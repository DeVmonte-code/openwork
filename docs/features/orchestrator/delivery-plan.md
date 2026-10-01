# Delivery plan

Status: proposal. Part of [the orchestrator plan](README.md). Covers brief step 12
and records what is still open.

## How the work is sliced

- Small pull requests (`CONTRIBUTING.md`: keep diffs as small as possible). Each
  milestone is several of them, merged behind `DEN_ORCHESTRATOR_ENABLED=false`.
- Pure domain first, then persistence, then loops, then execution, then people.
  Each layer is testable before the next exists.
- Every milestone ends with proof, not a demo: named tests from
  [test-plan.md](test-plan.md), and for anything visible a journey spec and
  screenshots (`DESIGN.md` P10).
- No milestone is "done" with a skipped test. A scope change is made in this
  document first.
- Effort is sized relatively (S, M, L). Calendar dates need a team and a
  decision on priority, which this plan does not have.

## Milestones

| | Milestone | Size | Depends on |
| --- | --- | --- | --- |
| M0 | Sign-off | S | none |
| M1 | Domain core | M | M0 |
| M2 | Persistence and queue | L | M1 |
| M3 | Reconciler and lifecycle API | L | M2 |
| M4 | Execution | L | M3 |
| M5 | Governance | L | M4 |
| M6 | Surfaces and observability | L | M3 for the API; M5 for approvals |
| M7 | Resilience, security, scale | M | M5, M6 |
| M8 | Controlled pilot | M | M7 |

M6 can start in parallel once M3's API exists.

### M0 Sign-off

Merge this document set. Resolve the blocking decisions: D1, D5, D6, D9 and D11,
plus the first three open questions below. **Exit:** maintainers have confirmed
or changed each decision in this folder.

### M1 Domain core

- `packages/types/src/orchestrator.ts`: the schemas in
  [agent-config.md](agent-config.md) and [messaging.md](messaging.md), with
  `.meta({ ref })` names. The six `examples/agents/*.json` become fixtures.
- `packages/agent-orchestrator` with no infrastructure: V1 to V3 validation behind
  ports, agent and task state machines, idempotency key derivation, loop
  guards, backoff, the effect state machine, ledger hashing, the repository and
  runner ports, an in-memory repository, and the conformance suite.
- The A2A subset, the internal-to-A2A state projection and the Agent Card generator
  ([a2a.md](a2a.md)), checked against types generated from the pinned specification.

**Exit:** `bun test src` green, including L7, C1, C2, C8 and the hash-chain part
of G5. The negative config cases and state-machine reachability checks prototyped
for this plan are ported as tests.

### M2 Persistence and queue

- `ee/packages/den-db/src/schema/orchestrator.ts` and a migration generated with
  `pnpm --dir ee/packages/den-db db:generate`.
- A MySQL repository: claim, lease, heartbeat, reaper, fencing, idempotency,
  dead letter, effect log, budgets, ledger append and state, organization
  policy.
- The source-boundary test that allows only `append` on the ledger.

**Exit:** the conformance suite passes on MySQL; R3, R4, R8, R10, R12 pass;
migrations apply to an empty database and to a database with the previous
schema.

### M3 Reconciler and lifecycle API

- The reconciler loop and its role flag; tick generation; agent commands; version
  save, validate and activate; task create, list, get, cancel, requeue; overview;
  the stream.
- Routes with `describeRoute()`, the OpenAPI snapshot, route-access tests, plan
  gating for writes.
- The Agent Card for every active agent and the A2A endpoint (`SendMessage`, `GetTask`,
  `ListTasks`, `CancelTask`) under `/a2a`, as a protocol adapter.

**Exit:** L1 to L8, C3 to C7 and X2 to X6, X8, X10 pass; `pnpm api:snapshot` committed and
`pnpm api:lint` clean without raising the baseline.

### M4 Execution

- The headless runner adapter on the engine-adapter shape; run tokens; the
  orchestrator MCP tools; checkpoints and resume; budgets reserved and settled;
  the effect gateway with verifiers.
- The sample process runs end to end on mock connections, with approvals
  stubbed to auto-deny so the safe path is exercised first.

**Exit:** R1, R2, R5 to R7, R9, G3 and G4 pass; the sample reaches the approval
step on its own.

### M5 Governance

- Approvals, taint, tier resolution from MCP annotations, organization policy
  enforcement, memory scopes and proposals, secret-shape checks, the kill switch,
  second-activator rule.
- The outbound A2A client and the remote agent registry, built and tested but off in
  the pilot.

