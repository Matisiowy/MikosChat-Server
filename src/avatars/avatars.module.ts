import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AvatarsService } from './avatars.service';
import { AvatarsController } from './avatars.controller';
import { MediaController } from './media.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    AvatarsController,
    MediaController,
  ],
  providers: [AvatarsService],
})
export class AvatarsModule {}
