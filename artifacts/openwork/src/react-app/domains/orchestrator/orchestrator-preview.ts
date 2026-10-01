import { useSyncExternalStore } from "react";
import {
  changeManager as applyManagerChange,
  createSampleHierarchy,
  getRelationship,
  type ChangeManagerInput,
  type Hierarchy,
  type HierarchyIssue,
  validateChangeManager,
} from "./hierarchy-rules";

// In-memory sample data only. No network, client or storage access.
export type AgentId = "coordinator" | "intake" | "research" | "drafter" | "reviewer" | "sender" | "digest";
export type AgentRunState = "running" | "paused";

export type OrchestratorSnapshot = {
  approvalWaiting: boolean;
  questionOpen: boolean;
  agents: Readonly<Record<AgentId, AgentRunState>>;
  hierarchy: Hierarchy;
};

export type ManagerChangeUndoResult = {
  undone: boolean;
  issues: HierarchyIssue[];
};

function agentRunStates(hierarchy: Hierarchy): Readonly<Record<AgentId, AgentRunState>> {
  return Object.fromEntries(
    hierarchy.agents.map((agent) => [agent.id, agent.state === "paused" ? "paused" : "running"]),
  ) as Record<AgentId, AgentRunState>;
}

const initialHierarchy = createSampleHierarchy();
let snapshot: OrchestratorSnapshot = {
  approvalWaiting: true,
  questionOpen: true,
  agents: agentRunStates(initialHierarchy),
  hierarchy: initialHierarchy,
};
const listeners = new Set<() => void>();
const set = (next: OrchestratorSnapshot) => { snapshot = next; listeners.forEach((l) => l()); };
const publishHierarchy = (hierarchy: Hierarchy) => set({ ...snapshot, hierarchy, agents: agentRunStates(hierarchy) });

export const orchestratorPreview = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => snapshot,
  resolveApproval() { if (snapshot.approvalWaiting) set({ ...snapshot, approvalWaiting: false }); },
  setAgentState(id: AgentId, state: AgentRunState) {
    if (snapshot.agents[id] !== state) {
      publishHierarchy({
        ...snapshot.hierarchy,
        agents: snapshot.hierarchy.agents.map((agent) => agent.id === id ? { ...agent, state } : agent),
      });
    }
  },
  changeManager(input: ChangeManagerInput): {
    changed: boolean;
    issues: HierarchyIssue[];
    undo: () => ManagerChangeUndoResult;
  } {
    const previousRelationship = getRelationship(snapshot.hierarchy, input.agentId);
    const result = applyManagerChange(snapshot.hierarchy, input);
    if (!result.changed) return { ...result, undo: () => ({ undone: false, issues: result.issues }) };

    const addedRelationship = result.hierarchy.relationships.at(-1);
    publishHierarchy(result.hierarchy);
    let canUndo = true;
    const conflict = (): ManagerChangeUndoResult => ({
      undone: false,
      issues: [{
        severity: "refusal",
        code: "undo_conflict",
        agentId: input.agentId,
        params: {},
      }],
    });
    return {
      changed: true,
      issues: result.issues,
      undo() {
        if (!canUndo) return conflict();
        const current = snapshot.hierarchy;
        if (!addedRelationship || getRelationship(current, input.agentId)?.id !== addedRelationship.id) return conflict();
        const restorationIssues = previousRelationship
          ? validateChangeManager(current, {
              agentId: input.agentId,
              managerId: previousRelationship.managerId,
              control: previousRelationship.control,
              reliance: previousRelationship.reliance,
              escalation: previousRelationship.escalation,
            })
          : [];
        if (restorationIssues.some((item) => item.severity === "refusal")) {
          return { undone: false, issues: restorationIssues };
        }

        canUndo = false;
        publishHierarchy({
          ...current,
          relationships: current.relationships.map((relationship) => {
            if (relationship.id === addedRelationship.id) return { ...relationship, status: "ended" };
            if (previousRelationship && relationship.id === previousRelationship.id) {
              return { ...relationship, status: "active" };
            }
            return relationship;
          }),
        });
        return { undone: true, issues: restorationIssues };
      },
    };
  },
};

export function useOrchestratorPreview() {
  return useSyncExternalStore(orchestratorPreview.subscribe, orchestratorPreview.getSnapshot, orchestratorPreview.getSnapshot);
}
