# Orchestrator API

Status: proposal. Part of [the orchestrator plan](README.md). Covers the
interface half of brief step 10.

The API follows `docs/api-style.md`. In particular: flat kebab-case resource
segments under `/v1` (the organization comes from the session, as it does for
`/v1/automations`), camelCase properties, TypeID identifiers, lifecycle fields
named `state`, timestamps ending in `At` as RFC 3339 strings, cursor pagination,
`PATCH` for partial updates, `POST /{resource}/{verb}` for actions, and stable
snake_case error codes. Every route carries a `describeRoute()` with `summary`,
`tags`, `security` and `responses`.

## Conventions

- **Tags.** `Orchestrator` for the product API, `Orchestrator runners`
  (marked `Internal`, so removed from the published snapshot) for the runner
  protocol, and `A2A` for the protocol adapter below. Register all three in `src/app.ts`.
- **Access.** Reads use `orgMemberRoute()` plus the permission in the tables
  below. Writes check the permission in handler code and write a ledger entry in
  the same transaction. Webhook intake is a `signedWebhookRoute`. The runner
  protocol is a `tokenRoute` with a new `orchestratorRunnerToken` scheme.
- **Pagination.** `?cursor=&limit=`, `limit` at most 100, response
  `{ "items": [...], "nextCursor": "..." | null }`.
- **Idempotency.** Mutating requests that create work take an `idempotencyKey` in
  the body (the style guide lists header-based keys as a future follow-up). The
  same key with a different body returns `409 idempotency_conflict`.
- **Optimistic concurrency.** Version saves take `baseVersion`. Lifecycle
  commands take an optional `expectedState`, so a double click cannot act on a
  state the user did not see.
- **Plan gating.** Writes that configure (create, save, validate, activate, edit
  policy) return `402 enterprise_plan_required` without the entitlement. Reads,
  pause, stop, retire, cancel and every delete are never gated.

## Agents

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-agents` | List agents with state, health, queue depth, spend today | `view` |
| `POST /v1/orchestrator-agents` | Create an agent with its first draft | `configure` |
| `GET /v1/orchestrator-agents/{agentId}` | One agent: state, health, active version, counters | `view` |
| `PATCH /v1/orchestrator-agents/{agentId}` | Change owner or labels | `configure` |
| `POST /v1/orchestrator-agents/{agentId}/start` | `start` | `operate` |
| `POST /v1/orchestrator-agents/{agentId}/pause` | `pause` | `operate` |
| `POST /v1/orchestrator-agents/{agentId}/resume` | `resume`; from `quarantined` needs `acknowledgement` | `operate` |
| `POST /v1/orchestrator-agents/{agentId}/restart` | `restart` | `operate` |
| `POST /v1/orchestrator-agents/{agentId}/stop` | `stop` | `operate` |
| `POST /v1/orchestrator-agents/{agentId}/retire` | `retire`; needs `reassignTo` if tasks are open | `admin` |
| `GET /v1/orchestrator-agents/{agentId}/metrics` | Rollups for a window | `view` |
| `GET /v1/orchestrator-agents/{agentId}/card` | The Agent Card generated from the active version, or from a given `agentVersionId`, for the editor's preview | `view` |

Lifecycle commands return `202` with the agent, whose `state` is the transitional
one (`starting`, `pausing`, `stopping`). They return `409 invalid_state` with the
states they could have run from.

```json
{
  "id": "agt_01j9z8q2k4m7",
  "slug": "sender",
  "displayName": "Sender",
  "state": "active",
  "desiredState": "running",
  "health": "healthy",
  "activeVersion": {"id": "agv_01j9z8q2k4mq", "version": 3},
  "ownerMemberId": "mem_01j9z8q2k4m8",
  "queueDepth": 2,
  "runningAttempts": 1,
  "spend": {"todayMicroUsd": 18200, "dayLimitMicroUsd": 1000000},
  "lastHeartbeatAt": "2026-10-01T08:00:12.000Z",
  "updatedAt": "2026-10-01T08:00:12.000Z"
}
```

## Versions

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-agents/{agentId}/versions` | History, newest first | `view` |
| `POST /v1/orchestrator-agents/{agentId}/versions` | Save a draft: `{ baseVersion, changeNote, config }` | `configure` |
| `GET /v1/orchestrator-agents/{agentId}/versions/{agentVersionId}` | One version, config included | `view_content` |
| `GET /v1/orchestrator-agents/{agentId}/versions/{agentVersionId}/diff?against={agentVersionId}` | Changed paths and values | `view_content` |
| `POST /v1/orchestrator-agents/{agentId}/versions/{agentVersionId}/validate` | Run V1 to V3, V4 with `simulate: true`; returns the report | `configure` |
| `POST /v1/orchestrator-agents/{agentId}/versions/{agentVersionId}/activate` | Activate or roll back | `activate` |

