/**
 * User Routes — /v1/users/me
 * Protected by authenticateUser (JWT bearer), mounted separately from the
 * merchant-scoped /v1/me routes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getUserById, getIdentitiesForUser } from '../services/user-auth/services/user.service';
import { UserNotFoundError } from '../services/user-auth/errors';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.endUser!.id;
    const user = await getUserById(userId);
    if (!user) throw new UserNotFoundError();

    const identities = await getIdentitiesForUser(userId);
    res.json({
      success: true,
      data: {
        user,
        identities: identities.map(({ type, identifier, verifiedAt }) => ({ type, identifier, verifiedAt })),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
