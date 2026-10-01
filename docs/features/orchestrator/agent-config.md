# Agent configuration

Status: proposal. Part of [the orchestrator plan](README.md). Covers brief step 2.

## Principles

- **Configuration is data.** A versioned JSON document, validated by Zod, stored
  normalised. Trigger conditions are declarative predicates; there is no code
  evaluation anywhere in a config.
- **Strict.** Unknown fields are rejected (`z.strictObject` throughout), so
  nothing can be smuggled in beside the fields that are checked.
- **Normalised on save.** Validation fills every default and stores the result.
  Changing a default later never changes an existing version's behaviour.
- **No secrets.** A config names capabilities and connections; it never holds a
  credential, token or key. Credentials are resolved server-side when an effect
  runs (see [governance.md](governance.md)).
- **Spend must be a decision.** `limits.cost` has no default. Activation fails
  until someone chooses the numbers.
- **Least privilege by construction.** An agent that declares
  `permissions.inputTrust: "untrusted"` cannot hold an external-write or
  irreversible tool. The schema catches declared tiers; validation catches the
  tier the catalogue assigns.

## Field reference

| Brief item | Config path | Notes |
| --- | --- | --- |
| Identity | `identity` | `slug` is unique per organization and is how other agents address this one |
| Role and responsibilities | `role` | `kind`, up to 10 `responsibilities`, and the task types the agent `accepts` and `produces` |
| Instructions or system prompt | `instructions` | Encrypted at rest. Guardrails are extra lines appended to every attempt |
| Model | `model` | A primary and up to two fallbacks, tried in order after `model_failure` |
| Tool access | `tools` | Allow and deny lists of catalogue capabilities, and which orchestrator tools the agent gets |
| Trigger conditions | `triggers` | `task` triggers (accepted types, optional `where` predicate) and `event` triggers (a webhook source, optional filter, and the task type it creates) |
| Execution frequency | `runtime.mode`, `frequency` | Interval, daily or weekly schedule, tick interval, minimum gap, attempts per hour, quiet hours |
| Memory and context | `memory` | Context size, scopes the agent may read and write, organization namespaces, retention |
| Permissions | `permissions` | Input trust, data classes, who it may delegate to, approval requirements and approvers |
| Retry and escalation | `retry`, `escalation`, `deadLetter` | Attempts, backoff, retryable error classes; rules that notify, reassign, pause or require a human |
| Resource and cost limits | `limits`, `runtime.concurrency` | Runtime, steps, tokens, cost per attempt, task, day and month, queue depth, fan-out, new processes, visits per process |

## The schema

This is the normative draft, as code. It compiles under `strict` TypeScript with
Zod 4, the version in `packages/types/package.json`. It becomes
`packages/types/src/orchestrator.ts` in milestone M1; an exported `.meta({ ref })`
on each schema will carry the OpenAPI names the way `automations.ts` does.

