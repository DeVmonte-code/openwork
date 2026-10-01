export type HierarchyAgentState = "running" | "paused" | "stopped" | "draft" | "retired";

export type HierarchyAgent = {
  id: string;
  nameKey: string;
  state: HierarchyAgentState;
};

export type Relationship = {
  id: string;
  managerId: string;
  agentId: string;
  control: number;
  reliance: number;
  escalation: number;
  status: "active" | "ended";
};

export type Hierarchy = {
  topId: string;
  spanLimit: number;
  agents: HierarchyAgent[];
  relationships: Relationship[];
};

export type ChangeManagerInput = {
  agentId: string;
  managerId: string;
  control: number;
  reliance: number;
  escalation: number;
};

export type HierarchyIssue = {
  severity: "refusal" | "warning" | "info";
  code: string;
  agentId: string;
  params: Record<string, string | number | string[]>;
};

const SAMPLE_RELATIONSHIPS: Array<Omit<Relationship, "id" | "status">> = [
  { managerId: "coordinator", agentId: "digest", control: 1, reliance: 1, escalation: 5 },
  { managerId: "coordinator", agentId: "intake", control: 2, reliance: 1, escalation: 5 },
  { managerId: "coordinator", agentId: "research", control: 3, reliance: 3, escalation: 4 },
  { managerId: "coordinator", agentId: "reviewer", control: 4, reliance: 3, escalation: 3 },
  { managerId: "coordinator", agentId: "sender", control: 4, reliance: 4, escalation: 2 },
  { managerId: "reviewer", agentId: "drafter", control: 4, reliance: 4, escalation: 3 },
];

export function createSampleHierarchy(): Hierarchy {
  return {
    topId: "coordinator",
    spanLimit: 7,
    agents: [
      { id: "coordinator", nameKey: "orchestrator.agent_coordinator", state: "running" },
      { id: "digest", nameKey: "orchestrator.agent_digest", state: "running" },
      { id: "intake", nameKey: "orchestrator.agent_intake", state: "running" },
      { id: "research", nameKey: "orchestrator.agent_research", state: "running" },
      { id: "reviewer", nameKey: "orchestrator.agent_reviewer", state: "running" },
      { id: "sender", nameKey: "orchestrator.agent_sender", state: "running" },
      { id: "drafter", nameKey: "orchestrator.agent_drafter", state: "running" },
    ],
    relationships: SAMPLE_RELATIONSHIPS.map((relationship, index) => ({
      ...relationship,
      id: `relationship-${index + 1}`,
      status: "active",
    })),
  };
}

export function activeRelationships(hierarchy: Hierarchy): Relationship[] {
  return hierarchy.relationships.filter((relationship) => relationship.status === "active");
}

const findAgent = (hierarchy: Hierarchy, agentId: string) =>
  hierarchy.agents.find((agent) => agent.id === agentId);

function hasLiveSpanState(agent: HierarchyAgent | undefined): boolean {
  return agent !== undefined && agent.state !== "draft" && agent.state !== "retired";
}

export function directReports(hierarchy: Hierarchy, managerId: string): HierarchyAgent[] {
  const reportingIds = new Set(
    activeRelationships(hierarchy)
      .filter((relationship) => relationship.managerId === managerId)
      .map((relationship) => relationship.agentId),
  );
  return hierarchy.agents.filter((agent) => reportingIds.has(agent.id) && hasLiveSpanState(agent));
}

export function spanOfControl(hierarchy: Hierarchy, managerId: string): number {
  return directReports(hierarchy, managerId).length;
}

export function getRelationship(hierarchy: Hierarchy, agentId: string): Relationship | undefined {
  return activeRelationships(hierarchy).find((relationship) => relationship.agentId === agentId);
}

export function managerOf(hierarchy: Hierarchy, agentId: string): HierarchyAgent | undefined {
  const relationship = getRelationship(hierarchy, agentId);
  return relationship ? findAgent(hierarchy, relationship.managerId) : undefined;
}

export function managerChain(hierarchy: Hierarchy, agentId: string): HierarchyAgent[] {
  const chain: HierarchyAgent[] = [];
  const visited = new Set([agentId]);
  let currentId = agentId;

  while (true) {
    const manager = managerOf(hierarchy, currentId);
    if (!manager || visited.has(manager.id)) return chain;
    chain.push(manager);
    visited.add(manager.id);
    currentId = manager.id;
  }
}

function issue(
  severity: HierarchyIssue["severity"],
  code: string,
  agentId: string,
  params: HierarchyIssue["params"] = {},
): HierarchyIssue {
  return { severity, code, agentId, params };
}

