import {
  Controller,
  Post,
  Delete,
  Body,
  Req,
  UseGuards,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';

import {
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';

import type {
  AuthRequest,
} from '../common/auth-request';

import {
  RegisterDeviceDto,
} from './dto/register-device.dto';

import {
  NotificationsService,
} from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
  ) {}

  @Post('devices')
  @HttpCode(200)
  register(
    @Req() req: AuthRequest,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notifications.register(
      req.user.userId,
      req.user.sessionId,
      dto,
    );
  }

  @Delete('devices')
  @HttpCode(200)
  unregister(
    @Req() req: AuthRequest,
    @Body() body: { pushToken: string },
  ) {
    if (
      typeof body?.pushToken !== 'string' ||
      !body.pushToken ||
      body.pushToken.length > 255
    ) {
      throw new BadRequestException('Invalid push token');
    }

    return this.notifications.unregister(
      req.user.userId,
      req.user.sessionId,
      body.pushToken,
    );
  }
}
