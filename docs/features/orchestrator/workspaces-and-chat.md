# Linking the Orchestrator to workspaces and chats

Status: proposal. Part of [the orchestrator plan](README.md). It answers one question: how
does the Orchestrator connect to workspaces and to the new-session interface, so that the
chat a person is already in can hand work to agents and pick it up again?

## The short answer

There are three links, not one. The Orchestrator stays organization-wide (D12), so it is not
nested under a workspace the way a chat is. A workspace or a chat is something a task
**points at**. It never contains the task.

| Link | Direction | What the person sees | How it works | When |
| --- | --- | --- | --- | --- |
| L1 | Chat to Orchestrator | In any chat: "ask the Research agent to look into this". A card shows the task and its state | The chat's agent calls `orchestrator:*` capabilities on the gateway that every workspace already has | M6, in the pilot |
| L2 | Orchestrator to chat | On a task: **Discuss in chat**. The new-task composer opens with a summary filled in | The existing composer, destination menu and draft store. Nothing is sent until the person sends it | M6, in the pilot |
| L3 | Agent to workspace | An agent works in a cloud workspace, later a desktop one, and its run is a real, visible session | The remote-session pattern. The configuration field is reserved, not in v1 | After the pilot |

## What already exists

Nothing here is new infrastructure. The plan reuses these.

| Piece | Where | What it gives us |
| --- | --- | --- |
| The gateway on every workspace | `apps/app/src/react-app/domains/connections/cloud-mcp-reconciler.ts` attaches `/mcp/agent` to each workspace engine | A chat in any workspace can already call organization capabilities, with no desktop release |
| Remote sessions | `ee/apps/den-api/src/mcp/remote-session-capabilities.ts`, and `docs/remote-chat-over-mcp-architecture.md` | A working model for a capability source with a scope, and for sessions on a cloud worker or a connected desktop |
| Automation threads | `apps/app/src/react-app/domains/automations/automation-cloud-thread.ts` | A run keeps the workspace and the native session it used, and the page offers "Open local thread" only on the machine that has it |
| Session routes | `workspaceSessionRoute` in `apps/app/src/react-app/shell/workspace-routes.ts` | A link to a chat in a workspace |
| New-task composer | `apps/app/src/react-app/domains/session/chat/new-task-composer.tsx` and `new-task-destination-menu.tsx` | Choosing the workspace a new chat starts in |
| Drafts | `apps/app/src/react-app/domains/session/sync/draft-store.ts` | A prefilled message that waits for the person |
| Result cards | `ee/apps/den-api/src/mcp/connection-action-app.ts` and `packages/mcp-apps` | A card inside the chat, with a link out |
| MCP exposure policy | `ee/apps/den-api/src/mcp/policy.ts` | Which API tags become tools. Tags not on the list are not exposed |

## L1: chat to Orchestrator

This is how the current chat uses the Orchestrator.

1. The person is in a chat, in any workspace, on desktop or web.
2. They ask for something an agent does, for example "have the Research agent check this".
3. The chat's agent finds the capability with `search_capabilities` and calls
   `orchestrator:submit_task` through `execute_capability`. The gateway tool list does not
   change; the same rule the remote-session capabilities follow.
4. The gateway takes the member from the verified token, never from an argument, checks
   `orchestrator.submit`, creates one root task and returns its id with a card.
5. The chat reads progress with `orchestrator:get_task`. It polls, as remote sessions do.

| Capability | Does | Needs |
| --- | --- | --- |
| `orchestrator:list_agents` | The running agents that are visible to members: name, slug, the requests each handles, state | `orchestrator.view` |
| `orchestrator:submit_task` | Creates a root task for an agent or a request type. Takes an `idempotencyKey` and an optional `origin` label | `orchestrator.submit` |
| `orchestrator:get_task` | State, result, and a short timeline. Own submissions, or any task with `orchestrator.view`. An open question comes back with its options and a digest | `orchestrator.view` |
| `orchestrator:answer` | Relays the person's answer to a question the Orchestrator put to them | The member the question was put to |

