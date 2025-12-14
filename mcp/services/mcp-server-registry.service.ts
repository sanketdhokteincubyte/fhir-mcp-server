import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PREDEFINED_MCP_SERVERS } from '../constants';
import { McpAuthType, McpServerConfig } from '../interfaces';

@Injectable()
export class McpServerRegistryService {
  private readonly servers: Map<string, McpServerConfig>;

  constructor(private readonly configService: ConfigService) {
    this.servers = new Map(
      PREDEFINED_MCP_SERVERS.map((server) => [server.slug, server]),
    );
  }

  getAllServers(): McpServerConfig[] {
    return Array.from(this.servers.values());
  }

  getServerBySlug(slug: string): McpServerConfig | undefined {
    return this.servers.get(slug);
  }

  getServerUrl(server: McpServerConfig): string {
    if (server.serverUrlEnvVar) {
      const envUrl = this.configService.get<string>(server.serverUrlEnvVar);
      if (envUrl) {
        return envUrl;
      }
    }
    return server.serverUrl;
  }

  getOAuthClientId(server: McpServerConfig): string | undefined {
    if (!server.oauth) {
      return undefined;
    }
    return this.configService.get<string>(server.oauth.clientIdEnvVar);
  }

  getOAuthClientSecret(server: McpServerConfig): string | undefined {
    if (!server.oauth) {
      return undefined;
    }
    return this.configService.get<string>(server.oauth.clientSecretEnvVar);
  }

  hasValidOAuthConfig(server: McpServerConfig): boolean {
    const clientId = this.getOAuthClientId(server);
    const clientSecret = this.getOAuthClientSecret(server);
    return Boolean(clientId && clientSecret);
  }

  hasValidConfig(server: McpServerConfig): boolean {
    const authType = server.authType || McpAuthType.OAUTH;

    if (authType === McpAuthType.OAUTH) {
      return this.hasValidOAuthConfig(server);
    } else if (authType === McpAuthType.MCP_OAUTH) {
      return Boolean(server.mcpOAuth);
    } else if (authType === McpAuthType.API_KEY) {
      return Boolean(
        server.apiKeyEnvVar && this.configService.get(server.apiKeyEnvVar),
      );
    } else {
      return true;
    }
  }

  getAuthToken(server: McpServerConfig): string | undefined {
    const authType = server.authType || McpAuthType.OAUTH;

    if (authType === McpAuthType.API_KEY) {
      return this.configService.get<string>(server.apiKeyEnvVar!);
    } else if (authType === McpAuthType.NONE) {
      return 'no-auth';
    }
    return undefined;
  }
}
