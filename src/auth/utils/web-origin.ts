import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { getCorsOrigins } from '../../config/environment';

export function requireWebOrigin(req: Request): void {
  const origin = req.headers.origin;

  if (
    typeof origin !== 'string' ||
    !getCorsOrigins().includes(origin)
  ) {
    throw new ForbiddenException(
      'Untrusted request origin',
    );
  }
}
