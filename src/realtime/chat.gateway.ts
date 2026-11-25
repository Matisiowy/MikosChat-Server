import { getCorsOrigins } from '../config/environment';
import { GROUP_EVENTS } from '../groups/events/group.events';
import type { GroupEvent } from '../groups/events/group.events';
import { ReceiptsService } from '../receipts/receipts.service';
import { MessageReceiptDto } from '../receipts/dto/message-receipt.dto';
import { OnEvent } from '@nestjs/event-emitter';
import { MESSAGE_EVENTS } from '../messages/events/message.events';
import type {
  MessagePayload,
  MessageDeletedEvent,
} from '../messages/events/message.events';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import {
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { SocketAuthService } from './socket-auth.service';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketMessageDto } from './dto/socket-message.dto';
import { SocketConversationDto } from './dto/socket-conversation.dto';

import { PresenceService } from '../presence/presence.service';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: (origin, callback) => {
      callback(null, !origin || getCorsOrigins().includes(origin));
    },
    credentials: true,
  },
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 25000,
  pingTimeout: 20000,
})
@UsePipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: () =>
    new WsException('Invalid event payload'),
}))
export class ChatGateway
  implements OnGatewayInit, OnGatewayDisconnect {

  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger('ChatGateway');

  constructor(
    private readonly auth: SocketAuthService,
    private readonly messages: MessagesService,
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly receipts: ReceiptsService,
  ) {}

  afterInit(server: Namespace) {
    server.use(async (client, next) => {
      try {
        const token = client.handshake.auth?.token;
        const auth = await this.auth.authenticate(token);

        client.data.auth = auth;
        client.data.token = token;

        await client.join(`user:${auth.userId}`);

        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });

    server.on('connection', client => {
      const auth = client.data.auth;

      const remaining = Math.max(
        0,
        auth.expiresAt - Date.now(),
      );

      client.data.expiryTimer = setTimeout(() => {
        client.disconnect(true);
      }, remaining);

      void this.startPresence(client).catch(() => {
        this.logger.warn('Presence initialization failed');
      });

      client.emit('session:ready', {
        userId: auth.userId,
        socketId: client.id,
      });

      this.logger.log(
        `Client connected: ${client.id}`,
      );
    });

    this.logger.log('MikosChat WebSocket ready');
  }

  handleDisconnect(client: Socket) {
    void this.stopPresence(client).catch(() => {
      this.logger.warn('Presence cleanup failed');
    });

    if (client.data.expiryTimer) {
      clearTimeout(client.data.expiryTimer);
    }

    this.logger.log(
      `Client disconnected: ${client.id}`,
    );
  }


  private async broadcastPresence(
    userId: string,
    online: boolean,
  ) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
      },
    });

    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: userId },
          { blockedId: userId },
        ],
      },
    });

    const excluded = new Set(
      blocks.map(b =>
        b.blockerId === userId
          ? b.blockedId
          : b.blockerId,
      ),
    );

    const friendIds = friendships.map(f =>
      f.senderId === userId
        ? f.receiverId
        : f.senderId,
    );

    await Promise.all(
      friendIds
        .filter(id => !excluded.has(id))
        .map(id => this.emitToUser(
          id,
          'presence:update',
          {
            userId,
            online,
            lastSeenAt: online
              ? null
              : new Date().toISOString(),
          },
        )),
    );
  }

  private async startPresence(client: Socket) {
    const { userId } = client.data.auth;

    const wasOnline = await this.presence.isOnline(userId);

    if (!client.connected) return;

    await this.presence.connect(userId, client.id);

    if (!client.connected) {
      await this.presence.disconnect(userId, client.id);
      return;
    }

    client.data.presenceTimer = setInterval(async () => {
      try {
        await this.requireAuth(client);

        if (!client.connected) return;

        await this.presence.heartbeat(userId, client.id);

        if (!client.connected) {
          await this.presence.disconnect(userId, client.id);
        }
      } catch {
        client.disconnect(true);
      }
    }, 30000);

    if (!wasOnline) {
      await this.broadcastPresence(userId, true);
    }
  }

  private async stopPresence(client: Socket) {
    clearInterval(client.data.presenceTimer);

    const userId = client.data.auth?.userId;
    if (!userId) return;

    const stillOnline = await this.presence.disconnect(
      userId,
      client.id,
    );

    if (!stillOnline) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date() },
      });

      await this.broadcastPresence(userId, false);
    }
  }

  private async requireAuth(client: Socket) {
    try {
      return await this.auth.authenticate(
        client.data.token,
      );
    } catch {
      client.disconnect(true);
      throw new WsException('Unauthorized');
    }
  }

  private async emitToUser(
    userId: string,
    event: string,
    payload: unknown,
  ) {
    const sockets = await this.server
      .in(`user:${userId}`)
      .fetchSockets();

    await Promise.all(sockets.map(async socket => {
      try {
        const auth = await this.auth.authenticate(
          socket.data.token,
        );

        if (auth.userId !== userId) {
          socket.disconnect(true);
          return;
        }

        socket.emit(event, payload);
      } catch {
        socket.disconnect(true);
      }
    }));
  }

  private async emitToConversation(
    conversationId: string,
    senderId: string,
    event: string,
    payload: unknown,
    includeSender = true,
  ) {
    const members =
      await this.prisma.conversationMember.findMany({
        where: {
          conversationId,
          leftAt: null,
          user: {
            status: 'ACTIVE',
          },
        },
        select: {
          userId: true,
        },
      });

    if (!members.some(m => m.userId === senderId)) {
      return;
    }

    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: senderId },
          { blockedId: senderId },
        ],
      },
    });

    const excluded = new Set(
      blocks.map(b =>
        b.blockerId === senderId
          ? b.blockedId
          : b.blockerId,
      ),
    );

    await Promise.all(
      members
        .filter(m => !excluded.has(m.userId))
        .filter(m => includeSender || m.userId !== senderId)
        .map(m => this.emitToUser(
          m.userId,
          event,
          payload,
        )),
    );
  }


  private async notifyGroupMembers(
    conversationId: string,
    event: string,
  ) {
    const members =
      await this.prisma.conversationMember.findMany({
        where: {
          conversationId,
          leftAt: null,
          user: {
            status: 'ACTIVE',
          },
        },
        select: {
          userId: true,
        },
      });

    await Promise.all(
      members.map(member =>
        this.emitToUser(
          member.userId,
          event,
          { conversationId },
        ),
      ),
    );
  }

  @OnEvent('conversation.mute.updated')
  async onConversationMuteUpdated(payload: {
    userId: string;
    conversationId: string;
    mutedUntil: Date | null;
  }) {
    await this.emitToUser(
      payload.userId,
      'conversation:mute',
      {
        conversationId: payload.conversationId,
        mutedUntil: payload.mutedUntil,
      },
    );
  }

  @OnEvent('group.created')
  async onGroupCreated(payload: GroupEvent) {
    await this.notifyGroupMembers(
      payload.conversationId,
      'conversation:created',
    );
  }

  @OnEvent(GROUP_EVENTS.UPDATED)
  @OnEvent(GROUP_EVENTS.ROLE_UPDATED)
  @OnEvent(GROUP_EVENTS.OWNER_TRANSFERRED)
  async onGroupUpdated(payload: GroupEvent) {
    await this.notifyGroupMembers(
      payload.conversationId,
      'conversation:updated',
    );
  }

  @OnEvent(GROUP_EVENTS.MEMBERS_ADDED)
  async onGroupMembersAdded(payload: GroupEvent) {
    const members =
      await this.prisma.conversationMember.findMany({
        where: {
          conversationId: payload.conversationId,
          leftAt: null,
          user: { status: 'ACTIVE' },
        },
        select: { userId: true },
      });

    await Promise.all(
      members.map(member =>
        this.emitToUser(
          member.userId,
          payload.affectedUserIds.includes(member.userId)
            ? 'conversation:added'
            : 'conversation:updated',
          {
            conversationId: payload.conversationId,
          },
        ),
      ),
    );
  }

  @OnEvent(GROUP_EVENTS.MEMBER_REMOVED)
  async onGroupMemberRemoved(payload: GroupEvent) {
    const activeMembers =
      await this.prisma.conversationMember.findMany({
        where: {
          conversationId: payload.conversationId,
          leftAt: null,
        },
        select: { userId: true },
      });

    const activeIds = new Set(
      activeMembers.map(member => member.userId),
    );

    await Promise.all(
      payload.affectedUserIds
        .filter(id => !activeIds.has(id))
        .map(id =>
          this.emitToUser(
            id,
            'conversation:removed',
            {
              conversationId: payload.conversationId,
            },
          ),
        ),
    );

    await this.notifyGroupMembers(
      payload.conversationId,
      'conversation:updated',
    );
  }

  @OnEvent(MESSAGE_EVENTS.CREATED)
  async onMessageCreated(message: MessagePayload) {
    if (message.type === 'SYSTEM') {
      const members =
        await this.prisma.conversationMember.findMany({
          where: {
            conversationId: message.conversationId,
            leftAt: null,
            user: { status: 'ACTIVE' },
          },
          select: { userId: true },
        });

      await Promise.all(
        members.map(member =>
          this.emitToUser(
            member.userId,
            'message:new',
            message,
          ),
        ),
      );

      return;
    }

    await this.emitToConversation(
      message.conversationId,
      message.senderId,
      'message:new',
      message,
    );
  }

  @OnEvent(MESSAGE_EVENTS.UPDATED)
  async onMessageUpdated(message: MessagePayload) {
    await this.emitToConversation(
      message.conversationId,
      message.senderId,
      'message:updated',
      message,
    );
  }

  @OnEvent(MESSAGE_EVENTS.DELETED)
  async onMessageDeleted(message: MessageDeletedEvent) {
    await this.emitToConversation(
      message.conversationId,
      message.senderId,
      'message:deleted',
      message,
    );
  }


  @OnEvent('receipt.updated')
  async onReceiptUpdated(receipt: {
    id: string;
    messageId: string;
    userId: string;
    senderId: string;
    conversationId: string;
    deliveredAt: Date | null;
    readAt: Date | null;
  }) {
    await this.emitToConversation(
      receipt.conversationId,
      receipt.userId,
      'receipt:update',
      receipt,
    );
  }

  private async confirmReceipt(
    client: Socket,
    dto: MessageReceiptDto,
    read: boolean,
  ) {
    const auth = await this.requireAuth(client);

    const now = Date.now();

    const recent: number[] =
      (client.data.receiptTimes ?? [])
        .filter((t: number) => now - t < 10000);

    if (recent.length >= 100) {
      throw new WsException('Rate limit exceeded');
    }

    recent.push(now);
    client.data.receiptTimes = recent;

    try {
      const receipt = read
        ? await this.receipts.read(
            auth.userId,
            dto.messageId,
          )
        : await this.receipts.delivered(
            auth.userId,
            dto.messageId,
          );

      return {
        success: true,
        receipt,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        'getStatus' in error
      ) {
        throw new WsException(error.message);
      }

      this.logger.error('Receipt update failed');
      throw new WsException('Receipt update failed');
    }
  }

  @SubscribeMessage('message:delivered')
  messageDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MessageReceiptDto,
  ) {
    return this.confirmReceipt(client, dto, false);
  }

  @SubscribeMessage('message:read')
  messageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MessageReceiptDto,
  ) {
    return this.confirmReceipt(client, dto, true);
  }


  @OnEvent('reaction.updated')
  async onReactionUpdated(payload: {
    messageId: string;
    conversationId: string;
    userId: string;
    reactions: unknown[];
  }) {
    await this.emitToConversation(
      payload.conversationId,
      payload.userId,
      'reaction:update',
      payload,
    );
  }

  @SubscribeMessage('message:send')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SocketMessageDto,
  ) {
    const auth = await this.requireAuth(client);

    const now = Date.now();
    const recent: number[] =
      (client.data.messageTimes ?? [])
        .filter((t: number) => now - t < 10000);

    if (recent.length >= 20) {
      throw new WsException('Rate limit exceeded');
    }

    recent.push(now);
    client.data.messageTimes = recent;

    let message;

    try {
      message = await this.messages.send(
        auth.userId,
        dto.conversationId,
        dto,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        'getStatus' in error
      ) {
        throw new WsException(error.message);
      }

      this.logger.error('Message send failed');
      throw new WsException('Message send failed');
    }


    return {
      success: true,
      message,
    };
  }

  private async typing(
    client: Socket,
    dto: SocketConversationDto,
    isTyping: boolean,
  ) {
    const auth = await this.requireAuth(client);

    const now = Date.now();

    if (
      isTyping &&
      now - (client.data.lastTypingAt ?? 0) < 1000
    ) {
      return { success: true };
    }

    client.data.lastTypingAt = now;

    try {
      await this.conversations.requireMembership(
        auth.userId,
        dto.conversationId,
      );
    } catch {
      throw new WsException('Conversation not found');
    }

    await this.emitToConversation(
      dto.conversationId,
      auth.userId,
      'typing:update',
      {
        conversationId: dto.conversationId,
        userId: auth.userId,
        isTyping,
        expiresAt: new Date(
          now + 5000,
        ).toISOString(),
      },
      false,
    );

    return { success: true };
  }

  @SubscribeMessage('typing:start')
  typingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SocketConversationDto,
  ) {
    return this.typing(client, dto, true);
  }

  @SubscribeMessage('typing:stop')
  typingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SocketConversationDto,
  ) {
    return this.typing(client, dto, false);
  }
}
