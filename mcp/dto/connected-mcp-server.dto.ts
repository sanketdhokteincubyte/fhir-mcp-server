import { McpConnectionStatus, McpServerConnection } from '@prisma/client';
import { McpServerConfig } from '../interfaces';

export class ConnectedMcpServerDto {
  id: string;
  serverSlug: string;
  serverName: string;
  description: string;
  iconUrl?: string;
  status: McpConnectionStatus;
  createdAt: Date;
  updatedAt: Date;

  constructor(connection: McpServerConnection, serverConfig?: McpServerConfig) {
    this.id = connection.id;
    this.serverSlug = connection.serverSlug;
    this.serverName = serverConfig?.name ?? connection.serverSlug;
    this.description = serverConfig?.description ?? '';
    this.iconUrl = serverConfig?.iconUrl;
    this.status = connection.status;
    this.createdAt = connection.createdAt;
    this.updatedAt = connection.updatedAt;
  }
}

export class ConnectedMcpServersResponseDto {
  connections: ConnectedMcpServerDto[];

  constructor(connections: ConnectedMcpServerDto[]) {
    this.connections = connections;
  }
}
