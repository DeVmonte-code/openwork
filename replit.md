# OpenWork

OpenWork is the imported browser workspace for chatting with agents, managing sessions and workspaces, and connecting tools.

## Run & Operate

- Start the managed workflow `artifacts/openwork: web`. It supplies `PORT` and `BASE_PATH` and serves the app at `/`.
- `pnpm --filter @workspace/openwork run test:e2e` runs the migration browser checks against the running preview.
- `pnpm --filter @workspace/openwork run build` creates static production output; it requires workflow-equivalent `PORT` and `BASE_PATH`.
- The original imported repository is retained under `.migration-backup/`.

## Run locally

Prerequisites: Node **22.12+** (Node 24 recommended; Vite also supports Node 20.19+) and **pnpm 10.26.1** (the verified release). The repository does not pin an exact Node or pnpm release; pnpm must support the v9 lockfile and workspace install policy. Use pnpm, not npm or Yarn.

```text
git clone <your-repository-url> openwork-local
cd openwork-local
pnpm install
pnpm local
```

`pnpm local` builds and starts the API directly with Node, waits for `/api/healthz`, then starts Vite. No Replit path router is needed: the local Vite server forwards `/api` to the API without rewriting paths or parsing bodies. The fixed Den upstream and sign-in rules remain unchanged. No database or session secret is needed for this API proxy.

Both local servers listen only on **127.0.0.1**, not your network interfaces. The runner overrides inherited `HOST` values. The API also accepts an optional `HOST` for direct starts; with none set it keeps its existing all-interface behavior for Replit.

Defaults are web port **5173** and API port **8788**. Occupied defaults advance to the next free port; the command prints the chosen ports and these addresses:

- Web: `http://127.0.0.1:5173/`
- Orchestrator: `http://127.0.0.1:5173/orchestrator`
- Hierarchy: `http://127.0.0.1:5173/orchestrator/hierarchy`
- Health through the web: `http://127.0.0.1:5173/api/healthz`

Use the printed addresses if ports changed. Complete the existing hosted OpenWork sign-in, then paste its one-time code into the local OpenWork sign-in screen. Manual paste-code sign-in remains the default; no unsigned preview mode is provided.

### macOS (Apple Silicon or Intel)

Install Node 24 with **nvm** (`nvm install 24 && nvm use 24`), or with **Homebrew**:

```sh
brew install node@24 corepack
export PATH="$(brew --prefix node@24)/bin:$PATH"
```

Then, from the repository root:

```sh
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install
pnpm local
```

The first install downloads the native tools matching your Mac (darwin arm64 on Apple Silicon, darwin x64 on Intel). Open the printed web address, normally `http://127.0.0.1:5173/`; the Orchestrator and Hierarchy addresses are listed above. If Corepack is not bundled with your Node installation, install it with Homebrew (`brew install corepack`) first.

Native macOS and Windows runs were **not tested here**. Only their install resolution was verified on Linux using pnpm's temporary `supportedArchitectures` settings with scripts disabled. Linux ARM64 resolution was also verified; native execution on that architecture was not tested. Do not copy `node_modules` between operating systems or CPUs: run `pnpm install` on the target computer.

To choose ports on macOS/Linux:

```sh
LOCAL_WEB_PORT=5180 LOCAL_API_PORT=9000 pnpm local
```

On Windows PowerShell:

```powershell
$env:LOCAL_WEB_PORT = "5180"
$env:LOCAL_API_PORT = "9000"
pnpm local
```

Explicit port overrides fail with a message if occupied. Press **Ctrl+C** to stop both servers; either server exiting also stops the other. The Vite proxy is enabled only when `OPENWORK_LOCAL_API_URL` is set, which the runner supplies to its web child; do not set it for ordinary Replit workflows. `pnpm test:local` checks port/environment policy, raw/streaming proxy behavior, native lockfile coverage, and the portable pnpm-only preinstall hook.

`pnpm test:local:processes` additionally checks real server startup, occupied defaults, interrupts, startup failure, peer termination, both local kernel listeners being loopback-only, and the API's unchanged default wildcard listener on Linux; it skips on other operating systems.

Known limits:

- Sign-in is required. Orchestrator and Hierarchy are in-memory **sample data**, not live agent orchestration; full chat needs an account and reachable worker.
- The root `preinstall` uses Node on every platform; it still removes npm/Yarn lock files and enforces pnpm.
- Windows process cleanup uses the bundled helper with built-in Windows PowerShell and kernel Job Objects on modern, Node-supported Windows. API and web code start only after ownership is established; failed helper setup stops startup rather than leaving unowned servers.
- Browser tests currently default to Replit's Chromium path. On another computer, supply `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and `PLAYWRIGHT_BASE_URL` to use an installed Chromium and the local web address.

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
