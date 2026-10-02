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

Agents are listed with an **Agent Card** generated from their configuration, and they
talk to each other over the open **A2A (Agent2Agent) protocol**, so the same cards and
messages work with agents outside OpenWork. The tab is a window onto a service. It is
not where the agents live.

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
| [a2a.md](a2a.md) | 3, 6 | The A2A protocol: Agent Cards, task states, delegation as A2A messages, remote agents, interoperability |
| [hierarchy.md](hierarchy.md) | Span-of-control task | Who reports to whom: one manager per agent, control and dependency degrees, span of control, the five reports |
| [workspaces-and-chat.md](workspaces-and-chat.md) | 10 | How the Orchestrator links to workspaces and the current chat: handing work from a chat, discussing a task in a chat, and agents bound to a workspace |
| [memory.md](memory.md) | 7 | Task context versus durable memory, retention, access |
| [governance.md](governance.md) | 8 | Permission matrix, approvals, secrets, ledger, loop and spend controls, threat model |
| [api.md](api.md) | 10 | HTTP, stream, runner and MCP surfaces |
| [ui.md](ui.md) | 10 | The sidebar tab, routes, views, states, copy, `DESIGN.md` mapping |
| [operations.md](operations.md) | 9, 12 | Metrics, alerts, deployment profiles, runbooks, incident procedure |
| [sample-process.md](sample-process.md) | Done criterion 11 | Six agents, with a coordinator over them, collaborating from request to sent reply |
| [test-plan.md](test-plan.md) | 11 | Resilience matrix, permission and approval tests, journey specs |
| [delivery-plan.md](delivery-plan.md) | 12 | Milestones, exit criteria, pilot, risks, questions still open |

`examples/agents/*.json` are the seven sample configurations (six workers and the
coordinator that manages them). They are the first fixtures the schema tests will load.
`examples/hierarchy/*.json` hold the hierarchy reports for the same organization.

## A note on names

In product copy this is the **Orchestrator**. In code it is the **agent
orchestrator**: the repository already has an `orchestrator` that means
something else. `ee/packages/cloud-runtime/src/orchestrator` provisions, starts
and stops cloud sandbox hosts. It is unrelated to coordinating agents, but it is
the piece that creates the cloud workers the later `cloud` runner target would
use. To keep the two apart, new code locations use `agent-orchestrator`
(`packages/agent-orchestrator`, `ee/apps/den-api/src/agent-orchestrator/`), and
database tables, API paths and the app folder keep the plain `orchestrator`
prefix because nothing there collides.

## Where the paths in these documents point

Paths such as `apps/app`, `ee/apps/den-api` and `packages/automations` are relative to
the original OpenWork repository root. On this fork's `dev` branch,
the Replit migration moved that whole repository under `.migration-backup/` and made the
root a Replit workspace. The migrated web app, including the preview of the Orchestrator
tab, is in `artifacts/openwork/`, and its `src` mirrors `apps/app/src`. Read every path in
this plan as `.migration-backup/<path>` on that branch. The Replit workspace has no Den,
no headless runner and no database package, so the backend described here cannot be
built there (decision D17).

The Replit preview also has a Hierarchy page (route `/orchestrator/hierarchy`) that runs on
sample data and its own copy of the rules, `hierarchy-rules.ts`, with unit tests and a browser
test. It is a UI preview, not the implementation: [hierarchy.md](hierarchy.md) is the
specification, and the preview differs from it in three ways that are expected. Its escalation
path lists the whole chain instead of skipping managers that are not running, it does not check
stored data for loops or two managers, and it keeps its levels as plain numbers. The port to
`packages/agent-orchestrator` should start from the reference code in `hierarchy.md`.

## Glossary

