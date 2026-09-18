import { Request, Response, NextFunction } from 'express';
import timeout from 'connect-timeout';

/**
 * connect-timeout has no built-in way to override a shorter timeout set
 * upstream (e.g. the global 15s default in index.ts) - calling timeout()
 * again just starts a second, independent timer racing the first, and
 * whichever fires first wins. That means a plain `timeout('30s')` on a
 * sub-router does nothing useful once a shorter global timeout is already
 * installed. This clears the existing timer (set by whichever timeout()
 * middleware ran earlier in the chain) before installing the longer one, so
 * it actually takes effect.
 */
export function extendTimeout(time: string) {
  const install = timeout(time);
  return (req: Request, res: Response, next: NextFunction) => {
    req.clearTimeout();
    install(req, res, next);
  };
}