Rules:

- **A scope, not a new tool.** The capabilities sit behind an `orchestrator` scope, read and
  write, included in first-party desktop tokens and off by default for public OAuth clients.
  An organization can turn it off with the existing exposure policy.
- **Not the whole API.** The `Orchestrator` API tag is not on the allow list in `policy.ts`,
  and it stays off. Exposing every route would hand a chat approvals, configuration, the
  hierarchy and the kill switch. Only the three capabilities above are exposed
  ([api.md](api.md)).
- **What a chat cannot do.** Approve, decline, edit an agent or change the hierarchy. Those
  do not exist as capabilities, so asking for them returns `unknown_capability`. If a task
  waits for an approval, the chat tells the person, and the card opens the consent card in the
  Orchestrator ([ui.md](ui.md)). This is the same rule as the interface's agent-readable
  control: no command to approve.
- **MCP can enqueue, never run.** The gateway creates work. It never gets runner credentials
  or touches a running attempt, matching the rule for the desktop runner token.
- **A task from a chat is untrusted input.** A chat may have read a web page, so the root
  task starts tainted (`originTaintsTask`, [messaging.md](messaging.md)). It cannot reach an
  external write without a person's approval, and it cannot reach an irreversible one
  ([governance.md](governance.md), "Taint").
- **The origin is a label.** The task stores the surface, the workspace id and the chat id
  so the Orchestrator can say "Started from a chat" and offer a way back. It is never used
  for authorization and never holds what was said. The schema (`originSchema`) rejects any
  extra field, so content cannot ride along.
- **Classification.** A task from a chat takes the organization's default class
  (`internal` unless changed). The caller can raise it and cannot lower it.
- **No loops.** The Orchestrator never sends a prompt into a chat. It produces cards and
  notifications only, so chat to Orchestrator to chat cannot cycle. Submissions are limited
  per member (default 30 an hour) and count toward `maxOpenProcesses`.
- **Retries.** If the caller sends no `idempotencyKey`, one is derived from the member, the
  chat, and a digest of the payload within a five-minute window, so a retried tool call
  does not start a second process.

### Which agents a chat can see

Only agents the owner made visible to members. This uses the agent's `a2a.exposure`
([agent-config.md](agent-config.md)):

| `exposure` | Listed and usable from a chat or MCP client | Served over A2A |
| --- | --- | --- |
| `internal` (the default) | No. Reached by other agents and from the Orchestrator itself | No |
| `members` | Yes | No |
| `organization` | Yes | Yes, to authenticated organization principals |

Submitting to an agent that is not visible returns `not_found`, so the answer does not
reveal that it exists. An agent made visible needs a description and at least one skill
(the validator enforces it), because those are what the chat shows. In the samples, the
Research agent is `members`, so a chat can hand it a question.

### Relaying an answer

When an agent asks the person a question, the question appears in "Needs you" as before. If
the person is in a chat, the chat can pass their answer on. This is allowed, and an
organization can switch it off with the policy `chatAnswers`. The risk is a chat answering
for the person without asking, so the capability is narrow:

1. The chat reads the task with `orchestrator:get_task`. The open question comes back with
   its `requestMessageId`, its options and a `questionDigest`.
2. The chat asks the person, and calls `orchestrator:answer` with the digest and the answer.
3. The service accepts it only if every check passes (`checkRelayedAnswer`, which has
   its own checks):
   - the caller is the member the question was put to, and nobody else, not an
     administrator and not a manager agent. Others answer in the tab;
   - the question is for a person, not for a delegator or a manager, and it is still open;
   - the digest matches the exact question and options, so a chat that never read the
     question cannot answer it;
   - if the question offered options, the answer is one of them.
4. The answer is recorded with `answeredVia: "chat"` (or `mcp_client`). The task is tainted
   from then on, like any text that came out of a chat. The timeline shows "Answered from a
   chat" with the words, and the ledger has `task.answered_via_chat`.