```ts
import { z } from "zod"

// --- shared vocabulary -------------------------------------------------------

export const riskTierSchema = z.enum(["read", "reversible_write", "external_write", "irreversible"])
export type RiskTier = z.infer<typeof riskTierSchema>

export const dataClassSchema = z.enum(["public", "internal", "confidential", "restricted"])

/** Only these classes are ever retried; `policy` and `permanent` failures are not in the list on purpose. */
export const errorClassSchema = z.enum([
  "transient", "rate_limited", "tool_unavailable", "model_failure", "malformed_output", "unknown",
])

export const orgRoleSchema = z.enum(["owner", "super-admin", "admin"])

const slugSchema = z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/)
/** Task, event and result types, e.g. `reply.draft.requested`. */
const typeNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,62}$/)
const idSchema = z.string().trim().min(1).max(160)
const dayMs = 24 * 60 * 60 * 1000

const timezoneSchema = z.string().trim().min(1).max(120).refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0))
    return true
  } catch {
    return false
  }
}, "Expected a valid IANA timezone")

// --- trigger conditions: declarative predicates, never code ------------------

const jsonPathSchema = z.string().max(200).regex(/^\$(\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/)
const literalSchema = z.union([z.string().max(500), z.number(), z.boolean(), z.null()])

export type Predicate =
  | { op: "eq" | "neq" | "gt" | "lt" | "contains"; path: string; value: string | number | boolean | null }
  | { op: "in"; path: string; values: Array<string | number | boolean | null> }
  | { op: "exists"; path: string }
  | { op: "and" | "or"; of: Predicate[] }
  | { op: "not"; of: Predicate }

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.enum(["eq", "neq", "gt", "lt", "contains"]), path: jsonPathSchema, value: literalSchema }),
    z.strictObject({ op: z.literal("in"), path: jsonPathSchema, values: z.array(literalSchema).min(1).max(50) }),
    z.strictObject({ op: z.literal("exists"), path: jsonPathSchema }),
    z.strictObject({ op: z.enum(["and", "or"]), of: z.array(predicateSchema).min(1).max(10) }),
    z.strictObject({ op: z.literal("not"), of: predicateSchema }),
  ]),
)

/** Depth and node limits are checked after parsing so error messages stay readable. */
export function predicateShape(predicate: Predicate): { depth: number; nodes: number } {
  if (predicate.op === "and" || predicate.op === "or") {
    const children = predicate.of.map(predicateShape)
    return {
      depth: 1 + Math.max(...children.map((child) => child.depth)),
      nodes: 1 + children.reduce((total, child) => total + child.nodes, 0),
    }
  }
  if (predicate.op === "not") {
    const child = predicateShape(predicate.of)
    return { depth: 1 + child.depth, nodes: 1 + child.nodes }
  }
  return { depth: 1, nodes: 1 }
}

const boundedPredicateSchema = predicateSchema.refine((predicate) => {
  const shape = predicateShape(predicate)
  return shape.depth <= 4 && shape.nodes <= 20
}, "A trigger condition may nest at most 4 levels and contain at most 20 tests")

// --- building blocks ---------------------------------------------------------

const modelRefSchema = z.strictObject({
  providerId: idSchema,
  modelId: idSchema,
  variant: z.string().trim().min(1).max(60).optional(),
})

const recipientsSchema = z.strictObject({
  roles: z.array(orgRoleSchema).max(3).default([]),
  memberIds: z.array(idSchema).max(10).default([]),
}).refine((value) => value.roles.length + value.memberIds.length > 0, "Name at least one role or member")

/** `daily` and `weekly` are byte-for-byte the shapes in `automationScheduleSchema`; `interval` is new. */
const scheduleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("interval"), everyMs: z.number().int().min(60_000).max(7 * dayMs) }),
  z.strictObject({
    kind: z.literal("daily"),
    timezone: timezoneSchema,
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.strictObject({
    kind: z.literal("weekly"),
    timezone: timezoneSchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
])

const orchestratorToolSchema = z.enum([
  "delegate_task", "report_status", "ask_clarification", "complete_task", "fail_task",
  "answer_clarification", "request_approval", "memory_read", "memory_write", "inspect_queue", "notify",
])

const memoryScopeSchema = z.enum(["task", "process", "agent", "org"])
const microUsdSchema = z.number().int().nonnegative().safe()

// --- the configuration -------------------------------------------------------

export const agentConfigV1Schema = z.strictObject({
  schemaVersion: z.literal(1),

  identity: z.strictObject({
    slug: slugSchema,
    displayName: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  }),

  /** Role and responsibilities, plus the task types this agent consumes and produces. */
  role: z.strictObject({
    kind: z.enum(["dispatcher", "worker", "reviewer", "executor", "monitor", "custom"]),
    responsibilities: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    accepts: z.array(z.strictObject({
      type: typeNameSchema,
      /** Restricted JSON Schema subset; the validator is chosen in milestone M1. Checked when work is delegated to this agent. */
      payloadSchema: z.record(z.string(), z.json()).optional(),
      /** Same subset. Checked when this agent calls `complete_task`. */
      resultSchema: z.record(z.string(), z.json()).optional(),
    })).max(20).default([]),
    produces: z.array(typeNameSchema).max(20).default([]),
  }),

  /** Stored encrypted. Never holds credentials; see governance.md. */
  instructions: z.strictObject({
    system: z.string().trim().min(1).max(32_000),
    guardrails: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  }),

  model: z.strictObject({
    primary: modelRefSchema,
    /** Tried in order when the primary fails with `model_failure`. */
    fallbacks: z.array(modelRefSchema).max(2).default([]),
    maxOutputTokens: z.number().int().positive().max(200_000).optional(),
  }),

  runtime: z.strictObject({
    /** `desktop` is deliberately absent from v1; see architecture.md. */
    target: z.enum(["headless", "cloud"]),
    mode: z.enum(["event", "schedule", "continuous"]),
    /** Simultaneous attempts for this agent. */
    concurrency: z.number().int().min(1).max(10).default(1),
  }),

  /** Conditions that wake an `event` agent. `schedule` and `continuous` agents have none. */
  triggers: z.array(z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("task"),
      taskTypes: z.array(typeNameSchema).min(1).max(20),
      where: boundedPredicateSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal("event"),
      sourceId: idSchema,
      eventTypes: z.array(typeNameSchema).max(20).default([]),
      where: boundedPredicateSchema.optional(),
      createsTaskType: typeNameSchema,
    }),
  ])).max(10).default([]),

  /** When and how often the agent may run. */
  frequency: z.strictObject({
    schedule: scheduleSchema.optional(),
    tickIntervalMs: z.number().int().min(30_000).max(3_600_000).optional(),
    minGapBetweenAttemptsMs: z.number().int().nonnegative().max(dayMs).default(0),
    maxAttemptsPerHour: z.number().int().positive().max(3_600).default(60),
    quietHours: z.strictObject({
      timezone: timezoneSchema,
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
    }).optional(),
  }).prefault({}),

  tools: z.strictObject({
    /** Capability ids or `prefix.*` patterns from the OpenWork MCP catalog. `tier` can only raise a tool's tier. */
    allow: z.array(z.strictObject({
      capability: z.string().trim().min(1).max(200),
      tier: riskTierSchema.optional(),
    })).max(50).default([]),
    deny: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    /** `complete_task` and `fail_task` are always available whether listed or not. */
    orchestrator: z.array(orchestratorToolSchema).max(11)
      .default(["report_status", "ask_clarification", "complete_task", "fail_task"]),
  }).prefault({}),

  permissions: z.strictObject({
    /** Declares whether this agent reads content an outsider can write. */
    inputTrust: z.enum(["trusted", "untrusted"]),
    dataClasses: z.array(dataClassSchema).min(1).max(4).default(["public", "internal"]),
    /** Agent slugs or `role:<kind>`. */
    delegateTo: z.array(z.string().regex(/^(role:)?[a-z][a-z0-9-]*$/)).max(20).default([]),
    approvals: z.strictObject({
      /** `irreversible` always needs approval and `read` never does, so neither is configurable. */
      requireFrom: z.enum(["reversible_write", "external_write"]).default("external_write"),
      approvers: z.strictObject({
        roles: z.array(orgRoleSchema).max(3).default(["owner", "super-admin"]),
        memberIds: z.array(idSchema).max(10).default([]),
        minApprovals: z.number().int().min(1).max(3).default(1),
      }).prefault({}),
      expiresInMs: z.number().int().min(60_000).max(7 * dayMs).default(dayMs),
      allowSelfApproval: z.boolean().default(false),
    }).prefault({}),
  }),

  memory: z.strictObject({
    context: z.strictObject({
      maxInputTokens: z.number().int().min(1_000).max(200_000).default(32_000),
      summarizeAfterSteps: z.number().int().min(2).max(100).default(20),
    }).prefault({}),
    read: z.array(memoryScopeSchema).max(4).default(["task"]),
    write: z.array(memoryScopeSchema).max(4).default(["task"]),
    /** Organisation memory is partitioned by namespace; an agent sees only the ones listed. */
    orgNamespaces: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,62}$/)).max(20).default([]),
    retention: z.strictObject({
      taskContextDays: z.number().int().min(1).max(90).default(7),
      agentMemoryDays: z.number().int().min(1).max(365).default(90),
    }).prefault({}),
  }).prefault({}),

  /** No default for cost: activation must force a decision about spend. */
  limits: z.strictObject({
    maxRuntimeMs: z.number().int().min(10_000).max(3_600_000).default(900_000),
    maxStepsPerAttempt: z.number().int().min(1).max(200).default(40),
    maxTokensPerAttempt: z.number().int().min(1_000).max(2_000_000).default(200_000),
    cost: z.strictObject({
      perAttemptMicroUsd: microUsdSchema,
      perTaskMicroUsd: microUsdSchema,
      perDayMicroUsd: microUsdSchema,
      perMonthMicroUsd: microUsdSchema,
    }),
    maxQueueDepth: z.number().int().min(1).max(10_000).default(500),
    maxChildTasksPerTask: z.number().int().min(0).max(50).default(10),
    /** Only time-driven agents may start new processes; event agents may only extend the one they are in. */
    maxNewProcessesPerAttempt: z.number().int().min(0).max(100).default(0),
    /** How many times this agent may appear on one delegation path: 1 means no revisits, 3 allows two revision rounds. */
    maxVisitsPerProcess: z.number().int().min(1).max(5).default(1),
  }),

  retry: z.strictObject({
    maxAttempts: z.number().int().min(1).max(10).default(3),
    backoff: z.strictObject({
      initialMs: z.number().int().min(1_000).max(600_000).default(5_000),
      maxMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
      multiplier: z.number().min(1).max(5).default(2),
      jitter: z.enum(["none", "full"]).default("full"),
    }).prefault({}),
    retryOn: z.array(errorClassSchema).default(["transient", "rate_limited", "tool_unavailable", "model_failure"]),
  }).prefault({}),

  escalation: z.array(z.strictObject({
    when: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("consecutive_failures"), count: z.number().int().min(2).max(20) }),
      z.strictObject({ kind: z.literal("task_stalled"), afterMs: z.number().int().min(60_000).max(7 * dayMs) }),
      z.strictObject({ kind: z.literal("budget_used"), percent: z.number().int().min(50).max(100) }),
      z.strictObject({ kind: z.literal("approval_waiting"), afterMs: z.number().int().min(60_000).max(7 * dayMs) }),
      z.strictObject({ kind: z.literal("dead_lettered") }),
    ]),
    then: z.array(z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("notify"), to: recipientsSchema }),
      z.strictObject({ action: z.literal("require_human"), to: recipientsSchema }),
      z.strictObject({ action: z.literal("reassign"), toAgent: slugSchema }),
      z.strictObject({ action: z.literal("pause_agent") }),
    ])).min(1).max(4),
  })).max(10).default([]),

  deadLetter: z.strictObject({
    holdDays: z.number().int().min(1).max(365).default(90),
  }).prefault({}),
}).superRefine((config, context) => {
  const issue = (path: Array<string | number>, message: string) =>
    context.addIssue({ code: "custom", path, message })
  const { mode } = config.runtime

  if (mode === "event") {
    if (config.triggers.length === 0) issue(["triggers"], "An event agent needs at least one trigger")
    if (config.role.accepts.length === 0) issue(["role", "accepts"], "An event agent must accept at least one task type")
    if (config.frequency.schedule) issue(["frequency", "schedule"], "Only schedule agents take a schedule")
    if (config.frequency.tickIntervalMs !== undefined) issue(["frequency", "tickIntervalMs"], "Only continuous agents take a tick interval")
  }
  if (mode === "schedule") {
    if (!config.frequency.schedule) issue(["frequency", "schedule"], "A schedule agent needs a schedule")
    if (config.triggers.length > 0 || config.role.accepts.length > 0) {
      issue(["triggers"], "Time-driven agents produce work; they do not accept tasks or triggers")
    }
    if (config.frequency.tickIntervalMs !== undefined) issue(["frequency", "tickIntervalMs"], "Only continuous agents take a tick interval")
  }
  if (mode === "continuous") {
    if (config.frequency.tickIntervalMs === undefined) issue(["frequency", "tickIntervalMs"], "A continuous agent needs a tick interval")
    if (config.triggers.length > 0 || config.role.accepts.length > 0) {
      issue(["triggers"], "Time-driven agents produce work; they do not accept tasks or triggers")
    }
    if (config.frequency.schedule) issue(["frequency", "schedule"], "Only schedule agents take a schedule")
  }

  const acceptedTypes = new Set(config.role.accepts.map((entry) => entry.type))
  config.triggers.forEach((trigger, index) => {
    if (trigger.kind === "task") {
      for (const type of trigger.taskTypes) {
        if (!acceptedTypes.has(type)) issue(["triggers", index, "taskTypes"], `Task type ${type} is not in role.accepts`)
      }
    } else if (!acceptedTypes.has(trigger.createsTaskType)) {
      issue(["triggers", index, "createsTaskType"], `Task type ${trigger.createsTaskType} is not in role.accepts`)
    }
  })

  const canDelegate = config.tools.orchestrator.includes("delegate_task")
  if (canDelegate && config.permissions.delegateTo.length === 0) {
    issue(["permissions", "delegateTo"], "delegate_task needs at least one delegation target")
  }
  if (!canDelegate && config.permissions.delegateTo.length > 0) {
    issue(["tools", "orchestrator"], "delegateTo is set but delegate_task is not enabled")
  }

  if (config.permissions.inputTrust === "untrusted") {
    config.tools.allow.forEach((tool, index) => {
      if (tool.tier === "external_write" || tool.tier === "irreversible") {
        issue(["tools", "allow", index, "tier"], "An agent that reads untrusted content cannot hold external-write or irreversible tools")
      }
    })
  }

  if (config.limits.maxNewProcessesPerAttempt > 0 && mode === "event") {
    issue(["limits", "maxNewProcessesPerAttempt"], "Event agents cannot start new processes; only schedule and continuous agents can")
  }

  const { cost } = config.limits
  if (!(cost.perAttemptMicroUsd <= cost.perTaskMicroUsd
    && cost.perTaskMicroUsd <= cost.perDayMicroUsd
    && cost.perDayMicroUsd <= cost.perMonthMicroUsd)) {
    issue(["limits", "cost"], "Cost limits must not shrink as the period grows: attempt <= task <= day <= month")
  }
  if (config.retry.backoff.initialMs > config.retry.backoff.maxMs) {
    issue(["retry", "backoff"], "initialMs must not exceed maxMs")
  }
  const usesOrgMemory = config.memory.read.includes("org") || config.memory.write.includes("org")
  if (usesOrgMemory && config.memory.orgNamespaces.length === 0) {
    issue(["memory", "orgNamespaces"], "Organisation memory access needs at least one namespace")
  }
})

export type AgentConfigV1Input = z.input<typeof agentConfigV1Schema>
export type AgentConfigV1 = z.output<typeof agentConfigV1Schema>
```

