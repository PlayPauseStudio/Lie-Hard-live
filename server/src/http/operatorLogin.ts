import { Router } from 'express';
import { operatorLoginSchema } from '../validation/schemas';
import { checkOperatorPassword, signOperatorToken } from '../auth/operatorJwt';
import { logger } from '../util/logger';

/**
 * POST /auth/operator/login { password } -> { token }
 * The operator password is verified server-side (bcrypt) and never leaves the
 * server. On success we mint a short-lived JWT used in the socket handshake.
 */
export function operatorLoginRouter(): Router {
  const router = Router();
  router.post('/auth/operator/login', async (req, res) => {
    const parsed = operatorLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const ok = await checkOperatorPassword(parsed.data.password);
    if (!ok) {
      logger.warn({ ip: req.ip }, 'Operator login failed');
      return res.status(401).json({ error: 'invalid_password' });
    }
    const token = await signOperatorToken();
    return res.json({ token });
  });
  return router;
}
