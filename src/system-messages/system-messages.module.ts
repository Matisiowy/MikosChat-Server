import { Module } from '@nestjs/common';
import { SystemMessagesService } from './system-messages.service';

@Module({
  providers: [SystemMessagesService],
  exports: [SystemMessagesService],
})
export class SystemMessagesModule {}
