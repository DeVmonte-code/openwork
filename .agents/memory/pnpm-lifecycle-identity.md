---
name: pnpm lifecycle identity
description: Version differences in package-manager identity during install hooks.
---

Do not assume pnpm install lifecycle hooks always supply a versioned `npm_config_user_agent`.

**Why:** A fresh pnpm 11 install was rejected by the pnpm-only policy because the older versioned user-agent signal was absent. pnpm 10 supplies it; pnpm 11 can instead be identified by the lifecycle's pnpm executable.

**How to apply:** When maintaining the install policy, test both package-manager versions and their lifecycle identity signals, while continuing to reject npm. A frozen-lockfile no-op install does not exercise the root install hook; use a fresh dependency tree to verify this compatibility.