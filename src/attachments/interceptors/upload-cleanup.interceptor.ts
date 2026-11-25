import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';

import {
  catchError,
  mergeMap,
  from,
  throwError,
} from 'rxjs';

import { AttachmentStorageService } from '../attachment-storage.service';

@Injectable()
export class UploadCleanupInterceptor
  implements NestInterceptor {

  constructor(
    private readonly storage: AttachmentStorageService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ) {
    const request = context
      .switchToHttp()
      .getRequest<Express.Request>();

    return next.handle().pipe(
      catchError(error => {
        const files = Array.isArray(request.files)
          ? request.files
          : [];

        return from(
          Promise.allSettled(
            files.map(file =>
              this.storage.removeTemporary(file.path),
            ),
          ),
        ).pipe(
          mergeMap(() =>
            throwError(() => error),
          ),
        );
      }),
    );
  }
}
