export interface McpOAuthCallbackDto {
  code: string;
  state: string;
}

export class McpOAuthCallbackResponseDto {
  success: boolean;
  serverSlug: string;
  message: string;
  organizationId: string;

  constructor(
    success: boolean,
    serverSlug: string,
    message: string,
    organizationId: string,
  ) {
    this.success = success;
    this.serverSlug = serverSlug;
    this.message = message;
    this.organizationId = organizationId;
  }
}
