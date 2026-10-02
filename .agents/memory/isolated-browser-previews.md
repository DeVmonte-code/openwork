---
name: Isolated browser previews
description: Avoid duplicate provider contexts when checking protected frontend components without changing authentication.
---

An isolated browser harness must import each dependency through its own exact versioned module URL used by the running Vite app, not unversioned equivalents or one shared hash.

**Why:** Browser module identity includes the query string. Importing React Router without Vite's dependency-version query creates a separate context from the page's router hooks, producing a false missing-router error even when a provider is present. Incremental optimization can give React, React DOM, and React Router different hashes; using the router's hash for all three produces stale-dependency 504 responses.

**How to apply:** When checking a protected component in browser-intercepted test HTML, obtain each dependency URL independently from the running server's transformed component and entry module. Respect Vite's React-refresh initialization and CommonJS export shape. Keep the harness isolated from production routing and never weaken authentication to expose a preview.

Base UI control identity can differ from native HTML: a Switch's supplied id belongs to its hidden native input, not the visible switch.

**Why:** Clicking that id in a browser test repeatedly targeted an off-screen hidden input although the visible, accessible control worked.

**How to apply:** Exercise switches through their accessible role and label. Check validation attributes on the visible control rather than assuming a supplied id identifies the interactive element.

Read opener metadata before opening a modal dialog, not through background role locators while the dialog is open.

**Why:** Base UI hides the background page from the accessibility tree. Playwright's default role locators consequently stop resolving background buttons, even when the buttons remain in the DOM, causing misleading timeouts.

**How to apply:** Capture an opener's label before activating it. Query controls inside the dialog while it is open, and wait for the dialog to close before asserting background focus or interacting with the page again.

If Playwright's default `localhost:80` origin returns 502 while the managed Vite workflow is healthy, use the workflow's assigned port as `PLAYWRIGHT_BASE_URL` for that run.

**Why:** The preview proxy can fail independently of the running dev server; in this workspace, the direct Vite origin worked and the proxy did not.

**How to apply:** Check the workflow's open port before restarting or changing code. Retry the isolated browser test against `http://localhost:<assigned-port>` and keep its existing module-resolution safeguards.