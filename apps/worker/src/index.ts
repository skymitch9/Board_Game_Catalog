/**
 * Worker entrypoint.
 *
 * Wiring only: mount middleware, mount routes, serve the SPA. Anything that
 * makes a decision belongs in packages/ so the CLI can use it too.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { requireAuth } from './middleware/auth.js';
import { healthRoutes } from './routes/health.js';
import { userRoutes } from './routes/users.js';

const app = new Hono<AppBindings>();

// Public — no Access token needed, so it can be curled to verify a deploy.
app.route('/api/health', healthRoutes);

// Everything else behind identity.
app.use('/api/*', requireAuth());
app.route('/api', userRoutes);

app.notFound(async (c) => {
  // Unmatched /api/* is a genuine 404; anything else is an SPA route, so hand
  // back index.html and let the client router deal with it.
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'not_found', path: c.req.path }, 404);
  }
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url, { headers: c.req.raw.headers }));
});

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal', detail: err.message }, 500);
});

export default app;
