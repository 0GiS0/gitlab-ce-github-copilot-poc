#!/usr/bin/env bash
# post-create.sh — runs automatically after the DevContainer is created.
# Installs dependencies and builds the chat widget so the Docker image
# for copilot-proxy has the widget.js ready to serve.
set -euo pipefail

echo "======================================================="
echo " GitLab CE + GitHub Copilot PoC — post-create setup"
echo "======================================================="

ROOT="/workspace"

echo ""
echo "➜ Building GitLab UI chat widget…"
cd "$ROOT/gitlab-ui-extension"
npm ci --silent
npm run build
echo "✓ Widget built → gitlab-ui-extension/dist/widget.js"

echo ""
echo "➜ Installing Copilot backend dependencies…"
cd "$ROOT/copilot-chat-backend"
npm ci --silent
echo "✓ Backend dependencies installed"

echo ""
echo "======================================================="
echo " Setup complete!"
echo "======================================================="
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and fill in your credentials:"
echo "       cp .env.example .env"
echo "  2. Start all services (GitLab, Runner, Copilot proxy):"
echo "       docker compose -f .devcontainer/docker-compose.yml --env-file .env up -d"
echo "  3. Wait ~3-5 min for GitLab to initialise, then run:"
echo "       bash scripts/setup-gitlab.sh"
echo "  4. Open http://localhost:8080  (root / GitLab1234!)"
echo ""
