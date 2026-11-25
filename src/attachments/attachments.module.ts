import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';

import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { AttachmentUploadGuard } from './guards/attachment-upload.guard';
import { UploadCleanupInterceptor } from './interceptors/upload-cleanup.interceptor';

@Module({
  imports: [
    AuthModule,
    MessagesModule,
  ],
  controllers: [
    AttachmentsController,
  ],
  providers: [
    AttachmentsService,
    AttachmentStorageService,
    AttachmentUploadGuard,
    UploadCleanupInterceptor,
  ],
  exports: [
    AttachmentsService,
  ],
})
export class AttachmentsModule {}
