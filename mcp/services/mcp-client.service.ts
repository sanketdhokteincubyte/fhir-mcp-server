import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Injectable, Logger } from '@nestjs/common';
import {
  McpAuthType,
  McpClientConnection,
  McpServerConfig,
  McpServerInfo,
  McpTool,
  McpToolCallResult,
  RefreshableConnection,
} from '../interfaces';

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);

  async connect(
    serverConfig: McpServerConfig,
    authToken: string,
  ): Promise<McpClientConnection> {
    const client = new Client({
      name: 'rolai-mcp-client',
      version: '1.0.0',
    });

    const url = new URL(serverConfig.serverUrl);
    const authType = serverConfig.authType || McpAuthType.OAUTH;

    const headers: Record<string, string> = {};

    if (authType === McpAuthType.OAUTH || authType === McpAuthType.MCP_OAUTH) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else if (authType === McpAuthType.API_KEY) {
      headers['X-API-Key'] = authToken;
    }

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
      },
    });

    await client.connect(transport);

    this.logger.log(`Connected to MCP server at ${serverConfig.serverUrl}`);

    return { client, transport };
  }

  async disconnect(connection: McpClientConnection): Promise<void> {
    try {
      await connection.client.close();
      this.logger.log('Disconnected from MCP server');
    } catch (error) {
      this.logger.warn('Error disconnecting from MCP server', error);
    }
  }

  async listTools(
    connection: McpClientConnection | RefreshableConnection,
  ): Promise<McpTool[]> {
    try {
      const conn = this.getUnderlyingConnection(connection);
      const response = await conn.client.listTools();

      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
    } catch (error) {
      // If 401 and connection is refreshable, refresh and retry
      if (this.is401Error(error) && this.isRefreshable(connection)) {
        this.logger.log('Access token expired, refreshing and retrying listTools');
        await connection.refresh();

        const conn = this.getUnderlyingConnection(connection);
        const response = await conn.client.listTools();

        return response.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        }));
      }
      throw error;
    }
  }

  async callTool(
    connection: McpClientConnection | RefreshableConnection,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    try {
      const conn = this.getUnderlyingConnection(connection);
      const response = await conn.client.callTool({
        name: toolName,
        arguments: args,
      });

      return this.formatToolCallResult(response);
    } catch (error) {
      // If 401 and connection is refreshable, refresh and retry
      if (this.is401Error(error) && this.isRefreshable(connection)) {
        this.logger.log(
          `Access token expired during tool call '${toolName}', refreshing and retrying`,
        );
        await connection.refresh();

        const conn = this.getUnderlyingConnection(connection);
        const response = await conn.client.callTool({
          name: toolName,
          arguments: args,
        });

        return this.formatToolCallResult(response);
      }
      throw error;
    }
  }

  private formatToolCallResult(response: any): McpToolCallResult {
    return {
      content: (
        response.content as Array<{
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
          resource?: { uri?: string };
        }>
      ).map((c) => {
        if (c.type === 'text') {
          return { type: 'text' as const, text: c.text };
        }
        if (c.type === 'image') {
          return {
            type: 'image' as const,
            data: c.data,
            mimeType: c.mimeType,
          };
        }
        if (c.type === 'resource') {
          return {
            type: 'resource' as const,
            uri: c.resource?.uri,
          };
        }
        return { type: 'text' as const, text: JSON.stringify(c) };
      }),
      isError: response.isError as boolean,
      structuredContent: response.structuredContent,
    };
  }

  async getServerInfo(connection: McpClientConnection): Promise<McpServerInfo> {
    const serverInfo = connection.client.getServerVersion();

    return {
      name: serverInfo?.name,
      version: serverInfo?.version,
      capabilities: {
        tools: connection.client.getServerCapabilities()?.tools !== undefined,
        resources:
          connection.client.getServerCapabilities()?.resources !== undefined,
        prompts:
          connection.client.getServerCapabilities()?.prompts !== undefined,
      },
    };
  }

  async testConnection(
    serverConfig: McpServerConfig,
    authToken: string,
  ): Promise<boolean> {
    let connection: McpClientConnection | null = null;
    try {
      connection = await this.connect(serverConfig, authToken);
      await this.getServerInfo(connection);
      return true;
    } catch (error) {
      this.logger.warn('MCP connection test failed', error);
      return false;
    } finally {
      if (connection) {
        await this.disconnect(connection);
      }
    }
  }

  /**
   * Helper method to check if a connection is refreshable.
   */
  private isRefreshable(
    connection: McpClientConnection | RefreshableConnection,
  ): connection is RefreshableConnection {
    return connection instanceof RefreshableConnection;
  }

  /**
   * Helper method to get the underlying connection.
   */
  private getUnderlyingConnection(
    connection: McpClientConnection | RefreshableConnection,
  ): McpClientConnection {
    return this.isRefreshable(connection)
      ? connection.getConnection()
      : connection;
  }

  /**
   * Helper method to check if an error is a 401 Unauthorized error.
   */
  private is401Error(error: any): boolean {
    return error?.response?.status === 401 || error?.status === 401;
  }
}
