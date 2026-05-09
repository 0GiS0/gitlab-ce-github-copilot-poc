import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export const authRouter = Router();

// In-memory session store: sessionKey → { githubToken, createdAt }
// Replace with Redis or a DB for anything beyond a local PoC.
export const sessions = new Map<string, { githubToken: string; createdAt: number }>();

// Prune sessions older than 24 h once per hour
setInterval(() => {
  const cutoff = Date.now() - 86_400_000;
  for (const [key, val] of sessions) {
    if (val.createdAt < cutoff) sessions.delete(key);
  }
}, 3_600_000);

const GITHUB_CLIENT_ID = process.env['GITHUB_CLIENT_ID'] ?? '';
const GITHUB_CLIENT_SECRET = process.env['GITHUB_CLIENT_SECRET'] ?? '';
const CALLBACK_URL =
  process.env['CALLBACK_URL'] ?? 'http://localhost:3000/auth/github/callback';

authRouter.get('/github', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: 'copilot',
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRouter.get('/github/callback', async (req: Request, res: Response) => {
  const code = req.query['code'] as string | undefined;
  if (!code) { res.status(400).send('Missing code'); return; }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenData.access_token) {
      res.status(401).send(`OAuth failed: ${tokenData.error ?? 'unknown'}`);
      return;
    }

    const sessionKey = randomUUID();
    sessions.set(sessionKey, {
      githubToken: tokenData.access_token,
      createdAt: Date.now(),
    });

    // Send the session key to the opener widget via postMessage, then close the popup.
    res.send(`<!DOCTYPE html>
<html><head><title>Authenticated</title></head>
<body><p>Authenticated ✓ — closing…</p>
<script>
  window.opener?.postMessage(
    { type: 'COPILOT_AUTH_SUCCESS', sessionToken: '${sessionKey}' },
    '*'
  );
  setTimeout(() => window.close(), 500);
</script>
</body></html>`);
  } catch {
    res.status(500).send('Internal error during OAuth');
  }
});

authRouter.get('/status', (req: Request, res: Response) => {
  const token = getBearerToken(req);
  res.json({ authenticated: token ? sessions.has(token) : false });
});

authRouter.post('/logout', (req: Request, res: Response) => {
  const token = getBearerToken(req);
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

export function getBearerToken(req: Request): string | null {
  const header = req.headers['authorization'] ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}
