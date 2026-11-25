import { NotificationsModule } from './notifications/notifications.module';
import { GroupAvatarsModule } from './group-avatars/group-avatars.module';
import { GroupsModule } from './groups/groups.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AvatarsModule } from './avatars/avatars.module';
import { ReactionsModule } from './reactions/reactions.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  ThrottlerModule,
  ThrottlerGuard,
} from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FriendsModule } from './friends/friends.module';
import { BlocksModule } from './blocks/blocks.module';

import { ConversationsModule } from './conversations/conversations.module';

import { MessagesModule } from './messages/messages.module';

import { RealtimeModule } from './realtime/realtime.module';

import { RedisModule } from './redis/redis.module';
import { PresenceModule } from './presence/presence.module';

@Module({
  imports: [
    AttachmentsModule,
    AvatarsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    FriendsModule,
    BlocksModule,
    ConversationsModule,
    GroupsModule,
    GroupAvatarsModule,
    MessagesModule,
    ReceiptsModule,
    ReactionsModule,
    RealtimeModule,
    RedisModule,
    PresenceModule,
    NotificationsModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
