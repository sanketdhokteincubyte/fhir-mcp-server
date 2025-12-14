# MCP OAuth Flow with Dynamic Client Registration

## Overview

This document explains how the MCP OAuth flow works with Dynamic Client Registration between your NestJS MCP Client and the FHIR MCP Server.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   NestJS MCP    │         │   FHIR MCP       │         │   FHIR Server   │
│     Client      │         │     Server       │         │  (ECW Cloud)    │
└─────────────────┘         └──────────────────┘         └─────────────────┘
```

## Complete OAuth Flow

### Step 1: User Initiates Connection
**Client → User**
- User clicks "Connect to FHIR" in your application
- Client calls `POST /mcp-servers/:organizationId/connections/initiate` with `serverSlug: "fhir"`

### Step 2: Discover OAuth Metadata
**Client → MCP Server**
- Client calls `GET http://localhost:8000/.well-known/oauth-authorization-server`
- MCP Server returns OAuth metadata including:
  - `authorization_endpoint`: `http://localhost:8000/authorize`
  - `token_endpoint`: `http://localhost:8000/token`
  - `registration_endpoint`: `http://localhost:8000/register`

### Step 3: Dynamic Client Registration
**Client → MCP Server**
- Client calls `POST http://localhost:8000/register` with:
  ```json
  {
    "client_name": "Rolai - fhir",
    "redirect_uris": ["http://localhost:3000/auth/mcp-servers/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "client_secret_post"
  }
  ```
- MCP Server returns:
  ```json
  {
    "client_id": "fhir_mcp_abc123",
    "client_secret": "secret456"
  }
  ```

### Step 4: Generate PKCE Challenge
**Client (Internal)**
- Client generates:
  - `code_verifier`: Random 32-byte string (base64url encoded)
  - `code_challenge`: SHA256 hash of code_verifier (base64url encoded)
  - `code_challenge_method`: "S256"

### Step 5: Build Authorization URL
**Client → User's Browser**
- Client redirects user to:
  ```
  http://localhost:8000/authorize?
    response_type=code&
    client_id=fhir_mcp_abc123&
    redirect_uri=http://localhost:3000/auth/mcp-servers/callback&
    scope=patient/*.*+user/*.*&
    state=uuid-state-value&
    code_challenge=challenge-value&
    code_challenge_method=S256
  ```

### Step 6: MCP Server Proxies to FHIR Server
**MCP Server → FHIR Server**
- MCP Server stores the client's redirect_uri and PKCE challenge in state mapping
- MCP Server redirects to FHIR Server's authorization endpoint:
  ```
  https://staging-fhir.ecwcloud.com/fhir/r4/FFBJCD/oauth2/authorize?
    response_type=code&
    client_id=YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM&
    redirect_uri=http://localhost:8000/oauth/callback&  ← MCP Server's callback!
    scope=patient/Condition.read&
    state=uuid-state-value&
    code_challenge=mcp-generated-challenge&
    code_challenge_method=S256&
    aud=https://staging-fhir.ecwcloud.com/fhir/r4/FFBJCD
  ```

### Step 7: User Authorizes
**User → FHIR Server**
- User logs in to FHIR server
- User grants permissions

### Step 8: FHIR Server Redirects to MCP Server
**FHIR Server → MCP Server**
- FHIR Server redirects to:
  ```
  http://localhost:8000/oauth/callback?
    code=fhir-auth-code-xyz&
    state=uuid-state-value
  ```
- **IMPORTANT**: This must be HTTP, not HTTPS!

### Step 9: MCP Server Handles Callback
**MCP Server (Internal)**
- MCP Server's `/oauth/callback` route handler receives the request
- Retrieves client's redirect_uri from state mapping
- Creates a new MCP authorization code
- Stores mapping: `mcp_auth_code → fhir_auth_code`

### Step 10: MCP Server Redirects to Client
**MCP Server → Client**
- MCP Server redirects to:
  ```
  http://localhost:3000/auth/mcp-servers/callback?
    code=fhir_mcp_new-code-123&
    state=uuid-state-value
  ```

### Step 11: Client Exchanges Code for Token
**Client → MCP Server**
- Client calls `POST http://localhost:8000/token` with:
  ```
  grant_type=authorization_code
  code=fhir_mcp_new-code-123
  client_id=fhir_mcp_abc123
  client_secret=secret456
  redirect_uri=http://localhost:3000/auth/mcp-servers/callback
  code_verifier=original-pkce-verifier
  ```

### Step 12: MCP Server Exchanges with FHIR Server
**MCP Server → FHIR Server**
- MCP Server retrieves the original FHIR auth code from mapping
- MCP Server calls FHIR Server's token endpoint:
  ```
  POST https://staging-fhir.ecwcloud.com/fhir/r4/FFBJCD/oauth2/token
  grant_type=authorization_code
  code=fhir-auth-code-xyz
  client_id=YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM
  client_secret=4IwEpBrZ8vVZ1j-ncL3_2wL6CveF-l3qUgL5_rTcdEsjhrkzeD9H9IXOWljY10nz
  redirect_uri=http://localhost:8000/oauth/callback
  code_verifier=mcp-generated-verifier
  ```

### Step 13: FHIR Server Returns Tokens
**FHIR Server → MCP Server**
- Returns:
  ```json
  {
    "access_token": "fhir-access-token",
    "refresh_token": "fhir-refresh-token",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
  ```

