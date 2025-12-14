"""
Script to verify redirect URI configuration with FHIR server.
This helps identify if the redirect_uri is the issue.
"""

import asyncio
import httpx
from urllib.parse import urlencode

# Configuration from .env
FHIR_SERVER_BASE_URL = "https://staging-fhir.ecwcloud.com/fhir/r4/FFBJCD"
FHIR_CLIENT_ID = "YtcHWZdmDzyltJNcTFGci8UONC3Wz8OWoQy6hUiM3DM"
FHIR_CLIENT_SECRET = "4IwEpBrZ8vVZ1j-ncL3_2wL6CveF-l3qUgL5_rTcdEsjhrkzeD9H9IXOWljY10nz"

# Test different redirect URIs
TEST_REDIRECT_URIS = [
    "http://localhost:8000/oauth/callback",
    "https://localhost:8000/oauth/callback",
    "http://localhost:3000/callback",
    "https://localhost:3000/callback",
]

async def discover_smart_config():
    """Discover SMART configuration from FHIR server."""
    print("\n=== Discovering SMART Configuration ===")
    discovery_url = f"{FHIR_SERVER_BASE_URL}/.well-known/smart-configuration"
    
    async with httpx.AsyncClient(verify=False) as client:
        try:
            response = await client.get(discovery_url)
            print(f"Status: {response.status_code}")
            if response.status_code == 200:
                config = response.json()
                print(f"\nAuthorization Endpoint: {config.get('authorization_endpoint')}")
                print(f"Token Endpoint: {config.get('token_endpoint')}")
                print(f"Capabilities: {config.get('capabilities', [])}")
                return config
            else:
                print(f"Error: {response.text}")
        except Exception as e:
            print(f"Error: {e}")
    return None

async def test_token_request(redirect_uri: str, auth_code: str = "test_code"):
    """Test token request with a specific redirect_uri."""
    print(f"\n=== Testing Token Request with redirect_uri: {redirect_uri} ===")
    
    token_url = "https://staging-oauthserver.ecwcloud.com/oauth/oauth2/token"
    
    data = {
        "grant_type": "authorization_code",
        "code": auth_code,
        "client_id": FHIR_CLIENT_ID,
        "client_secret": FHIR_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
    }
    
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    
    async with httpx.AsyncClient(verify=False) as client:
        try:
            response = await client.post(token_url, data=data, headers=headers)
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            if response.status_code == 401:
                error = response.json()
                if error.get("error") == "invalid_client":
                    print("❌ INVALID_CLIENT - This redirect_uri is likely NOT registered")
                elif error.get("error") == "invalid_grant":
                    print("✅ REDIRECT_URI IS VALID - Error is due to invalid/expired code")
            elif response.status_code == 200:
                print("✅ SUCCESS - Token obtained")
                
        except Exception as e:
            print(f"Error: {e}")

async def main():
    """Run verification tests."""
    print("=" * 80)
    print("FHIR OAuth Redirect URI Verification")
    print("=" * 80)
    
    # Step 1: Discover SMART configuration
    config = await discover_smart_config()
    
    # Step 2: Test token requests with different redirect URIs
    print("\n" + "=" * 80)
    print("Testing Token Requests with Different Redirect URIs")
    print("=" * 80)
    print("\nNote: We expect 'invalid_grant' error if redirect_uri is valid")
    print("      We expect 'invalid_client' error if redirect_uri is NOT registered")
    
    for redirect_uri in TEST_REDIRECT_URIS:
        await test_token_request(redirect_uri)
        await asyncio.sleep(1)  # Rate limiting
    
    print("\n" + "=" * 80)
    print("Summary")
    print("=" * 80)
    print("\nIf all redirect URIs show 'invalid_client' error:")
    print("  → You need to register a redirect URI with the FHIR server")
    print("\nIf one shows 'invalid_grant' error:")
    print("  → That redirect_uri IS registered - use it in FHIR_MCP_SERVER_URL")
    print("\nNext Steps:")
    print("  1. Contact ECW Cloud support to add redirect URI to your OAuth client")
    print("  2. Or use ngrok to expose your MCP server with a public URL")
    print("  3. Add the ngrok URL to your OAuth client's allowed redirect URIs")

if __name__ == "__main__":
    asyncio.run(main())

