import { McpServerCapability, McpServerConfig } from '../interfaces';

export class AvailableMcpServerDto {
  slug: string;
  name: string;
  description: string;
  iconUrl?: string;
  capabilities: McpServerCapability[];
  isConfigured: boolean;

  constructor(server: McpServerConfig, isConfigured: boolean) {
    this.slug = server.slug;
    this.name = server.name;
    this.description = server.description;
    this.iconUrl = server.iconUrl;
    this.capabilities = server.capabilities;
    this.isConfigured = isConfigured;
  }
}

export class AvailableMcpServersResponseDto {
  servers: AvailableMcpServerDto[];

  constructor(servers: AvailableMcpServerDto[]) {
    this.servers = servers;
  }
}
