import { useSyncExternalStore } from "react";

// In-memory sample data only. No network, client or storage access.
export type AgentId = "intake" | "research" | "drafter" | "reviewer" | "sender" | "digest";
export type AgentRunState = "running" | "paused";

export type OrchestratorSnapshot = {
  approvalWaiting: boolean;
  questionOpen: boolean;
  agents: Readonly<Record<AgentId, AgentRunState>>;
};

let snapshot: OrchestratorSnapshot = {
  approvalWaiting: true,
  questionOpen: true,
  agents: { intake: "running", research: "running", drafter: "running", reviewer: "running", sender: "running", digest: "running" },
};
const listeners = new Set<() => void>();
const set = (next: OrchestratorSnapshot) => { snapshot = next; listeners.forEach((l) => l()); };

export const orchestratorPreview = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => snapshot,
  resolveApproval() { if (snapshot.approvalWaiting) set({ ...snapshot, approvalWaiting: false }); },
  setAgentState(id: AgentId, state: AgentRunState) {
    if (snapshot.agents[id] !== state) set({ ...snapshot, agents: { ...snapshot.agents, [id]: state } });
  },
};

export function useOrchestratorPreview() {
  return useSyncExternalStore(orchestratorPreview.subscribe, orchestratorPreview.getSnapshot, orchestratorPreview.getSnapshot);
}
