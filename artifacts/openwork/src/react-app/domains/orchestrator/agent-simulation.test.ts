import { expect, test } from "bun:test";
import { emptyAgentDraft, type AgentDraft, type DraftContext } from "./agent-draft";
import { simulateAgentDraft } from "./agent-simulation";
import { SAMPLE_POLICY } from "./agent-samples";

const context: DraftContext = { agents: [{ id: "manager", name: "Manager", slug: "manager", active: true }] };
const example = "Where is the handbook?";
function draft(patch: Partial<AgentDraft> = {}): AgentDraft {
  return { ...emptyAgentDraft(), name: "Support", instructions: "Check the handbook.", reportsTo: "manager", dailyCostLimit: "1",
    requests: [{ id: "question", name: "Answer a question", description: "Draft an answer.", examples: [example] }], ...patch };
}
test("simulation is deterministic and leaves draft and context unchanged", () => {
  const current = draft({ capabilityIds: ["web", "knowledge", "inbox", "draft"] });
  const before = JSON.stringify({ current, context });
  const first = simulateAgentDraft(current, context, example);
  expect(first).toEqual(simulateAgentDraft(current, context, example));
  expect(first.status).toBe("complete");
  expect(first.steps.filter(step => step.kind === "capability").map(step => step.capabilityId)).toEqual(["inbox", "knowledge", "draft", "web"]);
  expect(JSON.stringify({ current, context })).toBe(before);
});
test("simulation uses current instructions, enabled skills and selected memory", () => {
  const result = simulateAgentDraft(draft({
    instructions: "Changed instructions", memoryIds: ["handbook"],
    skills: [{ id: "triage", version: "1.2", enabled: true }, { id: "review", version: "1.0", enabled: false }],
  }), context, example);
  expect(result.steps[0]?.params.count).toBe("Changed instructions".length);
  expect(result.steps.filter(step => step.kind === "skill").map(step => step.params.skill)).toEqual(["triage"]);
  expect(result.steps.filter(step => step.kind === "memory").map(step => step.params.namespace)).toEqual(["handbook"]);
});
test("simulation stops before sending outside and omits later capabilities", () => {
  const result = simulateAgentDraft(draft({ capabilityIds: ["reply", "inbox", "web"], approverIds: ["alex"] }), context, example);
  expect(result.status).toBe("approval");
  expect(result.steps.filter(step => step.kind === "capability").map(step => step.capabilityId)).toEqual(["inbox"]);
  expect(result.steps.at(-1)).toEqual({
    kind: "approval", labelKey: "orchestrator.builder.sim_approval", params: { count: 1 }, capabilityId: "reply",
  });
});
test("simulation stops before an irreversible capability", () => {
  const result = simulateAgentDraft(draft({ capabilityIds: ["delete"], approverIds: ["alex", "sam"] }), context, example,
    { ...SAMPLE_POLICY, allowIrreversibleActions: true });
  expect(result.status).toBe("approval");
  expect(result.steps.at(-1)?.capabilityId).toBe("delete");
});

for (const scenario of [
  { allowIrreversibleActions: false, approverIds: [], code: "irreversible_policy" },
  { allowIrreversibleActions: false, approverIds: ["alex", "sam"], code: "irreversible_policy" },
  { allowIrreversibleActions: true, approverIds: [], code: "irreversible_approvers" },
  { allowIrreversibleActions: true, approverIds: ["alex"], code: "irreversible_approvers" },
]) {
  test(`deletion simulation is blocked with policy ${scenario.allowIrreversibleActions} and ${scenario.approverIds.length} approvers`, () => {
    const current = draft({ capabilityIds: ["inbox", "delete"], approverIds: scenario.approverIds });
    const before = JSON.stringify(current);
    const result = simulateAgentDraft(current, context, example, { allowIrreversibleActions: scenario.allowIrreversibleActions });
    expect(result.status).toBe("blocked");
    expect(result.steps).toEqual([]);
    expect(result.issues.map(issue => issue.code)).toEqual([scenario.code]);
    expect(JSON.stringify(current)).toBe(before);
  });
}
test("outsider readers remain blocked even when deletion is allowed with two approvers", () => {
  const result = simulateAgentDraft(draft({
    readsOutsiders: true, capabilityIds: ["delete"], approverIds: ["alex", "sam"],
  }), context, example, { allowIrreversibleActions: true });
  expect(result.status).toBe("blocked");
  expect(result.steps).toEqual([]);
  expect(result.issues.map(issue => issue.code)).toEqual(["outsiders"]);
});
test("invalid drafts are blocked without simulated steps", () => {
  const result = simulateAgentDraft(draft({ name: "", readsOutsiders: true, capabilityIds: ["reply"] }), context, example);
  expect(result.status).toBe("blocked");
  expect(result.steps).toEqual([]);
  expect(result.issues.some(issue => issue.severity === "error")).toBe(true);
});
test("unknown sample requests cannot be simulated", () => {
  expect(simulateAgentDraft(draft(), context, "Invented request").status).toBe("blocked");
});
test("warnings do not block a valid simulation", () => {
  const result = simulateAgentDraft(draft({ reportsTo: "" }), context, example);
  expect(result.status).toBe("complete");
  expect(result.issues[0]?.severity).toBe("warning");
});
test("disabled capabilities never appear in the walk-through", () => {
  expect(simulateAgentDraft(draft(), context, example).steps.some(step => step.kind === "capability")).toBe(false);
});