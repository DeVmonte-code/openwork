# Multi-agent orchestrator

Status: proposal, 2026-10. These documents are the plan; no code ships with
them. Every "existing" claim cites a path in this repository. Everything else is
a proposal, and the open decisions are listed at the end of this page.

## Outcome

A new **Orchestrator** destination in the sidebar where an organization runs
several autonomous agents at the same time. Each agent is configured on its own,
watched continuously, and coordinated by one central orchestrator that starts,
pauses, resumes, restarts and stops it. Agents pass work to each other as
durable tasks, nothing is lost on a restart, risky actions wait for a person,
and every change and decision is on the record.

The tab is a window onto a service. It is not where the agents live.

## Why the orchestrator lives in Den, not in the desktop app

`packages/automations/README.md` states that the desktop "is only a Den client
and is never an Automation scheduler or execution host". The task brief says the
same thing from the other side: continuous operation "only through an
interactive chat session" is out of scope, because persistent operation needs a
deployed runtime, workers, storage and monitoring.

So the plan is split three ways:

| Plane | What it is | Where it lives |
| --- | --- | --- |
| Surfaces | The Orchestrator tab (desktop and web), the Den dashboard monitor, MCP clients, webhooks | `apps/app`, `ee/apps/den-web`, `ee/apps/den-api/src/mcp` |
| Control plane | Registry, config versions, durable queue, lifecycle reconciler, approvals, budgets, ledger | `ee/apps/den-api`, `ee/packages/den-db` (MySQL) |
| Execution plane | Isolated runners that execute one attempt at a time and report back | `ee/apps/headless-runner` first; cloud workers later |

## What already exists and what is new

| Need | Existing piece | How the orchestrator uses it |
| --- | --- | --- |
| Durable schedule, leases, idempotent occurrences | `packages/automations`, `ee/apps/den-api/src/automations/`, `ee/packages/den-db/src/schema/automations.ts` | Reuse the lease, heartbeat and attempt-count patterns, `schedule.ts` for daily and weekly timing, and the canonical digest approach for config versions. The claim technique differs; see architecture.md |
| Provider-neutral execution port | `AutomationEngineAdapter` in `packages/automations/src/engine.ts` (`capabilities`, `admit`, `observe`, `read`, `cancel`) | The runner port has the same shape, so admission keys and event cursors work the same way |
| Cheap, crash-safe agent turns | `ee/apps/headless-runner` (idempotent on `messageId`, steps written before the next starts, no shell, no host filesystem) | The default runner for the pilot |
| Full-workspace agent runs | `ee/apps/den-api/src/automations/cloud-agent-executor.ts`, `docs/features/automation-runtime-placement/README.md` | A later runner target |
| Desktop-side runs | `docs/features/automations-desktop-runner/README.md` (SSE wake-up, HTTP claim, attempt-bound heartbeats) | Out of the pilot; the pull model is the template for hybrid runners |
| Tools and connections | OpenWork MCP gateway, `ee/apps/den-api/src/mcp/` (`search_capabilities`, `execute_capability`, MCP tool annotations) | Every external effect goes through it |
| Short-lived run credentials | `ee/apps/den-api/src/mcp/headless-run-token.ts` (one hour at most, membership re-checked per request) | Model for per-attempt agent tokens |
| "Owner still has authority" checks | `ee/apps/den-api/src/automations/authority.ts` | An agent pauses when its owner loses access |
| Spend limits | `ee/packages/den-db/src/schema/gateway-usage-limits.ts` | Org-level ceiling; per-agent budgets sit under it |
| Encrypted columns | `encryptedColumn` in `ee/packages/den-db/src/columns.ts` | Instructions, payloads, memory |
| Audit | `ee/packages/den-db/src/audit-log.ts`, `ee/apps/den-api/src/audit/` (currently a pilot limited to a few operation kinds) | Mirror target; see decision D6 |
| Plan gating | `docs/enterprise-plan-gating.md`, `ee/apps/den-api/src/entitlements.ts` | "Gate writes, never reads or deletes" |
| Sidebar destination | `apps/app/src/react-app/domains/session/sidebar/sidebar-destination.tsx`, the Automations wiring in `shell/session-route.tsx` | The template for the new tab |
| Executable proof | `evals/specs`, `.opencode/skills/write-a-spec/SKILL.md` | Journey specs per milestone |