`validate` returns `{ "ok": false, "issues": [{ "code", "level", "severity", "path", "message" }] }`
with the codes in [agent-config.md](agent-config.md). Saving an invalid config
returns `422 validation_failed` with the V1 issues; the draft is kept only if it
parses.

## Tasks

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-tasks` | Filter by `state`, `agentId`, `rootTaskId`, `type`, `createdAfter`, `originSessionId`; `state=dead_lettered` is the dead-letter view | `view` |
| `POST /v1/orchestrator-tasks` | Submit a root task. Optional `origin` (an `originSchema` label). The server sets the kind from the route, so a caller on the gateway cannot claim `member_ui` | `submit` |
| `GET /v1/orchestrator-tasks/{taskId}` | Task with its process summary | `view` |
| `GET /v1/orchestrator-tasks/{taskId}/messages` | Thread, in `seq` order | `view_content` for bodies |
| `GET /v1/orchestrator-tasks/{taskId}/attempts` | Attempts with version, runner, usage, error | `view` |
| `GET /v1/orchestrator-tasks/{taskId}/timeline` | Messages, attempts, effects and approvals merged | `view` |
| `POST /v1/orchestrator-tasks/{taskId}/cancel` | Cancel; cascades to descendants | `operate` |
| `POST /v1/orchestrator-tasks/{taskId}/requeue` | From `dead_lettered`, `failed` or `expired`; creates and returns a new task that supersedes it (optionally with an edited `payload`). The old task is never reopened | `operate` |
| `POST /v1/orchestrator-tasks/{taskId}/reassign` | Move a queued or dead-lettered task to another agent | `operate` |
| `POST /v1/orchestrator-tasks/{taskId}/discard` | Close a dead letter with a reason | `operate` |
| `PATCH /v1/orchestrator-tasks/{taskId}` | Change `priority` or `deadlineAt` of a non-terminal task | `operate` |
| `POST /v1/orchestrator-tasks/{taskId}/answer` | Answer a clarification | the asked member or `operate` |

```json
{
  "idempotencyKey": "form:2026-10-01:r1",
  "type": "research.requested",
  "target": {"kind": "agent", "agentId": "agt_01j9z8q2k4m7"},
  "payload": {"requestId": "r1"},
  "priority": 5,
  "deadlineAt": "2026-10-02T08:00:00.000Z",
  "classification": "internal"
}
```

`201` returns `{ "task": {...}, "created": true }`. A repeated key returns `200`
with `"created": false` and the original task. A full queue returns
`429 queue_full`.

## Approvals

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-approvals` | Pending first, oldest first; filter by `state`, `agentId` | `view` for the list, content needs `approve` or `view_content` |
| `GET /v1/orchestrator-approvals/{approvalId}` | The card: `approvalRequestSchema` plus state and decisions | as above |
| `POST /v1/orchestrator-approvals/{approvalId}/approve` | Body `{ argsDigest, comment? }`; the digest must match the card | `approve`, and named as an approver |
| `POST /v1/orchestrator-approvals/{approvalId}/decline` | Body `{ comment? }` | `approve`, and named as an approver |

Approval decisions are not exposed through MCP or to any agent-mediated client.
They require a signed-in person (`userSessionRoute()`), because the point is that
a person saw the exact action.

## Hierarchy