| Term | Meaning |
| --- | --- |
| Agent | A named, configured actor with an owner, versioned configuration, and a lifecycle state |
| Agent version | One immutable, validated snapshot of an agent's configuration |
| Agent Card | An agent's listing in the A2A protocol: name, description, skills, how to reach it and how to authenticate. Generated from the active configuration |
| A2A skill ("Request it handles") | One thing an agent can be asked to do, tied to a task type it accepts. Not the same as an attached skill |
| Attached skill | A skill (instructions, never a tool) attached to an agent from the organization's marketplaces or the gateway's built-in skills. Pinned by content digest. A skill that lives only on one person's computer cannot be attached |
| Remote agent | An A2A agent outside the organization that an administrator has registered |
| Task | A durable unit of work in the queue. Triggers, schedules and delegation all produce tasks; agents only ever process tasks |
| Process | A root task plus every task descended from it. It shares one correlation id, one budget and one set of loop limits. The product already uses "Workflow" for Code Mode scripts, so this plan avoids that word |
| Attempt | One lease-bound try at a task by one agent. Fenced: a stale attempt cannot write |
| Effect | An externally visible action, executed only through the effect gateway |
| Approval | A human decision bound to one effect and one exact set of arguments |
| Ledger | The append-only, hash-chained governance record: changes, decisions, effects |
| Reconciler | The loop that moves each agent's observed state toward the state an operator asked for |
| Manager | An agent that supervises other agents (`role.kind: manager`, or any agent with direct reports). Has exactly one manager of its own, except the root |
| Direct report | An agent with a recorded, active reporting relationship to one manager |
| Origin | Where a root task came from: the Orchestrator itself, a chat, an MCP client, an event source, a schedule or an outside A2A caller. Ids only, never content. A label, not authority |
| Span of control | The number of active direct reports a manager has. Counted, never stored. Indirect reports are not counted |
| Control degree | 1 to 5: how much authority the manager has over the report |
| Dependency degree | 1 to 5: how much the report relies on its manager. Stored separately from the control degree |

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
| D9 | The pure domain goes in `packages/agent-orchestrator` (MIT); persistence, routes and loops go in `ee/`. | Matches how Automations is split; `REUSE.toml` sets the licence boundary at `ee/` | Maintainers |
| D10 | The tab is called "Orchestrator" while behind the rollout flag. Design reviews the name before general availability. | `DESIGN.md` C3 asks for names people control, and "Agents" already means local OpenCode agents in the Library | Design owner |
| D11 | Writing orchestrator configuration is an Enterprise feature. Pause, stop, retire and reading are never gated. | `docs/enterprise-plan-gating.md` | Product owner |
| D12 | The orchestrator is scoped to one organization. | Same as Automations | Architecture owner |
| D13 | The pilot runs self-hosted on one local device the team controls, using Docker Compose, Den's stub provisioner and the headless runner. Kubernetes and hybrid stay supported later. | Full control, nothing outside the machine required, same code paths as production. Taken from the project owner's answer on 2026-10-01 ("the one we can have full access, and once deployed on a local device does not give any issues") | Project owner to confirm this reading |
| D14 | A2A is the agent-to-agent protocol at every agent boundary. The orchestrator is the A2A server for each agent it runs and the A2A client when an agent delegates, so every exchange is a durable, guarded task. Internal message types stay, because they carry governance fields, and are projected to A2A. | Interoperability for free; the guarantees in this plan apply to every exchange | Architecture owner |
| D15 | A finished task is never reopened. Retrying creates a new task that references the old one. | A2A forbids messages to finished tasks, and it makes the record easier to audit | Architecture owner |
| D16 | The A2A binding is HTTP+JSON under `/a2a`, as a protocol adapter. In the pilot agents are `internal` or `members`, none is `organization`, and no remote agents are registered. | One operation per route keeps authorisation and audit simple; widening exposure is a separate security decision | Security owner |
| D17 | The orchestrator backend is built in the original repository layout. The Replit workspace's `artifacts/openwork` is a preview and a source to port the tab from. | Den, the headless runner, the database package and the evals only exist in the original layout | Maintainers |
| D18 | Every agent except the root has exactly one direct manager. There is no matrix reporting, and no loops. | A single line of authority keeps escalation, approval and accountability unambiguous | Product owner |
| D19 | A manager agent can satisfy an internal approval but never an approval for an external write or an irreversible action. Those stay with a person at every control degree. | A manager agent is software; the human floor in governance.md must not have a path around it | Security owner |
| D20 | Changing the hierarchy needs the right to activate a version, and every change is a ledger entry. Agents may recommend a change but never make one. The span limit is 7 and breaches are flagged, not blocked, until the organization chooses `block`. | The hierarchy decides who has authority, so it is governed like configuration. The limit of 7 is a starting point to confirm | Product owner |
| D21 | The Orchestrator stays organization-scoped. A workspace or a chat is a reference: an origin on a task and an optional binding on an agent. It is never a parent. | Same placement as Automations; keeps one queue, one ledger and one set of limits | Product owner |
| D22 | Chats reach the Orchestrator through gateway capabilities, in the remote-session pattern. A chat can list the agents visible to members, submit a task, read it, and relay the person's answer to a question put to them. It cannot approve, configure or change the hierarchy. | Reuses what every workspace already has; approvals and configuration stay a person's act in the tab. Decided by the project owner for answers | Security owner |
| D23 | A task that came from a chat, an MCP client, an event or an outside caller starts tainted. An origin is a label and carries ids only. | A chat may have read hostile text; taint already limits what such a task can do | Security owner |
| D24 | An agent is visible to members' chats and MCP clients only when its `a2a.exposure` is `members` or `organization`. `members` is not served over A2A; `organization` is. Decided by the project owner. | Members see only the agents meant for them; widening A2A stays a separate security decision | Product owner |
| D25 | Talking to an agent happens in a conversation inside the Orchestrator, made of ordinary `chat.message` tasks in one A2A context and shown in plain language. A general chat is the second-best path. Approvals stay cards; typing "approve" approves nothing. Decided after the owner tried the preview and found a general chat confusing. | The guarantees on tasks, approvals and loops apply with no new machinery, and people never see tool or model rows | Product owner |

