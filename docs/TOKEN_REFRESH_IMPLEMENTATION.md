# Token Refresh Implementation

## Overview

Implemented automatic token refresh for MCP OAuth connections using the **Smart Connection Pattern**. When an access token expires, the connection automatically refreshes itself and retries the request.

## Architecture: Smart Connection Pattern

This implementation follows SOLID principles and clean code practices:

- **Single Responsibility**: Each class has one clear responsibility
- **DRY**: Token refresh logic is centralized, not duplicated
- **Encapsulation**: Connection manages its own lifecycle
- **Separation of Concerns**: Protocol logic separated from business logic

## How It Works

### Token Expiry Detection

When the MCP server detects an expired token:

```python
# src/fhir_mcp_server/oauth/server_provider.py
async def load_access_token(self, token: str) -> AccessToken | None:
    access_token = self.token_mapping.get(token)
    if access_token.expires_at and access_token.expires_at < time.time():
        logger.warning(f"Access token expired: {token[:20]}...")
        return None  # Returns None, causing 401 Unauthorized
```

### Client-Side Token Refresh Flow

1. **Client makes request** with expired token
2. **MCP server returns 401** Unauthorized
3. **Client detects 401** and initiates refresh
4. **Client calls `/token` endpoint** with refresh token
5. **MCP server proxies** refresh request to FHIR server
6. **FHIR server returns** new access token
7. **MCP server generates** new MCP access token
8. **Client stores** new tokens
9. **Client retries** original request with new token

## Implementation Details

### 1. RefreshableConnection (`mcp/interfaces/refreshable-connection.interface.ts`)

A smart connection wrapper that can refresh its own token:

```typescript
export class RefreshableConnection {
  constructor(
    public readonly connection: McpClientConnection,
    private readonly refreshCallback: () => Promise<{
      accessToken: string;
      connection: McpClientConnection;
    }>,
    accessToken: string,
  ) {}

  async refresh(): Promise<void> {
    const { accessToken, connection } = await this.refreshCallback();
    // Update internal state
  }
}
```

### 2. MCP Client Service (`mcp/services/mcp-client.service.ts`)

Updated `listTools()` and `callTool()` to accept `RefreshableConnection` and automatically retry on 401:

```typescript
async listTools(
  connection: McpClientConnection | RefreshableConnection,
): Promise<McpTool[]> {
  try {
    const conn = this.getUnderlyingConnection(connection);
    const response = await conn.client.listTools();
    return this.formatTools(response);
  } catch (error) {
    // If 401 and connection is refreshable, refresh and retry
    if (this.is401Error(error) && this.isRefreshable(connection)) {
      await connection.refresh();
      const conn = this.getUnderlyingConnection(connection);
      const response = await conn.client.listTools();
      return this.formatTools(response);
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
    return await conn.client.callTool({ name: toolName, arguments: args });
  } catch (error) {
    // If 401 and connection is refreshable, refresh and retry
    if (this.is401Error(error) && this.isRefreshable(connection)) {
      await connection.refresh();
      const conn = this.getUnderlyingConnection(connection);
      return await conn.client.callTool({ name: toolName, arguments: args });
    }
    throw error;
  }
}
```

### 3. MCP Service (`mcp/mcp.service.ts`)

**Much simpler now!** No duplicate retry logic. Just creates RefreshableConnection:

```typescript
async getServerTools(userId: string, serverSlug: string): Promise<McpToolsResponseDto> {
  const serverConfig = this.mcpServerRegistryService.getServerBySlug(serverSlug);
  const tokens = await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(userId, serverSlug);

  // Create a refreshable connection with token refresh capability
  const refreshableConnection = await this.createRefreshableConnection(
    userId,
    serverSlug,
    serverConfig,
    tokens.accessToken,
  );

  try {
    // McpClientService handles 401 and automatic retry internally!
    const tools = await this.mcpClientService.listTools(refreshableConnection);
    return new McpToolsResponseDto(tools, serverSlug);
  } finally {
    await this.mcpClientService.disconnect(refreshableConnection.getConnection());
  }
}
```

The `createRefreshableConnection()` method injects the refresh callback:

```typescript
private async createRefreshableConnection(...): Promise<RefreshableConnection> {
  const baseConnection = await this.mcpClientService.connect(serverConfig, accessToken);

  const refreshCallback = async () => {
    const tokens = await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(...);
    const newTokens = await this.refreshTokenForConnection(...);
    const newConnection = await this.mcpClientService.connect(serverConfig, newTokens.accessToken);
    return { accessToken: newTokens.accessToken, connection: newConnection };
  };

  return new RefreshableConnection(baseConnection, refreshCallback, accessToken);
}
```

### 4. MCP Connection Service (`mcp/services/mcp-connection.service.ts`)

Helper methods for token management:

```typescript
async getConnectionByUserAndSlug(userId: string, serverSlug: string) {
  return this.transactionHost.tx.mcpServerConnection.findUnique({
    where: { userId_serverSlug: { userId, serverSlug } },
  });
}

async updateConnectionTokens(
  connectionId: string,
  accessToken: string,
  refreshToken?: string,
  tokenExpiresAt?: Date,
) {
  // Encrypt new tokens
  // Update database
}
```

## Token Refresh Flow Diagram

```
Client                    MCP Server                FHIR Server
  |                            |                          |
  |-- POST /mcp/ (expired) -->|                          |
  |                            |-- load_access_token() -->|
  |                            |<-- token expired --------|
  |<-- 401 Unauthorized -------|                          |
  |                            |                          |
  |-- POST /token ------------>|                          |
  |   (refresh_token)          |                          |
  |                            |-- POST /oauth/token ---->|
  |                            |   (FHIR refresh_token)   |
  |                            |<-- new FHIR token -------|
  |                            |-- generate MCP token --->|
  |<-- new MCP token ----------|                          |
  |                            |                          |
  |-- POST /mcp/ (new token) ->|                          |
  |<-- 200 OK (tools) ---------|                          |
```

## Testing

1. **Start MCP server** with short token expiry for testing
2. **Complete OAuth flow** to get initial tokens
3. **Wait for token to expire** (or manually expire it)
4. **Call list tools** - should automatically refresh and succeed

## Benefits of Smart Connection Pattern

### SOLID Principles
- ✅ **Single Responsibility** - Each class has one clear job
- ✅ **Open/Closed** - Can extend without modifying existing code
- ✅ **Dependency Inversion** - Depends on abstractions (RefreshableConnection interface)

### Clean Code
- ✅ **DRY** - Token refresh logic in ONE place, not duplicated across methods
- ✅ **Encapsulation** - Connection manages its own lifecycle
- ✅ **Separation of Concerns** - Protocol logic separated from business logic

### User Experience
- ✅ **Seamless** - No manual re-authentication needed
- ✅ **Automatic retry** - Failed requests automatically retried with fresh tokens
- ✅ **Transparent** - Application code doesn't need to handle token refresh

### Security & Reliability
- ✅ **Secure** - Refresh tokens encrypted in database
- ✅ **Testable** - Each component can be tested independently
- ✅ **Maintainable** - Easy to understand and modify

## Future Enhancements

1. **Proactive refresh** - refresh tokens before they expire
2. **Refresh token rotation** - handle refresh token rotation if FHIR server supports it
3. **Concurrent request handling** - prevent multiple simultaneous refresh requests
4. **Connection pooling** - reuse connections efficiently