function pathToDescendant(
  hierarchy: Hierarchy,
  startId: string,
  targetId: string,
  ignoredRelationshipId?: string,
): string[] | undefined {
  const children = new Map<string, string[]>();
  for (const relationship of activeRelationships(hierarchy)) {
    if (relationship.id === ignoredRelationshipId) continue;
    const list = children.get(relationship.managerId) ?? [];
    list.push(relationship.agentId);
    children.set(relationship.managerId, list);
  }

  const visit = (currentId: string, path: string[], visited: Set<string>): string[] | undefined => {
    if (currentId === targetId) return path;
    for (const childId of children.get(currentId) ?? []) {
      if (visited.has(childId)) continue;
      const result = visit(childId, [...path, childId], new Set(visited).add(childId));
      if (result) return result;
    }
    return undefined;
  };

  return visit(startId, [startId], new Set([startId]));
}

function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= 5;
}

function invalidLevelIssues(input: ChangeManagerInput): HierarchyIssue[] {
  const levels: Array<[keyof Pick<ChangeManagerInput, "control" | "reliance" | "escalation">, number]> = [
    ["control", input.control],
    ["reliance", input.reliance],
    ["escalation", input.escalation],
  ];
  return levels
    .filter(([, value]) => !isValidLevel(value))
    .map(([field, value]) => issue("refusal", "invalid_level", input.agentId, { field, level: value }));
}

function candidateRelationship(hierarchy: Hierarchy, input: ChangeManagerInput): Relationship {
  let number = hierarchy.relationships.length + 1;
  const existingIds = new Set(hierarchy.relationships.map((relationship) => relationship.id));
  while (existingIds.has(`relationship-${number}`)) number++;
  return {
    ...input,
    id: `relationship-${number}`,
    status: "active",
  };
}

function changeValidation(
  hierarchy: Hierarchy,
  input: ChangeManagerInput,
  ignoredRelationshipId?: string,
): HierarchyIssue[] {
  const agent = findAgent(hierarchy, input.agentId);
  const manager = findAgent(hierarchy, input.managerId);
  const issues: HierarchyIssue[] = [];

  if (!agent) issues.push(issue("refusal", "unknown_agent", input.agentId, { unknownId: input.agentId }));
  if (!manager) issues.push(issue("refusal", "unknown_agent", input.agentId, { unknownId: input.managerId }));
  if (!agent || !manager) return issues;

  if (input.agentId === input.managerId) {
    issues.push(issue("refusal", "self_report", input.agentId, { managerId: input.managerId }));
    return issues;
  }

  const path = pathToDescendant(hierarchy, input.agentId, input.managerId, ignoredRelationshipId);
  if (path) {
    issues.push(issue("refusal", "loop", input.agentId, { path: [...path, input.agentId] }));
    return issues;
  }

  if (input.agentId === hierarchy.topId) {
    issues.push(issue("refusal", "top_manager", input.agentId, { managerId: input.managerId }));
  }
  if (agent.state === "retired" || manager.state === "retired") {
    issues.push(issue("refusal", "retired", input.agentId, {
      retiredIds: [agent.state === "retired" ? agent.id : "", manager.state === "retired" ? manager.id : ""].filter(Boolean),
    }));
  }
  issues.push(...invalidLevelIssues(input));
  if (issues.some((item) => item.severity === "refusal")) return issues;

  const candidate = candidateRelationship(hierarchy, input);
  const withCandidate = {
    ...hierarchy,
    relationships: [...hierarchy.relationships, candidate],
  };
  const nextSpan = spanOfControl(withCandidate, input.managerId);
  if (nextSpan > hierarchy.spanLimit) {
    issues.push(issue("warning", "over_limit", input.agentId, {
      managerId: input.managerId,
      count: nextSpan,
      limit: hierarchy.spanLimit,
    }));
  }
  if (manager.state === "paused" && agent.state !== "retired" && input.reliance >= 3) {
    issues.push(issue("warning", "paused_manager", input.agentId, {
      managerId: manager.id,
      reliance: input.reliance,
    }));
  }
  if (Math.abs(input.control - input.reliance) >= 3) {
    issues.push(issue("info", "level_gap", input.agentId, {
      managerId: input.managerId,
      control: input.control,
      reliance: input.reliance,
    }));
  }
  return issues;
}

export function validateRelationship(hierarchy: Hierarchy, input: ChangeManagerInput): HierarchyIssue[] {
  if (input.agentId === input.managerId) {
    return [issue("refusal", "self_report", input.agentId, { managerId: input.managerId })];
  }

  const duplicate = activeRelationships(hierarchy).some(
    (relationship) => relationship.agentId === input.agentId && relationship.managerId === input.managerId,
  );
  if (duplicate) return [issue("refusal", "duplicate", input.agentId, { managerId: input.managerId })];

  if (getRelationship(hierarchy, input.agentId)) {
    return [issue("refusal", "second_manager", input.agentId, { managerId: input.managerId })];
  }
  return changeValidation(hierarchy, input);
}