`daily` and `weekly` schedules are the shapes in `automationScheduleSchema`
(`packages/types/src/automations.ts`), so the timing code in
`packages/automations/src/schedule.ts`, including DST behaviour, is reused.
`interval` is new.

### An example

The sender is the most interesting of the six, because it holds the only
external-write tool. The others are in `examples/agents/`.

```json
{
  "schemaVersion": 1,
  "identity": {"slug": "sender", "displayName": "Sender", "labels": ["sample"]},
  "role": {
    "kind": "executor",
    "responsibilities": ["Send one approved reply", "Confirm it was sent exactly once"],
    "accepts": [{"type": "reply.send.requested"}]
  },
  "instructions": {
    "system": "Send the approved draft as a reply to the original request. Before sending, check whether this reply was already sent. Do nothing else."
  },
  "model": {
    "primary": {"providerId": "example-provider", "modelId": "example-model"}
  },
  "runtime": {"target": "headless", "mode": "event"},
  "triggers": [{"kind": "task", "taskTypes": ["reply.send.requested"]}],
  "tools": {
    "allow": [
      {"capability": "mail.find_sent"},
      {"capability": "mail.send_reply", "tier": "external_write"}
    ],
    "orchestrator": ["report_status", "request_approval"]
  },
  "permissions": {
    "inputTrust": "trusted",
    "approvals": {
      "requireFrom": "external_write",
      "approvers": {"roles": ["owner", "super-admin"], "minApprovals": 1},
      "expiresInMs": 86400000,
      "allowSelfApproval": false
    }
  },
  "limits": {
    "cost": {
      "perAttemptMicroUsd": 50000,
      "perTaskMicroUsd": 100000,
      "perDayMicroUsd": 1000000,
      "perMonthMicroUsd": 10000000
    }
  },
  "escalation": [
    {
      "when": {"kind": "approval_waiting", "afterMs": 14400000},
      "then": [{
        "action": "notify",
        "to": {"roles": ["owner", "super-admin"]}
      }]
    }
  ]
}
```

