/** @jsxImportSource react */
import { t } from "@/i18n";
import type { Hierarchy, HierarchyAgent, HierarchyIssue } from "./hierarchy-rules";

export const LEVELS = [1, 2, 3, 4, 5];
export const SEP = " \u203A ";
export const levelName = (n: number) => t(`orchestrator.level_${n}`);
export const levelLabel = (n: number) => t("orchestrator.h_level", { level: n, name: levelName(n) });

export function useNames(h: Hierarchy) {
  return (id: string | undefined) => {
    if (!id) return "";
    const a = h.agents.find((x) => x.id === id);
    return a ? t(a.nameKey) : id;
  };
}

export function stateText(s: HierarchyAgent["state"]) {
  return t(`orchestrator.state_${s}`);
}

export function issueText(issue: HierarchyIssue, name: (id?: string) => string) {
  const p = issue.params;
  const path = Array.isArray(p.path) ? p.path.map((id) => name(id)).join(" → ") : "";
  const base = {
    agent: name(issue.agentId),
    manager: name(typeof p.managerId === "string" ? p.managerId : undefined),
    path,
    count: typeof p.count === "number" ? p.count : 0,
    limit: typeof p.limit === "number" ? p.limit : 0,
    control: typeof p.control === "number" ? p.control : 0,
    reliance: typeof p.reliance === "number" ? p.reliance : 0,
  };
  const code = issue.code === "manager_has_reports"
    ? `${issue.code}_${base.count === 1 ? "one" : "other"}`
    : issue.code;
  return t(`orchestrator.issue_${code}`, base);
}


export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}


