# TrustDesk frontend — static Vite build served by nginx, which also
# reverse-proxies API paths to the backend container so the built SPA
# never needs CORS or a baked-in API base URL — same-origin, mirroring
# vite.config.ts's dev-time proxy list exactly (see nginx.conf).
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