New: the agent registry and config versions, the task queue with its messages
and effects, the reconciler, approvals, memory scopes, the governance ledger,
the Orchestrator API and tab.

## How this relates to Automations

An Automation is one scheduled instruction that a person owns, run one
occurrence at a time, with a receipt. The Orchestrator is standing agents with
their own configuration, a shared queue, delegation, approvals and budgets. They
share infrastructure and neither replaces the other; see
[delivery-plan.md](delivery-plan.md) for how they might converge after the pilot.

## Document map

| Document | Brief steps | Covers |
| --- | --- | --- |
| [architecture.md](architecture.md) | 1, 3, 4, 5 | Operating model, state machines, durable queue, workers, failure modes |
| [agent-config.md](agent-config.md) | 2 | Versioned configuration schema, validation, activation, rollback |
| [messaging.md](messaging.md) | 6 | Agent-to-agent message contract and history |
| [memory.md](memory.md) | 7 | Task context versus durable memory, retention, access |
| [governance.md](governance.md) | 8 | Permission matrix, approvals, secrets, ledger, loop and spend controls, threat model |
| [api.md](api.md) | 10 | HTTP, stream, runner and MCP surfaces |
| [ui.md](ui.md) | 10 | The sidebar tab, routes, views, states, copy, `DESIGN.md` mapping |
| [operations.md](operations.md) | 9, 12 | Metrics, alerts, deployment profiles, runbooks, incident procedure |
| [sample-process.md](sample-process.md) | Done criterion 11 | Six agents collaborating from request to sent reply |
| [test-plan.md](test-plan.md) | 11 | Resilience matrix, permission and approval tests, journey specs |
| [delivery-plan.md](delivery-plan.md) | 12 | Milestones, exit criteria, pilot, risks, questions still open |

`examples/agents/*.json` are the six sample configurations. They are the first
fixtures the schema tests will load.

## Glossary

| Term | Meaning |
| --- | --- |
| Agent | A named, configured actor with an owner, versioned configuration, and a lifecycle state |
| Agent version | One immutable, validated snapshot of an agent's configuration |
| Task | A durable unit of work in the queue. Triggers, schedules and delegation all produce tasks; agents only ever process tasks |
| Process | A root task plus every task descended from it. It shares one correlation id, one budget and one set of loop limits. The product already uses "Workflow" for Code Mode scripts, so this plan avoids that word |
| Attempt | One lease-bound try at a task by one agent. Fenced: a stale attempt cannot write |
| Effect | An externally visible action, executed only through the effect gateway |
| Approval | A human decision bound to one effect and one exact set of arguments |
| Ledger | The append-only, hash-chained governance record: changes, decisions, effects |
| Reconciler | The loop that moves each agent's observed state toward the state an operator asked for |

## Decisions

All are proposals until a maintainer confirms. "Needs" names who should confirm.

