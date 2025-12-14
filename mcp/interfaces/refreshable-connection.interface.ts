import { McpClientConnection } from './mcp-client.interface';

/**
 * A connection wrapper that can refresh its own access token when it expires.
 * This follows the Single Responsibility Principle - the connection is responsible
 * for maintaining its own validity.
 */
export class RefreshableConnection {
  private currentAccessToken: string;

  constructor(
    public readonly connection: McpClientConnection,
    private readonly refreshCallback: () => Promise<{
      accessToken: string;
      connection: McpClientConnection;
    }>,
    accessToken: string,
  ) {
    this.currentAccessToken = accessToken;
  }

  /**
   * Refresh the access token and update the connection.
   * This is called automatically when a 401 error is detected.
   */
  async refresh(): Promise<void> {
    const { accessToken, connection } = await this.refreshCallback();
    this.currentAccessToken = accessToken;
    // Update the connection reference
    Object.assign(this.connection, connection);
  }

  /**
   * Get the current access token.
   */
  getAccessToken(): string {
    return this.currentAccessToken;
  }

  /**
   * Get the underlying MCP client connection.
   */
  getConnection(): McpClientConnection {
    return this.connection;
  }
}