export function validateChangeManager(hierarchy: Hierarchy, input: ChangeManagerInput): HierarchyIssue[] {
  const existing = getRelationship(hierarchy, input.agentId);
  if (existing?.managerId === input.managerId) {
    return [issue("refusal", "duplicate", input.agentId, { managerId: input.managerId })];
  }

  const withoutExisting = existing
    ? {
        ...hierarchy,
        relationships: hierarchy.relationships.map((relationship) =>
          relationship.id === existing.id ? { ...relationship, status: "ended" as const } : relationship,
        ),
      }
    : hierarchy;
  return changeValidation(withoutExisting, input, existing?.id);
}

export function changeManager(
  hierarchy: Hierarchy,
  input: ChangeManagerInput,
): { hierarchy: Hierarchy; issues: HierarchyIssue[]; changed: boolean } {
  const issues = validateChangeManager(hierarchy, input);
  if (issues.some((item) => item.severity === "refusal")) {
    return { hierarchy, issues, changed: false };
  }

  const existing = getRelationship(hierarchy, input.agentId);
  const endedRelationships = existing
    ? hierarchy.relationships.map((relationship) =>
        relationship.id === existing.id ? { ...relationship, status: "ended" as const } : relationship,
      )
    : hierarchy.relationships;
  return {
    hierarchy: {
      ...hierarchy,
      relationships: [...endedRelationships, candidateRelationship(hierarchy, input)],
    },
    issues,
    changed: true,
  };
}

export function retireAgent(
  hierarchy: Hierarchy,
  agentId: string,
): { hierarchy: Hierarchy; issues: HierarchyIssue[]; changed: boolean } {
  const agent = findAgent(hierarchy, agentId);
  if (!agent) {
    return {
      hierarchy,
      issues: [issue("refusal", "unknown_agent", agentId, { unknownId: agentId })],
      changed: false,
    };
  }
  if (agent.state === "retired") {
    return { hierarchy, issues: [issue("refusal", "retired", agentId, { retiredIds: [agentId] })], changed: false };
  }

  const reportCount = activeRelationships(hierarchy).filter((relationship) => {
    const report = findAgent(hierarchy, relationship.agentId);
    return relationship.managerId === agentId && report?.state !== "retired";
  }).length;
  if (reportCount > 0) {
    return {
      hierarchy,
      issues: [issue("refusal", "manager_has_reports", agentId, { managerId: agentId, count: reportCount })],
      changed: false,
    };
  }

  return {
    hierarchy: {
      ...hierarchy,
      agents: hierarchy.agents.map((item) => item.id === agentId ? { ...item, state: "retired" } : item),
      relationships: hierarchy.relationships.map((relationship) =>
        relationship.status === "active" && relationship.agentId === agentId
          ? { ...relationship, status: "ended" }
          : relationship,
      ),
    },
    issues: [],
    changed: true,
  };
}

export function listExceptions(hierarchy: Hierarchy): HierarchyIssue[] {
  const issues: HierarchyIssue[] = [];
  for (const agent of hierarchy.agents) {
    if (agent.id === hierarchy.topId || agent.state === "draft" || agent.state === "retired") continue;
    if (!getRelationship(hierarchy, agent.id)) {
      issues.push(issue("warning", "without_manager", agent.id));
    }
  }

  for (const relationship of activeRelationships(hierarchy)) {
    const agent = findAgent(hierarchy, relationship.agentId);
    const manager = findAgent(hierarchy, relationship.managerId);
    if (!agent || !manager || agent.state === "retired") continue;
    if (manager.state === "paused" && relationship.reliance >= 3) {
      issues.push(issue("warning", "paused_manager", agent.id, {
        managerId: manager.id,
        reliance: relationship.reliance,
      }));
    }
    if (Math.abs(relationship.control - relationship.reliance) >= 3) {
      issues.push(issue("info", "level_gap", agent.id, {
        managerId: manager.id,
        control: relationship.control,
        reliance: relationship.reliance,
      }));
    }
  }

  for (const manager of hierarchy.agents) {
    if (manager.state === "retired") continue;
    const count = spanOfControl(hierarchy, manager.id);
    if (count > hierarchy.spanLimit) {
      issues.push(issue("warning", "over_limit", manager.id, {
        managerId: manager.id,
        count,
        limit: hierarchy.spanLimit,
      }));
    }
  }
  // Stable sorting keeps source order within each warning category.
  const priority = (item: HierarchyIssue): number => {
    if (item.severity === "refusal") return 0;
    if (item.severity === "info") return 5;
    switch (item.code) {
      case "without_manager": return 1;
      case "paused_manager": return 2;
      case "over_limit": return 3;
      default: return 4;
    }
  };
  return issues.sort((left, right) => priority(left) - priority(right));
}