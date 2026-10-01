declare const afterEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toHaveLength: (expected: number) => void;
};

import { orchestratorPreview, type AgentId } from "./orchestrator-preview";

function isAgentId(id: string): id is AgentId {
  return id === "coordinator"
    || id === "intake"
    || id === "research"
    || id === "drafter"
    || id === "reviewer"
    || id === "sender"
    || id === "digest";
}

afterEach(() => {
  for (const agent of orchestratorPreview.getSnapshot().hierarchy.agents) {
    if (agent.state === "paused" && isAgentId(agent.id)) {
      orchestratorPreview.setAgentState(agent.id, "running");
    }
  }
});

describe("shared Orchestrator hierarchy sample", () => {
  test("keeps agent run state and hierarchy state in sync, counting paused agents in the tree model", () => {
    orchestratorPreview.setAgentState("research", "paused");

    const snapshot = orchestratorPreview.getSnapshot();
    expect(snapshot.agents.research).toBe("paused");
    expect(snapshot.hierarchy.agents.find((agent) => agent.id === "research")?.state).toBe("paused");
  });

  test("undo restores the manager relationship without clobbering intervening agent state", () => {
    const before = orchestratorPreview.getSnapshot();
    const result = orchestratorPreview.changeManager({
      agentId: "drafter",
      managerId: "coordinator",
      control: 2,
      reliance: 2,
      escalation: 3,
    });
    expect(result.changed).toBe(true);
    expect(orchestratorPreview.getSnapshot().hierarchy.relationships.filter((relation) =>
      relation.status === "active" && relation.agentId === "drafter",
    )).toHaveLength(1);
    expect(orchestratorPreview.getSnapshot().hierarchy.relationships.find((relation) =>
      relation.status === "active" && relation.agentId === "drafter",
    )?.managerId).toBe("coordinator");

    orchestratorPreview.setAgentState("drafter", "paused");
    result.undo();

    const after = orchestratorPreview.getSnapshot();
    expect(after.hierarchy.relationships).toHaveLength(before.hierarchy.relationships.length + 1);
    expect(after.hierarchy.relationships.filter((relation) =>
      relation.status === "active" && relation.agentId === "drafter",
    )).toHaveLength(1);
    expect(after.hierarchy.relationships.find((relation) =>
      relation.status === "active" && relation.agentId === "drafter",
    )?.managerId).toBe("reviewer");
    expect(after.hierarchy.relationships.at(-1)?.status).toBe("ended");
    expect(after.hierarchy.agents.find((agent) => agent.id === "drafter")?.state).toBe("paused");
    expect(after.agents.drafter).toBe("paused");
  });

  test("refuses an undo that would create a reporting loop after another hierarchy edit", () => {
    const firstChange = orchestratorPreview.changeManager({
      agentId: "drafter",
      managerId: "coordinator",
      control: 2,
      reliance: 2,
      escalation: 3,
    });
    const secondChange = orchestratorPreview.changeManager({
      agentId: "reviewer",
      managerId: "drafter",
      control: 2,
      reliance: 2,
      escalation: 3,
    });

    const beforeFailedUndo = orchestratorPreview.getSnapshot().hierarchy.relationships;
    const refusal = firstChange.undo();
    expect(refusal.undone).toBe(false);
    expect(refusal.issues[0]?.code).toBe("loop");
    expect(orchestratorPreview.getSnapshot().hierarchy.relationships).toBe(beforeFailedUndo);

    // Restore the second edit first, then the first undo can be retried safely.
    expect(secondChange.undo().undone).toBe(true);
    expect(firstChange.undo().undone).toBe(true);
  });
});