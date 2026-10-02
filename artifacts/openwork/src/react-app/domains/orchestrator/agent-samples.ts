import type { RiskTier, RolePreset } from "./agent-draft";

export const ROLE_PRESETS: readonly RolePreset[] = ["dispatcher", "worker", "reviewer", "executor", "monitor", "manager"];
export type SamplePolicy = { allowIrreversibleActions: boolean };
export const SAMPLE_POLICY: Readonly<SamplePolicy> = { allowIrreversibleActions: false };
export const SAMPLE_SKILLS = [
  { id: "triage", version: "1.2", labelKey: "orchestrator.builder.skill_triage" },
  { id: "review", version: "1.0", labelKey: "orchestrator.builder.skill_review" },
  { id: "tone", version: "2.1", labelKey: "orchestrator.builder.skill_tone" },
];
export type SampleCapability = { id: string; labelKey: string; risk: RiskTier };
export const SAMPLE_CAPABILITIES: readonly SampleCapability[] = [
  { id: "inbox", labelKey: "orchestrator.builder.cap_inbox", risk: "read" },
  { id: "knowledge", labelKey: "orchestrator.builder.cap_knowledge", risk: "read" },
  { id: "draft", labelKey: "orchestrator.builder.cap_draft", risk: "reversible" },
  { id: "reply", labelKey: "orchestrator.builder.cap_reply", risk: "external" },
  { id: "web", labelKey: "orchestrator.builder.cap_web", risk: "read" },
  { id: "delete", labelKey: "orchestrator.builder.cap_delete", risk: "irreversible" },
];
export const SAMPLE_MEMORY = [
  { id: "handbook", labelKey: "orchestrator.builder.memory_handbook", classKey: "orchestrator.builder.class_internal" },
  { id: "customers", labelKey: "orchestrator.builder.memory_customers", classKey: "orchestrator.builder.class_confidential" },
  { id: "public", labelKey: "orchestrator.builder.memory_public", classKey: "orchestrator.builder.class_public" },
];
export const SAMPLE_PEOPLE = [
  { id: "alex", labelKey: "orchestrator.builder.person_alex" },
  { id: "sam", labelKey: "orchestrator.builder.person_sam" },
  { id: "robin", labelKey: "orchestrator.builder.person_robin" },
];