import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
} from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';

import {
  WebLoginDto,
  WebRegisterDto,
} from './dto/web-auth.dto';

import {
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  readRememberCookie,
} from './utils/session-cookie';

import { requireWebOrigin } from './utils/web-origin';

@ApiTags('Browser Authentication')
@Controller('auth/web')
export class WebAuthController {
  constructor(
    private readonly auth: AuthService,
  ) {}

  private async issueSession(
    req: Request,
    res: Response,
    tokens: {
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      expiresIn: number;
      tokenType: string;
    },
    remember: boolean,
  ) {
    const session = await this.auth.getWebSession(
      tokens.sessionId,
    );

    setSessionCookie(
      req,
      res,
      tokens.refreshToken,
      remember,
      session.expiresAt,
    );

    return {
      user: session.user,
      accessToken: tokens.accessToken,
      sessionId: tokens.sessionId,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({
    default: { limit: 5, ttl: 60000 },
  })
  @ApiOperation({
    summary: 'Create browser session',
  })
  async login(
    @Body() dto: WebLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireWebOrigin(req);

    const { remember, ...credentials } = dto;

    const tokens = await this.auth.login(
      credentials,
      req.headers['user-agent'],
    );

    return this.issueSession(
      req,
      res,
      tokens,
      remember === true,
    );
  }

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @Throttle({
    default: { limit: 5, ttl: 60000 },
  })
  @ApiOperation({
    summary: 'Register browser account',
  })
  async register(
    @Body() dto: WebRegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireWebOrigin(req);

    const { remember, ...registration } = dto;

    const tokens = await this.auth.register(
      registration,
    );

    return this.issueSession(
      req,
      res,
      tokens,
      remember === true,
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({
    default: { limit: 20, ttl: 60000 },
  })
  @ApiOperation({
    summary: 'Restore or refresh browser session',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireWebOrigin(req);

    const token = readSessionCookie(req);

    if (!token) {
      throw new UnauthorizedException(
        'No browser session',
      );
    }

    const remember = readRememberCookie(req);

    const tokens = await this.auth.refresh(token);

    return this.issueSession(
      req,
      res,
      tokens,
      remember,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Revoke browser session',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireWebOrigin(req);

    const token = readSessionCookie(req);

    if (token) {
      await this.auth.logoutByRefreshToken(token);
    }

    clearSessionCookie(req, res);

    return { success: true };
  }
}
