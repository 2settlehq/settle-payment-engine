/**
 * End-User Authentication Middleware
 * Verifies the `Authorization: Bearer <JWT>` header issued by the
 * phone/email/wallet/Google login flows and attaches req.endUser.
 * Separate from the merchant HMAC `authenticate` middleware in src/security -
 * these are two independent identity systems.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/token.service';
import { MissingAccessTokenError, InvalidAccessTokenError } from '../errors';

export function authenticateUser(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(new MissingAccessTokenError());
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = verifyAccessToken(token);
    req.endUser = { id: payload.sub };
    next();
  } catch {
    next(new InvalidAccessTokenError());
  }
}
