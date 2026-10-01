# The Orchestrator tab

Status: proposal. Part of [the orchestrator plan](README.md). Covers the interface
half of brief step 10. It follows `DESIGN.md`; rule ids (P1, S2, C5…) are cited
so a reviewer can check each choice. The audience is non-technical: people who
run a team of agents, not people who write JSON.

## Placement and gating

- A new row in the sidebar header menu, after Automations and before Extensions.
  It uses `SidebarDestination`
  (`apps/app/src/react-app/domains/session/sidebar/sidebar-destination.tsx`) the
  way Automations does in `app-sidebar.tsx`.
- Icon: a generic lucide icon, 16 px (V5). No sparkle, wand or robot. `Workflow`
  is avoided because "Workflow" already means a Code Mode script in this
  product. Candidates are `Waypoints` or `Network`; confirm the glyph exists in
  the installed lucide version.
- Label: **Orchestrator** while the rollout flag is on (D10). It is a translated
  string, `orchestrator.nav`, not a literal.
- Attention marker: the amber triangle Automations already uses
  (`data-automations-attention-indicator`), with an accessible name such as "2
  items need you". It shows when an approval or question is waiting, or an agent
  is paused after problems. Colour marks the minority that needs attention (V2).
- Availability mirrors `automationsNavigationAvailable` in
  `shell/session-route.tsx`: a rollout flag **and** a Den-connected deployment.
  While the flag is off the row does not exist, because the feature has not
  shipped to this organization. Once it is on, a policy or plan block is never a
  disappearance (P4): the row stays, the page opens, and the blocked part shows
  a lock with the reason and who can change it.
- The tab works in the desktop app and in OpenWork Web, as one shared surface,
  like Automations. The desktop is a Den client here, never the host.

## Routes and files

Org-scoped, so not nested under a workspace, like `/automations` and `/dashboard`.
Routes render through `SessionRoute` to keep the sidebar shell.

| Route | View |
| --- | --- |
| `/orchestrator` | Agents list, with "Needs you" above it when non-empty |
| `/orchestrator/tasks` | Tasks across agents, filterable |
| `/orchestrator/tasks/:taskId` | Task timeline; the approval card sits at the top when one is pending |
| `/orchestrator/activity` | Governance ledger |
| `/orchestrator/agents/:agentId` | One agent |
| `/orchestrator/agents/:agentId/edit` | Configuration editor and version history |

Add `orchestratorRoute(path?)` to `react-app/shell/workspace-routes.ts` beside
`automationsRoute()`, register the routes in `shell/app-root.tsx`, thread
`onOpenOrchestrator`, `orchestratorActive` and `orchestratorNeedsAttention`
through `session-route.tsx`, `settings-route.tsx`, `session-page.tsx` and
`app-sidebar.tsx` the way the Automations props travel, and add an
`orchestrator.open` entry to `shell/command-palette.tsx`.

New domain folder, mirroring `domains/automations/`:

```
apps/app/src/react-app/domains/orchestrator/
  orchestrator-page.tsx          route shell and sub-navigation
  orchestrator-client.ts         typed Den client + TanStack Query hooks
  orchestrator-availability.ts   flag + deployment + role checks
  orchestrator-format.ts         state and spend wording, relative times
  agents-view.tsx  needs-you-list.tsx  agent-detail.tsx
  agent-editor.tsx  version-history.tsx  validation-report.tsx
  tasks-view.tsx  task-timeline.tsx  approval-card.tsx
  activity-view.tsx  kill-switch.tsx
```

Use `@/components` primitives (P5): `Button`, `Dialog`, `Popover`, `Switch`,
`Command`, tables as dense rows. Data comes through TanStack Query; no new
global store is needed. Wire types come from `@openwork/types`.

## Views

### Agents (the focal view, P7)

One row per agent (S2: 40 to 48 px, label left, state right, one action):
name with role in muted text; what it is doing now ("Replying to r1", "Idle",
"Next run 08:00"); queue count; spend today; a state label; a pause or resume
icon button. Working agents use the existing dot-matrix activity glyph in the
glyph lane (`SessionDotMatrixLoader`); shimmer appears only on the step that is
running now (V6).

```
Orchestrator                                                  New agent

Needs you  2
  Send reply to 1 recipient · Sender, waiting 12 min          Approve and send   Decline
  Which address should this come from? · Drafter              Answer

Agents
  ⣿ Intake        Checking the inbox · 0 queued       $0.42 today    Running     ⏸
  ⣿ Research      Working on r1 · 2 queued            $1.10 today    Running     ⏸
    Drafter       Idle · 0 queued                     $0.31 today    Running     ⏸
    Reviewer      Idle                                $0.12 today    Running     ⏸
    Sender        Waiting for approval · 1 queued     $0.02 today    Running     ⏸
    Daily digest  Next run 08:00                      $0.05 today    Running     ⏸
```

There is one page title and no description line (P2). Explanatory sentences are
absent from the first viewport (P1); the empty state is the only invitation.

### Needs you

