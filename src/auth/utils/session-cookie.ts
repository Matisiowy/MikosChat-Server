import type {
  CookieOptions,
  Request,
  Response,
} from 'express';

export const SESSION_COOKIE = 'mikoschat_refresh';

const SESSION_DURATION =
  30 * 24 * 60 * 60 * 1000;

function cookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    secure: req.secure ||
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
) {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(req),
    ...(remember
      ? { maxAge: SESSION_DURATION }
      : {}),
  });
}

export function clearSessionCookie(
  req: Request,
  res: Response,
) {
  res.clearCookie(
    SESSION_COOKIE,
    cookieOptions(req),
  );
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
