import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  Authenticated,
  AuthenticatedUser,
} from '@src/lib/authentication/decorators/authentication.decorator';
import { AuthUser } from '@src/lib/interfaces/auth-user';
import { ZodValidationPipe } from '@src/lib/pipes/zod.pipe';
import {
  AvailableMcpServersResponseDto,
  ConnectedMcpServersResponseDto,
  InitiateMcpConnectionDto,
  InitiateMcpConnectionResponseDto,
  McpOAuthCallbackDto,
  McpOAuthCallbackResponseDto,
  McpToolsResponseDto,
} from './dto';
import { McpService } from './mcp.service';
import { InitiateMcpConnectionSchema, McpOAuthCallbackSchema } from './schema';

@ApiTags('MCP Servers')
@Controller('/:organizationId/mcp')
@Authenticated()
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Get('/servers')
  async getAvailableServers(): Promise<AvailableMcpServersResponseDto> {
    return this.mcpService.getAvailableServers();
  }

  @Get('/connections')
  async getUserConnections(
    @AuthenticatedUser() user: AuthUser,
  ): Promise<ConnectedMcpServersResponseDto> {
    return this.mcpService.getUserConnections(user.id);
  }

  @Post('/connections/initiate')
  @HttpCode(200)
  async initiateConnection(
    @AuthenticatedUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body(new ZodValidationPipe(InitiateMcpConnectionSchema, 'body'))
    dto: InitiateMcpConnectionDto,
  ): Promise<InitiateMcpConnectionResponseDto> {
    return this.mcpService.initiateConnection(
      user.id,
      organizationId,
      dto.serverSlug,
    );
  }

  @Get('/connections/callback')
  async handleOAuthCallback(
    @AuthenticatedUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Query(new ZodValidationPipe(McpOAuthCallbackSchema, 'query'))
    query: McpOAuthCallbackDto,
  ): Promise<McpOAuthCallbackResponseDto> {
    return this.mcpService.handleOAuthCallback(
      user.id,
      organizationId,
      query.code,
      query.state,
    );
  }

  @Delete('/connections/:connectionId')
  @HttpCode(204)
  async deleteConnection(
    @AuthenticatedUser() user: AuthUser,
    @Param('connectionId') connectionId: string,
  ): Promise<void> {
    await this.mcpService.deleteConnection(user.id, connectionId);
  }

  @Get('/connections/:serverSlug/tools')
  async getServerTools(
    @AuthenticatedUser() user: AuthUser,
    @Param('serverSlug') serverSlug: string,
  ): Promise<McpToolsResponseDto> {
    return this.mcpService.getServerTools(user.id, serverSlug);
  }
}
