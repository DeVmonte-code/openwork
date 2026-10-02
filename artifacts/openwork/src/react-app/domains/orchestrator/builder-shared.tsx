/** @jsxImportSource react */
import type { ReactNode } from "react";
import { t } from "@/i18n";
import type { DraftIssue } from "./agent-draft";
import { SAMPLE_CAPABILITIES, SAMPLE_MEMORY, SAMPLE_PEOPLE, SAMPLE_SKILLS } from "./agent-samples";

const K = "orchestrator.builder.";
export const bt = (key: string, params?: Record<string, string | number>) => t(K + key, params);

const labelOf = (list: readonly { id: string; labelKey: string }[], id: string) => {
  const found = list.find((item) => item.id === id);
  return found ? t(found.labelKey) : id;
};
export const skillLabel = (id: string) => labelOf(SAMPLE_SKILLS, id);
export const memoryLabel = (id: string) => labelOf(SAMPLE_MEMORY, id);
export const capabilityLabel = (id: string) => labelOf(SAMPLE_CAPABILITIES, id);
export const personLabel = (id: string) => labelOf(SAMPLE_PEOPLE, id);

export const issueText = (issue: DraftIssue) =>
  `${t(issue.messageKey, issue.params)} ${t(`${issue.messageKey}_action`, issue.params)}`;

export const errId = (field: string) => `ab-err-${field}`;

export function FieldIssues({ issues, field, show }: { issues: DraftIssue[]; field: string; show: boolean }) {
  const mine = show ? issues.filter((issue) => issue.field === field) : [];
  if (!mine.length) return null;
  return (
    <ul id={errId(field)} className="flex flex-col gap-0.5 text-xs">
      {mine.map((issue) => (
        <li key={issue.code} className={issue.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
          {bt(issue.severity === "error" ? "severity_error" : "severity_warning")} {issueText(issue)}
        </li>
      ))}
    </ul>
  );
}

export function describedBy(issues: DraftIssue[], field: string, show: boolean, extra?: string) {
  const ids = [extra, show && issues.some((issue) => issue.field === field) ? errId(field) : undefined].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`ab-group-${id}`} data-agent-builder-group={id} className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 id={`ab-group-${id}`} className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
