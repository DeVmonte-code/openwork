import { agentSlug, type AgentDraft, type DraftContext, type DraftIssue, type DraftRequest, type DraftSkill } from "./agent-draft";
import { SAMPLE_CAPABILITIES, SAMPLE_MEMORY, SAMPLE_PEOPLE, SAMPLE_SKILLS } from "./agent-samples";

const canonical = (value: string) => value.trim().toLowerCase();
const duplicates = (values: string[]) => new Set(values).size !== values.length;

export function checkAgentDraft(draft: AgentDraft, context: DraftContext): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (code: string, field: string, severity: "error" | "warning" = "error") => {
    if (!issues.some(issue => issue.code === code && issue.field === field)) {
      issues.push({ code, field, severity, messageKey: `orchestrator.builder.issue_${code}`, params: { name: draft.name.trim() } });
    }
  };
  if (!draft.name.trim()) add("name", "name");
  if (draft.name.length > 80) add("name_length", "name");
  const slug = agentSlug(draft.name);
  if (draft.name.trim() && !slug) add("slug_empty", "name");
  if (slug && context.agents.some(agent => canonical(agent.slug) === slug || agentSlug(agent.name) === slug)) add("slug_unique", "name");
  if (!draft.instructions.trim()) add("instructions", "instructions");
  if (draft.instructions.length > 32_000) add("instructions_length", "instructions");
  if (!draft.dailyCostLimit.trim()) add("cost", "dailyCostLimit");
  else if (!Number.isFinite(Number(draft.dailyCostLimit)) || Number(draft.dailyCostLimit) < 0) add("cost_value", "dailyCostLimit");
  if (draft.visibility !== "orchestrator") {
    if (!draft.description.trim()) add("description", "description");
    if (!draft.requests.length) add("request_required", "requests");
  }
  if (!draft.reportsTo) add("no_manager", "reportsTo", "warning");
  else if (!context.agents.some(agent => agent.id === draft.reportsTo && agent.active)) add("manager", "reportsTo");
  if (duplicates(draft.skills.map(skill => skill.id))) add("skill_duplicate", "skills");
  if (draft.skills.some(skill => !SAMPLE_SKILLS.some(sample => sample.id === skill.id && sample.version === skill.version))) add("skill_unknown", "skills");
  if (draft.requests.length > 5) add("request_limit", "requests");
  if (duplicates(draft.requests.map(request => canonical(request.name))) || duplicates(draft.requests.map(request => request.id))) add("request_duplicate", "requests");
  for (const request of draft.requests) {
    if (!request.name.trim() || !request.description.trim()) add("request_details", "requests");
    if (request.examples.length > 5) add("example_limit", "requests");
    if (request.examples.some(example => !example.trim())) add("example_empty", "requests");
  }
  const capabilities = SAMPLE_CAPABILITIES.filter(capability => draft.capabilityIds.includes(capability.id));
  if (draft.capabilityIds.some(id => !SAMPLE_CAPABILITIES.some(capability => capability.id === id))) add("capability_unknown", "capabilityIds");
  if (draft.readsOutsiders && capabilities.some(capability => capability.risk === "external" || capability.risk === "irreversible")) add("outsiders", "capabilityIds");
  if (capabilities.some(capability => capability.risk === "external") && !draft.approverIds.length) add("approvers", "approverIds");
  if (draft.approverIds.some(id => !SAMPLE_PEOPLE.some(person => person.id === id))) add("approver_unknown", "approverIds");
  if (draft.memoryIds.some(id => !SAMPLE_MEMORY.some(namespace => namespace.id === id))) add("memory_unknown", "memoryIds");
  return issues;
}

export function draftIsValid(draft: AgentDraft, context: DraftContext): boolean {
  return !checkAgentDraft(draft, context).some(issue => issue.severity === "error");
}

export function attachDraftSkill(draft: AgentDraft, skill: DraftSkill): { draft: AgentDraft; refusal: string | null } {
  if (draft.skills.some(current => current.id === skill.id)) return { draft, refusal: "orchestrator.builder.issue_skill_duplicate" };
  return { draft: { ...draft, skills: [...draft.skills, skill] }, refusal: null };
}

export function addDraftRequest(draft: AgentDraft, request: DraftRequest): { draft: AgentDraft; refusal: string | null } {
  if (draft.requests.length >= 5) return { draft, refusal: "orchestrator.builder.issue_request_limit" };
  if (draft.requests.some(current => current.id === request.id || canonical(current.name) === canonical(request.name))) return { draft, refusal: "orchestrator.builder.issue_request_duplicate" };
  if (!request.name.trim() || !request.description.trim()) return { draft, refusal: "orchestrator.builder.issue_request_details" };
  if (request.examples.length > 5) return { draft, refusal: "orchestrator.builder.issue_example_limit" };
  if (request.examples.some(example => !example.trim())) return { draft, refusal: "orchestrator.builder.issue_example_empty" };
  return { draft: { ...draft, requests: [...draft.requests, request] }, refusal: null };
}