### Step 14: MCP Server Returns Tokens to Client
**MCP Server → Client**
- MCP Server wraps the FHIR tokens and returns to client:
  ```json
  {
    "access_token": "fhir-access-token",
    "refresh_token": "fhir-refresh-token",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
  ```

### Step 15: Client Stores Connection
**Client (Internal)**
- Client stores the connection in database with:
  - `userId`
  - `organizationId`
  - `serverSlug: "fhir"`
  - `accessToken: "fhir-access-token"`
  - `refreshToken: "fhir-refresh-token"`
  - `tokenExpiresAt: Date`

### Step 16: Client Uses MCP Server
**Client → MCP Server**
- Client connects to MCP server using StreamableHTTP transport:
  ```
  GET http://localhost:8000/mcp
  Authorization: Bearer fhir-access-token
  ```
- Client can now call MCP tools like `search_fhir_resources`, `read_fhir_resource`, etc.

## Common Issues

### Issue 1: "Invalid HTTP request received"

**Cause**: The FHIR server is redirecting to `https://localhost:8000/oauth/callback` but the MCP server is running on HTTP.

**Solution**: Set `FHIR_MCP_SERVER_URL` in `.env`:
```bash
FHIR_MCP_SERVER_URL="http://localhost:8000"
```

This ensures the MCP server uses HTTP in the callback URL it registers with the FHIR server.

### Issue 2: Token exchange fails with "invalid_client" (401)

**Cause**: The redirect URI `http://localhost:8000/oauth/callback` is NOT registered in the FHIR server's OAuth client configuration.

**Symptoms**:
```
HTTP Request: POST https://staging-oauthserver.ecwcloud.com/oauth/oauth2/token "HTTP/1.1 401 "
Token endpoint response: 401 - {"error":"invalid_client"}
```

**Solution A - Register Redirect URI (Recommended)**:
1. Contact your FHIR server administrator (ECW Cloud support)
2. Request to add `http://localhost:8000/oauth/callback` to the allowed redirect URIs for your OAuth client
3. Provide your client_id: `YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM`

**Solution B - Use ngrok for Local Development**:
```bash
# 1. Install and start ngrok
ngrok http 8000

# 2. Copy the HTTPS URL (e.g., https://abc123.ngrok.io)

# 3. Update .env
FHIR_MCP_SERVER_URL="https://abc123.ngrok.io"

# 4. Register https://abc123.ngrok.io/oauth/callback with FHIR server

# 5. Restart MCP server
uv run fhir-mcp-server --transport streamable-http --log-level DEBUG
```

**Solution C - Use Existing Redirect URI**:
1. Ask your FHIR server administrator for the list of allowed redirect URIs
2. If one exists (e.g., `https://your-domain.com/callback`), deploy MCP server there
3. Update `FHIR_MCP_SERVER_URL` to match

**Verification**:
Run the verification script to test which redirect URIs are registered:
```bash
uv run python verify_redirect_uri.py
```

### Issue 3: State parameter mismatch

**Cause**: The state value is being modified or lost during redirects.

**Solution**: Ensure the same state value is passed through all redirects.

### Issue 4: PKCE verification failed

**Cause**: The code_verifier doesn't match the code_challenge.

**Solution**: Ensure the client stores the code_verifier and sends it during token exchange.

## Environment Variables

### FHIR MCP Server (.env)
```bash
# MCP Server Configuration
FHIR_MCP_HOST="localhost"
FHIR_MCP_PORT=8000
FHIR_MCP_SERVER_URL="http://localhost:8000"  # ← IMPORTANT!

# FHIR Server Configuration
FHIR_SERVER_BASE_URL="https://staging-fhir.ecwcloud.com/fhir/r4/FFBJCD"
FHIR_SERVER_DISABLE_AUTHORIZATION=False
FHIR_SERVER_CLIENT_ID="your-client-id"
FHIR_SERVER_CLIENT_SECRET="your-client-secret"
FHIR_SERVER_SCOPES="patient/Condition.read"
```

### NestJS MCP Client
```bash
# Web App Base URL (for OAuth callbacks)
WEB_APP_BASE_URL="http://localhost:3000"

# MCP FHIR Server URL
MCP_FHIR_SERVER_URL="http://localhost:8000/mcp"
```

## Testing the Flow

### 1. Start the FHIR MCP Server
```bash
uv run fhir-mcp-server --transport streamable-http --log-level DEBUG
```

### 2. Test OAuth Metadata Discovery
```powershell
Invoke-RestMethod -Uri "http://localhost:8000/.well-known/oauth-authorization-server"
```

### 3. Test Dynamic Client Registration
```powershell
$body = @{
    client_name = "Test Client"
    redirect_uris = @("http://localhost:3000/callback")
    grant_types = @("authorization_code", "refresh_token")
    response_types = @("code")
    token_endpoint_auth_method = "client_secret_post"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8000/register" -Method POST -ContentType "application/json" -Body $body
```

### 4. Test Full Flow in Your Client
- Navigate to your app
- Click "Connect to FHIR"
- Complete the OAuth flow
- Verify the connection is stored

## Security Considerations

1. **PKCE**: Always use PKCE for public clients (mobile/SPA apps)
2. **State Parameter**: Always validate the state parameter to prevent CSRF attacks
3. **HTTPS in Production**: Use HTTPS for all OAuth endpoints in production
4. **Token Storage**: Store tokens securely (encrypted in database)
5. **Token Expiry**: Implement token refresh logic before tokens expire