## Defaults by role

The "Create agent" flow in [ui.md](ui.md) starts from one of these. They are
presets of the same schema, not separate types.

| Starting point | Mode | Input trust | Tools | Approvals | Cost preset (per day) |
| --- | --- | --- | --- | --- | --- |
| Dispatcher | continuous | untrusted | read-only | none | low |
| Worker | event | untrusted or trusted, asked | read-only, or reversible writes | none | medium |
| Reviewer | event | trusted | read-only | none | low |
| Executor | event | trusted | one external-write tool | required, two approvers for irreversible | low |
| Monitor | schedule | trusted | queue inspection and notify | none | low |

## Validation

A version cannot be activated until it has passed levels 1 to 3 against the
organization's current state. Level 4 is optional. Validation is a pure function
in `packages/orchestrator` with its ports (tool catalogue, member access,
organization policy) injected, so every rule is unit-testable.

| Level | Checks |
| --- | --- |
| V1 Schema | Shape, types, ranges, and the cross-field rules in the schema (mode versus triggers, cost ordering, delegation versus tools) |
| V2 References | Models are authorized for the owner (as `automations/authority.ts` checks for Automations); every allowed tool exists in the catalogue and is granted to the owner; delegation targets exist, are not retired, and accept the type being produced; every `produces` type has an accepting agent |
| V3 Policy | Effective tier of each tool (declared tier raised to at least the catalogue tier), untrusted input versus external-write, approvers resolve to active members, limits within organization caps, interval above the organization minimum, data classes within what the model provider is cleared for, runner target enabled for the organization |
| V4 Simulation | Optional dry run against scripted mock tools with the headless runner; reports steps, tokens and any denied calls |

