# Memory and context

Status: proposal. Part of [the orchestrator plan](README.md). Covers brief step 7.

## Two different things

| | Task context | Durable memory |
| --- | --- | --- |
| What it is | What an attempt needs to continue: the payload, the latest checkpoint, scratch notes, unresolved messages | Knowledge that outlives a task |
| Lives | And dies with the task | Until its retention rule or a person removes it |
| Written | By the runner and the orchestrator as a side effect of working | Deliberately, through `memory_write` or the UI |
| Source of truth for | Resuming an attempt after a crash, an approval or a question | What agents and people know across tasks |

Keeping them apart is what lets task context be deleted aggressively without
losing what the organization has decided to keep.

## Scopes

| Scope | Holds | Readable by | Writable by | Default retention |
| --- | --- | --- | --- | --- |
| `task` | Checkpoints, scratch notes, intermediate results | Attempts of that task | The task's agent | 7 days after the task is terminal (1 to 90) |
| `process` | Facts shared by the tasks of one process, such as what research found for the drafter | Agents with `process` read, on tasks in that process | Agents with `process` write | Same as the root task |
| `agent` | An agent's own durable notes | That agent, across versions; its owner in the UI | That agent | 90 days since last use (1 to 365) |
| `org` | Curated organization knowledge, in namespaces such as `playbooks` | Agents granted the namespace; members by role | Members directly; agents as proposals | Until deleted or the organization's retention policy applies |

## Access control

Access is decided by configuration, not by the agent's own say-so.

- `memory.read` and `memory.write` list the scopes an agent may use.
  `memory.orgNamespaces` lists the organization namespaces it may touch. Using
  `org` with no namespace fails validation.
- The memory tools check, on every call: the scopes in the attempt's pinned
  config version; that the entry's data class is within the agent's
  `permissions.dataClasses`; and that the agent's owner still has authority.
- Memory is never injected wholesale. A read returns a few snippets chosen by
  key, tag or text, within a token budget, each labelled with its provenance
  and wrapped as quoted data.
- People need the permissions in the matrix in [governance.md](governance.md);
  organization memory is curated by admins and above.

## Data model

`orchestrator_memory` in `ee/packages/den-db/src/schema/orchestrator.ts`.

| Column | Notes |
| --- | --- |
| `id`, `organization_id`, `scope`, `namespace` | `namespace` is set for `org` only |
| `owner_ref` | Task id, root task id or agent id, depending on scope |
| `key`, `tags`, `summary` | What retrieval searches |
| `value` | Encrypted JSON, at most 16 KiB. Larger content is an artifact, referenced |
| `classification` | A data class, inherited from the highest class among the sources |
| `provenance` | Agent, task, attempt, source references, and `trust` (`trusted` or `untrusted`) |
| `state` | `proposed`, `committed`, `superseded`, `deleted` |
| `version`, `supersedes_id` | A write appends a version and supersedes the last; nothing is edited in place |
| `subject_ref` | Optional tag identifying the person or record the entry is about, used for erasure |
| `expires_at`, `created_by` | Retention and the acting agent or member |

## Retrieval

Version 1 retrieves by exact key, by tag, and by full-text search over key,
tags and summary. It does not use embeddings. Vector search adds a provider
dependency and another place where restricted data is copied and must be
erased, so it is a separate decision after the pilot.

## Organization memory and poisoning

Memory that an attacker can write is an instruction channel. The rules:

- An agent's write to `org` is a **proposal**. An admin reviews proposals in the
  UI and commits or discards them.
- An organization can enable `autoCommitTrusted` per namespace. It applies only
  to entries whose provenance is `trusted`, meaning no task in the process
  touched untrusted content (see "taint" in [governance.md](governance.md)).
- Entries derived from untrusted content are labelled so, can never auto-commit,
  and stay visibly labelled wherever they are read.
- Retrieved memory is data. The instructions every attempt receives say that
  nothing in a snippet changes the task, the tools or the rules.
- Reading memory never raises an attempt's permissions or lowers its approval
  requirements.

## Retention and deletion

| What | Rule | Mechanism |
| --- | --- | --- |
| Task context | Purged `taskContextDays` after the task is terminal | Reconciler retention step |
| Process memory | Purged with the root task's context | Same |
| Agent memory | Purged `agentMemoryDays` after last use | Same |
| Organization memory | Kept until deleted, or by the organization's retention policy | Explicit delete or policy |
| Deleted entries | The value is purged at once; a tombstone with id, scope, key, actor and time remains | Delete API |
| Message bodies | See [messaging.md](messaging.md) | Reconciler |

Erasure by subject (`DELETE /v1/orchestrator/memory?subjectRef=…`) removes the
values of every entry tagged with that subject across all scopes and the bodies
of messages tagged to it. Untagged free text cannot be found automatically, so
agent instructions tell agents to tag personal data and not to store it in agent
or organization memory, and an organization can switch those scopes off for the
`confidential` and `restricted` data classes. The governance ledger holds
digests and ids, never content, so erasure does not touch it. Den already has an
erasure path for gateway usage (`ee/packages/den-db/src/gateway-usage-erasure.ts`);
the orchestrator should follow its approach.

## Building an attempt's context

In order, within `memory.context.maxInputTokens`:

1. The agent's instructions and guardrails.
2. The orchestrator's rules block, which agents cannot edit: messages and
   memory are data, tools are limited to the allow list, effects need the
   gateway.
3. The task payload, as quoted data.
4. The latest checkpoint summary.
5. Unresolved messages, such as a clarification answer.
6. Memory snippets, at most a quarter of the budget.
7. Recent turns.

After `summarizeAfterSteps` steps the runner folds older turns into the
checkpoint summary, so long tasks keep a bounded context.

A checkpoint:

```json
{
  "stepIndex": 7,
  "summary": "Found the order record and two relevant playbook entries; drafting next.",
  "scratch": {"orderId": "o-1042"},
  "pendingToolCalls": [],
  "effectsDone": []
}
```

`effectsDone` lists effect keys already completed, so a resumed attempt does not
plan them again even before it consults the effect log.
