# Test plan

Status: proposal. Part of [the orchestrator plan](README.md). Covers brief step 11.

The ids below (L, C, R, O, A, P, G, J) are the ones the other documents cite.
Alerts are `AL1` to `AL13` and runbooks `RB1` to `RB10`, both in
[operations.md](operations.md), so the three sets never share a name. A
test is "done" when it is automated and, for anything a person could be asked to
trust, has a witness: an independent observation that the risky condition really
happened, so a pass cannot mean "nothing was exercised"
(`.opencode/skills/write-a-spec/SKILL.md`).

## Layers

| Layer | Where | Runs | What it proves |
| --- | --- | --- | --- |
| Domain unit and table tests | `packages/agent-orchestrator/src/*.test.ts` with `bun test src` | Every PR | State machines, config validation, loop guards, key derivation, ledger hashing, backoff |
| Repository conformance | `packages/agent-orchestrator/src/testing.ts`, the pattern of `packages/automations/src/testing.ts`; run against an in-memory repository and against MySQL | Every PR (memory); with `DEN_TEST_DATABASE_URL` (MySQL) | Claim, lease, fencing, idempotency, dead letter, ledger append behave identically on both |
| Service integration | `ee/apps/den-api/test/agent-orchestrator-*.test.ts` with `bun test --conditions development` against a disposable database | Every PR touching the orchestrator | Reconciler, effect gateway, approvals, budgets, routes and route access |
| Contract | `pnpm api:snapshot`, `pnpm api:lint`, route-access tests | Every PR touching the API | The published contract matches the code |
| Journey specs | `evals/specs/orchestrator-*.e2e.test.ts` | PR change proof, published as the PR's evidence | What a person sees, before and after, including who cannot |
| Fault injection | `evals/specs` worlds that kill processes, plus scripts under the orchestrator package | Nightly, and before each pilot stage | Recovery without duplicate effects |
| Load and soak | A dedicated script | Before the pilot and after any queue change | The scale assumptions in [operations.md](operations.md) |
| Security | Red-team fixtures, log scans, cross-organization probes; the Warden diff security review | Every PR; fixtures also nightly | The threat model in [governance.md](governance.md) |

Properties to assert generically, in the domain layer, over generated sequences
of events: no illegal transition; invariants I1 to I10 from
[architecture.md](architecture.md) hold after every step; terminal states never
change except the documented dead-letter requeue.

## L: lifecycle

| Id | Scenario | Expected |
| --- | --- | --- |
| L1 | Start an agent with an active version | `starting` then `active`; triggers registered; first tick or claim happens |
| L2 | Pause while an attempt runs | The attempt checkpoints and releases; no new claims; queue intact; `paused` |
| L3 | Resume a paused agent | Claims resume; the released task continues from its checkpoint |
| L4 | Restart an active agent | Old attempts are fenced out (`restartGeneration`); queued tasks survive; runs the active version |
| L5 | Stop an agent with queued and running work | Running work cancelled after the drain window; owned tasks return to `queued` without spending an attempt |
| L6 | Retire with open tasks | Refused without `reassignTo`; with it, tasks move and the agent is read-only |
| L7 | Illegal command (pause a stopped agent) | `409 invalid_state` listing the allowed states |
| L8 | Owner removed from the organization | Agent quarantined as "Owner needs access", not deleted |

## C: configuration

| Id | Scenario | Expected |
| --- | --- | --- |
| C1 | Invalid configs: unknown field, shrinking cost limits, event agent without triggers, untrusted agent with a send tool | Rejected with the stable code; the 15 negative cases prototyped in this plan become fixtures |
| C2 | Defaults | A saved version stores the normalised config; normalising twice changes nothing; changing a default later changes no stored version |
| C3 | Version history | Every save and activation writes a version row and a ledger entry with before and after digests and changed paths |
| C4 | Rollback | Activating an older version re-validates and works; old content is unchanged |
| C5 | Activate while attempts run | In-flight attempts finish on their version; the next claim uses the new one; the timeline shows both |
| C6 | Stale `baseVersion` | `409 version_conflict`; nothing overwritten |
| C7 | Second activator required | The last editor cannot activate an external-write agent |
| C8 | The six sample configs | All validate; each referenced delegate exists; exactly one holds an external-write tool |

