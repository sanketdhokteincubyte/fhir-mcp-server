import { McpTool } from '../interfaces';

export class McpToolDto {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;

  constructor(tool: McpTool) {
    this.name = tool.name;
    this.description = tool.description;
    this.inputSchema = tool.inputSchema;
  }
}

export class McpToolsResponseDto {
  tools: McpToolDto[];
  serverSlug: string;

  constructor(tools: McpTool[], serverSlug: string) {
    this.tools = tools.map((t) => new McpToolDto(t));
    this.serverSlug = serverSlug;
  }
}