An approval is a different object and a different path. It cannot be relayed, whatever the
chat says.

The card is a standard MCP Apps card (the `connection-action-app.ts` pattern): task title, state,
last activity, and **Open in Orchestrator**, which goes to `/orchestrator/tasks/{taskId}`.
Clients without MCP Apps get the same link as text, so Codex, Claude Code and Cursor work
the same way as the in-app chat.

When a task reaches a point that needs a person, it shows in "Needs you" and the sidebar
attention marker, in whichever workspace the person is. The chat is not interrupted.

## L2: Orchestrator to chat

"Discuss in chat" is on the task page, on a "Needs you" row and on the agent page.

- It opens the new-task composer. The workspace comes from the existing destination menu.
  The default is the workspace that started the task if it is on this device, otherwise
  the one in use.
- The draft is plain text that stands on its own: the title, the state and what is being asked,
  built in the browser from fields the member can already see, then a request for help deciding.
  It ends with one line telling the chat that it cannot change anything in the Orchestrator. If
  the member lacks `orchestrator.view_content`, the draft has the state and title only. Nothing
  is posted from the server.
- **No link in the draft until L1 exists.** A link to a local page is useless to a chat that has no
  way to read it, and it sends the chat looking for tools. Once the `orchestrator:*` capabilities
  exist, the draft may name the task id so the chat can read it with `orchestrator:get_task`.
- **This is the second-best way to talk to an agent.** The first is the conversation inside the
  Orchestrator ([ui.md](ui.md), "Asking an agent"). A general chat does not know the agent, its
  task or its approvals.
- Nothing is sent and nothing navigates unasked (`DESIGN.md` S5). The person reads the draft
  and sends it.
- The chat can then keep current with `orchestrator:get_task`.
- **Back to chat.** A task with a chat origin shows a link to that chat, built with
  `workspaceSessionRoute`. It appears only when that workspace is on this device and the
  signed-in member is the one who started it, the rule the Automations page follows for
  "Open local thread". Elsewhere the line reads "Started from a chat" with no link.
- This is a new chat. It does not mirror an agent's run. Agents on the headless runner are
  not OpenCode sessions, so their record is the task timeline.

## L3: agent to workspace

Where an agent works decides what it can see. This is the part to leave until after the
pilot, and the configuration for it is reserved now so nothing has to be reworked.

| Target | Where the agent works | Files it can reach | The run as a chat | Status |
| --- | --- | --- | --- | --- |
| `headless` | Den's headless runner | None. Only MCP tools | The task timeline, not a chat | The pilot |
| `cloud` | An OpenWork Cloud worker | That cloud workspace | A native session, visible in OpenWork Web, with an "Open run" card as remote sessions have | After the pilot. The target exists; a workspace binding is needed |
| `desktop` | A signed-in desktop, through the shared runner channel | A local workspace | A native, visible local session | After the pilot. Absent from the v1 schema |

- **Binding.** An optional `runtime.workspace` on the agent: `{ kind: "cloud" }`, or
  `{ kind: "desktop", workspaceId, runnerId }`. It is chosen when the agent is created and
  pinned, as Automations pin a workspace: targeting must not follow whichever workspace
  happens to be open when the work runs. Adding it is an additive schema change with a new
  `schemaVersion`.
- **Ownership.** An agent bound to a person's desktop belongs to that person. If they leave
  the organization the agent is quarantined (T11 in [governance.md](governance.md)).
- **Offline.** If the machine is not running, the task does not wait in silence. An
  attention item says "Open OpenWork Desktop and sign in", with the task's deadline.
- **Same limits.** A bound agent acts through its configured tools, under the same
  approval and taint rules. Binding a workspace never widens what the configuration grants.

## What the interface adds

- No new sidebar row. The row stays organization-wide, and its attention marker shows in
  every workspace.
- On a task: **Discuss in chat**, and a line "Started from a chat" (with **Open chat** when
  allowed).
- In a chat: only the result card. The command palette could later offer "Hand this chat to
  an agent", which does the same as asking.
