import { Hono } from 'hono';
import { isDatabaseReachable } from '@bgc/db';
import type { AppBindings } from '../env.js';

/**
 * Unauthenticated on purpose: this is the endpoint you curl to prove the
 * deployment works before Access is even configured.
 */
export const healthRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const database = (await isDatabaseReachable(c.env.DB)) ? 'up' : 'down';
  return c.json(
    {
      ok: database === 'up',
      version: c.env.APP_VERSION ?? 'unknown',
      database,
      time: new Date().toISOString(),
    },
    database === 'up' ? 200 : 503,
  );
});
