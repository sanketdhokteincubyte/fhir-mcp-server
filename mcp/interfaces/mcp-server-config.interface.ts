export enum McpAuthType {
  OAUTH = 'oauth',
  MCP_OAUTH = 'mcpOAuth',
  API_KEY = 'apiKey',
  NONE = 'none',
}

export interface McpOAuthConfig {
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export interface McpOAuthDynamicConfig {
  scopes: string[];
}

export interface McpServerConfig {
  slug: string;
  name: string;
  description: string;
  serverUrl: string;
  serverUrlEnvVar?: string;
  iconUrl?: string;
  authType?: McpAuthType;
  oauth?: McpOAuthConfig;
  mcpOAuth?: McpOAuthDynamicConfig;
  apiKeyEnvVar?: string;
  capabilities: McpServerCapability[];
}

export enum McpServerCapability {
  TOOLS = 'tools',
  RESOURCES = 'resources',
  PROMPTS = 'prompts',
}

export interface McpServerInfo {
  name?: string;
  version?: string;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}
