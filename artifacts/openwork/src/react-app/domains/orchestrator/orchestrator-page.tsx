/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { LockIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { orchestratorPreview, useOrchestratorPreview, type AgentId } from "./orchestrator-preview";

export type OrchestratorPreviewState = "default" | "empty" | "locked";

const AGENTS: Array<{ id: AgentId; name: string; cost: string }> = [
  { id: "intake", name: "orchestrator.agent_intake", cost: "$0.42" },
  { id: "research", name: "orchestrator.agent_research", cost: "$1.10" },
  { id: "drafter", name: "orchestrator.agent_drafter", cost: "$0.31" },
  { id: "reviewer", name: "orchestrator.agent_reviewer", cost: "$0.12" },
  { id: "sender", name: "orchestrator.agent_sender", cost: "$0.02" },
  { id: "digest", name: "orchestrator.agent_digest", cost: "$0.05" },
];
const STARTS = ["dispatcher", "worker", "reviewer", "executor", "monitor"];

function describe(id: AgentId, approvalWaiting: boolean): { activity: string; queue: string | null } {
  switch (id) {
    case "intake": return { activity: t("orchestrator.activity_intake"), queue: t("orchestrator.queued_zero") };
    case "research": return { activity: t("orchestrator.activity_research"), queue: t("orchestrator.queued_two") };
    case "drafter": return { activity: t("orchestrator.activity_idle"), queue: t("orchestrator.queued_zero") };
    case "reviewer": return { activity: t("orchestrator.activity_idle"), queue: null };
    case "sender": return approvalWaiting
      ? { activity: t("orchestrator.activity_waiting"), queue: t("orchestrator.queued_one") }
      : { activity: t("orchestrator.activity_idle"), queue: t("orchestrator.queued_zero") };
    case "digest": return { activity: t("orchestrator.activity_digest"), queue: null };
  }
}

function parseState(search: string): OrchestratorPreviewState {
  const v = new URLSearchParams(search).get("state");
  return v === "empty" || v === "locked" ? v : "default";
}

export function OrchestratorPage({ previewState }: { previewState?: OrchestratorPreviewState }) {
  const [search] = useSearchParams();
  const state = previewState ?? parseState(search.toString());
  const snap = useOrchestratorPreview();
  const [loading, setLoading] = useState(true);
  useEffect(() => { const id = window.setTimeout(() => setLoading(false), 450); return () => window.clearTimeout(id); }, []);
  const locked = state === "locked";

  const toggle = (id: AgentId, name: string) => {
    const prior = snap.agents[id];
    const next = prior === "running" ? "paused" : "running";
    orchestratorPreview.setAgentState(id, next);
    toast.undo(`${name} · ${t(next === "paused" ? "orchestrator.toast_paused" : "orchestrator.toast_resumed")}`, {
      icon: next === "paused" ? PauseIcon : PlayIcon,
      undo: { label: t("common.undo"), onClick: () => orchestratorPreview.setAgentState(id, prior) },
      closeLabel: t("common.close"),
    });
  };

  const heading = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-xl font-semibold tracking-tight">{t("orchestrator.title")}</h1>
      <span className="text-xs text-muted-foreground">{t("orchestrator.preview_label")}</span>
    </div>
  );

  let body;
  if (state === "empty") {
    body = (
      <section aria-labelledby="orch-empty" className="flex flex-col gap-3">
        <h2 id="orch-empty" className="text-sm font-medium">{t("orchestrator.empty_title")}</h2>
        <p className="text-xs font-medium text-muted-foreground">{t("orchestrator.empty_starting_points")}</p>
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {STARTS.map((s) => (
            <li key={s} className="flex h-10 items-center px-3 text-sm text-muted-foreground" aria-disabled="true">{t(`orchestrator.start_${s}`)}</li>
          ))}
        </ul>
      </section>
    );
  } else {
    body = (
      <>
        {snap.approvalWaiting || snap.questionOpen ? (
          <section aria-labelledby="orch-needs" className="flex flex-col gap-3">
            <h2 id="orch-needs" className="text-xs font-medium text-muted-foreground">{t("orchestrator.needs_you")}</h2>
            {snap.approvalWaiting ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
                <p className="text-sm font-medium">{t("orchestrator.approval_action")}</p>
                <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("orchestrator.approval_agent")}</dt><dd>{t("orchestrator.approval_sender")}</dd>
                  <dt className="text-muted-foreground">{t("orchestrator.approval_data")}</dt><dd>{t("orchestrator.approval_data_value")}</dd>
                  <dt className="text-muted-foreground">{t("orchestrator.approval_risk")}</dt><dd>{t("orchestrator.approval_risk_value")}</dd>
                </dl>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { orchestratorPreview.resolveApproval(); toast(t("orchestrator.toast_declined")); }}>{t("orchestrator.decline")}</Button>
                  <Button size="sm" onClick={() => { orchestratorPreview.resolveApproval(); toast.success(t("orchestrator.toast_sent")); }}>{t("orchestrator.approve")}</Button>
                </div>
              </div>
            ) : null}
            {snap.questionOpen ? (
              <div className="flex min-h-10 items-center justify-between gap-3 border-y border-border py-1.5">
                <p className="min-w-0 text-sm">{t("orchestrator.question")} <span className="text-xs text-muted-foreground">· {t("orchestrator.question_agent")}</span></p>
                <Button variant="secondary" size="sm" onClick={() => toast(t("orchestrator.toast_answered"))}>{t("orchestrator.answer")}</Button>
              </div>
            ) : null}
          </section>
        ) : null}
        <section aria-labelledby="orch-agents" className="flex flex-col gap-1">
          <h2 id="orch-agents" className="px-3 pb-1.5 text-xs font-medium text-muted-foreground">{t("orchestrator.agents")}</h2>
          <ul className="flex flex-col divide-y divide-border border-y border-border" aria-busy={loading}>
            {AGENTS.map((a) => {
              if (loading) {
                return (
                  <li key={a.id} className="flex h-11 items-center gap-3 px-3" aria-label={t("orchestrator.loading_agents")}>
                    <Skeleton className="h-3.5 w-24 motion-reduce:animate-none" /><Skeleton className="h-3.5 flex-1 motion-reduce:animate-none" /><Skeleton className="h-3.5 w-16 motion-reduce:animate-none" />
                  </li>
                );
              }
              const name = t(a.name);
              const run = snap.agents[a.id];
              const d = describe(a.id, snap.approvalWaiting);
              const paused = run === "paused";
              const label = `${t(paused ? "orchestrator.resume_agent" : "orchestrator.pause_agent")}: ${name}`;
              return (
                <li key={a.id} className="flex h-11 items-center gap-3 px-3 text-sm">
                  <span className="w-28 shrink-0 truncate font-medium">{name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={[d.activity, d.queue, `${a.cost} ${t("orchestrator.today_cost")}`].filter(Boolean).join(" · ")}>
                    {[d.activity, d.queue, `${a.cost} ${t("orchestrator.today_cost")}`].filter(Boolean).join(" · ")}
                  </span>
                  <span className="shrink-0 text-xs">{t(paused ? "orchestrator.state_paused" : "orchestrator.state_running")}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={locked} onClick={() => toggle(a.id, name)}>
                    {paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      </>
    );
  }

  return (
    <section data-orchestrator-page aria-label={t("orchestrator.title")} className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-198 flex-col gap-5 px-4 pb-12 pt-12 lg:pt-32">
        {heading}
        {locked ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LockIcon className="size-4 shrink-0" aria-hidden="true" />
            <span>{t("orchestrator.locked_line")} · {t("orchestrator.locked_ask")}</span>
          </p>
        ) : null}
        {body}
      </div>
    </section>
  );
}

export default OrchestratorPage;