## Traceability to the brief

| "Done looks like" | Satisfied by | Proved by |
| --- | --- | --- |
| Start, stop, pause, resume, restart | architecture.md "Agent lifecycle" | test-plan.md L1 to L6, spec J1 |
| Independent configuration of the nine fields | agent-config.md "Field reference" | agent-config.md "Validation", test-plan.md C1 to C5 |
| Concurrent long-lived or scheduled agents | architecture.md "Run modes" | test-plan.md R9, spec J1 |
| Tasks and structured messages between agents | messaging.md, a2a.md | sample-process.md, test-plan.md X1 to X10, spec J1 |
| Durable queue | architecture.md "Durable queue" | test-plan.md R1 to R4 |
| Health, status, output, errors, usage observable | operations.md "Observability" | test-plan.md O1 to O3 |
| Recovery by policy | architecture.md "Failure modes", agent-config.md "Retry and escalation" | test-plan.md R1 to R8 |
| Versioned, auditable configuration | agent-config.md "Versioning", governance.md "Ledger" | test-plan.md C3, G5 |
| Human approval | governance.md "Approvals" | test-plan.md A1 to A9, spec J3 |
| No uncontrolled loops or duplicates | governance.md "Loop and spend controls", architecture.md "Idempotency" | test-plan.md R5, R10, G1 to G4, spec J4 |
| Sample multi-agent workflow | sample-process.md | spec J1, J2 |
| Span of control and dependency reporting (the follow-on task) | hierarchy.md | test-plan.md H1 to H14, spec J6 |
| Linking to workspaces and the current chat (the follow-on question) | workspaces-and-chat.md | test-plan.md W1 to W14, spec J7 |
| A friendly way to talk to an agent (the follow-on question) | ui.md "Asking an agent", messaging.md "Conversations with a person" | test-plan.md T1 to T8, spec J8 |

## Out of scope

Training a foundation model. Unrestricted production access. Irreversible
actions without permission controls. Building every agent or business process.
Continuous operation that depends on an open chat session.

## Questions that need answers before building

The brief lists seven unknowns. Each has a working default in this plan so
nothing blocks; [delivery-plan.md](delivery-plan.md) records the default and
what we need from you for every one. The deployment environment is decided
(D13: one local device); the first real process to pilot is still open.