## R: resilience

| Id | Scenario | How it is injected | Expected | Witness |
| --- | --- | --- | --- | --- |
| R1 | Worker killed mid-attempt | Kill the runner process | Lease expires, attempt `lost`, task retried, finishes once | Attempt rows: one `lost`, one `succeeded`; no duplicate children |
| R2 | Worker killed after the effect started | Kill after the mock mail records the send, before the result is stored | One message in the mock; the effect settles by verifier; no second send | The mock's message count is 1 |
| R3 | Reconciler replica killed mid-claim | Kill one of two replicas under load | No task lost or doubled; the other replica continues | Task count in equals tasks terminal; no double leases |
| R4 | Database connection drops | Sever the connection during enqueue | Caller gets `503`; either the task exists once or not at all | Idempotent retry yields exactly one task |
| R5 | Model failures | Provider returns 500, then 429, then malformed output | Retry with backoff, fallback model, then `malformed_output` after one repair | Attempt errors by class; fallback model recorded |
| R6 | Tool unavailable; credential expired | Mock returns 503; mock returns auth failure | 503 retries by policy; auth failure stops retries and raises a reconnect item | No retries after the auth failure |
| R7 | Malformed messages | Agent sends bad bodies; webhook sends garbage | Agent gets structured errors (two corrections, then fail); webhook gets `400` and a quarantine row | No malformed message is ever delivered |
| R8 | Poison task | A task that crashes the worker every time | Dead-lettered after `maxAttempts` lost attempts | Attempt count equals the limit |
| R9 | Concurrency and backlog | Continuous, schedule and event agents together; a large backlog after an outage | No interference between agents; claim rate capped; per-agent concurrency never exceeded | Max concurrent attempts per agent over time |
| R10 | Duplicate delivery | Send the same webhook delivery id twice; replay a delegation | One task; one child | Row counts |
| R11 | Restart after restore | Restore an older backup mid-process | Leases expired; `executing` effects become unknown; none retried automatically | No send after restore without a person or a verifier |
| R12 | Clock skew | Skew one replica's clock by two minutes | Leases unaffected, because they compare the database clock | Lease expiry times from the database |

## O: observability

| Id | Scenario | Expected |
| --- | --- | --- |
| O1 | An agent stops heartbeating | Health goes to "Not responding" within 3 leases; A1 fires |
| O2 | A day of mixed outcomes | Rollups equal the sums of task, attempt and usage rows; the overview matches |
| O3 | Each alert in the catalogue | AL1 to AL13 each fire from a staged condition and carry the right severity and action |
| O4 | Logs | No instruction, payload, argument, body or token appears in any log line from a full process (scan of captured logs) |
| O5 | Trace | One process is one trace across all agents, including the approval wait |

## A: approvals

| Id | Scenario | Expected |
| --- | --- | --- |
| A1 | Approve | The effect runs exactly once, after approval, with the approved arguments |
| A2 | Decline | Task fails `approval_rejected`; no effect; the agent is not asked to retry |
| A3 | Expire | Task `expired`; `approval_waiting` escalation ran; late approval refused `approval_expired` |
| A4 | Wrong approver | A member not named, or without `orchestrator.approve`, gets `403` and a ledger entry |
| A5 | Self-approval | Refused unless `allowSelfApproval`; a one-person setup works only when enabled and the setting is on the ledger |
| A6 | Arguments change | The old approval is withdrawn; a new one is required; the old digest cannot authorize the new call |
| A7 | Replay | A consumed approval cannot authorize a second execution |
| A8 | Taint | A tainted task needs approval for an external write even with `requireFrom` lowered |
| A9 | Two approvers | `irreversible` needs two distinct members |

## P: permission boundaries

Generated from the matrix in [governance.md](governance.md): for every
permission and role cell, one test asserts the allowed side and one the denied
side. Plus:

| Id | Scenario | Expected |
| --- | --- | --- |
| P1 | An agent calls a tool not on its allow list | Denied and ledgered; the tool is not reachable |
| P2 | An agent calls a tool its owner cannot use | Denied (authority intersection) |
| P3 | An agent sends a system-only message type | `403 message_type_forbidden` |
| P4 | A member of another organization reads or acts | `404`; no data; run-token claims for another organization rejected |
| P5 | An agent drives the UI control surface | No command exists to approve or decline |
| P6 | A downgraded organization | Writes return `402`; reads, pause, stop, retire still work |

