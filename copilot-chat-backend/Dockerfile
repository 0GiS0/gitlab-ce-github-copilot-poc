# --- Stage 1: build the GitLab UI widget ---
FROM node:20-alpine AS widget-builder
WORKDIR /widget
COPY gitlab-ui-extension/package*.json ./
RUN npm ci
COPY gitlab-ui-extension/ ./
RUN npm run build

# --- Stage 2: compile the TypeScript backend ---
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY copilot-chat-backend/package*.json ./
RUN npm ci
COPY copilot-chat-backend/tsconfig.json ./
COPY copilot-chat-backend/src/ ./src/
RUN npm run build

# --- Stage 3: lean runtime image ---
FROM node:20-alpine
WORKDIR /app
COPY copilot-chat-backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend-builder /app/dist ./dist
# widget.js is served as a static file from /public
COPY --from=widget-builder /widget/dist ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
