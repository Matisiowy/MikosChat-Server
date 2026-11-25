import {
  Injectable,
  Logger,
} from '@nestjs/common';

import { OnEvent } from '@nestjs/event-emitter';

import { Expo } from 'expo-server-sdk';
import type { ExpoPushMessage } from 'expo-server-sdk';

import { PrismaService } from '../prisma/prisma.service';

import { MESSAGE_EVENTS } from '../messages/events/message.events';
import type {
  MessagePayload,
} from '../messages/events/message.events';

import type {
  RegisterDeviceDto,
} from './dto/register-device.dto';

@Injectable()
export class NotificationsService {
  private readonly logger =
    new Logger(NotificationsService.name);

  private readonly expo = new Expo();

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async register(userId: string, sessionId: string, dto: RegisterDeviceDto) {
    const device = await this.prisma.device.upsert({
      where: {
        pushToken: dto.pushToken,
      },
      create: {
        userId,
        sessionId,
        platform: dto.platform,
        pushToken: dto.pushToken,
        name: dto.name,
        appVersion: dto.appVersion,
      },
      update: {
        userId,
        sessionId,
        platform: dto.platform,
        name: dto.name,
        appVersion: dto.appVersion,
        lastActiveAt: new Date(),
      },
    });

    return {
      success: true,
      deviceId: device.id,
    };
  }

  async unregister(userId: string, sessionId: string, pushToken: string) {
    await this.prisma.device.deleteMany({
      where: {
        userId,
        sessionId,
        pushToken,
      },
    });

    return { success: true };
  }

  @OnEvent(MESSAGE_EVENTS.CREATED, { async: true })
  async onMessage(message: MessagePayload) {
    if (
      message.type === 'SYSTEM' ||
      message.deletedAt
    ) return;

    try {
      await this.sendMessageNotification(message);
    } catch (error) {
      this.logger.error(
        'Failed to dispatch message notification',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private async sendMessageNotification(
    message: MessagePayload,
  ) {
    const conversation =
      await this.prisma.conversation.findUnique({
        where: {
          id: message.conversationId,
        },
        include: {
          members: {
            where: {
              leftAt: null,
              user: {
                status: 'ACTIVE',
              },
            },
          },
        },
      });

    if (!conversation) return;

    if (!conversation.members.some(
      member => member.userId === message.senderId
    )) return;

    const now = new Date();

    const recipients = conversation.members
      .filter(member =>
        member.userId !== message.senderId &&
        (!member.mutedUntil || member.mutedUntil <= now)
      )
      .map(member => member.userId);

    if (!recipients.length) return;

    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          {
            blockerId: message.senderId,
            blockedId: { in: recipients },
          },
          {
            blockedId: message.senderId,
            blockerId: { in: recipients },
          },
        ],
      },
    });

    const blocked = new Set(
      blocks.map(block =>
        block.blockerId === message.senderId
          ? block.blockedId
          : block.blockerId
      )
    );

    const allowed = recipients.filter(
      id => !blocked.has(id)
    );

    if (!allowed.length) return;

    const devices = await this.prisma.device.findMany({
      where: {
        userId: { in: allowed },
        pushToken: { not: null },
        platform: {
          in: ['ANDROID', 'IOS'],
        },
      },
    });

    const sessions = await this.prisma.session.findMany({
      where: {
        userId: { in: allowed },
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        userId: true,
      },
    });

    const activeSessions = new Map(
      sessions.map(session => [session.id, session.userId])
    );



    const notifications: ExpoPushMessage[] = [];

    for (const device of devices) {
      if (
        !device.sessionId ||
        activeSessions.get(device.sessionId) !== device.userId
      ) continue;

      if (
        !device.pushToken ||
        !Expo.isExpoPushToken(device.pushToken)
      ) continue;

      notifications.push({
        to: device.pushToken,
        sound: 'default',
        title: 'MikosChat',
        body: 'Masz nową wiadomość.',
        priority: 'high',
        channelId: 'messages',
        ttl: 3600,
        data: {
          type: 'message',
          recipientId: device.userId,
          conversationId: message.conversationId,
          messageId: message.id,
        },
      });
    }

    const chunks =
      this.expo.chunkPushNotifications(notifications);

    for (const chunk of chunks) {
      try {
        const tickets =
          await this.expo.sendPushNotificationsAsync(chunk);

        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];

          if (ticket.status !== 'error') continue;

          if (
            ticket.details?.error === 'DeviceNotRegistered'
          ) {
            const token = chunk[i].to;

            if (typeof token === 'string') {
              await this.prisma.device.deleteMany({
                where: { pushToken: token },
              });
            }
          }

          this.logger.warn(
            `Push rejected: ${ticket.details?.error || 'unknown'}`
          );
        }
      } catch {
        this.logger.error('Expo push request failed');
      }
    }
  }
}
