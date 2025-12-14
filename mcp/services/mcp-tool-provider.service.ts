import { createTool } from '@mastra/core/tools';
import { Injectable, Logger } from '@nestjs/common';
import { trackError } from '@src/lib/app-insights-logger';
import OpenAI from 'openai';
import { z } from 'zod';
import { McpTool } from '../interfaces';
import { McpClientService } from './mcp-client.service';
import { McpConnectionService } from './mcp-connection.service';
import { McpServerRegistryService } from './mcp-server-registry.service';

@Injectable()
export class McpToolProviderService {
  private readonly logger = new Logger(McpToolProviderService.name);
  private readonly MCP_TOOL_PREFIX = 'mcp_';

  constructor(
    private readonly mcpConnectionService: McpConnectionService,
    private readonly mcpServerRegistryService: McpServerRegistryService,
    private readonly mcpClientService: McpClientService,
  ) {}

  async getOpenAiTools(
    userId: string,
  ): Promise<OpenAI.Responses.FunctionTool[]> {
    const allTools: OpenAI.Responses.FunctionTool[] = [];

    try {
      const connections =
        await this.mcpConnectionService.getConnectionsByUserId(userId);

      if (!connections || connections.length === 0) {
        return allTools;
      }

      for (const connection of connections) {
        try {
          const serverConfig = this.mcpServerRegistryService.getServerBySlug(
            connection.serverSlug,
          );

          if (!serverConfig) {
            this.logger.warn(
              `Server config not found for slug: ${connection.serverSlug}`,
            );
            continue;
          }

          const tokens =
            await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(
              userId,
              connection.serverSlug,
            );

          if (!tokens) {
            this.logger.warn(
              `No tokens found for server: ${connection.serverSlug}`,
            );
            continue;
          }

          const mcpConnection = await this.mcpClientService.connect(
            serverConfig,
            tokens.accessToken,
          );

          try {
            const tools = await this.mcpClientService.listTools(mcpConnection);
            const convertedTools = tools.map((tool) =>
              this.convertMcpToolToOpenAi(tool, connection.serverSlug),
            );
            allTools.push(...convertedTools);
          } finally {
            await this.mcpClientService.disconnect(mcpConnection);
          }
        } catch (error) {
          trackError(error, {
            errorFrom: 'McpToolProviderService.getOpenAiTools',
            serverSlug: connection.serverSlug,
            userId,
          });
          this.logger.error(
            `Failed to get tools from server ${connection.serverSlug}`,
            error,
          );
        }
      }
    } catch (error) {
      trackError(error, {
        errorFrom: 'McpToolProviderService.getOpenAiTools',
        userId,
      });
      this.logger.error('Failed to get MCP tools for user', error);
    }

    return allTools;
  }

  async getMastraTools(userId: string): Promise<Record<string, any>> {
    const allTools: Record<string, any> = {};

    try {
      const connections =
        await this.mcpConnectionService.getConnectionsByUserId(userId);

      if (!connections || connections.length === 0) {
        return allTools;
      }

      for (const connection of connections) {
        try {
          const serverConfig = this.mcpServerRegistryService.getServerBySlug(
            connection.serverSlug,
          );

          if (!serverConfig) {
            this.logger.warn(
              `Server config not found for slug: ${connection.serverSlug}`,
            );
            continue;
          }

          const tokens =
            await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(
              userId,
              connection.serverSlug,
            );

          if (!tokens) {
            this.logger.warn(
              `No tokens found for server: ${connection.serverSlug}`,
            );
            continue;
          }

          const mcpConnection = await this.mcpClientService.connect(
            serverConfig,
            tokens.accessToken,
          );

          try {
            const tools = await this.mcpClientService.listTools(mcpConnection);

            for (const tool of tools) {
              const toolName = this.formatToolName(
                connection.serverSlug,
                tool.name,
              );
              allTools[toolName] = this.convertMcpToolToMastra(
                tool,
                connection.serverSlug,
                userId,
              );
            }
          } finally {
            await this.mcpClientService.disconnect(mcpConnection);
          }
        } catch (error) {
          trackError(error, {
            errorFrom: 'McpToolProviderService.getMastraTools',
            serverSlug: connection.serverSlug,
            userId,
          });
          this.logger.error(
            `Failed to get Mastra tools from server ${connection.serverSlug}`,
            error,
          );
        }
      }
    } catch (error) {
      trackError(error, {
        errorFrom: 'McpToolProviderService.getMastraTools',
        userId,
      });
      this.logger.error('Failed to get MCP Mastra tools for user', error);
    }

    return allTools;
  }

