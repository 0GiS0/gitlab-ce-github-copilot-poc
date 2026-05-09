import express from 'express';
import path from 'path';
import { authRouter } from './auth';
import { chatRouter } from './chat';

const app = express();
const PORT = process.env['PORT'] ?? 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// CORS — the widget runs on GitLab's origin (port 8080), backend is on port 3000
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

app.use('/auth', authRouter);
app.use('/chat', chatRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Copilot proxy running → http://localhost:${PORT}`);
});
