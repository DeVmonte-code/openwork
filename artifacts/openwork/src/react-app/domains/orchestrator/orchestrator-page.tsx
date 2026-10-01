/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { LockIcon, PauseIcon, PlayIcon } from "lucide-react";
import { NavLink, useLocation, useSearchParams } from "react-router";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { HierarchyView } from "./hierarchy-view";
import { orchestratorPreview, useOrchestratorPreview, type AgentId } from "./orchestrator-preview";
import {
  discussionDraft,
  discussionWorkspace,
  originChatAvailable,
  type DiscussionWorkspace,
  type NeedOrigin,
} from "./orchestrator-discussion";

export type OrchestratorPreviewState = "default" | "empty" | "locked";
export type OrchestratorDiscussionContext = {
  workspaces: readonly DiscussionWorkspace[];
  currentWorkspaceId?: string | null;
  openDraft: (workspaceId: string, draft: string) => void;
};

const AGENTS: Array<{ id: AgentId; name: string; cost: string }> = [
  { id: "coordinator", name: "orchestrator.agent_coordinator", cost: "$0.00" },
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
    case "coordinator": return { activity: t("orchestrator.activity_idle"), queue: t("orchestrator.queued_zero") };
  }
}

function parseState(search: string): OrchestratorPreviewState {
  const v = new URLSearchParams(search).get("state");
  return v === "empty" || v === "locked" ? v : "default";
}

function NeedOriginLine({ origin, workspaces }: { origin: NeedOrigin; workspaces: readonly DiscussionWorkspace[] }) {
  if (origin.kind === "orchestrator") return null;
  const isLocalChat = originChatAvailable(origin, workspaces);
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{t(origin.kind === "chat" ? "orchestrator.started_from_chat" : "orchestrator.started_by_outside_tool")}</span>
      {origin.kind === "chat" && isLocalChat ? (
        <NavLink className="underline underline-offset-2" to={workspaceSessionRoute(origin.workspaceId, origin.chatId)}>
          {t("orchestrator.open_chat")}
        </NavLink>
      ) : null}
    </p>
  );
}

