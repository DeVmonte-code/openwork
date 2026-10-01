---
name: Isolated browser previews
description: Avoid duplicate provider contexts when checking protected frontend components without changing authentication.
---

An isolated browser harness must import dependencies through the exact versioned module URLs used by the running Vite app, not unversioned equivalents.

**Why:** Browser module identity includes the query string. Importing React Router without Vite's dependency-version query creates a separate context from the page's router hooks, producing a false missing-router error even when a provider is present.

**How to apply:** When checking a protected component in browser-intercepted test HTML, obtain dependency URLs from the running server's transformed component. Respect Vite's React-refresh initialization and CommonJS export shape. Keep the harness isolated from production routing and never weaken authentication to expose a preview.