- For the Replit preview: the task page and "Needs you" rows can show **Discuss in chat** and
  the origin line with sample data now. L1 needs the backend.

## Decisions

These are also in the README.

- **D21.** The Orchestrator stays organization-scoped. A workspace or a chat is a reference:
  an origin on a task, an optional binding on an agent. It is never a parent.
- **D22.** Chats reach the Orchestrator through gateway capabilities in the remote-session
  pattern. A chat can list the agents visible to members, submit a task, read it and relay
  the person's answer to a question put to them. It cannot approve, configure or change the
  hierarchy.
- **D23.** A task that came from a chat, an MCP client, an event or an outside caller starts
  tainted. An origin is a label, not authority, and carries ids only.
- **D24.** An agent is visible to chats and MCP clients only when its `a2a.exposure` is
  `members` or `organization`.

## How it is tested

Group W in [test-plan.md](test-plan.md), and journey J7. The rules for the origin and for relayed
answers are code in [messaging.md](messaging.md), with their own checks; a deliberate break of
each rule was caught.

| Id | Scenario | Expected |
| --- | --- | --- |
| W1 | The origin schema | Every kind parses; a chat origin with content, or without both ids, is rejected |
| W2 | Taint by origin | A chat, an MCP client, an event and an outside caller taint; the Orchestrator itself and a schedule do not |
| W3 | Submit from a chat | One task with the origin; the same call retried creates no second task |
| W4 | Identity | The member comes from the token; another member's task is a 404 |
| W5 | What a chat cannot do | Approve, decline, edit an agent and change the hierarchy return `unknown_capability` |
| W6 | The scope | Without the scope or with the feature off, the capabilities are not listed |
| W7 | Discuss in chat | The composer opens with the draft unsent; a member without `view_content` gets title and state only |
| W8 | Back to chat | Hidden when the workspace is not on this device or the member differs |
| W9 | No loop | The Orchestrator never sends a prompt into a chat; submissions beyond the per-member limit get `rate_limited` |
| W10 | A relayed answer is accepted | The person asked, with the question's digest, answers once; the task continues, the timeline says "Answered from a chat", the ledger has `task.answered_via_chat` |
| W11 | A relayed answer is refused | Another member, a question for an agent or manager, an answered or expired question, a wrong digest, an answer outside the offered options: each is refused with its reason and nothing is recorded as answered |
| W12 | Taint after a relay | A task answered through a chat is tainted afterwards: an external write needs approval, an irreversible one is denied |
| W13 | The policy | With `chatAnswers` off, `orchestrator:answer` is not listed and a call returns `unknown_capability` |
| W14 | Visibility | `orchestrator:list_agents` shows only `members` and `organization` agents; submitting to an `internal` agent returns `not_found`; the tab still reaches every agent |

## Decided

Your answers, 2026-10-02:

- A chat may relay a person's answer, with the limits above.
- "Discuss in chat" defaults to the workspace that started the task if it is on this device,
  otherwise the workspace in use.
- A chat sees only the agents made visible to members.
- The Replit preview gets "Discuss in chat" and the origin line.

## Decided later

- **Who holds a workspace binding (D26).** Both, with different rights. The agent's owner creates the
  binding and can change or remove it. The organization, through `orchestrator.admin`, can see every
  binding, limit which kinds are allowed by policy, and revoke any of them. A revoked binding
  pauses the agent and raises an attention item; it never deletes history. The owner's answer was
  "yes" to "owner or organization"; this reading is the one that gives each the control it needs, and
  it is open to correction.
- **Connectors for the first pilot (D27).** All the connectors an organization has made available
  through the gateway are usable, not a short fixed list. Each agent still has its own explicit allow
  list (`tools.allow`), and risk decides who must approve: reads run on their own, reversible writes
  are limited by the agent's configuration, writes outside the organization need a person, and
  irreversible actions stay off until the organization turns them on. The pilot starts every
  agent in a read-only stage and adds writes one agent at a time.