Who reports to whom, and the five reports. The rules and the shapes of the responses are in
[hierarchy.md](hierarchy.md); every report is computed when read, so a response is always
consistent with the relationships at that moment.

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-hierarchy` | The tree: each agent with its manager, span, level and the control and dependency degrees on its edge. Add `?format=register` for the flat agent register | `view` |
| `GET /v1/orchestrator-reporting-relationships` | List relationships. Filter by `managerAgentId`, `reportingAgentId`, `state` | `view` |
| `POST /v1/orchestrator-reporting-relationships` | Add: `{ managerAgentId, reportingAgentId, controlDegree, dependencyDegree, escalation }`. `relationshipType` is always `direct` | `activate` |
| `PATCH /v1/orchestrator-reporting-relationships/{relationshipId}` | Change degrees or escalation; needs the current `revision` | `activate` |
| `POST /v1/orchestrator-reporting-relationships/{relationshipId}/end` | End it (kept in history, never deleted). The agent has no manager until another is set | `activate` |
| `POST /v1/orchestrator-reporting-relationships/reassign` | Move an agent to a different manager in one step: `{ reportingAgentId, newManagerAgentId, controlDegree?, dependencyDegree? }`. The old relationship ends and the new one starts together, or nothing changes | `activate` |
| `POST /v1/orchestrator-reporting-relationships/validate` | Check a proposed change without saving it; returns every refusal and every warning, including what the span would become | `view` |
| `GET /v1/orchestrator-agents/{agentId}/reports` | The agent's direct reports with control and dependency, plus the span (the "manager to controlled agents" view). `?include=indirect` adds the rest of the subtree | `view` |
| `GET /v1/orchestrator-agents/{agentId}/manager` | The agent's manager, dependency degree, escalation rule and the whole chain to the root (the "agent to its manager" view) | `view` |
| `GET /v1/orchestrator-reports/span-of-control` | Span report: every manager, its reports, span, limit, and queued and running work | `view` |
| `GET /v1/orchestrator-reports/dependency` | Dependency report: every agent, its manager, the degrees and its escalation path | `view` |
| `GET /v1/orchestrator-reports/hierarchy-exceptions` | Exceptions: no manager, over the limit, dependent on an unavailable manager, large gaps | `view` |
| `GET /v1/orchestrator-reports/relationship-matrix` | Managers by reporting agents, each cell control / dependency | `view` |

Notes:

- A change takes effect for new routing at once. Work already in flight keeps the route it was
  given; escalations raised after the change follow the new chain.
- A refused change returns `422` with every reason (`issues[]`), not only the first, and
  writes nothing. The codes are in [hierarchy.md](hierarchy.md), "What is refused and what is
  flagged". A change that is allowed but flagged returns `200` with `warnings[]`.
- Each write is a ledger entry (`hierarchy.*`) with the before and after values, in the same
  transaction as the change. Concurrent edits are serialised per organization, so two people
  cannot each add a "first" manager for the same agent; the second gets `version_conflict`.
- The two policy settings are edited with the rest of the policy, `PATCH /v1/orchestrator-policy`.
- The reports are also on the live stream: a hierarchy change sends
  `{ "type": "hierarchy" }` and the client refetches.

## Memory

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-memory` | Filter by `scope`, `namespace`, `state=proposed`, `tag`, `q` | `memory` |
| `POST /v1/orchestrator-memory` | Write an organization entry directly | `memory` |
| `POST /v1/orchestrator-memory/{memoryId}/commit` | Commit a proposal | `memory` |
| `DELETE /v1/orchestrator-memory/{memoryId}` | Delete; leaves a tombstone | `memory` |
| `POST /v1/orchestrator-memory/erase` | Erase by `subjectRef` across scopes | `admin` |

