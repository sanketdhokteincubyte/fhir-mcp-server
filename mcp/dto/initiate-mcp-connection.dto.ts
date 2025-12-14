export interface InitiateMcpConnectionDto {
  serverSlug: string;
}

export class InitiateMcpConnectionResponseDto {
  authorizationUrl?: string;
  message?: string;

  constructor(authorizationUrl?: string, message?: string) {
    this.authorizationUrl = authorizationUrl;
    this.message = message;
  }
}
