import { describe, expect, test } from "bun:test";
import { agentSlug, emptyAgentDraft, type AgentDraft, type DraftContext, type DraftRequest } from "./agent-draft";
import { addDraftRequest, attachDraftSkill, checkAgentDraft, draftIsValid } from "./agent-rules";
import { SAMPLE_POLICY } from "./agent-samples";

const context: DraftContext = { agents: [
  { id: "sender", name: "Sender", slug: "sender", active: true },
  { id: "retired", name: "Retired agent", slug: "retired-agent", active: false },
] };
const request: DraftRequest = { id: "answer", name: "Answer a question", description: "Draft an answer.", examples: ["Where is the handbook?"] };
function valid(patch: Partial<AgentDraft> = {}): AgentDraft {
  return { ...emptyAgentDraft(), name: "Support assistant", instructions: "Check the handbook.", dailyCostLimit: "2", reportsTo: "sender", ...patch };
}
const codes = (draft: AgentDraft) => checkAgentDraft(draft, context).map(issue => issue.code);

describe("agent draft rules", () => {
  test("starts with an empty cost limit and all required checks", () => {
    const draft = emptyAgentDraft();
    expect(draft.dailyCostLimit).toBe("");
    expect(codes(draft)).toEqual(["name", "instructions", "cost", "no_manager"]);
  });
  test("accepts a valid private draft without description or requests", () => {
    expect(draftIsValid(valid(), context)).toBe(true);
  });
  for (const field of ["name", "instructions", "dailyCostLimit"]) {
    test(`rejects whitespace-only ${field}`, () => {
      expect(draftIsValid(valid({ [field]: "   " }), context)).toBe(false);
    });
  }
  test("accepts 80 name characters and refuses 81", () => {
    expect(draftIsValid(valid({ name: "a".repeat(80) }), context)).toBe(true);
    expect(codes(valid({ name: "a".repeat(81) }))).toContain("name_length");
  });
  test("derives a stable slug and detects normalized collisions", () => {
    expect(agentSlug("  Séndér  ")).toBe("sender");
    expect(codes(valid({ name: " Séndér " }))).toContain("slug_unique");
  });
  test("refuses an empty derived slug", () => {
    expect(codes(valid({ name: "!!!" }))).toContain("slug_empty");
  });
  test("accepts 32000 instruction characters and refuses 32001", () => {
    expect(draftIsValid(valid({ instructions: "a".repeat(32000) }), context)).toBe(true);
    expect(codes(valid({ instructions: "a".repeat(32001) }))).toContain("instructions_length");
  });
  for (const cost of ["-1", "NaN", "Infinity", "money"]) {
    test(`refuses invalid cost ${cost}`, () => {
      expect(codes(valid({ dailyCostLimit: cost }))).toContain("cost_value");
    });
  }
  test("accepts an explicit zero cost limit", () => {
    expect(draftIsValid(valid({ dailyCostLimit: "0" }), context)).toBe(true);
  });
  for (const visibility of ["members", "organization"]) {
    test(`${visibility} requires a description and request`, () => {
      // Test typed draft values without assertions or casts.
      const draft = valid();
      if (visibility === "members") draft.visibility = "members";
      else draft.visibility = "organization";
      expect(codes(draft)).toEqual(["description", "request_required"]);
      draft.description = "Answers handbook questions.";
      draft.requests = [request];
      expect(draftIsValid(draft, context)).toBe(true);
    });
  }
  test("refuses duplicate skills even when one is off", () => {
    expect(codes(valid({ skills: [{ id: "triage", version: "1.2", enabled: true }, { id: "triage", version: "1.2", enabled: false }] }))).toContain("skill_duplicate");
  });
  test("requires a known pinned skill version", () => {
    expect(codes(valid({ skills: [{ id: "triage", version: "999", enabled: true }] }))).toContain("skill_unknown");
  });
  test("refuses duplicate requests by name or id", () => {
    expect(codes(valid({ requests: [request, { ...request, id: "another", name: " ANSWER A QUESTION " }] }))).toContain("request_duplicate");
    expect(codes(valid({ requests: [request, { ...request, name: "Another name" }] }))).toContain("request_duplicate");
  });
  test("limits requests to five", () => {
    const requests = Array.from({ length: 5 }, (_, index) => ({ ...request, id: String(index), name: `Request ${index}` }));
    expect(draftIsValid(valid({ requests }), context)).toBe(true);
    expect(codes(valid({ requests: [...requests, { ...request, id: "six", name: "Sixth" }] }))).toContain("request_limit");
  });
  test("requires request names and descriptions", () => {
    expect(codes(valid({ requests: [{ ...request, name: "" }] }))).toContain("request_details");
    expect(codes(valid({ requests: [{ ...request, description: "" }] }))).toContain("request_details");
  });
  test("limits examples to five and rejects empty examples", () => {
    expect(draftIsValid(valid({ requests: [{ ...request, examples: Array(5).fill("Sample question") }] }), context)).toBe(true);
    expect(codes(valid({ requests: [{ ...request, examples: Array(6).fill("Sample question") }] }))).toContain("example_limit");
    expect(codes(valid({ requests: [{ ...request, examples: [" "] }] }))).toContain("example_empty");
  });
  for (const capability of ["reply", "delete"]) {
    test(`outsider readers cannot hold ${capability}`, () => {
      expect(codes(valid({ readsOutsiders: true, capabilityIds: [capability], approverIds: ["alex"] }))).toContain("outsiders");
    });
  }
  test("outsider readers can read and save a reversible draft", () => {
    expect(draftIsValid(valid({ readsOutsiders: true, capabilityIds: ["inbox", "knowledge", "draft", "web"] }), context)).toBe(true);
  });
  test("sending outside requires sample approvers", () => {
    expect(codes(valid({ capabilityIds: ["reply"] }))).toContain("approvers");
    expect(draftIsValid(valid({ capabilityIds: ["reply"], approverIds: ["sam"] }), context)).toBe(true);
  });
  test("refuses unknown capabilities, people and namespaces", () => {
    expect(codes(valid({ capabilityIds: ["unknown"], memoryIds: ["unknown"], approverIds: ["unknown"] }))).toEqual(["capability_unknown", "approver_unknown", "memory_unknown"]);
  });
  test("reports to an existing active agent only", () => {
    expect(codes(valid({ reportsTo: "retired" }))).toContain("manager");
    expect(codes(valid({ reportsTo: "missing" }))).toContain("manager");
    expect(codes(valid())).not.toContain("manager");
  });
  test("no manager is a warning and does not invalidate the draft", () => {
    const draft = valid({ reportsTo: "" });
    expect(draftIsValid(draft, context)).toBe(true);
    expect(checkAgentDraft(draft, context)).toEqual([{
      severity: "warning", code: "no_manager", field: "reportsTo",
      messageKey: "orchestrator.builder.issue_no_manager", params: { name: draft.name },
    }]);
  });
  test("skill attachment refuses repeats without mutating the original", () => {
    const draft = valid();
    const skill = { id: "triage", version: "1.2", enabled: true };
    const first = attachDraftSkill(draft, skill);
    expect(draft.skills).toEqual([]);
    const repeat = attachDraftSkill(first.draft, skill);
    expect(repeat.draft).toBe(first.draft);
    expect(repeat.refusal).toBe("orchestrator.builder.issue_skill_duplicate");
  });
  test("request addition refuses repeats and leaves the draft unchanged", () => {
    const draft = valid();
    const first = addDraftRequest(draft, request);
    expect(draft.requests).toEqual([]);
    expect(addDraftRequest(first.draft, { ...request, id: "other", name: " answer a question " }).refusal).toBe("orchestrator.builder.issue_request_duplicate");
  });
  test("request addition refuses overflow and invalid details", () => {
    const requests = Array.from({ length: 5 }, (_, index) => ({ ...request, id: String(index), name: `Request ${index}` }));
    expect(addDraftRequest(valid({ requests }), request).refusal).toBe("orchestrator.builder.issue_request_limit");
    expect(addDraftRequest(valid(), { ...request, description: "" }).refusal).toBe("orchestrator.builder.issue_request_details");
    expect(addDraftRequest(valid(), { ...request, examples: Array(6).fill("Example") }).refusal).toBe("orchestrator.builder.issue_example_limit");
    expect(addDraftRequest(valid(), { ...request, examples: [" "] }).refusal).toBe("orchestrator.builder.issue_example_empty");
  });
  test("validation does not mutate its inputs", () => {
    const draft = valid({ requests: [request] });
    const before = JSON.stringify({ draft, context });
    checkAgentDraft(draft, context);
    expect(JSON.stringify({ draft, context })).toBe(before);
  });
});