## G: governance and controls

| Id | Scenario | Expected |
| --- | --- | --- |
| G1 | Hop cap | Delegation past the cap refused `hop_limit` |
| G2 | Visit cap and ping-pong | The fourth drafter visit refused; identical A to B payload twice stopped |
| G3 | Fan-out and process caps | `fanout_limit` and `process_task_limit` |
| G4 | Budget | Reservation fails past the limit; agent quarantined `budget_exhausted`; reset at the next UTC period |
| G5 | Ledger | Every governed change has exactly one entry; the chain verifies; editing or deleting an entry breaks verification (prototyped); the append-only boundary test rejects any other writer |
| G6 | Kill switch | No claims after engage; live attempts cancelled within 20 seconds; Resume all restores exactly the agents it paused |
| G7 | Secrets | Configs and memory reject secret-shaped strings; no credential in model context, messages or logs |

## Journey specs

Written in the shape `write-a-spec` asks for: a persona in the title, steps that
read `given`, `when`, `then`, `after:`, one evidence line each, a witness for the
risky condition, and the negative persona. Use `seed.appWeb`, mock connections
only, and bounded waits.

### J1 An owner activates a team of agents and a request becomes a sent reply

1. given a signed-in owner and a mock inbox with one request
2. when the owner creates the six sample agents and activates them
3. then the Orchestrator shows six rows, three of them working
4. after: the process reaches "Waiting for approval", and the owner sees the card naming the action, the data and the risk
5. when the owner approves
6. after: the reply is sent once and the process shows "Finished in …"
7. negative: a member without approval rights opens the same task, sees it, and has no way to approve

### J2 A worker dies mid-send and the reply still goes out once

1. given an approved reply and a mock mail that records messages
2. when the runner is killed after the send starts
3. then the witness shows the message was recorded
4. after: the task finishes and the mock holds exactly one message
5. negative: no second approval was created and the first stayed consumed

### J3 Only the right people can approve

1. given an agent whose approvers are the owner and one admin
2. when a member outside that list opens the card, then when the admin approves
3. after: the member's attempt is refused and recorded; the admin's succeeds
4. negative: the person who last activated the version cannot approve their own agent's send when self-approval is off

### J4 A revision loop is stopped and handed to a person

1. given a reviewer set to reject every draft
2. when the process runs
3. then the drafter is visited three times and the fourth is refused (witness: the refusal code)
4. after: "Needs you" shows the reviewer's question and no more tasks are created

### J5 An operator pauses, and then pauses everything

1. given two agents with queued work
2. when the operator pauses one, then engages the kill switch
3. after: the paused agent claims nothing; after the switch, nothing runs anywhere within 20 seconds
4. when the operator resumes all
5. after: only the agent that was running before comes back; the individually paused one stays paused

## Load and soak

- **Load.** 100 agents, 50 concurrent attempts, 100,000 tasks a day for 24
  hours of compressed time against MySQL, with a mock runner. Report claim
  latency, queue wait p95, reaper cost, rollup cost, and the database's load.
- **Soak.** 72 hours at pilot scale with scheduled worker kills every 15
  minutes; assert no leaked leases, no drift in the concurrency counters, and
  stable memory in the reconciler.
- **Reference points.** The headless runner's own limits (a turn timeout, a step
  cap, a global concurrency limit) are inputs, not things to bypass.

## Security checks

- **Red-team fixtures.** Hostile text in the inbox and in knowledge-base results:
  instructions to send elsewhere, to reveal tokens, to rewrite memory, to
  delegate to a privileged agent. For each, assert the specific control that
  stopped it (tool absence, taint approval, proposal-only memory, delegation
  allow list). A pass that cannot name the control is a failure.
- **Cross-organization probes** on every route and every MCP tool.
- **Warden.** The `diff-security-review` and `confidentiality-review` skills run
  on every PR in this programme.

## Exit criteria for this plan's testing

All of L, C, R, A, P and G automated and green; J1 to J5 green and published as
PR evidence; O3 and O4 green; the load test run once with its results recorded.
Nothing proceeds to the pilot with a red or skipped item in this list.
