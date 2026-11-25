import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { WsException } from '@nestjs/websockets';

interface SocketTokenPayload {
  sub: string;
  sid: string;
  exp: number;
}

@Injectable()
export class SocketAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(token: string) {
    if (!token || typeof token !== 'string') {
      throw new WsException('Unauthorized');
    }

    let payload: SocketTokenPayload;

    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        issuer: 'mikoschat-api',
        audience: 'mikoschat',
      });
    } catch {
      throw new WsException('Invalid access token');
    }

    if (!payload.sub || !payload.sid || !payload.exp) {
      throw new WsException('Invalid access token');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
        user: {
          status: 'ACTIVE',
        },
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!session) {
      throw new WsException('Session expired or revoked');
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      expiresAt: payload.exp * 1000,
    };
  }
}
