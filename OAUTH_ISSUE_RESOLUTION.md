# OAuth Issue Resolution - "invalid_client" Error

## Problem Summary

Your MCP OAuth flow is failing at the **token exchange** step with:
```
HTTP/1.1 401 Unauthorized
{"error":"invalid_client"}
```

## Root Causes (BOTH FIXED)

### 1. ✅ FIXED: Wrong Authentication Method
ECW Cloud FHIR server requires **Basic Authentication** (base64 encoded `client_id:client_secret` in Authorization header) for Confidential Apps, but the MCP server was using `client_secret_post` (sending credentials in POST body).

**Fix Applied**: Updated `server_provider.py` to use Basic Authentication as per ECW Cloud documentation.

### 2. Redirect URI Not Registered
The redirect URI needs to be registered with ECW Cloud's OAuth client configuration.

## Evidence from Logs

From `latest-log.txt`:

```
[Line 29-32] Token exchange parameters:
- effective_server_url: http://localhost:8000 ✅
- redirect_uri: http://localhost:8000/oauth/callback ✅
- client_id: YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM ✅

[Line 43] Token request to FHIR server:
POST https://staging-oauthserver.ecwcloud.com/oauth/oauth2/token

[Line 48] FHIR server response:
401 - {"error":"invalid_client"} ❌
```

The error "invalid_client" specifically means the FHIR server rejected the request due to:
- Invalid client credentials, OR
- **Redirect URI not in the allowed list** ← Most likely

## Solutions

### Option 1: Register Redirect URI with FHIR Server (Recommended)

**Steps:**
1. Contact ECW Cloud support or your FHIR server administrator
2. Request to add this redirect URI to your OAuth client:
   ```
   http://localhost:8000/oauth/callback
   ```
3. Provide your client_id:
   ```
   YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM
   ```
4. Wait for confirmation that the redirect URI has been added
5. Test the OAuth flow again

**Pros:**
- Simple and permanent solution
- No additional tools needed

**Cons:**
- Requires contacting FHIR server administrator
- May take time to get approval

---

### Option 2: Use ngrok for Local Development

**Steps:**

1. **Install ngrok** (if not already installed):
   - Download from https://ngrok.com/download
   - Or use: `choco install ngrok` (Windows with Chocolatey)

2. **Start ngrok**:
   ```bash
   ngrok http 8000
   ```

3. **Copy the HTTPS URL** from ngrok output:
   ```
   Forwarding: https://abc123.ngrok.io -> http://localhost:8000
   ```

4. **Update `.env` file**:
   ```bash
   FHIR_MCP_SERVER_URL="https://abc123.ngrok.io"
   ```

5. **Register the ngrok callback URL** with ECW Cloud:
   - Contact ECW Cloud support
   - Request to add: `https://abc123.ngrok.io/oauth/callback`
   - Provide client_id: `YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM`

6. **Restart the MCP server**:
   ```bash
   uv run fhir-mcp-server --transport streamable-http --log-level DEBUG
   ```

7. **Update your NestJS client** to use the ngrok URL:
   ```typescript
   // In predefined-mcp-servers.constant.ts
   serverUrl: 'https://abc123.ngrok.io/mcp'
   ```

**Pros:**
- Works immediately once registered
- Publicly accessible for testing
- HTTPS by default

**Cons:**
- Requires ngrok to be running
- Free ngrok URLs change on restart (use paid plan for static URLs)
- Adds latency

---

### Option 3: Check Existing Redirect URIs

**Steps:**

1. **Run the verification script**:
   ```bash
   uv run python verify_redirect_uri.py
   ```

2. **Check the output** for any redirect URI that shows `invalid_grant` instead of `invalid_client`
   - `invalid_client` = NOT registered
   - `invalid_grant` = IS registered (error is due to test code)

3. **If you find a registered URI**, update your `.env`:
   ```bash
   FHIR_MCP_SERVER_URL="<the-registered-uri-without-/oauth/callback>"
   ```

4. **Restart the MCP server**

**Pros:**
- No need to register new redirect URI
- Uses existing configuration

**Cons:**
- May not have any existing redirect URIs
- Existing URIs might not be suitable for local development

---

## Verification

After implementing any solution, verify it works:

1. **Check the logs** for the authorization request:
   ```
   INFO - MCP Server callback URL for FHIR authorization: <your-url>/oauth/callback
   ```

2. **Complete the OAuth flow** in your NestJS client

3. **Check the token exchange logs**:
   ```
   INFO - Token exchange - Using redirect_uri: <your-url>/oauth/callback
   ```

4. **Verify success**:
   ```
   HTTP Request: POST https://staging-oauthserver.ecwcloud.com/oauth/oauth2/token "HTTP/1.1 200 OK"
   ```

## Next Steps

1. **Choose a solution** based on your constraints:
   - Can you contact FHIR admin? → Option 1
   - Need quick testing? → Option 2
   - Want to check existing config? → Option 3

2. **Implement the solution**

3. **Test the complete OAuth flow**

4. **Update documentation** with the working configuration

## Additional Resources

- Full OAuth flow documentation: `docs/MCP_OAUTH_FLOW.md`
- Test script: `test_oauth_flow.py`
- Verification script: `verify_redirect_uri.py`

## Contact Information

If you need help registering the redirect URI with ECW Cloud:
- ECW Cloud Support: https://www.eclinicalworks.com/support/
- FHIR Server: https://staging-fhir.ecwcloud.com/fhir/r4/FFBJCD