**Exit:** A1 to A9, P1 to P6, G1, G2, G6, G7, X7 and X9 pass; J3, J4 and J5 green as
specs.

### M6 Surfaces and observability

- The tab, in the order the views are listed in [ui.md](ui.md): routes,
  sidebar row and marker, agents list, consent card, task timeline, agent detail,
  editor with validation and version compare, activity, kill switch, palette
  entry, control registrations, `en` strings.
- The agent builder described in [ui.md](ui.md) (Configure and Preview, requests it
  handles, example requests) and `SubscribeToTask` over server-sent events.
- Rollups, metrics, logs, traces, the alert rules, the Den dashboard monitor and
  a Grafana dashboard under `infra/`.
- The local pilot stack: a headless-runner image (`packaging/docker/Dockerfile.headless-runner`)
  and a Compose overlay that brings up Den, MySQL, Den web and the runner together
  in the style of `den-dev-up.sh`, the small mock MCP servers the sample needs,
  and a short local setup and backup guide.

**Exit:** O1 to O5 pass; J1 green; the screenshot set in [ui.md](ui.md) attached
to the pull requests; `.warden/skills/design-spec-review` run locally.

### M7 Resilience, security, scale

- Nightly fault injection; the load and soak runs; the red-team fixtures; a
  Warden security review; a tabletop run of runbooks RB1 to RB10 and the incident
  procedure; ledger anchor export; A2A interoperability against an official SDK client
  and a reference agent (X1 to X10).

**Exit:** the test plan's exit criteria, all recorded.

### M8 Controlled pilot

See below.

## Controlled pilot

**Where.** One local device the team controls, using the local single-device
profile. An internal organization only, with a small group of agents and a
low-risk process.

**What.** The six sample agents, in four stages. Move to the next only when its
gate is met.

| Stage | What changes | Gate to move on |
| --- | --- | --- |
| P1 Shadow | Sender's send tool is replaced with "save to a review folder". People still reply by hand | The agents' drafts are judged usable on a reviewed sample; zero errors in the effect log; cost per process inside budget |
| P2 Internal sends | Sender sends only to internal test recipients, with approval on every send | 200 processes complete; zero duplicate sends; zero unapproved external effects; every unknown effect resolved |
| P3 Limited real use | Real requests, capped at a low daily volume, approval on every send | Two weeks with no sev1 or sev2; dead-letter rate under 5%; median approval time acceptable to the approvers; runbooks used at least once for real |
| P4 Widen | One new agent type or process at a time, each with its own journey spec and threat review | Per addition |

**Review.** Daily in P1 and P2, weekly in P3. Read the logs, the ledger, spend,
dead letters and failure classes, and the approvers' comments. Record what was
decided and why in this folder.

**Stop at once** on any unapproved external effect, any cross-organization
access, or a ledger verification failure. Engage the kill switch, follow the
incident procedure, and do not resume until the cause has a test.

**Do not expand** because the happy path works. Expansion needs the operational
controls to have held under real failures, which is why P2 and P3 count
incidents handled, not just volume.

## Rollout controls

| Control | Purpose |
| --- | --- |
| `DEN_ORCHESTRATOR_ENABLED` | Deployment-wide; off by default |
| Organization capability, as `modelsAnalytics` does (`docs/features/models-task-analytics/README.md`) | Per-organization rollout |
| Entitlement for writes | Enterprise plan, gating configuration only (D11) |
| Per-organization policy | Hop and cost caps, enabled runner targets, irreversible actions off |
| Kill switch | Organization-wide stop |

## Risks

| Risk | Mitigation |
| --- | --- |
| A fooled agent causes a harmful action that a person then approves | Read-only agents for untrusted input, taint, exact-argument cards, narrow tools (reply-in-thread, not send-anywhere), approval rate limits, the pilot's shadow stage |
| Building a general workflow engine by accident | No process designer, no graph editor, no code in configs. Agents, tasks and messages only. New capability needs a decision recorded here |
| MySQL as a queue limits throughput | Conditional-update claims, per-agent partitioning, a measured ceiling in M7, and a repository port so a dedicated queue can replace it later |
| The audit system is still a pilot | Own ledger first; mirror later (D6) |
| Spend through bring-your-own-key models is not metered | Estimated and labelled; organization caps; drift alert AL13 |
| Approval fatigue | Rate limit, exact-argument cards, no bulk approve, ageing escalation, review of approval times in the pilot |
| Confusion with Automations | See below; position the two clearly in copy and docs |
| The pilot device sleeps, restarts or loses its disk | Always-on machine; sleep disabled; nightly database and runner backups off the device; recovery after downtime is tested in M7 (RB9, R1, R3) |
| The headless runner has no high availability (one process, local SQLite) | Checkpoints live in Den; several runners; cloud runner after the pilot |
| People want local-file agents | Explicitly deferred; the desktop runner's pull model is the starting point |
| Presence across replicas is not proven (noted as deferred hardening for the desktop runner) | The orchestrator keeps presence in the database and nothing in process memory |
| Too much interface for non-technical users | Starting points, progressive disclosure, plain words, a usability check in P1 |

