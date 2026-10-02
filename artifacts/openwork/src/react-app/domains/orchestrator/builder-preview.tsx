/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { AgentDraft, DraftContext, DraftIssue } from "./agent-draft";
import { simulateAgentDraft, type SimulationStep } from "./agent-simulation";
import { bt, capabilityLabel, Group, issueText, memoryLabel, skillLabel } from "./builder-shared";

function stepText(step: SimulationStep): string {
  const p = step.params;
  switch (step.kind) {
    case "skill": return t(step.labelKey, { ...p, skill: skillLabel(String(p.skill)) });
    case "memory": return t(step.labelKey, { ...p, namespace: memoryLabel(String(p.namespace)) });
    case "approval": return t(step.labelKey, { ...p, capability: step.capabilityId ? capabilityLabel(step.capabilityId) : "" });
    default: return t(step.labelKey, p);
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm">{children}</dd>
    </div>
  );
}

export function BuilderPreview({ draft, context, issues }: { draft: AgentDraft; context: DraftContext; issues: DraftIssue[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const examples = [...new Set(draft.requests.flatMap((r) => r.examples))];
  const example = picked !== null && examples.includes(picked) ? picked : null;
  const sim = useMemo(() => (example === null ? null : simulateAgentDraft(draft, context, example)), [draft, context, example]);
  const manager = context.agents.find((a) => a.id === draft.reportsTo);

  return (
    <div className="flex flex-col gap-6" data-agent-builder-preview>
      <Group id="listing" title={bt("preview_listing")}>
        <dl className="flex flex-col divide-y divide-border border-y border-border" data-testid="draft-listing">
          <Row label={bt("name")}><span className="font-semibold">{draft.name.trim() || bt("untitled")}</span></Row>
          <Row label={bt("description")}>{draft.description.trim() || bt("no_description")}</Row>
          <Row label={bt("role")}>{bt(`role_${draft.role}`)}</Row>
          <Row label={bt("group_requests")}>
            {draft.requests.length ? (
              <ul className="flex flex-col gap-1.5">
                {draft.requests.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground"> {r.description}</span>
                    {r.examples.length ? (
                      <ul className="text-xs text-muted-foreground">{r.examples.map((e, index) => <li key={index}>{e}</li>)}</ul>
                    ) : <p className="text-xs text-muted-foreground">{bt("no_examples")}</p>}
                  </li>
                ))}
              </ul>
            ) : bt("no_requests")}
          </Row>
          <Row label={bt("group_visibility")}>{bt(`visibility_${draft.visibility}`)}</Row>
          <Row label={bt("reports_to")}>{manager ? manager.name : bt("reports_none")}</Row>
        </dl>
      </Group>

      <Group id="checks" title={bt("checks")}>
        {errors.length ? (
          <div role="alert" data-testid="error-summary" className="flex flex-col gap-1">
            <p className="text-sm font-medium text-destructive">{bt("errors_summary", { count: errors.length })}</p>
            <ul className="flex flex-col gap-0.5 text-sm">{errors.map((i) => <li key={`${i.code}-${i.field}`}>{issueText(i)}</li>)}</ul>
          </div>
        ) : null}
        {warnings.length ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{bt("warnings_heading")}</p>
            <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">{warnings.map((i) => <li key={`${i.code}-${i.field}`}>{issueText(i)}</li>)}</ul>
            <p className="text-xs text-muted-foreground">{bt("warning_note")}</p>
          </div>
        ) : null}
        {!issues.length ? <p className="text-sm">{bt("checks_clear")}</p> : null}
      </Group>

      <Group id="simulation" title={bt("sim_heading")}>
        <p className="text-xs font-medium">{bt("sim_label")}</p>
        <p className="text-sm text-muted-foreground" data-testid="text-sim-notice">{bt("sim_none_called")}</p>
        {examples.length ? (
          <div role="group" aria-label={bt("sim_pick")} className="flex flex-col divide-y divide-border border-y border-border">
            {examples.map((e) => (
              <Button key={e} variant="ghost" size="sm" aria-pressed={e === example} onClick={() => setPicked(e)}
                className="h-10 justify-start rounded-none px-0 font-normal aria-pressed:font-semibold">{e}</Button>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">{bt("sim_no_examples")}</p>}
        {sim && sim.status === "blocked" ? <p role="status" className="text-sm text-muted-foreground">{bt("sim_blocked")}</p> : null}
        {sim && sim.status !== "blocked" ? (
          <div role="status" data-testid="simulation-result" className="flex flex-col gap-1">
            <ol aria-label={bt("sim_result_label")} className="flex flex-col divide-y divide-border border-y border-border">
              {sim.steps.map((s, i) => <li key={i} className="flex min-h-10 items-center text-sm">{stepText(s)}</li>)}
            </ol>
            <p className="text-xs text-muted-foreground">{bt(sim.status === "approval" ? "sim_stops" : "sim_complete")}</p>
          </div>
        ) : null}
      </Group>

      <div className="flex flex-col gap-1.5 border-t border-border pt-4">
        <div>
          <Button disabled aria-describedby="ab-activate-reason" data-testid="button-activate-agent">{bt("activate")}</Button>
        </div>
        <p id="ab-activate-reason" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockIcon className="size-3.5 shrink-0" aria-hidden="true" />{bt("activate_reason")}
        </p>
      </div>
    </div>
  );
}
