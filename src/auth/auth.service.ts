import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await argon2.hash(
      randomBytes(32).toString('hex'),
      { type: argon2.argon2id },
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256')
      .update(token)
      .digest('hex');
  }

  private async issueAccessToken(
    userId: string,
    sessionId: string,
  ) {
    return this.jwt.signAsync({
      sub: userId,
      sid: sessionId,
    });
  }

  private async createSession(
    userId: string,
    deviceName?: string,
    userAgent?: string,
  ) {
    const refreshToken = randomBytes(64).toString('hex');

    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceName,
        userAgent: userAgent?.slice(0, 512),
        refreshTokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ),
      },
    });

    return {
      accessToken: await this.issueAccessToken(
        userId,
        session.id,
      ),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      sessionId: session.id,
    };
  }

  async register(dto: RegisterDto) {
    const username = dto.username.toLowerCase();
    const email = dto.email.trim().toLowerCase();

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });

    try {
      const user = await this.prisma.user.create({
        data: {
          username,
          email,
          displayName: dto.displayName.trim(),
          passwordHash,
        },
        select: publicUserSelect,
      });

      const tokens = await this.createSession(user.id);

      return { user, ...tokens };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Username or email is already in use',
        );
      }

      throw error;
    }
  }

  async login(dto: LoginDto, userAgent?: string) {
    const identifier = dto.identifier.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: identifier },
        ],
      },
    });

    const valid = await argon2.verify(
      user?.passwordHash ?? this.dummyHash,
      dto.password,
    );

    if (!user || !valid || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Invalid credentials',
      );
    }

    const tokens = await this.createSession(
      user.id,
      dto.deviceName,
      userAgent,
    );

    return {
      user: await this.me(user.id),
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    const oldHash = this.hashToken(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: oldHash },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Invalid session');
    }

    const newRefreshToken = randomBytes(64).toString('hex');

    const result = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: oldHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        refreshTokenHash: this.hashToken(newRefreshToken),
        lastUsedAt: new Date(),
      },
    });

    if (result.count !== 1) {
      throw new UnauthorizedException('Invalid session');
    }

    return {
      accessToken: await this.issueAccessToken(
        session.userId,
        session.id,
      ),
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      sessionId: session.id,
    };
  }

  async logout(userId: string, sessionId: string) {
    await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }

    return user;
  }
}
