---
name: Windows cleanup risk
description: Why Windows server cleanup needs ownership independent of live server-root PIDs.
---

Do not replace Windows process ownership with `taskkill /PID <server-pid> /T` as the sole cleanup mechanism.

**Why:** After a server root exits, its PID is no longer a reliable target for tree termination; surviving native helper descendants can be missed. Ctrl+C can create the same race. A cleanup command returning or failing is not evidence that the tree is gone.

**How to apply:** Keep ownership independent of server-root lifetime and establish it before target code can spawn helpers. Bound cleanup waits and report termination failures. Mocked process-protocol tests do not qualify native Windows kernel behavior; preserve that verification distinction.