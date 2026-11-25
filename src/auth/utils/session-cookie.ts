import type {
  CookieOptions,
  Request,
  Response,
} from 'express';

export const SESSION_COOKIE = 'mikoschat_refresh';
export const REMEMBER_COOKIE = 'mikoschat_remember';

function cookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    secure:
      req.secure ||
      process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth/web',
  };
}

export function setSessionCookie(
  req: Request,
  res: Response,
  token: string,
  remember: boolean,
  expiresAt: Date,
) {
  const options: CookieOptions = {
    ...cookieOptions(req),
    ...(remember
      ? {
          maxAge: Math.max(
            0,
            expiresAt.getTime() - Date.now(),
          ),
        }
      : {}),
  };

  res.cookie(SESSION_COOKIE, token, options);

  res.cookie(
    REMEMBER_COOKIE,
    remember ? '1' : '0',
    options,
  );
}

export function clearSessionCookie(
  req: Request,
  res: Response,
) {
  const options = cookieOptions(req);

  res.clearCookie(SESSION_COOKIE, options);
  res.clearCookie(REMEMBER_COOKIE, options);
}

export function readSessionCookie(
  req: Request,
): string | undefined {
  const token = req.cookies?.[SESSION_COOKIE];

  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{128}$/.test(token)
  ) {
    return undefined;
  }

  return token;
}

export function readRememberCookie(
  req: Request,
): boolean {
  return req.cookies?.[REMEMBER_COOKIE] === '1';
}
