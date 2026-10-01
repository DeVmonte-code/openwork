# OpenWork

OpenWork is the imported browser workspace for chatting with agents, managing sessions and workspaces, and connecting tools.

## Run & Operate

- Start the managed workflow `artifacts/openwork: web`. It supplies `PORT` and `BASE_PATH` and serves the app at `/`.
- `pnpm --filter @workspace/openwork run test:e2e` runs the migration browser checks against the running preview.
- `pnpm --filter @workspace/openwork run build` creates static production output; it requires workflow-equivalent `PORT` and `BASE_PATH`.
- The original imported repository is retained under `.migration-backup/`.

## Stack & Source

- pnpm workspace, React 19.2, Vite, React Router, Tailwind v4.
- `artifacts/openwork/` is the migrated `apps/app` SPA, not the separate Den cloud dashboard or marketing website.
- `src/index.react.tsx` is the original React entry; `src/app/index.css` and `src/styles/` own the original theme and fonts.
- Shared imported packages live in `lib/{browser-tabs,install-config,types,ui,workbook,telemetry-contracts}`.
- The existing API server now supplies a fixed-upstream `/api/den` proxy. Its managed workflow must run alongside the frontend in development and production. The database libraries and mockup sandbox remain unused scaffolds.

## Migration Decisions

- Preserve the Vercel web deployment's mandatory sign-in. Do not silently switch to desktop or unsigned self-host mode to bypass authentication.
- Preserve the original remote OpenWork services and authentication protocol. No database conversion or replacement backend was requested.
- Retain original shared package names to preserve imports and package export contracts; the frontend artifact uses the `@workspace/` convention.
- Keep the original UI rather than redesigning it. Desktop-only operations remain gated by the imported platform layer.

## Connected Services

The original default sign-in site is `https://app.openworklabs.com`; its API is `https://api.app.openworklabs.com`. The sign-in screen also supports the original on-premises server address and pasted sign-in code controls. Full chat/agent functionality requires an OpenWork account and reachable worker. No account credentials are included in the import.

Hosted API requests go through the fixed same-origin proxy because Den does not approve arbitrary preview origins. The original manual grant handoff is enabled by default: complete hosted sign-in, then paste the resulting code into OpenWork. After the preview or published origin is approved in Den, set `VITE_OPENWORK_FORCE_MANUAL_AUTH=0` to use the original automatic web return. Custom on-premises control planes retain their original API resolution and require their own origin configuration.

Optional original configuration includes `VITE_DEN_BASE_URL`, `VITE_DEN_API_BASE_URL`, and `VITE_OPENWORK_SENTRY_DSN`. Set environment variables through workspace configuration, not committed credential files.

## Gotchas

- Do not run root `pnpm dev`: use the artifact-owned workflow.
- Cartographer JSX instrumentation is disabled for this imported UI because it inserts attributes inside generic JSX type arguments, producing invalid syntax.
- Production output includes the original main and overlay HTML entries.
- Existing imported type errors and desktop-runtime dependencies are not reasons to replace the original app with a mockup.
