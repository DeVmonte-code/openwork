---
name: Isolated browser previews
description: Avoid duplicate provider contexts when checking protected frontend components without changing authentication.
---

An isolated browser harness must import each dependency through its own exact versioned module URL used by the running Vite app, not unversioned equivalents or one shared hash.

**Why:** Browser module identity includes the query string. Importing React Router without Vite's dependency-version query creates a separate context from the page's router hooks, producing a false missing-router error even when a provider is present. Incremental optimization can give React, React DOM, and React Router different hashes; using the router's hash for all three produces stale-dependency 504 responses.

**How to apply:** When checking a protected component in browser-intercepted test HTML, obtain each dependency URL independently from the running server's transformed component and entry module. Respect Vite's React-refresh initialization and CommonJS export shape. Keep the harness isolated from production routing and never weaken authentication to expose a preview.