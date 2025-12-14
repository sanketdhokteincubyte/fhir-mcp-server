# Token Flow Debugging Guide

## Issue ✅ RESOLVED
After successful OAuth authentication, the MCP client gets a 401 Unauthorized error when trying to list tools.

## Root Cause - IDENTIFIED AND FIXED
The issue was **NOT** with token storage. The actual problems were:

### Primary Issue: Missing Authorization Header for MCP_OAUTH
The MCP client was only sending the `Authorization: Bearer <token>` header for `McpAuthType.OAUTH`, but NOT for `McpAuthType.MCP_OAUTH`.

**Code Issue** in `mcp/services/mcp-client.service.ts`:
```typescript
// ❌ BEFORE: Only OAUTH got the Authorization header
if (authType === McpAuthType.OAUTH) {
  headers['Authorization'] = `Bearer ${authToken}`;
}

// ✅ AFTER: Both OAUTH and MCP_OAUTH get the Authorization header
if (authType === McpAuthType.OAUTH || authType === McpAuthType.MCP_OAUTH) {
  headers['Authorization'] = `Bearer ${authToken}`;
}
```

**Fix Applied**: Updated `mcp-client.service.ts` to include `McpAuthType.MCP_OAUTH` in the authorization header condition.

### Secondary Issue: URL Trailing Slash
```
Client sends: POST /mcp (no trailing slash)
Server redirects: 307 → /mcp/ (with trailing slash)
Result: Unnecessary redirect
```

**Fix Applied**: Updated `serverUrl` in `predefined-mcp-servers.constant.ts` from:
- ❌ `https://aae8e7f44e8c.ngrok-free.app/mcp`
- ✅ `https://aae8e7f44e8c.ngrok-free.app/mcp/`

### Secondary Consideration: In-Memory Token Storage
The MCP server stores access tokens in an **in-memory dictionary** (`token_mapping`). This means:
- ✅ Tokens are stored after successful OAuth flow
- ⚠️ Tokens are lost if the server restarts
- ⚠️ Tokens are not shared across multiple server instances

## Debugging Steps

### Step 1: Check if Server Was Restarted
**Question**: Did you restart the MCP server between completing the OAuth flow and trying to list tools?

If YES → This is the issue. The in-memory token mapping was cleared.

**Solution**: Don't restart the server, or implement persistent token storage.

### Step 2: Check the Logs
After completing OAuth, you should see:
```
INFO - Storing MCP access token: fhir_mcp_<token>...
INFO - Mapped to FHIR access token: <fhir-token>...
INFO - Token mapping now has 1 tokens
```

When listing tools, you should see:
```
DEBUG - Loading access token: fhir_mcp_<token>...
DEBUG - Token mapping has 1 tokens
DEBUG - Access token loaded successfully: fhir_mcp_<token>...
```

If you see:
```
WARNING - Access token not found in mapping: fhir_mcp_<token>...
```
→ The token was not stored or the server was restarted.

### Step 3: Verify Token in Client
Check what token the client is sending:
1. In your NestJS client, add logging in `mcp-client.service.ts`:
   ```typescript
   this.logger.debug(`Connecting with token: ${authToken.substring(0, 20)}...`);
   ```

2. Verify it matches the token returned from the OAuth flow

### Step 4: Check Token Expiry
The token might have expired. Check the logs for:
```
WARNING - Access token expired: fhir_mcp_<token>...
```

## Solutions

### Solution 1: Don't Restart the Server (Quick Fix)
Keep the MCP server running continuously. Don't restart it between OAuth flow and tool usage.

### Solution 2: Implement Persistent Token Storage (Recommended)
Modify `OAuthServerProvider` to store tokens in a database or Redis instead of in-memory.

**Changes needed**:
1. Add a database table for token storage
2. Update `exchange_authorization_code()` to save tokens to DB
3. Update `load_access_token()` to load tokens from DB
4. Update `exchange_refresh_token()` to update tokens in DB

### Solution 3: Use Shorter Testing Cycle
Complete the OAuth flow and immediately test tool listing without restarting the server.

## Testing Procedure

1. **Start the MCP server** (don't restart after this):
   ```bash
   uv run fhir-mcp-server --transport streamable-http --log-level DEBUG
   ```

2. **Complete OAuth flow** from your NestJS client

3. **Immediately test tool listing** (without restarting the server):
   ```
   GET /mcp-servers/:organizationId/tools/:serverSlug
   ```

4. **Check the logs** for token loading messages

## Expected Log Flow

### During OAuth (Token Exchange):
```
INFO - Token exchange - MCP Server effective_server_url: https://aae8e7f44e8c.ngrok-free.app
INFO - Token exchange - Using redirect_uri: https://aae8e7f44e8c.ngrok-free.app/oauth/callback
INFO - Token exchange - Using client_id: YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM
INFO - Token exchange - Using Basic Auth: Basic <auth>...
HTTP Request: POST https://staging-oauthserver.ecwcloud.com/oauth/oauth2/token "HTTP/1.1 200 OK"
INFO - Storing MCP access token: fhir_mcp_abc123...
INFO - Mapped to FHIR access token: eyJhbGc...
INFO - Token mapping now has 1 tokens
```

### During Tool Listing:
```
DEBUG - Loading access token: fhir_mcp_abc123...
DEBUG - Token mapping has 1 tokens
DEBUG - Access token loaded successfully: fhir_mcp_abc123...
DEBUG - Using configured FHIR access token for user.
```

## Next Steps

1. Check if you restarted the server
2. Review the logs for token storage and loading messages
3. If the server was restarted, complete the OAuth flow again without restarting
4. If the issue persists, share the complete logs from OAuth flow to tool listing

