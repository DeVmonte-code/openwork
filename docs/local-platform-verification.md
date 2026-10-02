# Local installation and loopback verification

Verified on Linux x64 with Node 24.13.0 and pnpm 10.26.1.

## Dependency policy and lockfile

- Removed 79 platform-exclusion overrides only. Minimum release age (1440 minutes), its existing exclusions, catalog, trusted build list, and version/security overrides remain unchanged.
- Regenerated with `pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile`.
- Comparison against the original lockfile found no existing package/version removals or upgrades. Importer and catalog sections were identical. Added 69 native package entries.
- Root `pnpm install --frozen-lockfile` passed.
- Replaced the Unix-only preinstall shell hook with equivalent Node cleanup and pnpm-only enforcement. Windows process helpers were not changed.

## Fresh default Linux installs

Copied the tracked source/workspace files, excluding secrets, backups, generated output, and installed dependencies, into separate temporary before/after directories.

For each copy:

```sh
pnpm install --frozen-lockfile
du -sk node_modules
```

Wall time was measured around the pnpm child process with Node's `performance.now()`.

| Measurement | Before | After |
| --- | ---: | ---: |
| Installed packages | 934 | 934 |
| Elapsed seconds | 18.65 | 8.86 |
| node_modules, KiB | 915872 | 915892 |

Both used cached packages; the second run benefited from a warm cache. This is not a controlled cold-install speed benchmark. The size difference is 20 KiB (approximately 0.002%). Both installed only the Linux x64 GNU variants of the four native tool families. No foreign-platform binaries appeared in either default installation.

## Target-platform native package proof

All five targets passed actual scripts-disabled installations, followed by inspection of installed package.json OS/CPU metadata:

| Target | esbuild | Rollup | lightningcss | Tailwind oxide | Seconds |
| --- | --- | --- | --- | --- | ---: |
| darwin-arm64 | darwin-arm64 | darwin-arm64 | darwin-arm64 | darwin-arm64 | 9.26 |
| darwin-x64 | darwin-x64 | darwin-x64 | darwin-x64 | darwin-x64 | 5.54 |
| win32-x64 | win32-x64 | win32-x64-msvc | win32-x64-msvc | win32-x64-msvc | 5.66 |
| win32-arm64 | win32-arm64 | win32-arm64-msvc | win32-arm64-msvc | win32-arm64-msvc | 5.71 |
| linux-arm64 | linux-arm64 | linux-arm64-gnu | linux-arm64-gnu | linux-arm64-gnu | 5.93 |

Installed versions were esbuild **0.28.2**, Rollup **4.63.1**, lightningcss **1.32.0**, and oxide **4.3.3**. Package names use the prefixes `@esbuild/`, `@rollup/rollup-`, `lightningcss-`, and `@tailwindcss/oxide-`, respectively.

The initial five full-workspace target installs exhausted the temporary environment's disk quota (error -122). They were replaced with focused installs in temporary workspace copies:

1. Copy the workspace manifests, original regenerated lockfile, and install policy.
2. Append temporary configuration for each target, never to the real workspace:

   ```yaml
   supportedArchitectures:
     os: [darwin] # or win32 / linux
     cpu: [arm64] # or x64
     libc: [glibc, musl]
   ```

3. Add a temporary `artifacts/native-platform-proof/package.json` named `native-platform-proof`, private, with the four parent dependencies pinned to the existing versions above.
4. Run this exact command for each OS/CPU pair:

   ```sh
   pnpm --filter native-platform-proof install --no-frozen-lockfile --ignore-scripts --prefer-offline
   ```

5. Inspect the actual installed native packages under `node_modules/.pnpm`; assert their `os` and `cpu` declarations match the target.

The temporary probe importer required a regenerated temporary lockfile; the real lockfile and production dependencies were not changed by these probes. This proves native package selection and installation, **not execution** on macOS, Windows, or Linux ARM64. No native machines for those targets were available.

## Tests and runtime checks

| Exact command | Final result |
| --- | --- |
| `pnpm test:local` | 17 passed; 0 failed; 0 skipped |
| `pnpm test:local:processes` | 7 passed; 0 failed; 0 skipped |
| `pnpm test:e2e` | 18 passed; 0 failed |
| `pnpm run typecheck` | Fails with the same 14 baseline frontend diagnostics; API typecheck passes |
| `git diff --check` | Passes |
| `curl --silent --show-error --max-time 10 http://localhost:80/api/healthz` | `{"status":"ok"}` |

The process tests inspect kernel LISTEN sockets, not just successful HTTP requests. Both local API and Vite listeners were exclusively IPv4 127.0.0.1, even with inherited `HOST=0.0.0.0`. The direct API start without HOST retained its wildcard default. The probe binds the same loopback interface. IPv4 inspection is mandatory; absence of `/proc/net/tcp6` is accepted only when IPv6 is disabled (ENOENT).

The initial browser run exposed an existing test-harness assumption that all optimized dependencies share one Vite hash. The two isolated harnesses now obtain each dependency's own versioned URL. No production UI or authentication changes were made. The final full browser run passed all 18 tests.

Managed web/API workflows were restarted with unchanged commands and were running normally. The unauthenticated sign-in preview was visually checked. The real signed-in UI was not verified; protected components were checked through the existing isolated browser fixtures. Existing diagnostics remain: missing optional Sentry configuration and refusal from the unavailable localhost:4096 worker health endpoint.

## Native Mac next check

Follow the nvm/Homebrew and Corepack steps in replit.md, then run `pnpm install` and `pnpm local` on the actual Mac. Confirm the printed addresses, mandatory sign-in/code handoff, API health through Vite, loopback listeners, and Ctrl+C cleanup. Do not reuse Linux node_modules on the Mac.