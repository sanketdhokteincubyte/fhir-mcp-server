import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Cache } from 'cache-manager';
import { createHash, randomBytes } from 'node:crypto';

export interface McpOAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface McpDynamicClientInfo {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

const MCP_CLIENT_CACHE_PREFIX = 'mcp_dynamic_client_';
const MCP_PKCE_CACHE_PREFIX = 'mcp_pkce_';
const CLIENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PKCE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class McpOAuthService {
  private readonly logger = new Logger(McpOAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async discoverOAuthMetadata(
    serverBaseUrl: string,
  ): Promise<McpOAuthMetadata> {
    const metadataUrl = `${serverBaseUrl.replace(
      /\/$/,
      '',
    )}/.well-known/oauth-authorization-server`;

    this.logger.debug(`Discovering OAuth metadata from ${metadataUrl}`);

    const response = await axios.get<McpOAuthMetadata>(metadataUrl, {
      headers: { Accept: 'application/json' },
    });

    return response.data;
  }

  async registerClient(
    registrationEndpoint: string,
    redirectUri: string,
    clientName: string = 'Rolai MCP Client',
  ): Promise<McpDynamicClientInfo> {
    this.logger.debug(`Registering client at ${registrationEndpoint}`);

    const response = await axios.post<McpDynamicClientInfo>(
      registrationEndpoint,
      {
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );

    return response.data;
  }

  async getOrCreateDynamicClient(
    serverSlug: string,
    serverBaseUrl: string,
    redirectUri: string,
  ): Promise<{ metadata: McpOAuthMetadata; client: McpDynamicClientInfo }> {
    const cacheKey = `${MCP_CLIENT_CACHE_PREFIX}${serverSlug}`;

    const cachedData = await this.cacheManager.get<string>(cacheKey);
    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      this.logger.debug(`Using cached dynamic client for ${serverSlug}`);
      return parsed;
    }

    const metadata = await this.discoverOAuthMetadata(serverBaseUrl);

    if (!metadata.registration_endpoint) {
      throw new Error(
        `MCP server ${serverSlug} does not support dynamic client registration`,
      );
    }

    const client = await this.registerClient(
      metadata.registration_endpoint,
      redirectUri,
      `Rolai - ${serverSlug}`,
    );

    const dataToCache = { metadata, client };
    await this.cacheManager.set(
      cacheKey,
      JSON.stringify(dataToCache),
      CLIENT_CACHE_TTL_MS,
    );

    return dataToCache;
  }

  generatePkceChallenge(): PkceChallenge {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256',
    };
  }

  async storePkceVerifier(state: string, codeVerifier: string): Promise<void> {
    await this.cacheManager.set(
      `${MCP_PKCE_CACHE_PREFIX}${state}`,
      codeVerifier,
      PKCE_CACHE_TTL_MS,
    );
  }

  async retrievePkceVerifier(state: string): Promise<string | null> {
    const key = `${MCP_PKCE_CACHE_PREFIX}${state}`;
    const verifier = await this.cacheManager.get<string>(key);
    if (verifier) {
      await this.cacheManager.del(key);
    }
    return verifier ?? null;
  }

  /**
   * Refresh an expired access token using the refresh token.
   * Calls the MCP server's /token endpoint to get a new access token.
   */
  async refreshAccessToken(
    tokenEndpoint: string,
    refreshToken: string,
    clientId: string,
    clientSecret?: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  }> {
    this.logger.debug(`Refreshing access token at ${tokenEndpoint}`);

    const payload: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    };

    if (clientSecret) {
      payload.client_secret = clientSecret;
    }

    const response = await axios.post(tokenEndpoint, payload, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });

    this.logger.log(`Successfully refreshed access token`);

    return response.data;
  }
}
