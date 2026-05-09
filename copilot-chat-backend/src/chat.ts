import { Router, Request, Response } from 'express';
import { sessions, getBearerToken } from './auth';

export const chatRouter = Router();

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

chatRouter.post('/', async (req: Request, res: Response) => {
  const sessionKey = getBearerToken(req);
  if (!sessionKey) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const session = sessions.get(sessionKey);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    return;
  }

  const { messages } = req.body as { messages: Message[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const copilotRes = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.githubToken}`,
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'gitlab-copilot-chat',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful AI assistant integrated in GitLab. ' +
              'Help developers with code reviews, debugging, architecture decisions, ' +
              'and questions about their projects.',
          },
          ...messages,
        ],
      }),
    });

    if (!copilotRes.ok || !copilotRes.body) {
      const errText = await copilotRes.text().catch(() => '');
      res.write(
        `data: ${JSON.stringify({ error: 'Copilot API error', status: copilotRes.status, detail: errText })}\n\n`
      );
      res.end();
      return;
    }

    // Pipe the SSE stream from Copilot directly to the client
    const reader = copilotRes.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
      return pump();
    };
    await pump();
  } catch {
    res.write(`data: ${JSON.stringify({ error: 'Internal proxy error' })}\n\n`);
    res.end();
  }
});
