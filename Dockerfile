# TrustDesk backend — runs via tsx directly against TypeScript source,
# mirroring `npm run dev` exactly (tsx watch src/server.ts, minus --watch).
# Deliberately NOT running the compiled `dist/` output: several modules
# read filesystem assets (data/*.json, data/knowledge_base/*.md,
# src/policy_packs/**) relative to their own __dirname at runtime — under
# tsc's dist/ output those paths would need re-copying at a different
# nesting depth (dist/src/... vs src/...) for zero actual benefit, since
# this app has no perf-sensitive cold-start requirement. `npm run build`/
# `typecheck` remain the CI-facing type-safety gate; this image runs the
# same way every dev/test/smoke-test invocation in this repo already does.
#
# Node 22, not 20 despite package.json's stated ">=20" engines minimum:
# `npm run migrate` shells out to `node-pg-migrate ... --migration-file-
# language ts`, which loads each migration via a plain CommonJS require()
# of the .ts file with no transpiler of its own — that only works because
# Node 22.6+ strips TypeScript syntax natively before executing. Node 20
# has no such capability and fails with a raw syntax error. This was
# invisible during local dev only because the dev machine happened to run
# Node 24; package.json's engines field was never actually accurate.
FROM node:22-bookworm-slim

WORKDIR /app

# Dependencies first for better layer caching — installed with dev deps
# included (tsx, typescript) since the runtime CMD below needs tsx itself.
COPY package.json package-lock.json ./
RUN npm ci

# Application source — everything the server or scripts/migrate.ts /
# scripts/seed (via src/db/seed.ts) read from disk at runtime. `tests/` is
# only here so the typecheck step below matches tsconfig.json's real
# `include` list exactly (src+tests+scripts) — same gate as CI, not
# shipped for any runtime purpose.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY data ./data

# Optional build-time type-check gate — fails the image build the same way
# CI would, before ever shipping a broken image. Skippable with
# `--build-arg SKIP_TYPECHECK=1` if you're iterating locally and want a
# faster rebuild loop.
ARG SKIP_TYPECHECK=
RUN if [ -z "$SKIP_TYPECHECK" ]; then npm run typecheck; fi

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

# Applies migrations (idempotent, additive-only) and seeds demo data only
# if the database is empty (see docker-entrypoint.sh / scripts/seedIfEmpty.ts
# for why seeding is NOT unconditional) before starting the server — this is
# what makes `docker compose up` alone a complete, working demo on first
# boot, without silently resetting a live demo's progress on any later
# restart.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]
