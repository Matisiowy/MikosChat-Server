import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';

import { isUUID } from 'class-validator';
import { MessagesService } from '../../messages/messages.service';
import type { AuthRequest } from '../../common/auth-request';

@Injectable()
export class AttachmentUploadGuard implements CanActivate {
  constructor(
    private readonly messages: MessagesService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<AuthRequest>();

    const conversationId = request.params.id;

    if (
      typeof conversationId !== 'string' ||
      !isUUID(conversationId)
    ) {
      throw new BadRequestException(
        'Invalid conversation ID',
      );
    }

    await this.messages.authorizeAttachmentUpload(
      request.user.userId,
      conversationId,
    );

    return true;
  }
}
