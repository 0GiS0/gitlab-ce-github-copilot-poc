# GitLab CE + GitHub Copilot Chat — PoC

A **DevContainer-based local environment** that spins up:

| Component | Description |
|---|---|
| **GitLab CE** | Self-hosted GitLab on `http://localhost:8080` |
| **GitLab Runner** | Docker executor for CI/CD pipelines |
| **Java project** | Spring Boot (Gradle) with lint → build → test pipeline |
| **.NET project** | ASP.NET Core 8 Web API with lint → build → test pipeline |
| **Copilot proxy** | Node.js/TypeScript backend that handles GitHub OAuth and proxies chat requests to the Copilot API |
| **Chat widget** | TypeScript widget (Shadow DOM) injected into every GitLab page via Nginx `sub_filter` |

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  DevContainer (Docker Compose)                    │
│                                                   │
│  ┌─────────────┐   ┌─────────────────┐           │
│  │ GitLab CE   │   │  GitLab Runner  │           │
│  │ :8080       │   │  (Docker exec) │           │
│  └─────┬─────┘   └─────────────────┘           │
│        │ Nginx sub_filter injects widget.js        │
│        │                                           │
│  ┌─────┴───────────────────────────────┐      │
│  │ Copilot Proxy  :3000                        │      │
│  │  GET  /auth/github      → GitHub OAuth     │      │
│  │  GET  /auth/github/callback                │      │
│  │  GET  /auth/status                         │      │
│  │  POST /chat             → Copilot API (SSE) │      │
│  │  GET  /widget.js        (static asset)      │      │
│  └───────────────────────────────────┐      │
└──────────────────────────────────────────────────┘
```

### OAuth + Chat flow

```
Browser (GitLab UI)        Copilot Proxy          GitHub / Copilot API
        |                       |                         |
        |── click Sign in ─────>|                         |
        |   popup opens         |── redirect OAuth ──────>|
        |                       |<── code=xxx ──────────|
        |                       |── exchange code→token ─>|
        |                       |<── access_token ───────|
        |<─ postMessage(token) ─|                         |
        |   popup closes        |                         |
        |                       |                         |
        |── POST /chat (SSE) ──>|                         |
        |                       |── completions API ─────>|
        |<──── stream ────────|<──── SSE stream ───────|
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Memory ≥ 6 GB recommended for GitLab CE |
| [VS Code](https://code.visualstudio.com/) + [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) | Or any DevContainer-compatible IDE |
| **GitHub OAuth App** | See below |
| **GitHub Copilot subscription** | Required to call `api.githubcopilot.com` |

---

## 1. Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - **Application name**: `GitLab Copilot Chat (local)`
   - **Homepage URL**: `http://localhost:8080`
   - **Authorization callback URL**: `http://localhost:3000/auth/github/callback`
3. Click **Register application**, then generate a **Client secret**.
4. Copy the **Client ID** and **Client secret**.

---

## 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env and set:
#   GITHUB_CLIENT_ID=<your client id>
#   GITHUB_CLIENT_SECRET=<your client secret>
```

---

## 3. Open in DevContainer

```
Code → Command Palette → Dev Containers: Reopen in Container
```

The `postCreateCommand` will automatically:
- Build the chat widget (`gitlab-ui-extension/dist/widget.js`)
- Install backend Node.js dependencies

---

## 4. Start all services

From **inside the DevContainer terminal**:

```bash
# Copy credentials into the compose environment
cp .env .devcontainer/.env   # docker compose reads from its own directory

docker compose -f .devcontainer/docker-compose.yml --env-file .env up -d
```

GitLab CE takes **3–5 minutes** to initialise on first boot.

---

## 5. Initialise GitLab (projects + runner)

```bash
bash scripts/setup-gitlab.sh
```

This script:
1. Polls GitLab until it’s ready
2. Creates a root API token
3. Creates `java-spring-boot` and `dotnet-api` projects
4. Pushes the source code from `projects/` into each GitLab project
5. Registers the GitLab Runner with Docker executor

---

## 6. Use the Copilot chat widget

1. Open **http://localhost:8080** and sign in as `root` / `GitLab1234!`.
2. Look for the **🤖 floating button** in the bottom-right corner of every page.
3. Click it → **Sign in with GitHub** → complete the OAuth flow in the popup.
4. Start chatting with GitHub Copilot directly inside GitLab!

---

## Repository structure

```
.
├── .devcontainer/
│   ├── devcontainer.json      # DevContainer config (Node 20, Java 17, .NET 8)
│   └── docker-compose.yml     # GitLab CE + Runner + Copilot proxy
├── gitlab-config/
│   └── gitlab.rb              # Nginx sub_filter widget injection + tuning
├── projects/
│   ├── java-spring-boot/      # Spring Boot Gradle + .gitlab-ci.yml
│   └── dotnet-api/            # ASP.NET Core 8 Web API + .gitlab-ci.yml
├── copilot-chat-backend/      # Express proxy (OAuth + Copilot API)
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth.ts            # GitHub OAuth + in-memory session store
│   │   └── chat.ts            # SSE proxy → api.githubcopilot.com
│   └── Dockerfile             # Multi-stage: widget build + backend build
├── gitlab-ui-extension/
│   └── src/
│       └── widget.ts          # Shadow DOM chat widget (TypeScript → IIFE)
├── scripts/
│   ├── post-create.sh         # DevContainer postCreateCommand
│   └── setup-gitlab.sh        # Initialise GitLab projects + runner
├── .env.example
└── README.md
```

---

## CI Pipelines

Both projects run the same three-stage pipeline inside GitLab:

| Stage | Java | .NET |
|---|---|---|
| **lint** | `gradle checkstyleMain` | `dotnet format --verify-no-changes` |
| **build** | `gradle build -x test` | `dotnet build --configuration Release` |
| **test** | `gradle test` (JUnit XML) | `dotnet test` (JUnit XML) |

Test results are published as JUnit reports in the GitLab pipeline UI.

---

## Notes

- The **session store** for OAuth tokens is in-memory. Restarting the proxy clears all sessions; users will need to sign in again.
- The widget uses a **Shadow DOM** so it doesn’t conflict with GitLab’s own CSS.
- The Nginx `sub_filter` requires uncompressed HTML responses from Puma; `proxy_set_header Accept-Encoding ""` is set in `gitlab.rb` to ensure this.
- If you change the widget source, rebuild it with `npm run build` inside `gitlab-ui-extension/` and restart the `copilot-proxy` container.