function DiscussInChat({
  origin,
  item,
  locked,
  discussion,
}: {
  origin: NeedOrigin;
  item: { title: string; state: string; agent: string; action: string };
  locked: boolean;
  discussion?: OrchestratorDiscussionContext;
}) {
  const workspaces = discussion?.workspaces ?? [];
  const workspaceId = discussionWorkspace(origin, workspaces, discussion?.currentWorkspaceId);
  return (
    <div className="flex items-center gap-2">
      {!workspaceId ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <LockIcon className="size-3.5" aria-hidden="true" />
          {t("orchestrator.discuss_no_workspace")}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={!workspaceId || !discussion}
        onClick={() => {
          if (!workspaceId || !discussion) return;
          discussion.openDraft(workspaceId, discussionDraft(
            item,
            locked,
            new URL(`${window.location.pathname}${locked ? "?state=locked" : ""}`, window.location.origin).toString(),
            {
              normal: t("orchestrator.discuss_draft_normal"),
              limited: t("orchestrator.discuss_draft_limited"),
            },
          ));
        }}
      >
        {t("orchestrator.discuss_in_chat")}
      </Button>
    </div>
  );
}

export function OrchestratorPage({
  previewState,
  discussion,
}: {
  previewState?: OrchestratorPreviewState;
  discussion?: OrchestratorDiscussionContext;
}) {
  const [search] = useSearchParams();
  const state = previewState ?? parseState(search.toString());
  const { pathname, search: rawSearch } = useLocation();
  const isHierarchy = /\/orchestrator\/hierarchy\/?$/.test(pathname);
  const snap = useOrchestratorPreview();
  const [loading, setLoading] = useState(true);
  useEffect(() => { const id = window.setTimeout(() => setLoading(false), 450); return () => window.clearTimeout(id); }, []);
  useEffect(() => {
    orchestratorPreview.bindSampleOriginWorkspace(discussion?.workspaces[0]?.id);
  }, [discussion?.workspaces]);
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

  const base = pathname.replace(/\/hierarchy\/?$/, "").replace(/\/$/, "");
  const nav = (
    <nav aria-label={t("orchestrator.nav_label")} className="flex gap-1">
      {[{ to: base, label: t("orchestrator.nav_agents"), end: true }, { to: `${base}/hierarchy`, label: t("orchestrator.nav_hierarchy"), end: true }].map((n) => (
        <Button
          key={n.to} variant="ghost" size="sm" nativeButton={false}
          className="aria-[current=page]:bg-secondary aria-[current=page]:text-foreground"
          render={<NavLink to={{ pathname: n.to, search: rawSearch }} end={n.end} />}
        >
          {n.label}
        </Button>
      ))}
    </nav>
  );

  let body;
  if (isHierarchy) {
    body = <HierarchyView state={state} loading={loading} />;
  } else if (state === "empty") {
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
        {snap.approvalWaiting || snap.questionOpen || snap.outsideQuestionOpen ? (
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { orchestratorPreview.resolveApproval(); toast(t("orchestrator.toast_declined")); }}>{t("orchestrator.decline")}</Button>
                    <Button size="sm" onClick={() => { orchestratorPreview.resolveApproval(); toast.success(t("orchestrator.toast_sent")); }}>{t("orchestrator.approve")}</Button>
                  </div>
                  <DiscussInChat
                    origin={snap.needOrigins.approval}
                    item={{
                      title: t("orchestrator.sender_approval_title"),
                      state: t("orchestrator.sender_approval_state"),
                      agent: t("orchestrator.approval_sender"),
                      action: t("orchestrator.sender_approval_summary_action"),
                    }}
                    locked={locked}
                    discussion={discussion}
                  />
                </div>
                <NeedOriginLine origin={snap.needOrigins.approval} workspaces={discussion?.workspaces ?? []} />
              </div>
            ) : null}
            {snap.questionOpen ? (
              <div className="flex flex-col gap-1 border-y border-border py-2">
                <div className="flex min-h-10 items-center justify-between gap-3">
                  <p className="min-w-0 text-sm">{t("orchestrator.question")} <span className="text-xs text-muted-foreground">· {t("orchestrator.question_agent")}</span></p>
                  <div className="flex shrink-0 items-center gap-1">
                    <DiscussInChat
                      origin={snap.needOrigins.question}
                      item={{
                        title: t("orchestrator.drafter_question_title"),
                        state: t("orchestrator.drafter_question_state"),
                        agent: t("orchestrator.question_agent"),
                        action: t("orchestrator.drafter_question_summary_action"),
                      }}
                      locked={locked}
                      discussion={discussion}
                    />
                    <Button variant="secondary" size="sm" onClick={() => toast(t("orchestrator.toast_answered"))}>{t("orchestrator.answer")}</Button>
                  </div>
                </div>
                <NeedOriginLine origin={snap.needOrigins.question} workspaces={discussion?.workspaces ?? []} />
              </div>
            ) : null}
            {snap.outsideQuestionOpen ? (
              <div className="flex flex-col gap-1 border-b border-border py-2">
                <div className="flex min-h-10 items-center justify-between gap-3">
                  <p className="min-w-0 text-sm">{t("orchestrator.outside_question")} <span className="text-xs text-muted-foreground">· {t("orchestrator.research_agent")}</span></p>
                  <div className="flex shrink-0 items-center gap-1">
                    <DiscussInChat
                      origin={snap.needOrigins.outsideQuestion}
                      item={{
                        title: t("orchestrator.outside_question_title"),
                        state: t("orchestrator.outside_question_state"),
                        agent: t("orchestrator.research_agent"),
                        action: t("orchestrator.outside_question_summary_action"),
                      }}
                      locked={locked}
                      discussion={discussion}
                    />
                    <Button variant="secondary" size="sm" onClick={() => toast(t("orchestrator.toast_answered"))}>{t("orchestrator.answer")}</Button>
                  </div>
                </div>
                <NeedOriginLine origin={snap.needOrigins.outsideQuestion} workspaces={discussion?.workspaces ?? []} />
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
      <div className={`mx-auto flex w-full ${isHierarchy ? "max-w-300" : "max-w-198"} flex-col gap-5 px-4 pb-12 pt-12 lg:pt-32`}>
        {heading}
        {nav}
        {locked && !isHierarchy ? (
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