Reports contain stable codes so the UI can explain them and tests can assert
them.

| Code | Level | Severity | Meaning |
| --- | --- | --- | --- |
| `schema_invalid` | V1 | error | A field failed its schema |
| `cross_field_invalid` | V1 | error | Fields are individually valid but contradict each other |
| `model_not_authorized` | V2 | error | The owner or organization cannot use this model |
| `tool_not_granted` | V2 | error | The capability is unknown or not granted to the owner |
| `delegate_target_missing` | V2 | error | A delegation target does not exist or is retired |
| `delegate_target_not_accepting` | V2 | error | The target does not accept a type this agent produces |
| `produced_type_unhandled` | V2 | warning | No active agent accepts a type this agent produces |
| `delegation_cycle` | V3 | info | The delegation graph has a cycle; it is bounded by each agent's `maxVisitsPerProcess` |
| `untrusted_with_external_write` | V3 | error | An untrusted-input agent holds a tool the catalogue rates external-write or higher |
| `irreversible_not_enabled` | V3 | error | The agent holds an irreversible tool and the organization has not enabled them |
| `approver_unreachable` | V3 | error | No active member matches the approver roles and ids |
| `limits_exceed_org_cap` | V3 | error | A limit is above the organization's cap |
| `interval_too_short` | V3 | error | Shorter than the organization minimum |
| `data_class_exceeds_provider` | V3 | error | The model's provider is not cleared for the agent's data classes |
| `target_not_available` | V3 | error | The runner target is not enabled for this organization |
| `simulation_failed` | V4 | error | The dry run did not finish cleanly |