Approvals, questions, dead letters and agents paused after problems, oldest
first, in one list. Each row names what is waiting and offers its one action.
The approval row expands into the consent card on the task page.

### The consent card

The focal element while a decision is pending (P7, T4). It sits at the top of
the task page, names action, data and risk in one state line (P9), and offers
primary, secondary and decline, with chords.

```
Send reply to 1 recipient
Sender · process r1 · waiting 12 min

Data    The drafted reply and the requester's address
Risk    They see it right away. It cannot be unsent.
Reply   To r***@example.com · Re: your request · 612 characters   Open draft

                                   Decline  esc        Approve and send  ⏎
```

- The button is named for the action (C1, C2): "Approve and send", then the
  toast "Sent". A capability that posts says "Approve and post".
- "Open draft" opens the artifact in the side panel and never auto-navigates (S5).
  Editing the draft changes the digest, withdraws this approval and raises a new
  one; the card says so in one line.
- Approving is the confirmation for an external action (P8). No second dialog.
- Not shown: any way to approve several at once.

### Agent detail

A 40 px header with the name, state, and the pause or resume icon button; restart
and stop in an overflow menu. Below it, compact rows with hairline dividers (S1,
S2), each opening with a rotating chevron (S3):

| Row | Shows |
| --- | --- |
| Now | What it is doing, last heartbeat ("12 s ago"), health in words |
| Work | Queued, running, done today, failed today |
| Spend | "$0.42 of $2.00 today", and the month |
| Configuration | "Version 3 · active · edited by Ana 2 days ago" with Edit, History, Compare |
| What it can do | Plain sentences: "Reads the knowledge base", "Saves drafts", "Sends replies after approval" |
| Recent tasks | The last ten, linking to the task page |
| History | This agent's ledger entries |

Capability ids, JSON and error codes live under a collapsed **Technical details**
(P3, C3), label only, no preview of the contents.

### Configuration editor

"New agent" starts from a role: Dispatcher, Worker, Reviewer, Executor or
Monitor (the presets in [agent-config.md](agent-config.md)). Sections, in order:
Basics; When it runs; What it can use; Limits and approvals; Advanced (retry,
escalation, memory). "Edit as JSON" is under Technical details.

- **Check** runs validation. Issues read as a sentence plus the next action (C6):
  "Sender can send replies but no one is set to approve them · Choose approvers".
  A warning never blocks; an error blocks activation.
- **Activate version 4** is the primary action. After it, a toast reads
  "Version 4 is active · Undo", and Undo rolls back (P8: undo over confirm).
- Cost limits have no default, so the form shows them empty with the reason in
  the field's validation, not as help text (P1).
- The version bar shows who edited, when, and the change note; Compare opens a
  field-level diff of two versions.

### Tasks and the timeline

A dense list with filters for state and agent. The task page shows a single rail
of steps in the style of tool activity (T1): a leading slot, a sentence label,
duration on the right. Messages, attempts, effects and approvals are rows in time
order, for example "Research found 3 facts · 41 s" and "Sender asked for
approval · 12 min". A finished process collapses to one line: "Finished in 14
min · 6 agents · $0.31". Raw envelopes and arguments sit under Technical details.

### Activity

The ledger in plain sentences with the actor and time: "Ana activated Sender
version 3", "Dev declined a send". Filter by agent or person. Export and verify
are in the overflow menu for those with the permission.

## Reference: creating an agent

The agents it creates are listed with the Agent Cards described in [a2a.md](a2a.md). The
reference layout is a mainstream agent builder: a form on the right with Configure
and Preview tabs, and sections for instructions, skills, knowledge and suggested
prompts, with a conversational helper on the left. It is a layout reference only; the
product follows `DESIGN.md`, which means no cards inside cards, no explanatory
tooltips in place of state, and plain words.

| Reference section | Here |
| --- | --- |
| Name, icon, one-line description | Basics. The description is what other agents and people see on the agent's card |
| Instructions, with "Suggest improvements" | Instructions. Assisted rewriting is a later addition; v1 is a plain text field with a character count |
| Skills | Two different things. **Skills**: the Library skills attached to this agent. **Requests it handles**: what others can ask it, which become the skills on its Agent Card, each with example requests |
| Knowledge, with work content toggles | **What it can read**: organization memory namespaces and connected sources it may use; each is a visible row with its data class |
| Suggested prompts (title and message) | **Example requests**, shared with the card's skill examples, shown on the agent page as one-click starters |
| Configure and Preview | The same two tabs. **Preview** runs the configuration against a sample request with mock tools (the V4 simulation), so a draft can be tried before activation |

"Create" becomes **Save draft**, then **Activate version N**, as described above.
The list that results is the Agents view, and each row can show the agent's card in
Technical details.

## Words people see

