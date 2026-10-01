declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: {
  (value: unknown): {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    toContainEqual: (expected: unknown) => void;
    toMatchObject: (expected: Record<string, unknown>) => void;
    toHaveLength: (expected: number) => void;
  };
  objectContaining: (value: Record<string, unknown>) => unknown;
};

import {
  activeRelationships,
  changeManager,
  createSampleHierarchy,
  directReports,
  getRelationship,
  listExceptions,
  managerChain,
  retireAgent,
  spanOfControl,
  validateChangeManager,
  validateRelationship,
  type Hierarchy,
  type HierarchyAgent,
  type Relationship,
} from "./hierarchy-rules";

const ids = {
  coordinator: "coordinator",
  digest: "digest",
  intake: "intake",
  research: "research",
  reviewer: "reviewer",
  sender: "sender",
  drafter: "drafter",
} as const;

function addAgent(hierarchy: Hierarchy, id: string, state: HierarchyAgent["state"] = "running"): Hierarchy {
  return { ...hierarchy, agents: [...hierarchy.agents, { id, nameKey: id, state }] };
}

function addRelationship(
  hierarchy: Hierarchy,
  managerId: string,
  agentId: string,
  levels = { control: 2, reliance: 2, escalation: 3 },
  status: Relationship["status"] = "active",
): Hierarchy {
  return {
    ...hierarchy,
    relationships: [...hierarchy.relationships, {
      id: `test-${hierarchy.relationships.length}`,
      managerId,
      agentId,
      ...levels,
      status,
    }],
  };
}

const input = (agentId: string, managerId: string, levels = { control: 2, reliance: 2, escalation: 3 }) => ({
  agentId,
  managerId,
  ...levels,
});

describe("hierarchy sample and calculated spans", () => {
  test("ships the requested sample spans and level values", () => {
    const hierarchy = createSampleHierarchy();

    expect(spanOfControl(hierarchy, ids.coordinator)).toBe(5);
    expect(spanOfControl(hierarchy, ids.reviewer)).toBe(1);
    for (const id of [ids.digest, ids.intake, ids.research, ids.sender, ids.drafter]) {
      expect(spanOfControl(hierarchy, id)).toBe(0);
    }
    expect(getRelationship(hierarchy, ids.research)).toMatchObject({ control: 3, reliance: 3, escalation: 4 });
    expect(getRelationship(hierarchy, ids.digest)).toMatchObject({ control: 1, reliance: 1, escalation: 5 });
    expect(hierarchy.spanLimit).toBe(7);
  });

  test("counts direct reports only, includes paused, and excludes draft, retired and ended reports", () => {
    let hierarchy = createSampleHierarchy();
    hierarchy = { ...hierarchy, agents: hierarchy.agents.map((agent) => agent.id === ids.digest ? { ...agent, state: "paused" as const } : agent) };
    hierarchy = addAgent(hierarchy, "draft-report", "draft");
    hierarchy = addRelationship(hierarchy, ids.coordinator, "draft-report");
    hierarchy = addAgent(hierarchy, "retired-report", "retired");
    hierarchy = addRelationship(hierarchy, ids.coordinator, "retired-report");
    hierarchy = addAgent(hierarchy, "indirect-report");
    hierarchy = addRelationship(hierarchy, ids.reviewer, "indirect-report");
    hierarchy = addAgent(hierarchy, "former-report");
    hierarchy = addRelationship(hierarchy, ids.coordinator, "former-report", undefined, "ended");

    expect(spanOfControl(hierarchy, ids.coordinator)).toBe(5);
    expect(spanOfControl(hierarchy, ids.reviewer)).toBe(2);
    expect(directReports(hierarchy, ids.coordinator).map((agent) => agent.id)).toContain(ids.digest);
    expect(directReports(hierarchy, ids.coordinator).map((agent) => agent.id)).not.toContain("draft-report");
    expect(directReports(hierarchy, ids.coordinator).map((agent) => agent.id)).not.toContain("retired-report");
  });

  test("preserves ended relationships when a report changes manager", () => {
    const original = createSampleHierarchy();
    const result = changeManager(original, input(ids.drafter, ids.coordinator));

    expect(result.changed).toBe(true);
    expect(result.hierarchy.relationships).toHaveLength(original.relationships.length + 1);
    expect(result.hierarchy.relationships.at(-2)).toMatchObject({ agentId: ids.drafter, managerId: ids.reviewer, status: "ended" });
    expect(result.hierarchy.relationships.at(-1)).toMatchObject({ agentId: ids.drafter, managerId: ids.coordinator, status: "active" });
    expect(activeRelationships(result.hierarchy)).toHaveLength(activeRelationships(original).length);
    expect(spanOfControl(result.hierarchy, ids.reviewer)).toBe(0);
    expect(spanOfControl(result.hierarchy, ids.coordinator)).toBe(6);
  });
});

