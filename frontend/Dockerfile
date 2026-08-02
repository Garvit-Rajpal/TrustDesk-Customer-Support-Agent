# TrustDesk frontend — static Vite build served by nginx, which also
# reverse-proxies API paths to the backend container so the built SPA
# never needs CORS or a baked-in API base URL — same-origin, mirroring
# vite.config.ts's dev-time proxy list exactly (see nginx.conf.template).
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
# Templated, not static: the backend's address differs between Docker
# Compose (a fixed local DNS name) and Azure Container Apps (a per-deploy
# FQDN known only at deploy time). Anything under /etc/nginx/templates/ is
# envsubst'd against the container's actual environment by this base
# image's own entrypoint scripts before nginx starts — no custom
# entrypoint needed. BACKEND_ORIGIN is supplied as a container env var.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