## Ledger

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-ledger` | Entries by `action`, `subjectId`, `actor`, time range | `audit` |
| `POST /v1/orchestrator-ledger/verify` | Recompute the chain over a range | `audit_export` |
| `POST /v1/orchestrator-ledger/export` | Signed export (newline-delimited JSON with the head hash) | `audit_export` |

## Policy, kill switch, event sources

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-policy` | Organization policy with its `revision` | `view` |
| `PATCH /v1/orchestrator-policy` | Edit; needs the current `revision` | `admin` |
| `POST /v1/orchestrator-policy/pause-all` | Kill switch on, with `reason` | `admin` |
| `POST /v1/orchestrator-policy/resume-all` | Restores exactly the agents the switch paused | `admin` |
| `GET /v1/orchestrator-event-sources` | Sources and recent delivery counts | `admin` |
| `POST /v1/orchestrator-event-sources` | Create; the signing secret is returned once | `admin` |
| `PATCH /v1/orchestrator-event-sources/{eventSourceId}` | Rename, enable, disable | `admin` |
| `POST /v1/orchestrator-event-sources/{eventSourceId}/rotate-secret` | New secret; the old one stays valid for 24 hours | `admin` |
| `POST /v1/orchestrator-event-sources/{eventSourceId}/events` | Intake. Signed with HMAC; replay window 5 minutes; the delivery id is the idempotency key | signature |

## Overview and live updates

| Method and path | Purpose |
| --- | --- |
| `GET /v1/orchestrator-overview` | Counts for the landing view: agents by state and health, queue by state, pending approvals, items needing attention, spend today |
| `GET /v1/orchestrator-attention` | The "Needs you" list: approvals, questions, dead letters, quarantined agents |
| `GET /v1/orchestrator-stream` | Server-Sent Events |

The stream follows the Automations runner pattern in
`docs/features/automations-desktop-runner/README.md`: it carries only a wake-up
and a resumable cursor, never data. A client that receives
`{ "type": "agents" | "tasks" | "approvals" | "attention" | "hierarchy", "cursor": "…" }`
refetches the affected query. Keepalive every 15 seconds. A client that cannot
hold the stream polls with backoff from 1 to 15 seconds. The app shows the time
of the last successful read, so a stale view says so.

## Remote agents