| Id | Decision | Why | Needs |
| --- | --- | --- | --- |
| D1 | The control plane lives in Den on MySQL. Desktop and web are clients. | `packages/automations/README.md`; the brief rules out chat-only operation | Architecture owner |
| D2 | One queue, one path. Events, schedules, ticks and delegation all create tasks. | One place to enforce idempotency, limits and audit | Architecture owner |
| D3 | Agents are reconciled: operators set a desired state, a loop converges the observed state. | Survives restarts and replica changes with no in-memory ownership | Architecture owner |
| D4 | Delivery is at-least-once. Duplicate side effects are prevented by idempotency keys, an effect log and approvals. Exactly-once against external systems is not promised. | It cannot be promised honestly | Architecture owner |
| D5 | The pilot runs agents on the headless runner only (MCP tools, no shell). Cloud runners follow; the desktop target is excluded from v1. | Only effects that pass the gateway can be gated. `docs/architecture/team-execution-policy.md` says command patterns "are not a shell sandbox". | Security owner |
| D6 | The orchestrator keeps its own hash-chained ledger and mirrors to Den audit once that system covers orchestrator kinds. | `audit-log.ts` accepts only a few operation kinds today and cloud-source retention is `delete_oldest` | Audit owner |
| D7 | Configuration is data validated by Zod. Trigger conditions are declarative predicates, never code. | Reviewable, diffable, safe to store | Architecture owner |
| D8 | Per-agent budgets reserve before spend and settle after. Org ceilings stay in the gateway usage policy. Spend through bring-your-own-key providers is estimated, not metered. | `team-execution-policy.md`: no budget policy exists today | Billing owner |
| D9 | The pure domain goes in `packages/orchestrator` (MIT); persistence, routes and loops go in `ee/`. | Matches how Automations is split; `REUSE.toml` sets the licence boundary at `ee/` | Maintainers |
| D10 | The tab is called "Orchestrator" while behind the rollout flag. Design reviews the name before general availability. | `DESIGN.md` C3 asks for names people control, and "Agents" already means local OpenCode agents in the Library | Design owner |
| D11 | Writing orchestrator configuration is an Enterprise feature. Pause, stop, retire and reading are never gated. | `docs/enterprise-plan-gating.md` | Product owner |
| D12 | The orchestrator is scoped to one organization. | Same as Automations | Architecture owner |
| D13 | The pilot runs self-hosted on one local device the team controls, using Docker Compose, Den's stub provisioner and the headless runner. Kubernetes and hybrid stay supported later. | Full control, nothing outside the machine required, same code paths as production. Taken from the project owner's answer on 2026-10-01 ("the one we can have full access, and once deployed on a local device does not give any issues") | Project owner to confirm this reading |

## Traceability to the brief

| "Done looks like" | Satisfied by | Proved by |
| --- | --- | --- |
| Start, stop, pause, resume, restart | architecture.md "Agent lifecycle" | test-plan.md L1 to L6, spec J1 |
| Independent configuration of the nine fields | agent-config.md "Field reference" | agent-config.md "Validation", test-plan.md C1 to C5 |
| Concurrent long-lived or scheduled agents | architecture.md "Run modes" | test-plan.md R9, spec J1 |
| Tasks and structured messages between agents | messaging.md | sample-process.md, spec J1 |
| Durable queue | architecture.md "Durable queue" | test-plan.md R1 to R4 |
| Health, status, output, errors, usage observable | operations.md "Observability" | test-plan.md O1 to O3 |
| Recovery by policy | architecture.md "Failure modes", agent-config.md "Retry and escalation" | test-plan.md R1 to R8 |
| Versioned, auditable configuration | agent-config.md "Versioning", governance.md "Ledger" | test-plan.md C3, G5 |
| Human approval | governance.md "Approvals" | test-plan.md A1 to A9, spec J3 |
| No uncontrolled loops or duplicates | governance.md "Loop and spend controls", architecture.md "Idempotency" | test-plan.md R5, R10, G1 to G4, spec J4 |
| Sample multi-agent workflow | sample-process.md | spec J1, J2 |

## Out of scope

Training a foundation model. Unrestricted production access. Irreversible
actions without permission controls. Building every agent or business process.
Continuous operation that depends on an open chat session.

## Questions that need answers before building

The brief lists seven unknowns. Each has a working default in this plan so
nothing blocks; [delivery-plan.md](delivery-plan.md) records the default and
what we need from you for every one. The deployment environment is decided
(D13: one local device); the first real process to pilot is still open.