describe("irreversible-action sample policy", () => {
  for (const approverIds of [[], ["alex", "sam"]]) {
    test(`default policy refuses deletion with ${approverIds.length} approvers`, () => {
      expect(SAMPLE_POLICY.allowIrreversibleActions).toBe(false);
      const current = valid({ capabilityIds: ["delete"], approverIds });
      const issues = checkAgentDraft(current, context);
      expect(issues).toEqual([{
        code: "irreversible_policy", field: "capabilityIds", severity: "error",
        messageKey: "orchestrator.builder.issue_irreversible_policy",
        params: { name: current.name, capability: "delete" },
      }]);
      expect(draftIsValid(current, context)).toBe(false);
    });
  }
  for (const approverIds of [[], ["alex"], ["alex", "sam"]]) {
    test(`enabled policy checks deletion with ${approverIds.length} approvers`, () => {
      const policy = { ...SAMPLE_POLICY, allowIrreversibleActions: true };
      const current = valid({ capabilityIds: ["delete"], approverIds });
      const issues = checkAgentDraft(current, context, policy);
      if (approverIds.length < 2) {
        expect(issues).toEqual([{
          code: "irreversible_approvers", field: "approverIds", severity: "error",
          messageKey: "orchestrator.builder.issue_irreversible_approvers",
          params: { name: current.name, capability: "delete" },
        }]);
      } else expect(issues).toEqual([]);
      expect(draftIsValid(current, context, policy)).toBe(approverIds.length === 2);
      expect(SAMPLE_POLICY.allowIrreversibleActions).toBe(false);
    });
  }
  for (const allowIrreversibleActions of [false, true]) {
    test(`outsider refusal stays alongside the irreversible error when policy is ${allowIrreversibleActions}`, () => {
      const current = valid({ readsOutsiders: true, capabilityIds: ["delete"], approverIds: ["alex"] });
      const issues = checkAgentDraft(current, context, { allowIrreversibleActions });
      expect(issues.map(issue => issue.code)).toEqual([
        "outsiders", allowIrreversibleActions ? "irreversible_approvers" : "irreversible_policy",
      ]);
      expect(issues.every(issue => issue.severity === "error")).toBe(true);
    });
  }
});