Other organizations' or vendors' A2A agents an administrator allows our agents to call.
Details and controls are in [governance.md](governance.md); not used in the pilot.

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /v1/orchestrator-remote-agents` | List, with pinned card version and state | `admin` |
| `POST /v1/orchestrator-remote-agents` | Register from a card URL; the card is fetched, verified and pinned | `admin` |
| `PATCH /v1/orchestrator-remote-agents/{remoteAgentId}` | Allowed skills, data class cap, enable or disable | `admin` |
| `POST /v1/orchestrator-remote-agents/{remoteAgentId}/refresh-card` | Fetch again; a changed card needs re-approval before use | `admin` |
| `DELETE /v1/orchestrator-remote-agents/{remoteAgentId}` | Remove | `admin` |

## The A2A endpoint

A protocol adapter, as `docs/api-style.md` allows: it follows the A2A specification
rather than the resource style above, lives under its own prefix, is tagged `A2A`,
and is exempt from the resource-style lint rules in the way SCIM and OAuth are. Full
design in [a2a.md](a2a.md).

| A2A operation | Route (from the specification, under `/a2a`) | Needs |
| --- | --- | --- |
| Agent Card | `GET /a2a/{tenant}/.well-known/agent-card.json` (location to confirm, see a2a.md) | Authentication for anything beyond `internal` |
| `SendMessage` | `POST /a2a/{tenant}/message:send` | `submit`, plus the skill's permission |
| `GetTask` | `GET /a2a/{tenant}/tasks/{id}` | `view` of that task |
| `ListTasks` | `GET /a2a/{tenant}/tasks` | `view` |
| `CancelTask` | `POST /a2a/{tenant}/tasks/{id}:cancel` | `operate` or the task's creator |
| `SubscribeToTask` | `GET /a2a/{tenant}/tasks/{id}:subscribe` (server-sent events, M6) | `view` of that task |

`tenant` is the agent's slug. Every request is authenticated and every task lookup is
scoped to the caller's organization; a task the caller may not see is "not found".
Requests carry `A2A-Version`; any major other than `1` is refused. A2A errors use the
specification's error shapes, not the Den error envelope.

## Runner protocol (pull-mode runners, after the pilot)

For the pilot, Den calls the headless runner and observes it, so no runner-side
protocol is needed. Runners inside a customer network pull work instead, which
is the shape of the Automations desktop runner. All routes are tagged `Internal`
and authenticated with a runner token.

| Method and path | Purpose |
| --- | --- |
| `POST /v1/orchestrator-runners` | Register: kind, version, capacity |
| `POST /v1/orchestrator-runners/{runnerId}/claims` | Claim up to `n` attempts |
| `POST /v1/orchestrator-runners/{runnerId}/attempts/{attemptId}/heartbeat` | Extend the lease; carries step and usage |
| `POST /v1/orchestrator-runners/{runnerId}/attempts/{attemptId}/checkpoint` | Store a checkpoint |
| `POST /v1/orchestrator-runners/{runnerId}/attempts/{attemptId}/events` | Append ordered events with their keys |
| `POST /v1/orchestrator-runners/{runnerId}/attempts/{attemptId}/release` | Graceful release with a reason |

All of them are fenced by `attemptId` and `restartGeneration`; a stale attempt
gets `409 attempt_superseded`.

## MCP surfaces

**Run-scoped tools** (authorized by an attempt's run token) are listed in
[messaging.md](messaging.md).

**Organization capabilities** on `/mcp/agent`, so the chat in any workspace, Codex, Claude Code and
other clients can hand work to the orchestrator. They follow the remote-session pattern
(`ee/apps/den-api/src/mcp/remote-session-capabilities.ts`): a capability source behind an
`orchestrator` scope, found with `search_capabilities` and run with `execute_capability`, not
new top-level tools. They run as the caller, and the caller is recorded on the task and in the
ledger.

| Capability | Does | Permission |
| --- | --- | --- |
| `orchestrator:list_agents` | Running agents, the requests each handles, state | `view` |
| `orchestrator:submit_task` | Same as `POST /v1/orchestrator-tasks`, with `idempotencyKey` and an optional `origin` label | `submit` |
| `orchestrator:get_task` | Task state, result and timeline summary | `view`, or the caller's own submissions |

The `Orchestrator` API tag is deliberately **not** added to the MCP allow list in
`ee/apps/den-api/src/mcp/policy.ts`. The catalogue is generated from the OpenAPI document and
filtered by tag, so exposing the tag would expose approvals, configuration, the hierarchy and
the kill switch. Approving, declining, answering and editing have no capability; a call for
them returns `unknown_capability`. See [workspaces-and-chat.md](workspaces-and-chat.md).

## Errors

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | Body or query failed validation (`details[]`) |
| 401 | `unauthorized` | No valid credential |
| 402 | `enterprise_plan_required` | A gated write without the entitlement |
| 403 | `forbidden` | Missing permission |
| 403 | `orchestrator_disabled` | The rollout flag is off for this deployment or organization |
| 403 | `message_type_forbidden` | An agent tried to send a system-only message type |
| 404 | `organization_not_found`, `not_found` | Missing organization or resource |
| 409 | `version_conflict` | Stale `baseVersion` or policy `revision` |
| 409 | `invalid_state` | Command not allowed from the current state |
| 409 | `idempotency_conflict` | Same key, different body |
| 409 | `approval_expired`, `approval_already_decided` | Late or repeated decision |
| 409 | `paused_by_killswitch` | New work while the kill switch is on |
| 409 | `attempt_superseded` | A stale runner attempt |
| 422 | `validation_failed` | Config failed validation (`issues[]`) |
| 429 | `queue_full`, `rate_limited` | Depth or rate cap reached |
| 503 | `unavailable` | The database could not commit; nothing was acknowledged |

Hierarchy refusals use the codes in [hierarchy.md](hierarchy.md) (`self_report`, `cycle`,
`duplicate_relationship`, `second_manager`, `root_cannot_report`, `unknown_agent`,
`retired_agent`, `has_active_reports`, `span_over_limit` in `block` mode) inside a
`422 validation_failed` response.

Delegation refusals reuse the guard names as codes: `hop_limit`, `visit_limit`,
`fanout_limit`, `process_task_limit`, `invalid_payload`, `target_not_accepting`.

## Publishing the contract

1. Write the Zod schemas in `packages/types/src/orchestrator.ts` with
   `.meta({ ref })` names.
2. Describe every route.
3. Run `pnpm api:snapshot` and commit `packages/docs/openapi.json`.
4. Run `pnpm api:lint`; do not raise `.spectral-baseline.json`.
5. Add route-access tests alongside `test/route-access-policy.test.ts`.
