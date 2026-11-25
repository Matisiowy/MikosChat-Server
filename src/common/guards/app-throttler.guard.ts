import {
  Injectable,
  ExecutionContext,
} from '@nestjs/common';

import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected generateKey(
    context: ExecutionContext,
    tracker: string,
    throttlerName: string,
  ): string {
    if (context.getType() === 'http') {
      const request = context
        .switchToHttp()
        .getRequest<Request>();

      const match = request.path.match(
        /^\/api\/v1\/auth\/(?:web\/)?(login|register|refresh)\/?$/,
      );

      if (match && request.method === 'POST') {
        return createHash('sha256')
          .update(
            `auth:${match[1]}:${throttlerName}:${tracker}`,
          )
          .digest('hex');
      }
    }

    return super.generateKey(
      context,
      tracker,
      throttlerName,
    );
  }
}
