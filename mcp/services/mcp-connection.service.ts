import {
  InjectTransactionHost,
  Transactional,
  TransactionHost,
} from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EncryptionType, McpConnectionStatus } from '@prisma/client';
import { CryptoService } from '@src/crypto/crypto.service';
import { ConnectionTokens, CreateConnectionInput } from '../interfaces';

@Injectable()
export class McpConnectionService {
  constructor(
    @InjectTransactionHost('rolai-db')
    private readonly transactionHost: TransactionHost<TransactionalAdapterPrisma>,
    private readonly cryptoService: CryptoService,
  ) {}

  @Transactional('rolai-db')
  async createConnection(input: CreateConnectionInput) {
    const user = await this.transactionHost.tx.user.findUnique({
      where: { id: input.userId },
      select: { salt: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const encryptedAccessToken = this.cryptoService.encrypt(
      input.accessToken,
      user.salt,
      EncryptionType.AES_GCM,
    );

    const encryptedRefreshToken = input.refreshToken
      ? this.cryptoService.encrypt(
          input.refreshToken,
          user.salt,
          EncryptionType.AES_GCM,
        )
      : null;

    return this.transactionHost.tx.mcpServerConnection.upsert({
      where: {
        userId_serverSlug: {
          userId: input.userId,
          serverSlug: input.serverSlug,
        },
      },
      create: {
        userId: input.userId,
        organizationId: input.organizationId,
        serverSlug: input.serverSlug,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
        status: McpConnectionStatus.ACTIVE,
        encryptionType: EncryptionType.AES_GCM,
      },
      update: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
        status: McpConnectionStatus.ACTIVE,
        encryptionType: EncryptionType.AES_GCM,
        organizationId: input.organizationId,
      },
    });
  }

  async getConnectionsByUserId(userId: string) {
    return this.transactionHost.tx.mcpServerConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getConnectionById(connectionId: string) {
    return this.transactionHost.tx.mcpServerConnection.findUnique({
      where: { id: connectionId },
    });
  }

  @Transactional('rolai-db')
  async deleteConnection(connectionId: string) {
    const connection =
      await this.transactionHost.tx.mcpServerConnection.findUnique({
        where: { id: connectionId },
      });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    return this.transactionHost.tx.mcpServerConnection.delete({
      where: { id: connectionId },
    });
  }

  async getConnectionByUserAndSlug(userId: string, serverSlug: string) {
    return this.transactionHost.tx.mcpServerConnection.findUnique({
      where: {
        userId_serverSlug: { userId, serverSlug },
      },
    });
  }

  async getDecryptedTokensByUserAndSlug(
    userId: string,
    serverSlug: string,
  ): Promise<ConnectionTokens | null> {
    const connection =
      await this.transactionHost.tx.mcpServerConnection.findUnique({
        where: {
          userId_serverSlug: { userId, serverSlug },
        },
        include: { user: { select: { salt: true } } },
      });

    if (!connection) {
      return null;
    }

    const accessToken = this.cryptoService.decrypt(
      connection.accessToken,
      connection.user.salt,
      connection.encryptionType,
    );

    const refreshToken = connection.refreshToken
      ? this.cryptoService.decrypt(
          connection.refreshToken,
          connection.user.salt,
          connection.encryptionType,
        )
      : undefined;

    return {
      accessToken,
      refreshToken,
      tokenExpiresAt: connection.tokenExpiresAt ?? undefined,
    };
  }

  @Transactional('rolai-db')
  async updateConnectionTokens(
    connectionId: string,
    accessToken: string,
    refreshToken?: string,
    tokenExpiresAt?: Date,
  ) {
    const connection =
      await this.transactionHost.tx.mcpServerConnection.findUnique({
        where: { id: connectionId },
        include: { user: { select: { salt: true } } },
      });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const encryptedAccessToken = this.cryptoService.encrypt(
      accessToken,
      connection.user.salt,
      EncryptionType.AES_GCM,
    );

    const encryptedRefreshToken = refreshToken
      ? this.cryptoService.encrypt(
          refreshToken,
          connection.user.salt,
          EncryptionType.AES_GCM,
        )
      : null;

    return this.transactionHost.tx.mcpServerConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
      },
    });
  }
}