## Versioning

```
agent ──< agent_version        (immutable content, one row per saved version)
agent.active_version_id ──> the version attempts use
```

| Version state | Meaning |
| --- | --- |
| `draft` | Editable. One open draft per agent |
| `validated` | Passed V1 to V3. Content is now immutable |
| `active` | The version new attempts use. At most one per agent |
| `superseded` | Was active, replaced |

- Saving a version needs `baseVersion` and a `changeNote` (up to 300
  characters). A stale `baseVersion` returns `409 version_conflict`, so two
  editors cannot overwrite each other.
- Every version stores its normalised config, a **digest** (SHA-256 over the
  canonical form with sorted keys, the approach of `automationRevisionDigest`),
  the validation report, the author, and the time.
- **Activation** re-runs V2 and V3, because tool grants and policies change
  after a version was first validated. It moves `active_version_id` in the same
  transaction that writes the ledger entry.
- **Attempts pin the version they started on.** Changing the active version
  never alters a running attempt. Retries and resumes use the version active
  when they are claimed, and the task timeline shows which version each attempt
  ran. Rolling back is the fast way to stop a bad version affecting retries.
- **Rollback** activates an older validated or superseded version through the
  same path as activation, including re-validation. Content is never edited, so
  history is never rewritten.
- **Audit.** Each create, validate, activate, rollback, start, pause and retire
  writes a ledger entry with the before and after digests and the changed field
  paths. The version rows hold the content, so the ledger stores digests, not
  copies. The UI's "Compare" is a diff of two version rows.