## Automations and the Orchestrator

An Automation is one scheduled instruction a person owns, run one occurrence at
a time with a receipt. The Orchestrator is standing agents with their own
configuration, a shared queue, delegation, approvals and budgets. They share
infrastructure (schedule calculation, lease patterns, the engine-adapter shape,
the MCP gateway) and neither replaces the other. A later step could let an
Automation hand work to the Orchestrator, or let an agent's schedule reuse the
Automations engine; that is a decision for after the pilot.

## Open questions

The brief lists seven unknowns. The plan proceeds on the working defaults. A
default that turns out wrong changes the named document.

| # | Question | Working default | What we need |
| --- | --- | --- | --- |
| 1 | Deployment environment | **Decided: the pilot runs self-hosted on one local device the team controls** ([operations.md](operations.md), "Local single-device profile"). Kubernetes (EKS, AKS, GKE) and hybrid runners stay supported for later | Which machine, and that it stays on |
| 2 | Implementation stack | The existing one: TypeScript, Hono, Drizzle on MySQL, React, TanStack Query, Zod; MySQL as the queue | Confirmation that no separate broker is wanted |
| 3 | Initial agents and process | The six in [sample-process.md](sample-process.md) | The first real, low-risk internal process |
| 4 | Availability and recovery targets | [operations.md](operations.md) section 3 | Required uptime, RPO and RTO |
| 5 | Autonomy boundary | Reads and drafts are autonomous; every external write is approved; irreversible actions are off | Which actions are irreversible for the pilot process, and who approves |
| 6 | Data classification | `public`, `internal`, `confidential`, `restricted` | The organization's scheme, and which model providers may receive which class |
| 7 | Scale | Pilot: 10 agents, 5 concurrent attempts, 1,000 tasks a day. Design: 100, 50, 100,000 | Real numbers |
| 8 | Dependencies | Reuse MySQL, the MCP gateway, the AI Gateway and OpenTelemetry. Secrets from the platform manager | Any requirement for an external key service, a SIEM or write-once export, and the paging channel |
| 9 | Decisions D6, D9, D10, D11 | As proposed in the README | Maintainer and product confirmation |
| 10 | A2A details ([a2a.md](a2a.md), "Open items") | HTTP+JSON binding, internal exposure only, no remote agents in the pilot | Binding confirmed by an interop test, the extension namespace, whether cards may be shared outside the organization, and where card signing keys live |
| 11 | Which tree the code is built in (D17) | The original layout; the Replit workspace stays a preview | Confirmation that the fork's `dev` should keep the Replit layout, or return to the original one |

## The brief's artefacts

| Expected artefact | Where it is | When it becomes code or configuration |
| --- | --- | --- |
| Agent configuration schema | [agent-config.md](agent-config.md) | M1 |
| Orchestrator architecture specification | [architecture.md](architecture.md) | n/a |
| Agent-to-agent message contract | [messaging.md](messaging.md) | M1 |
| API specification | [api.md](api.md) | M3, as `packages/docs/openapi.json` |
| Permission matrix | [governance.md](governance.md) | M5 |
| Deployment configuration | [operations.md](operations.md) section 4 | M6, as chart values |
| Monitoring and alerting configuration | [operations.md](operations.md) sections 1 and 2 | M6, as alert rules and a dashboard |
| Runbook and incident procedures | [operations.md](operations.md) sections 5 and 6 | Rehearsed in M7 |
| Sample multi-agent workflow | [sample-process.md](sample-process.md), `examples/agents/` | M4 and M6 |
| Automated test suite | [test-plan.md](test-plan.md) | Built across M1 to M7 |

## First pull requests after sign-off

1. `packages/types`: the orchestrator schemas, with no consumers yet.
2. `packages/agent-orchestrator`: configuration validation and the two state machines,
   with tests.
3. `packages/agent-orchestrator`: keys, loop guards, backoff, ledger hashing, with tests.
4. `packages/agent-orchestrator`: ports, the in-memory repository and the conformance
   suite.
5. `ee/packages/den-db`: the schema and migration.