describe("hierarchy validation", () => {
  test("refuses self-reporting, duplicate relationships, a second manager and a manager for the top agent", () => {
    const hierarchy = createSampleHierarchy();

    expect(validateRelationship(hierarchy, input(ids.reviewer, ids.reviewer)).map((issue) => issue.code)).toContain("self_report");
    expect(validateRelationship(hierarchy, input(ids.reviewer, ids.coordinator)).map((issue) => issue.code)).toContain("duplicate");
    expect(validateRelationship(hierarchy, input(ids.research, ids.reviewer)).map((issue) => issue.code)).toContain("second_manager");
    const withNewAgent = addAgent(hierarchy, "outside");
    expect(validateRelationship(withNewAgent, input(ids.coordinator, "outside")).map((issue) => issue.code)).toContain("top_manager");
    expect(validateChangeManager(hierarchy, input(ids.drafter, ids.reviewer)).map((issue) => issue.code)).toContain("duplicate");
  });

  test("detects and reports two-agent and three-agent loops with the complete path", () => {
    const two = createSampleHierarchy();
    const twoIssue = validateChangeManager(two, input(ids.coordinator, ids.reviewer)).find((issue) => issue.code === "loop");
    expect(twoIssue?.params.path).toEqual([ids.coordinator, ids.reviewer, ids.coordinator]);

    let three = createSampleHierarchy();
    three = addAgent(three, "ops", "running");
    three = addAgent(three, "leaf", "running");
    three = addRelationship(three, ids.reviewer, "ops");
    three = addRelationship(three, "ops", "leaf");
    const threeIssue = validateChangeManager(three, input(ids.coordinator, "leaf")).find((issue) => issue.code === "loop");
    expect(threeIssue?.params.path).toEqual([ids.coordinator, ids.reviewer, "ops", "leaf", ids.coordinator]);
  });

  test("rejects retired agents and managers and levels outside integer levels one through five", () => {
    let hierarchy = createSampleHierarchy();
    hierarchy = addAgent(hierarchy, "retired-agent", "retired");
    hierarchy = addAgent(hierarchy, "retired-manager", "retired");
    hierarchy = addAgent(hierarchy, "unassigned-agent");
    const levels = { control: 0, reliance: 6, escalation: 2.5 };

    const issueCodes = validateRelationship(hierarchy, input("retired-agent", ids.coordinator)).map((issue) => issue.code);
    expect(issueCodes).toContain("retired");
    expect(validateRelationship(hierarchy, input("unassigned-agent", "retired-manager")).map((issue) => issue.code)).toContain("retired");
    expect(validateChangeManager(hierarchy, input(ids.drafter, ids.coordinator, levels)).map((issue) => issue.code)).toContain("invalid_level");
  });

  test("warns rather than blocking when the new span exceeds the limit", () => {
    let hierarchy = createSampleHierarchy();
    hierarchy = addAgent(hierarchy, "extra-one");
    hierarchy = addAgent(hierarchy, "extra-two");
    hierarchy = addAgent(hierarchy, "extra-three");
    hierarchy = addRelationship(hierarchy, ids.coordinator, "extra-one");
    hierarchy = addRelationship(hierarchy, ids.coordinator, "extra-two");

    const issues = validateRelationship(hierarchy, input("extra-three", ids.coordinator));

    expect(issues).toContainEqual({
      severity: "warning",
      code: "over_limit",
      agentId: "extra-three",
      params: { managerId: ids.coordinator, count: 8, limit: 7 },
    });
    expect(changeManager(hierarchy, input("extra-three", ids.coordinator)).changed).toBe(true);
  });

  test("warns live when the proposed manager is paused and the agent relies on it at Moderate or above", () => {
    const hierarchy = createSampleHierarchy();
    hierarchy.agents.find((agent) => agent.id === ids.reviewer)!.state = "paused";

    const issues = validateChangeManager(hierarchy, input(ids.research, ids.reviewer, {
      control: 3,
      reliance: 3,
      escalation: 4,
    }));

    expect(issues).toContainEqual({
      severity: "warning",
      code: "paused_manager",
      agentId: ids.research,
      params: { managerId: ids.reviewer, reliance: 3 },
    });
    expect(issues.some((item) => item.severity === "refusal")).toBe(false);
  });

  test("includes draft agents in paused-manager dependency warnings", () => {
    const hierarchy = createSampleHierarchy();
    hierarchy.agents.find((agent) => agent.id === ids.reviewer)!.state = "paused";
    hierarchy.agents.find((agent) => agent.id === ids.drafter)!.state = "draft";

    expect(listExceptions(hierarchy)).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "paused_manager",
      agentId: ids.drafter,
    }));
  });

  test("recalculates old and new spans together when changing a manager", () => {
    const hierarchy = createSampleHierarchy();
    const result = changeManager(hierarchy, input(ids.drafter, ids.coordinator, { control: 1, reliance: 4, escalation: 2 }));

    expect(result.changed).toBe(true);
    expect(spanOfControl(result.hierarchy, ids.reviewer)).toBe(0);
    expect(spanOfControl(result.hierarchy, ids.coordinator)).toBe(6);
    expect(getRelationship(result.hierarchy, ids.drafter)).toMatchObject({ control: 1, reliance: 4, escalation: 2 });
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "info", code: "level_gap" }));
  });

  test("refuses to retire a manager that still supervises reports", () => {
    const result = retireAgent(createSampleHierarchy(), ids.reviewer);

    expect(result.changed).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "refusal",
      code: "manager_has_reports",
      agentId: ids.reviewer,
      params: { managerId: ids.reviewer, count: 1 },
    });
    expect(result.hierarchy).toEqual(createSampleHierarchy());
  });

  test("lists managerless agents and agents relying on a paused manager", () => {
    let hierarchy = createSampleHierarchy();
    hierarchy = addAgent(hierarchy, "orphan");
    hierarchy = {
      ...hierarchy,
      agents: hierarchy.agents.map((agent) => agent.id === ids.reviewer ? { ...agent, state: "paused" as const } : agent),
    };

    const issues = listExceptions(hierarchy);

    expect(issues).toContainEqual(expect.objectContaining({ severity: "warning", code: "without_manager", agentId: "orphan" }));
    expect(issues).toContainEqual(expect.objectContaining({ severity: "warning", code: "paused_manager", agentId: ids.drafter }));
  });
});