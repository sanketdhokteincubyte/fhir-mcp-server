export interface CreateConnectionInput {
  userId: string;
  organizationId: string;
  serverSlug: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

export interface ConnectionTokens {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}
