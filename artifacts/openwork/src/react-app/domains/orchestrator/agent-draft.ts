export type RolePreset = "dispatcher" | "worker" | "reviewer" | "executor" | "monitor" | "manager";
export type AgentVisibility = "orchestrator" | "members" | "organization";
export type RiskTier = "read" | "reversible" | "external" | "irreversible";
export type DraftSkill = { id: string; version: string; enabled: boolean };
export type DraftRequest = { id: string; name: string; description: string; examples: string[] };
export type AgentDraft = {
  name: string;
  description: string;
  role: RolePreset;
  reportsTo: string;
  instructions: string;
  skills: DraftSkill[];
  requests: DraftRequest[];
  capabilityIds: string[];
  memoryIds: string[];
  visibility: AgentVisibility;
  readsOutsiders: boolean;
  dailyCostLimit: string;
  approverIds: string[];
};
export type SampleAgent = { id: string; name: string; slug: string; active: boolean };
export type DraftContext = { agents: readonly SampleAgent[] };
export type DraftIssue = {
  severity: "error" | "warning";
  code: string;
  field: string;
  messageKey: string;
  params: Record<string, string | number>;
};

export function emptyAgentDraft(): AgentDraft {
  return {
    name: "", description: "", role: "worker", reportsTo: "", instructions: "",
    skills: [], requests: [], capabilityIds: [], memoryIds: [], visibility: "orchestrator",
    readsOutsiders: false, dailyCostLimit: "", approverIds: [],
  };
}

export function agentSlug(name: string): string {
  return name.trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}