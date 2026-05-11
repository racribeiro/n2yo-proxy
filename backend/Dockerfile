# -------------------------------------------------
# Multi‑stage build for backend + frontend
# -------------------------------------------------

# ---------- Backend builder ----------
FROM node:22-bookworm-slim AS backend-builder
# Pin a specific Node version for reproducibility
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install && npm install -g typescript
COPY backend/ .
RUN npm run build

# ---------- Frontend builder ----------
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---------- Runtime (backend only) ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install only production deps for backend
COPY backend/package*.json ./
RUN npm install --production

# Copy compiled backend output
COPY --from=backend-builder /app/backend/dist ./dist
# Copy compiled frontend static assets (served by backend)
COPY --from=frontend-builder /app/frontend/dist ./frontend-dist

RUN mkdir -p /app/data
EXPOSE 4000
CMD ["node", "dist/index.js"]
