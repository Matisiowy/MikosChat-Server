import { ReceiptsModule } from '../receipts/receipts.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SocketAuthService } from './socket-auth.service';
import { ChatGateway } from './chat.gateway';

import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [
    AuthModule,
    MessagesModule,
    ReceiptsModule,
    ConversationsModule,
    PresenceModule,
  ],
  providers: [
    SocketAuthService,
    ChatGateway,
  ],
  exports: [
    ChatGateway,
  ],
})
export class RealtimeModule {}
