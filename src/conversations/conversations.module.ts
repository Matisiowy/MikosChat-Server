import { SystemMessagesModule } from '../system-messages/system-messages.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';

@Module({
  imports: [SystemMessagesModule, AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
