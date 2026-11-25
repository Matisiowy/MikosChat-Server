import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { getWebAuthOrigins } from '../../config/environment';

export function requireWebOrigin(req: Request): void {
  const origin = req.headers.origin;

  if (
    typeof origin !== 'string' ||
    !getWebAuthOrigins().includes(origin)
  ) {
    throw new ForbiddenException(
      'Untrusted request origin',
    );
  }
}
