"""
Test script to debug OAuth flow issues.
This script helps identify where the OAuth flow is failing.
"""

import asyncio
import httpx
from urllib.parse import urlencode

# Configuration
MCP_SERVER_URL = "http://localhost:8000"
CLIENT_REDIRECT_URI = "http://localhost:3000/auth/mcp-servers/callback"

async def test_oauth_metadata():
    """Test OAuth metadata discovery."""
    print("\n=== Testing OAuth Metadata Discovery ===")
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{MCP_SERVER_URL}/.well-known/oauth-authorization-server")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        return response.json()

async def test_dynamic_registration():
    """Test dynamic client registration."""
    print("\n=== Testing Dynamic Client Registration ===")
    async with httpx.AsyncClient() as client:
        payload = {
            "client_name": "Test Client",
            "redirect_uris": [CLIENT_REDIRECT_URI],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "client_secret_post"
        }
        response = await client.post(
            f"{MCP_SERVER_URL}/register",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        return response.json()

async def test_authorization_url(client_id: str):
    """Test authorization URL generation."""
    print("\n=== Testing Authorization URL ===")
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CLIENT_REDIRECT_URI,
        "state": "test-state-123",
        "scope": "patient/Condition.read",
        "code_challenge": "test-challenge",
        "code_challenge_method": "S256"
    }
    auth_url = f"{MCP_SERVER_URL}/authorize?{urlencode(params)}"
    print(f"Authorization URL: {auth_url}")
    print("\nOpen this URL in your browser to test the authorization flow.")
    print("After authorization, check the MCP server logs for the redirect_uri being used.")
    return auth_url

async def main():
    """Run all tests."""
    try:
        # Test 1: OAuth Metadata
        metadata = await test_oauth_metadata()
        
        # Test 2: Dynamic Registration
        client_info = await test_dynamic_registration()
        client_id = client_info.get("client_id")
        
        # Test 3: Authorization URL
        if client_id:
            auth_url = await test_authorization_url(client_id)
            
            print("\n=== Next Steps ===")
            print("1. Open the authorization URL in your browser")
            print("2. Complete the FHIR authorization")
            print("3. Check the MCP server logs for:")
            print("   - 'MCP Server effective_server_url'")
            print("   - 'MCP Server callback URL for FHIR authorization'")
            print("4. Verify the callback URL uses HTTP (not HTTPS)")
            print("5. After callback, check the token exchange logs for:")
            print("   - 'Token exchange - Using redirect_uri'")
            print("   - Verify it matches the authorization redirect_uri")
            
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())

