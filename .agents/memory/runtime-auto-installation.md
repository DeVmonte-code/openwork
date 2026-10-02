---
name: Runtime auto-installation
description: Preserve the Node-only environment during dependency-free preview work.
---

Use the patch tool or existing Node runtime for repository edits when the user prohibits new dependencies or environment changes. Do not invoke Python for incidental text processing.

**Why:** Invoking Python during delegated edits automatically added a Python runtime module to the Replit configuration, despite no intentional package installation. The same behavior recurred across separate feature requests.

**How to apply:** Explicitly tell delegated workers not to invoke Python; saying only “no dependencies” does not prevent automatic runtime installation. Check configuration and dependency diffs before delivery. If an incidental runtime was added, remove it through the package-management interface to restore the original environment.