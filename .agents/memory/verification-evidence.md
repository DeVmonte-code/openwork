---
name: Verification evidence
description: Reliable status reports when prior temporary test logs are no longer available.
---

Do not treat verification logs in `/tmp` as durable completion records across sessions.

**Why:** A later status lookup could not find earlier verification logs, while the user specifically required exact commands and actual pass/fail counts. Reconstructing a result from test definitions is not proof that the tests ran.

**How to apply:** State the exact reproducible commands and final results in the delivery report. Check that old log paths still exist before comparing against them. On read-only status requests, use recorded execution evidence; do not silently rerun checks or guess missing results.