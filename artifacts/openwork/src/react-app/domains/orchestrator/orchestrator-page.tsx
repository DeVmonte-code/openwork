/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { LockIcon, MoreHorizontalIcon, PauseIcon, PlayIcon } from "lucide-react";
import { NavLink, useLocation, useSearchParams } from "react-router";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { AgentBuilder } from "./agent-builder";
import { HierarchyView } from "./hierarchy-view";
import { ApprovalCard } from "./orchestrator-approval-card";
import { ConversationPanel } from "./orchestrator-conversation-panel";
import type { ConversationSubject } from "./orchestrator-conversation";
import { orchestratorPreview, useOrchestratorPreview, type AgentId } from "./orchestrator-preview";
import {
  discussionDraft,
  discussionWorkspace,
  originChatAvailable,
  type DiscussionSummary,
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

function NeedActions({
  origin, item, locked, discussion, agentId, source, onAsk,
}: {
  origin: NeedOrigin;
  item: DiscussionSummary;
  locked: boolean;
  discussion?: OrchestratorDiscussionContext;
  agentId: AgentId;
  source: "approval" | "question" | "outsideQuestion";
  onAsk: (subject: ConversationSubject, opener: HTMLElement) => void;
}) {
  const workspaces = discussion?.workspaces ?? [];
  const workspaceId = discussionWorkspace(origin, workspaces, discussion?.currentWorkspaceId);
  const available = !!workspaceId && !!discussion;
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost" size="sm" className="text-muted-foreground" data-ask-agent={agentId}
        onClick={(e) => onAsk({ ...item, agentId, source }, e.currentTarget)}
      >
        {t("orchestrator.ask_agent", { agent: item.agent })}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={t("orchestrator.more_actions", { title: item.title })} />}
        >
          <MoreHorizontalIcon className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!available}
            onClick={() => {
              if (!workspaceId || !discussion) return;
              discussion.openDraft(workspaceId, discussionDraft(item, locked, {
                normal: t("orchestrator.discuss_draft_normal"),
                limited: t("orchestrator.discuss_draft_limited"),
              }));
            }}
          >
            {!available ? <LockIcon className="size-4" aria-hidden="true" /> : null}
            <span className="flex flex-col">
              {t("orchestrator.discuss_in_chat")}
              {!available ? <span className="text-xs text-muted-foreground">{t("orchestrator.discuss_no_workspace")}</span> : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
  const [building, setBuilding] = useState(false);
  useEffect(() => { setBuilding(false); }, [pathname, state]);
  useEffect(() => { const id = window.setTimeout(() => setLoading(false), 450); return () => window.clearTimeout(id); }, []);
  useEffect(() => {
    orchestratorPreview.bindSampleOriginWorkspace(discussion?.workspaces[0]?.id);
  }, [discussion?.workspaces]);
  const locked = state === "locked";
  const [conversation, setConversation] = useState<{ subject: ConversationSubject; key: number } | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const conversationKey = useRef(0);
  const openConversation = (subject: ConversationSubject, from: HTMLElement) => {
    opener.current = from;
    conversationKey.current += 1;
    setConversation({ subject, key: conversationKey.current });
    setConversationOpen(true);
  };
  // The opener may disappear (an approved card): fall back to the same agent's
  // Ask button, then the page itself.
  const restoreFocus = () => {
    const node = opener.current;
    if (node && node.isConnected) return node;
    const agentId = conversation?.subject.agentId;
    const fallback = agentId ? pageRef.current?.querySelector<HTMLElement>(`[data-ask-agent="${agentId}"]`) : null;
    return fallback ?? pageRef.current;
  };

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
              <ApprovalCard
                locked={locked}
                extra={(
                  <NeedActions
                    origin={snap.needOrigins.approval}
                    item={{
                      title: t("orchestrator.sender_approval_title"),
                      state: t("orchestrator.sender_approval_state"),
                      agent: t("orchestrator.approval_sender"),
                      action: t("orchestrator.sender_approval_summary_action"),
                    }}
                    locked={locked}
                    discussion={discussion}
                    agentId="sender"
                    source="approval"
                    onAsk={openConversation}
                  />
                )}
                footer={<NeedOriginLine origin={snap.needOrigins.approval} workspaces={discussion?.workspaces ?? []} />}
              />
            ) : null}
            {snap.questionOpen ? (
              <div className="flex flex-col gap-1 border-y border-border py-2">
                <div className="flex min-h-10 items-center justify-between gap-3">
                  <p className="min-w-0 text-sm">{t("orchestrator.question")} <span className="text-xs text-muted-foreground">· {t("orchestrator.question_agent")}</span></p>
                  <div className="flex shrink-0 items-center gap-1">
                    <NeedActions
                      origin={snap.needOrigins.question}
                      item={{
                        title: t("orchestrator.drafter_question_title"),
                        state: t("orchestrator.drafter_question_state"),
                        agent: t("orchestrator.question_agent"),
                        action: t("orchestrator.drafter_question_summary_action"),
                      }}
                      locked={locked}
                      discussion={discussion}
                      agentId="drafter"
                      source="question"
                      onAsk={openConversation}
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
                    <NeedActions
                      origin={snap.needOrigins.outsideQuestion}
                      item={{
                        title: t("orchestrator.outside_question_title"),
                        state: t("orchestrator.outside_question_state"),
                        agent: t("orchestrator.research_agent"),
                        action: t("orchestrator.outside_question_summary_action"),
                      }}
                      locked={locked}
                      discussion={discussion}
                      agentId="research"
                      source="outsideQuestion"
                      onAsk={openConversation}
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
                  <Button
                    variant="ghost" size="xs" className="shrink-0 text-muted-foreground" data-ask-agent={a.id}
                    onClick={(e) => openConversation({
                      title: name,
                      state: t(paused ? "orchestrator.state_paused" : "orchestrator.state_running"),
                      agent: name,
                      action: a.id === "drafter"
                        ? t("orchestrator.drafter_question_summary_action")
                        : a.id === "research"
                          ? t("orchestrator.outside_question_summary_action")
                          : d.activity,
                      agentId: a.id,
                      source: "agent",
                    }, e.currentTarget)}
                  >
                    {t("orchestrator.ask_agent", { agent: name })}
                  </Button>
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
    <section ref={pageRef} tabIndex={-1} data-orchestrator-page aria-label={t("orchestrator.title")} className="h-full min-h-0 overflow-y-auto outline-none">
      <div className={`mx-auto flex w-full ${isHierarchy ? "max-w-300" : "max-w-198"} flex-col gap-5 px-4 pb-12 pt-12 lg:pt-32`}>
        {heading}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {nav}
          {!isHierarchy && !building ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" disabled={locked} onClick={() => setBuilding(true)} data-testid="button-new-agent">
                {locked ? <LockIcon className="size-4" aria-hidden="true" /> : null}
                {t("orchestrator.builder.new_agent")}
              </Button>
              {locked ? <span className="text-xs text-muted-foreground">{t("orchestrator.builder.locked_reason")}</span> : null}
            </div>
          ) : null}
        </div>
        {locked && !isHierarchy ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LockIcon className="size-4 shrink-0" aria-hidden="true" />
            <span>{t("orchestrator.locked_line")} · {t("orchestrator.locked_ask")}</span>
          </p>
        ) : null}
        {building && !locked && !isHierarchy ? <AgentBuilder onClose={() => setBuilding(false)} /> : body}
      </div>
      {conversation ? (
        <ConversationPanel
          key={conversation.key}
          subject={conversation.subject}
          open={conversationOpen}
          limited={locked}
          onOpenChange={setConversationOpen}
          onClosed={() => setConversation(null)}
          finalFocus={restoreFocus}
        />
      ) : null}
    </section>
  );
}

export default OrchestratorPage;
