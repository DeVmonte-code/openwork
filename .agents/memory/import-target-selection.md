---
name: Import target selection
description: Choosing the intended product when a Vercel import contains multiple independently deployed apps.
---

When an imported repository contains several independently deployed apps, confirm the intended product with the user rather than assuming the Next.js app is the target.

**Why:** This OpenWork import included a workspace SPA, a separate cloud dashboard, a marketing site, and other Vercel configurations. Framework detection alone could have selected the wrong product.

**How to apply:** Treat Vercel configs as candidate deployments, not one combined application. Use the user's selected product to scope the port; do not migrate the whole backend or replace remote services just to make authenticated screens accessible without an account.