- Organizations can require that the person who activates a version for an agent
  with external-write tools is not the person who last edited it
  (`requireSecondActivator`, see [governance.md](governance.md)).

## Retry and escalation

### Error classes

| Class | Examples | Retried by default |
| --- | --- | --- |
| `transient` | Network reset, timeout | yes |
| `rate_limited` | Provider 429 | yes, honouring `Retry-After` |
| `tool_unavailable` | Connection down, tool 5xx | yes |
| `model_failure` | Provider 5xx, content filter | yes, moving to the next fallback model |
| `malformed_output` | Unparseable or schema-failing output after one repair prompt | no |
| `unknown` | Anything unclassified | no |
| `permanent` | Invalid input, business failure | never |
| `policy` | Permission denied, budget exhausted, loop guard | never |

`permanent` and `policy` are not in `retryOn` on purpose: no configuration can
make the orchestrator retry a denied action.

### Backoff

The delay before attempt `n + 1` is `min(maxMs, initialMs × multiplier^(n − 1))`.
With `jitter: "full"` the wait is a random value between zero and that delay.
Defaults: 5 s initial, 5 min cap, multiplier 2, full jitter, 3 attempts.

### Escalation rules

Each rule has a condition and one to four actions. A rule fires once per
episode and re-arms when its condition clears, so an hour of failures sends one
notification, not sixty.

| Condition | Fires when |
| --- | --- |
| `consecutive_failures` | The agent's last `count` attempts all failed |
| `task_stalled` | A task has made no progress for `afterMs` |
| `budget_used` | Spend reaches `percent` of any cost limit |
| `approval_waiting` | An approval has been pending for `afterMs` |
| `dead_lettered` | A task is dead-lettered |

| Action | Effect |
| --- | --- |
| `notify` | In-app notification to the roles and members named; shown in the notification centre |
| `require_human` | An attention item that must be resolved; the task waits for an answer |
| `reassign` | Queued tasks for this agent move to another agent that accepts the type |
| `pause_agent` | Sets the desired state to paused |

## Schema evolution

`schemaVersion` is part of every stored version. A new schema version ships with
a pure upgrade function from the previous one. Activation always runs the
current validator on the upgraded form, and old versions stay readable because
their original JSON is kept beside the upgraded view.
