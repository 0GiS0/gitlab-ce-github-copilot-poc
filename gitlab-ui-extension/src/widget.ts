/**
 * GitHub Copilot Chat Widget for GitLab CE
 *
 * Injected into every GitLab page via Nginx sub_filter (see gitlab-config/gitlab.rb).
 * Runs as a self-contained IIFE with a Shadow DOM to avoid CSS conflicts.
 *
 * Auth flow:
 *   1. Widget opens /auth/github in a popup.
 *   2. After GitHub OAuth the callback sends a postMessage with a sessionToken.
 *   3. Widget stores the token in sessionStorage and sends it as Bearer on each chat request.
 *   4. Backend proxy streams Copilot responses as SSE.
 */
(() => {
  const BACKEND = 'http://localhost:3000';
  const STORAGE_KEY = 'copilot-session-token';

  // Prevent double-injection
  if (document.getElementById('gh-copilot-host')) return;

  type Message = { role: 'user' | 'assistant'; content: string };

  let sessionToken: string | null = sessionStorage.getItem(STORAGE_KEY);
  let chatHistory: Message[] = [];

  /* ------------------------------------------------------------------ */
  /* DOM / Shadow setup                                                   */
  /* ------------------------------------------------------------------ */

  const host = document.createElement('div');
  host.id = 'gh-copilot-host';
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
<style>
*, *::before, *::after { box-sizing: border-box; }
:host { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; }

.fab {
  position: fixed; bottom: 24px; right: 24px;
  width: 56px; height: 56px; border-radius: 50%;
  background: #1f6feb; color: #fff; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.35); z-index: 10000;
  transition: transform 0.15s ease, background 0.15s ease;
}
.fab:hover { background: #388bfd; transform: scale(1.08); }
.fab svg { width: 26px; height: 26px; fill: currentColor; pointer-events: none; }

.panel {
  position: fixed; bottom: 92px; right: 24px;
  width: 380px; max-height: 580px;
  background: #0d1117; color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 12px;
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  z-index: 9999; overflow: hidden;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.panel[hidden] { display: none !important; }

.header {
  background: #161b22; padding: 12px 16px;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid #30363d; flex-shrink: 0;
}
.header-title { font-weight: 600; color: #e6edf3; display: flex; align-items: center; gap: 8px; }
.header-title svg { fill: #79c0ff; width: 18px; height: 18px; flex-shrink: 0; }
.close-btn { background: none; border: none; cursor: pointer; color: #8b949e; font-size: 20px; line-height: 1; padding: 2px 4px; }
.close-btn:hover { color: #e6edf3; }

.auth-section {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; flex: 1; padding: 32px 24px; gap: 16px; text-align: center;
}
.auth-section p { color: #8b949e; margin: 0; line-height: 1.6; }
.signin-btn {
  display: inline-flex; align-items: center; gap: 8px;
  background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
  border-radius: 6px; padding: 9px 18px; cursor: pointer;
  font-size: 14px; font-weight: 500; transition: background 0.15s;
}
.signin-btn:hover { background: #30363d; color: #e6edf3; }
.signin-btn svg { width: 18px; height: 18px; fill: currentColor; flex-shrink: 0; }

.messages {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  min-height: 280px;
}
.msg {
  padding: 10px 14px; border-radius: 10px;
  max-width: 86%; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word; font-size: 14px;
}
.msg.user  { background: #1f6feb; color: #fff; align-self: flex-end; border-bottom-right-radius: 3px; }
.msg.assistant { background: #161b22; color: #c9d1d9; align-self: flex-start; border-bottom-left-radius: 3px; border: 1px solid #30363d; }
.msg.thinking { color: #8b949e; font-style: italic; }

.input-row {
  display: flex; gap: 8px; padding: 12px;
  border-top: 1px solid #30363d; background: #0d1117; flex-shrink: 0;
}
.input-row textarea {
  flex: 1; background: #161b22; color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 6px;
  padding: 8px 12px; font-size: 14px; font-family: inherit;
  resize: none; min-height: 38px; max-height: 120px; line-height: 1.4;
  outline: none; overflow-y: auto;
}
.input-row textarea:focus { border-color: #1f6feb; }
.send-btn {
  background: #1f6feb; color: #fff; border: none;
  border-radius: 6px; padding: 8px 14px; cursor: pointer;
  font-size: 14px; font-weight: 500; align-self: flex-end;
  transition: background 0.15s; white-space: nowrap;
}
.send-btn:hover:not(:disabled) { background: #388bfd; }
.send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>

<!-- Floating action button -->
<button class="fab" id="fab" title="GitHub Copilot Chat" aria-label="Open Copilot Chat">
  <svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
</button>

<!-- Chat panel -->
<div class="panel" id="panel" hidden>
  <div class="header">
    <div class="header-title">
      <svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      GitHub Copilot
    </div>
    <button class="close-btn" id="close-btn" aria-label="Close">&times;</button>
  </div>

  <!-- Shown when not authenticated -->
  <div class="auth-section" id="auth-section">
    <p>Sign in with your GitHub account to use Copilot Chat directly inside GitLab.</p>
    <button class="signin-btn" id="signin-btn">
      <svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Sign in with GitHub
    </button>
  </div>

  <!-- Message thread (shown when authenticated) -->
  <div class="messages" id="messages" hidden></div>

  <!-- Input row (shown when authenticated) -->
  <div class="input-row" id="input-row" hidden>
    <textarea id="input" placeholder="Ask Copilot anything\u2026" rows="1"></textarea>
    <button class="send-btn" id="send-btn">Send</button>
  </div>
</div>
`;

  /* ------------------------------------------------------------------ */
  /* Element references                                                   */
  /* ------------------------------------------------------------------ */

  const $ = (id: string) => shadow.querySelector(`#${id}`) as HTMLElement;

  const fab        = $('fab') as HTMLButtonElement;
  const panel      = $('panel');
  const closeBtn   = $('close-btn') as HTMLButtonElement;
  const authSection = $('auth-section');
  const messages   = $('messages');
  const inputRow   = $('input-row');
  const input      = $('input') as HTMLTextAreaElement;
  const sendBtn    = $('send-btn') as HTMLButtonElement;
  const signinBtn  = $('signin-btn') as HTMLButtonElement;

  /* ------------------------------------------------------------------ */
  /* Auth state helpers                                                   */
  /* ------------------------------------------------------------------ */

  function setAuthenticated(authed: boolean): void {
    authSection.hidden = authed;
    messages.hidden    = !authed;
    inputRow.hidden    = !authed;
  }

  async function checkAuthStatus(): Promise<void> {
    if (!sessionToken) { setAuthenticated(false); return; }
    try {
      const res = await fetch(`${BACKEND}/auth/status`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = (await res.json()) as { authenticated: boolean };
      setAuthenticated(data.authenticated);
      if (!data.authenticated) {
        sessionToken = null;
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      setAuthenticated(false);
    }
  }

  // Check immediately on load
  checkAuthStatus();

  // Receive session token from the OAuth popup
  window.addEventListener('message', (event: MessageEvent) => {
    if (
      event.data &&
      typeof event.data === 'object' &&
      event.data.type === 'COPILOT_AUTH_SUCCESS' &&
      typeof event.data.sessionToken === 'string'
    ) {
      sessionToken = event.data.sessionToken as string;
      sessionStorage.setItem(STORAGE_KEY, sessionToken);
      setAuthenticated(true);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Panel toggle                                                         */
  /* ------------------------------------------------------------------ */

  fab.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  closeBtn.addEventListener('click', () => { panel.hidden = true; });

  /* ------------------------------------------------------------------ */
  /* OAuth sign-in                                                        */
  /* ------------------------------------------------------------------ */

  signinBtn.addEventListener('click', () => {
    const popup = window.open(
      `${BACKEND}/auth/github`,
      'copilot-oauth',
      'width=620,height=720,scrollbars=yes'
    );
    if (!popup) {
      alert('Please allow pop-ups for this site to authenticate with GitHub.');
    }
  });

  /* ------------------------------------------------------------------ */
  /* Chat                                                                 */
  /* ------------------------------------------------------------------ */

  function addMessage(role: 'user' | 'assistant', text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  async function sendMessage(): Promise<void> {
    const text = input.value.trim();
    if (!text || !sessionToken) return;

    input.value = '';
    sendBtn.disabled = true;

    chatHistory.push({ role: 'user', content: text });
    addMessage('user', text);

    const assistantEl = addMessage('assistant', '\u2026');
    let assistantText = '';

    try {
      const res = await fetch(`${BACKEND}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ messages: chatHistory }),
      });

      if (!res.ok || !res.body) {
        assistantEl.textContent = '\u26a0\ufe0f Failed to reach Copilot. Please try again.';
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              assistantText += delta;
              assistantEl.textContent = assistantText;
              messages.scrollTop = messages.scrollHeight;
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      }

      chatHistory.push({ role: 'assistant', content: assistantText });
    } catch {
      assistantEl.textContent = '\u26a0\ufe0f Network error. Is the Copilot proxy running?';
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', () => { sendMessage(); });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Mount                                                                */
  /* ------------------------------------------------------------------ */

  document.body.appendChild(host);
})();