  async executeTool(
    userId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: any; error?: boolean }> {
    try {
      const { serverSlug, originalToolName } = this.parseToolName(toolName);

      const serverConfig =
        this.mcpServerRegistryService.getServerBySlug(serverSlug);

      if (!serverConfig) {
        return {
          output: `MCP server '${serverSlug}' not found`,
          error: true,
        };
      }

      const tokens =
        await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(
          userId,
          serverSlug,
        );

      if (!tokens) {
        return {
          output: `No active connection found for MCP server '${serverSlug}'`,
          error: true,
        };
      }

      const connection = await this.mcpClientService.connect(
        serverConfig,
        tokens.accessToken,
      );

      try {
        const result = await this.mcpClientService.callTool(
          connection,
          originalToolName,
          args,
        );

        if (result.isError) {
          return {
            output: this.formatToolOutput(result.content),
            error: true,
          };
        }

        return {
          output: this.formatToolOutput(result.content),
          error: false,
        };
      } finally {
        await this.mcpClientService.disconnect(connection);
      }
    } catch (error) {
      trackError(error, {
        errorFrom: 'McpToolProviderService.executeTool',
        toolName,
        userId,
      });
      this.logger.error(`Failed to execute MCP tool ${toolName}`, error);
      return {
        output: `Error executing MCP tool: ${error.message}`,
        error: true,
      };
    }
  }

  isMcpTool(toolName: string): boolean {
    return toolName.startsWith(this.MCP_TOOL_PREFIX);
  }

  private convertMcpToolToOpenAi(
    tool: McpTool,
    serverSlug: string,
  ): OpenAI.Responses.FunctionTool {
    return {
      type: 'function',
      name: this.formatToolName(serverSlug, tool.name),
      description: tool.description || `MCP tool: ${tool.name}`,
      parameters: {
        ...(tool.inputSchema as object),
        additionalProperties: false,
      },
      strict: false,
    };
  }

  private convertMcpToolToMastra(
    tool: McpTool,
    serverSlug: string,
    userId: string,
  ): any {
    const toolName = this.formatToolName(serverSlug, tool.name);

    return createTool({
      id: toolName,
      description: tool.description || `MCP tool: ${tool.name}`,
      inputSchema: z.record(z.any()),
      execute: async ({ context }) => {
        const result = await this.executeTool(userId, toolName, context);
        if (result.error) {
          throw new Error(
            typeof result.output === 'string'
              ? result.output
              : JSON.stringify(result.output),
          );
        }
        return result.output;
      },
    });
  }

  private parseToolName(toolName: string): {
    serverSlug: string;
    originalToolName: string;
  } {
    // Format: mcp_{serverSlug}_{originalToolName}
    const parts = toolName.split('_');
    if (parts.length < 3 || parts[0] !== 'mcp') {
      throw new Error(`Invalid MCP tool name format: ${toolName}`);
    }

    const serverSlug = parts[1];
    const originalToolName = parts.slice(2).join('_');

    return { serverSlug, originalToolName };
  }

  private formatToolName(serverSlug: string, toolName: string): string {
    return `${this.MCP_TOOL_PREFIX}${serverSlug}_${toolName}`;
  }

  private formatToolOutput(content: any[]): any {
    if (!content || content.length === 0) {
      return '';
    }

    if (content.length === 1 && content[0].type === 'text') {
      return content[0].text;
    }

    return content.map((item) => {
      if (item.type === 'text') {
        return item.text;
      }
      if (item.type === 'image') {
        return {
          type: 'image',
          mimeType: item.mimeType,
          data: item.data,
        };
      }
      if (item.type === 'resource') {
        return {
          type: 'resource',
          uri: item.uri,
        };
      }
      return item;
    });
  }
}
