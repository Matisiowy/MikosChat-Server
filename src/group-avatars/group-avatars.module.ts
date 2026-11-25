import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SystemMessagesModule } from '../system-messages/system-messages.module';

import { GroupAvatarsService } from './group-avatars.service';
import { GroupAvatarsController } from './group-avatars.controller';
import { GroupAvatarMediaController } from './group-avatar-media.controller';

@Module({
  imports: [
    AuthModule,
    SystemMessagesModule,
  ],
  providers: [
    GroupAvatarsService,
  ],
  controllers: [
    GroupAvatarsController,
    GroupAvatarMediaController,
  ],
})
export class GroupAvatarsModule {}
