import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import { MCP_OAUTH_STATE_PREFIX, MCP_OAUTH_STATE_TTL_MS } from './constants';
import {
  AvailableMcpServerDto,
  AvailableMcpServersResponseDto,
  ConnectedMcpServerDto,
  ConnectedMcpServersResponseDto,
  InitiateMcpConnectionResponseDto,
  McpOAuthCallbackResponseDto,
  McpToolsResponseDto,
} from './dto';
import {
  McpAuthType,
  McpServerConfig,
  OAuthStateData,
  RefreshableConnection,
} from './interfaces';
import {
  McpClientService,
  McpConnectionService,
  McpOAuthService,
  McpServerRegistryService,
} from './services';

interface McpOAuthStateData extends OAuthStateData {
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  codeVerifier: string;
}

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mcpServerRegistryService: McpServerRegistryService,
    private readonly mcpConnectionService: McpConnectionService,
    private readonly mcpClientService: McpClientService,
    private readonly mcpOAuthService: McpOAuthService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getAvailableServers(): Promise<AvailableMcpServersResponseDto> {
    const allServers = this.mcpServerRegistryService.getAllServers();

    const servers = allServers.map((server) => {
      const isConfigured = this.mcpServerRegistryService.hasValidConfig(server);
      return new AvailableMcpServerDto(server, isConfigured);
    });

    return new AvailableMcpServersResponseDto(servers);
  }

  async getUserConnections(
    userId: string,
  ): Promise<ConnectedMcpServersResponseDto> {
    const connections =
      await this.mcpConnectionService.getConnectionsByUserId(userId);

    const connectedServers = connections.map((connection) => {
      const serverConfig = this.mcpServerRegistryService.getServerBySlug(
        connection.serverSlug,
      );
      return new ConnectedMcpServerDto(connection, serverConfig);
    });

    return new ConnectedMcpServersResponseDto(connectedServers);
  }

  async initiateConnection(
    userId: string,
    organizationId: string,
    serverSlug: string,
  ): Promise<InitiateMcpConnectionResponseDto> {
    const serverConfig =
      this.mcpServerRegistryService.getServerBySlug(serverSlug);

    if (!serverConfig) {
      throw new NotFoundException(`MCP server '${serverSlug}' not found`);
    }

    if (!this.mcpServerRegistryService.hasValidConfig(serverConfig)) {
      throw new BadRequestException(
        `MCP server '${serverSlug}' is not configured.`,
      );
    }

    const authType = serverConfig.authType || McpAuthType.OAUTH;

    if (authType === McpAuthType.API_KEY || authType === McpAuthType.NONE) {
      const authToken =
        this.mcpServerRegistryService.getAuthToken(serverConfig);

      if (!authToken) {
        throw new BadRequestException(
          `MCP server '${serverSlug}' is not configured.`,
        );
      }

      await this.mcpConnectionService.createConnection({
        userId,
        organizationId,
        serverSlug,
        accessToken: authToken,
        refreshToken: undefined,
        tokenExpiresAt: undefined,
      });

      return new InitiateMcpConnectionResponseDto(
        undefined,
        `Successfully connected to ${serverConfig.name}`,
      );
    }

    if (authType === McpAuthType.MCP_OAUTH) {
      return this.initiateMcpOAuthConnection(
        userId,
        organizationId,
        serverConfig,
      );
    }

    if (!this.mcpServerRegistryService.hasValidOAuthConfig(serverConfig)) {
      throw new BadRequestException(
        `MCP server '${serverSlug}' is not configured. Missing OAuth credentials.`,
      );
    }

    const state = randomUUID();
    const stateData: OAuthStateData = {
      userId,
      organizationId,
      serverSlug: serverConfig.slug,
      createdAt: Date.now(),
    };

    await this.cacheManager.set(
      `${MCP_OAUTH_STATE_PREFIX}${state}`,
      JSON.stringify(stateData),
      MCP_OAUTH_STATE_TTL_MS,
    );

    const clientId =
      this.mcpServerRegistryService.getOAuthClientId(serverConfig);
    const webAppBaseUrl = this.configService.get<string>('WEB_APP_BASE_URL');
    const redirectUri = `${webAppBaseUrl}/auth/mcp-servers/callback`;

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri,
      scope: serverConfig.oauth!.scopes.join(' '),
      state,
      response_type: 'code',
    });

    const authorizationUrl = `${
      serverConfig.oauth!.authorizationUrl
    }?${params.toString()}`;

    return new InitiateMcpConnectionResponseDto(authorizationUrl);
  }

  private async initiateMcpOAuthConnection(
    userId: string,
    organizationId: string,
    serverConfig: McpServerConfig,
  ): Promise<InitiateMcpConnectionResponseDto> {
    const webAppBaseUrl = this.configService.get<string>('WEB_APP_BASE_URL');
    const redirectUri = `${webAppBaseUrl}/auth/mcp-servers/callback`;

    const serverUrl = this.mcpServerRegistryService.getServerUrl(serverConfig);
    const serverBaseUrl = serverUrl.replace(/\/mcp\/?$/, '');

    const { metadata, client } =
      await this.mcpOAuthService.getOrCreateDynamicClient(
        serverConfig.slug,
        serverBaseUrl,
        redirectUri,
      );

    const pkce = this.mcpOAuthService.generatePkceChallenge();

    const state = randomUUID();

    const stateData: McpOAuthStateData = {
      userId,
      organizationId,
      serverSlug: serverConfig.slug,
      createdAt: Date.now(),
      clientId: client.client_id,
      clientSecret: client.client_secret,
      tokenEndpoint: metadata.token_endpoint,
      codeVerifier: pkce.codeVerifier,
    };

    await this.cacheManager.set(
      `${MCP_OAUTH_STATE_PREFIX}${state}`,
      JSON.stringify(stateData),
      MCP_OAUTH_STATE_TTL_MS,
    );

    const scopes = serverConfig.mcpOAuth?.scopes || [];
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      state,
      scope: scopes.join(' '),
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
    });

    const authorizationUrl = `${
      metadata.authorization_endpoint
    }?${params.toString()}`;

    this.logger.debug(
      `Initiating MCP OAuth for ${serverConfig.slug} with dynamic client ${client.client_id}`,
    );

    return new InitiateMcpConnectionResponseDto(authorizationUrl);
  }

  async handleOAuthCallback(
    userId: string,
    organizationId: string,
    code: string,
    state: string,
  ): Promise<McpOAuthCallbackResponseDto> {
    const stateKey = `${MCP_OAUTH_STATE_PREFIX}${state}`;
    const cachedStateStr = await this.cacheManager.get<string>(stateKey);

    if (!cachedStateStr) {
      // Idempotency handling for duplicate OAuth callbacks
      const existingConnections =
        await this.mcpConnectionService.getConnectionsByUserId(userId);

      if (existingConnections && existingConnections.length > 0) {
        const recentConnection = existingConnections.find((conn) => {
          const timeDiff = Date.now() - new Date(conn.createdAt).getTime();
          return timeDiff < 10000;
        });

        if (recentConnection) {
          const serverConfig = this.mcpServerRegistryService.getServerBySlug(
            recentConnection.serverSlug,
          );
          return new McpOAuthCallbackResponseDto(
            true,
            recentConnection.serverSlug,
            `Successfully connected to ${
              serverConfig?.name || recentConnection.serverSlug
            }`,
            recentConnection.organizationId,
          );
        }
      }

      throw new BadRequestException(
        'Invalid or expired OAuth state. Please try connecting again.',
      );
    }

    const stateData = JSON.parse(cachedStateStr) as
      | OAuthStateData
      | McpOAuthStateData;

    if (stateData.userId !== userId) {
      throw new ForbiddenException('OAuth state does not match current user');
    }

    await this.cacheManager.del(stateKey);

    const serverConfig = this.mcpServerRegistryService.getServerBySlug(
      stateData.serverSlug,
    );

    if (!serverConfig) {
      throw new NotFoundException(
        `MCP server '${stateData.serverSlug}' not found`,
      );
    }

    const isMcpOAuth = 'clientId' in stateData && 'tokenEndpoint' in stateData;

    const webAppBaseUrl = this.configService.get<string>('WEB_APP_BASE_URL');
    const redirectUri = `${webAppBaseUrl}/auth/mcp-servers/callback`;

    try {
      let tokenResponse: {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        token_type: string;
      };

      if (isMcpOAuth) {
        const mcpStateData = stateData;
        tokenResponse = await this.exchangeCodeForTokensWithPkce(
          mcpStateData.tokenEndpoint,
          code,
          mcpStateData.clientId,
          mcpStateData.clientSecret,
          redirectUri,
          mcpStateData.codeVerifier,
        );
      } else {
        const clientId =
          this.mcpServerRegistryService.getOAuthClientId(serverConfig);
        const clientSecret =
          this.mcpServerRegistryService.getOAuthClientSecret(serverConfig);

        if (!clientId || !clientSecret || !serverConfig.oauth) {
          throw new BadRequestException('OAuth configuration is incomplete');
        }

        tokenResponse = await this.exchangeCodeForTokens(
          serverConfig.oauth.tokenUrl,
          code,
          clientId,
          clientSecret,
          redirectUri,
        );
      }

      await this.mcpConnectionService.createConnection({
        userId: stateData.userId,
        organizationId: stateData.organizationId,
        serverSlug: stateData.serverSlug,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt: tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000)
          : undefined,
      });

      return new McpOAuthCallbackResponseDto(
        true,
        stateData.serverSlug,
        `Successfully connected to ${serverConfig.name}`,
        stateData.organizationId,
      );
    } catch (error) {
      this.logger.error('Failed to exchange OAuth code for tokens', error);
      throw new BadRequestException(
        'Failed to complete OAuth flow. Please try again.',
      );
    }
  }

  private async exchangeCodeForTokens(
    tokenUrl: string,
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  }> {
    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      },
    );

    return response.data;
  }

  private async exchangeCodeForTokensWithPkce(
    tokenUrl: string,
    code: string,
    clientId: string,
    clientSecret: string | undefined,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  }> {
    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    };

    if (clientSecret) {
      params.client_secret = clientSecret;
    }

    const response = await axios.post(
      tokenUrl,
      new URLSearchParams(params).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      },
    );

    return response.data;
  }

  async deleteConnection(userId: string, connectionId: string): Promise<void> {
    const connection =
      await this.mcpConnectionService.getConnectionById(connectionId);

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to delete this connection',
      );
    }

    await this.mcpConnectionService.deleteConnection(connectionId);
  }

  async getServerTools(
    userId: string,
    serverSlug: string,
  ): Promise<McpToolsResponseDto> {
    const serverConfig =
      this.mcpServerRegistryService.getServerBySlug(serverSlug);

    if (!serverConfig) {
      throw new NotFoundException(`MCP server '${serverSlug}' not found`);
    }

    const tokens =
      await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(
        userId,
        serverSlug,
      );

    if (!tokens) {
      throw new NotFoundException(
        `No active connection found for server '${serverSlug}'`,
      );
    }

    // Create a refreshable connection with token refresh capability
    const refreshableConnection = await this.createRefreshableConnection(
      userId,
      serverSlug,
      serverConfig,
      tokens.accessToken,
    );

    try {
      const tools = await this.mcpClientService.listTools(refreshableConnection);
      return new McpToolsResponseDto(tools, serverSlug);
    } finally {
      await this.mcpClientService.disconnect(
        refreshableConnection.getConnection(),
      );
    }
  }

  /**
   * Call a tool on an MCP server with automatic token refresh on expiry.
   */
  async callServerTool(
    userId: string,
    serverSlug: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    const serverConfig =
      this.mcpServerRegistryService.getServerBySlug(serverSlug);

    if (!serverConfig) {
      throw new NotFoundException(`MCP server '${serverSlug}' not found`);
    }

    const tokens =
      await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(
        userId,
        serverSlug,
      );

    if (!tokens) {
      throw new NotFoundException(
        `No active connection found for server '${serverSlug}'`,
      );
    }

    // Create a refreshable connection with token refresh capability
    const refreshableConnection = await this.createRefreshableConnection(
      userId,
      serverSlug,
      serverConfig,
      tokens.accessToken,
    );

    try {
      const result = await this.mcpClientService.callTool(
        refreshableConnection,
        toolName,
        args,
      );
      return result;
    } finally {
      await this.mcpClientService.disconnect(
        refreshableConnection.getConnection(),
      );
    }
  }

  /**
   * Create a refreshable connection that can automatically refresh its token on expiry.
   * This encapsulates the token refresh logic within the connection itself.
   */
  private async createRefreshableConnection(
    userId: string,
    serverSlug: string,
    serverConfig: McpServerConfig,
    accessToken: string,
  ): Promise<RefreshableConnection> {
    const baseConnection = await this.mcpClientService.connect(
      serverConfig,
      accessToken,
    );

    // Create a refresh callback that will be called when token expires
    const refreshCallback = async () => {
      this.logger.log(`Refreshing token for ${serverSlug}`);

      // Get current tokens
      const tokens =
        await this.mcpConnectionService.getDecryptedTokensByUserAndSlug(
          userId,
          serverSlug,
        );

      if (!tokens) {
        throw new NotFoundException('Connection tokens not found');
      }

      // Refresh the token
      const newTokens = await this.refreshTokenForConnection(
        userId,
        serverSlug,
        serverConfig,
        tokens,
      );

      // Create new connection with refreshed token
      const newConnection = await this.mcpClientService.connect(
        serverConfig,
        newTokens.accessToken,
      );

      return {
        accessToken: newTokens.accessToken,
        connection: newConnection,
      };
    };

    return new RefreshableConnection(baseConnection, refreshCallback, accessToken);
  }

  /**
   * Refresh tokens for a connection when the access token expires.
   * This is a public method so it can be used by other services (e.g., McpToolProviderService).
   */
  async refreshTokenForConnection(
    userId: string,
    serverSlug: string,
    serverConfig: McpServerConfig,
    currentTokens: { accessToken: string; refreshToken?: string },
  ): Promise<{ accessToken: string; refreshToken?: string }> {
    if (!currentTokens.refreshToken) {
      throw new BadRequestException(
        'No refresh token available. Please reconnect.',
      );
    }

    // Get the connection to find the client_id
    const connection =
      await this.mcpConnectionService.getConnectionByUserAndSlug(
        userId,
        serverSlug,
      );

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    // For MCP_OAUTH, we need to get the dynamic client credentials
    let clientId: string;
    let clientSecret: string | undefined;
    let tokenEndpoint: string;

    if (serverConfig.authType === McpAuthType.MCP_OAUTH) {
      // Get the dynamic client from cache
      const dynamicClientData =
        await this.mcpOAuthService.getOrCreateDynamicClient(
          serverSlug,
          serverConfig.serverUrl,
          `${this.configService.get('WEB_APP_BASE_URL')}/auth/mcp-servers/callback`,
        );
      clientId = dynamicClientData.client.client_id;
      clientSecret = dynamicClientData.client.client_secret;
      tokenEndpoint = dynamicClientData.metadata.token_endpoint;
    } else {
      // For regular OAuth, use the configured client credentials
      clientId = this.mcpServerRegistryService.getOAuthClientId(serverConfig);
      clientSecret =
        this.mcpServerRegistryService.getOAuthClientSecret(serverConfig);
      tokenEndpoint = serverConfig.oauth!.tokenUrl;
    }

    // Call the MCP server's /token endpoint to refresh
    const tokenResponse = await this.mcpOAuthService.refreshAccessToken(
      tokenEndpoint,
      currentTokens.refreshToken,
      clientId,
      clientSecret,
    );

    // Update the stored tokens
    await this.mcpConnectionService.updateConnectionTokens(
      connection.id,
      tokenResponse.access_token,
      tokenResponse.refresh_token,
      tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : undefined,
    );

    this.logger.log(`Successfully refreshed tokens for ${serverSlug}`);

    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
    };
  }
}
