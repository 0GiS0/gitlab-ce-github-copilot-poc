#!/usr/bin/env bash
# setup-gitlab.sh — initialises GitLab after first boot.
# Creates two demo projects (java-spring-boot, dotnet-api), pushes their source
# code, and registers the GitLab Runner for CI.
#
# Usage:  bash scripts/setup-gitlab.sh
# Env:    GITLAB_URL            (default: http://localhost:8080)
#         GITLAB_ROOT_PASSWORD  (default: GitLab1234!)
set -euo pipefail

GITLAB_URL="${GITLAB_URL:-http://localhost:8080}"
PASSWORD="${GITLAB_ROOT_PASSWORD:-GitLab1234!}"
RUNNER_TOKEN="glrt-demo-token-12345"
WORKSPACE="${WORKSPACE:-/workspace}"

echo "======================================================="
echo " GitLab Setup Script"
echo " Target: $GITLAB_URL"
echo "======================================================="

# ---------------------------------------------------------------------------
# 1. Wait for GitLab to become available
# ---------------------------------------------------------------------------
echo ""
echo "➜ Waiting for GitLab (this can take 3-5 minutes on first boot)…"
until curl -sf "$GITLAB_URL/api/v4/version" -o /dev/null 2>&1; do
  printf '.'
  sleep 10
done
echo ""
echo "✓ GitLab is up!"

# ---------------------------------------------------------------------------
# 2. Obtain a root API token via the initial password
# ---------------------------------------------------------------------------
echo ""
echo "➜ Obtaining root API token…"

TOKEN_JSON=$(curl -sf --request POST \
  "$GITLAB_URL/api/v4/users/1/personal_access_tokens" \
  --header "Content-Type: application/json" \
  --data "$(printf '{"name":"setup-script","scopes":["api"],"user_id":1}')"\ 
  -u "root:$PASSWORD" 2>/dev/null || echo '{}')

ROOT_TOKEN=$(echo "$TOKEN_JSON" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || true)

if [ -z "$ROOT_TOKEN" ]; then
  # Fallback: try the session-cookie approach
  ROOT_TOKEN=$(curl -sf --request POST "$GITLAB_URL/users/sign_in" \
    -d "user[login]=root&user[password]=$PASSWORD" \
    -c /tmp/gl-cookies.txt \
    | grep -oP '(?<="private_token":")[^"]+' || true)
fi

if [ -z "$ROOT_TOKEN" ]; then
  echo ""
  echo "⚠  Could not obtain a root token automatically."
  echo "   Create one manually at: $GITLAB_URL/-/user_settings/personal_access_tokens"
  echo "   Then re-run:  GITLAB_TOKEN=<token> bash scripts/setup-gitlab.sh"
  exit 1
fi

ROOT_TOKEN="${GITLAB_TOKEN:-$ROOT_TOKEN}"
echo "✓ Token obtained"

# ---------------------------------------------------------------------------
# 3. Helper: create a project
# ---------------------------------------------------------------------------
create_project() {
  local NAME="$1"
  local DESC="$2"
  echo "➜ Creating project: $NAME"
  curl -sf --request POST "$GITLAB_URL/api/v4/projects" \
    --header "PRIVATE-TOKEN: $ROOT_TOKEN" \
    --header "Content-Type: application/json" \
    --data "{\"name\":\"$NAME\",\"description\":\"$DESC\",\"visibility\":\"internal\",\"initialize_with_readme\":false}" \
    -o /dev/null
  echo "✓ $NAME created"
}

create_project "java-spring-boot" "Spring Boot Gradle demo with lint/build/test CI pipeline"
create_project "dotnet-api"       ".NET 8 ASP.NET Core Web API demo with lint/build/test CI pipeline"

# ---------------------------------------------------------------------------
# 4. Helper: push a local project to GitLab
# ---------------------------------------------------------------------------
push_project() {
  local NAME="$1"
  local DIR="$WORKSPACE/projects/$NAME"

  echo "➜ Pushing $NAME to GitLab…"
  cd "$DIR"

  git init -q
  git config user.email "admin@localhost"
  git config user.name  "GitLab Admin"
  git checkout -b main 2>/dev/null || git checkout main
  git add -A
  git diff --cached --quiet || git commit -q -m "feat: initial $NAME project

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

  # Encode password for URL
  local ENCODED_PW
  ENCODED_PW=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PASSWORD'))")

  git remote remove origin 2>/dev/null || true
  git remote add origin \
    "http://root:${ENCODED_PW}@${GITLAB_URL#http://}/root/${NAME}.git"

  git push --force --set-upstream origin main -q \
    && echo "✓ $NAME pushed" \
    || echo "⚠  Push failed for $NAME — check credentials or create the remote manually"

  cd "$WORKSPACE"
}

push_project "java-spring-boot"
push_project "dotnet-api"

# ---------------------------------------------------------------------------
# 5. Register GitLab Runner
# ---------------------------------------------------------------------------
echo ""
echo "➜ Registering GitLab Runner…"
RUNNER_CID=$(docker ps -qf 'ancestor=gitlab/gitlab-runner' 2>/dev/null | head -1 || true)

if [ -n "$RUNNER_CID" ]; then
  docker exec "$RUNNER_CID" gitlab-runner register \
    --non-interactive \
    --url "$GITLAB_URL" \
    --token "$RUNNER_TOKEN" \
    --executor docker \
    --docker-image "alpine:latest" \
    --description "Local Docker Runner" \
    --tag-list "docker,local" 2>&1 | tail -5 \
    && echo "✓ Runner registered" \
    || echo "⚠  Runner registration failed — register manually in GitLab UI"
else
  echo "⚠  gitlab-runner container not found — start services first, then re-run this script"
fi

echo ""
echo "======================================================="
echo " All done!"
echo "======================================================="
echo ""
echo "  GitLab UI : $GITLAB_URL"
echo "  Username  : root"
echo "  Password  : $PASSWORD"
echo ""
echo "  Projects:"
echo "    $GITLAB_URL/root/java-spring-boot"
echo "    $GITLAB_URL/root/dotnet-api"
echo ""
echo "  Copilot chat widget: http://localhost:3000/widget.js"
echo "  (injected automatically into GitLab via Nginx sub_filter)"
echo ""