| Internal | Shown as |
| --- | --- |
| `active` | Running |
| `paused` | Paused |
| `starting`, `pausing`, `stopping` | Starting, Pausing, Stopping |
| `quarantined` | Paused after problems, with the reason: "5 failures in a row", "Owner needs access", "Budget reached" |
| `queued` | Queued |
| `claimed`, `running` | Working |
| `waiting_approval` | Waiting for approval |
| `waiting_input` | Waiting for an answer |
| `waiting_children` | Waiting on other agents |
| A2A skill | Request it handles |
| Agent Card | Listing |
| `succeeded` | Done |
| `failed` | Failed |
| `dead_lettered` | Needs your help |
| `expired` | Timed out |
| health `unavailable` | Not responding |

Blocked and locked states use neutral ink and a lock (C5). Red is reserved for
`failed` and `Not responding`. Labels are verb-first and sentence case (C1, C7):
"Pause agent", "Resume agent", "Restart", "Activate version 4", "Requeue task".

## Confirm or undo

| Action | Pattern |
| --- | --- |
| Pause, resume, restart | Immediate, with "Undo" in the toast |
| Activate or roll back a version | Immediate, with "Undo" |
| Stop, retire | Confirm (stop cancels live work; retire is permanent) |
| Cancel, discard a dead letter, delete a memory entry | Confirm |
| Approve an external action | The consent card is the confirmation |
| Pause everything | Confirm, naming how many agents and tasks it affects; "Resume all" restores exactly those |

## States

Each view designs and shows these (the "States" section of `DESIGN.md`):

| State | What shows |
| --- | --- |
| Loading | Skeleton rows in the final layout, not "Loading…" |
| Empty | An invitation with the five starting points: "Create your first agent" |
| Error | What happened and the next action: "Couldn't load agents · Try again" |
| Blocked | A lock, the reason and the owner: "Changing agents is part of Enterprise · Ask an owner" or "Only admins can change agents · Ask an admin" |
| Offline | The last known state with its age: "Last updated 2 min ago · Reconnecting" |
| Success | The data |

## Live updates

The view subscribes to the stream in [api.md](api.md). A wake-up refetches the
affected queries; the stream carries no data. If the stream cannot stay open the
app polls with backoff and shows the age of the last read. Nothing moves focus,
reorders a row under the pointer, or opens a pane because an event arrived (S5);
new items appear in place with an unobtrusive count.

## Agent-readable control

`apps/app/src/react-app/ARCHITECTURE.md` describes `window.__openworkControl`
and the query and command kinds. Register, in the orchestrator domain:

| Id | Kind | Notes |
| --- | --- | --- |
| `orchestrator.list_agents`, `orchestrator.get_agent`, `orchestrator.list_attention` | query | Concurrent, side-effect-free, do not focus the window |
| `orchestrator.open` | command | Navigation only |
| `orchestrator.pause_agent`, `orchestrator.resume_agent` | command | `effects` declares durable change; no confirmation |
| `orchestrator.stop_agent` | command | `confirmation` required |

There is deliberately **no** command to approve or decline. Approving is a
person's act, and an agent driving the UI must not be able to perform it.

## Keyboard and accessibility

Palette entries "Orchestrator" and, behind confirmation, "Pause all agents". The
consent card takes `⏎` and `esc`. Every control has a visible focus ring;
motion respects reduced-motion (V6); state is never conveyed by colour alone, so
each state label is text.

## Translations

Add `orchestrator.*` keys to `apps/app/src/i18n/locales/en.ts` first and follow
`TRANSLATIONS.md` for the other locales. The existing Automations and Dashboard
rows use literals; the new row should not.

## DESIGN.md checklist

| Rule | How this plan meets it |
| --- | --- |
| P1 Show state | Rows report state ("Waiting for approval", "$0.42 today"); no explanatory sentences in the first viewport |
| P2 Title or description | One page title; rows and cards carry one of the two |
| P3 Progressive disclosure | Retry, escalation, memory, JSON and ids sit under Advanced and Technical details |
| P4 Presence with a lock | Blocked parts stay visible with reason and owner |
| P5 Reuse | `SidebarDestination` and `@/components` primitives; no hand-rolled controls |
| P6 Density | Compact rows, 40 to 48 px, hairlines |
| P7 One focal element | The agent list; the consent card while a decision is pending |
| P8 Undo over confirm | Undo toasts; confirms only for stop, retire, cancel, discard, delete, and approving external actions |
| P9 Consent | Action, data, risk, reversibility in one card |
| P10 Evidence | Screenshots at real size for every state below, plus the journey specs in [test-plan.md](test-plan.md) |
| P11 Continuity | Starting an agent shows the agent row in place, never a "Setting up…" screen |
| S1 to S6 | No nested cards; compact rows; chevron disclosure; nothing auto-navigates; one command behind palette, button and chord |
| C1 to C7 | Verb-first, named-for-action buttons; plain words; blocked is not an error; sentence case |
| V1 to V7 | Tokens only; lucide icons; no gradients, no robot glyphs |
| T1, T4 | The timeline is one rail; the consent card sits where the user acts |

## Evidence to attach to the UI pull requests

Screenshots at real size: the agents list with working, idle and paused rows;
the empty state; the consent card; the card after approval ("Sent"); the agent
detail; the editor with a validation error; the version compare; the blocked
state for a member; the offline state; and the sidebar row with and without the
attention marker.
