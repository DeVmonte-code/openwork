import type { AgentDraft, DraftContext, DraftIssue } from "./agent-draft";
import { checkAgentDraft } from "./agent-rules";
import { SAMPLE_CAPABILITIES } from "./agent-samples";

export type SimulationStep = {
  kind: "instructions" | "skill" | "memory" | "capability" | "approval" | "finish";
  labelKey: string;
  params: Record<string, string | number>;
  capabilityId?: string;
};
export type SampleSimulation = { status: "blocked" | "approval" | "complete"; steps: SimulationStep[]; issues: DraftIssue[] };

// A fixed rehearsal, not an interpretation of the request. No I/O or model.
export function simulateAgentDraft(draft: AgentDraft, context: DraftContext, example: string): SampleSimulation {
  const issues = checkAgentDraft(draft, context);
  const knownExample = draft.requests.some(request => request.examples.includes(example));
  if (issues.some(issue => issue.severity === "error") || !knownExample) return { status: "blocked", steps: [], issues };
  const steps: SimulationStep[] = [{ kind: "instructions", labelKey: "orchestrator.builder.sim_instructions", params: { count: draft.instructions.length } }];
  for (const skill of draft.skills.filter(skill => skill.enabled)) steps.push({ kind: "skill", labelKey: "orchestrator.builder.sim_skill", params: { skill: skill.id, version: skill.version } });
  for (const id of draft.memoryIds) steps.push({ kind: "memory", labelKey: "orchestrator.builder.sim_memory", params: { namespace: id } });
  for (const capability of SAMPLE_CAPABILITIES.filter(capability => draft.capabilityIds.includes(capability.id))) {
    if (capability.risk === "external" || capability.risk === "irreversible") {
      steps.push({ kind: "approval", labelKey: "orchestrator.builder.sim_approval", params: { count: draft.approverIds.length }, capabilityId: capability.id });
      return { status: "approval", steps, issues };
    }
    steps.push({ kind: "capability", labelKey: capability.labelKey, params: {}, capabilityId: capability.id });
  }
  steps.push({ kind: "finish", labelKey: "orchestrator.builder.sim_finish", params: {} });
  return { status: "complete", steps, issues };
}