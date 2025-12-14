import { Module } from '@nestjs/common';
import { CryptoModule } from '@src/crypto/crypto.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpClientService } from './services/mcp-client.service';
import { McpConnectionService } from './services/mcp-connection.service';
import { McpOAuthService } from './services/mcp-oauth.service';
import { McpServerRegistryService } from './services/mcp-server-registry.service';
import { McpToolProviderService } from './services/mcp-tool-provider.service';

@Module({
  imports: [CryptoModule],
  controllers: [McpController],
  providers: [
    McpService,
    McpServerRegistryService,
    McpConnectionService,
    McpClientService,
    McpToolProviderService,
    McpOAuthService,
  ],
  exports: [
    McpService,
    McpServerRegistryService,
    McpConnectionService,
    McpClientService,
    McpToolProviderService,
    McpOAuthService,
  ],
})
export class McpModule {}
