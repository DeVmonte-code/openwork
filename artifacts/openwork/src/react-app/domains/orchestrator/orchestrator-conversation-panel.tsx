/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { ApprovalCard } from "./orchestrator-approval-card";
import {
  CONVERSATION_STARTERS,
  sampleConversationReply,
  type ConversationSubject,
} from "./orchestrator-conversation";
import "./orchestrator-conversation-panel.css";
import { orchestratorPreview, useOrchestratorPreview } from "./orchestrator-preview";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "agent"; text: string; approval: boolean };

const DELAY_MS = 250;

export function ConversationPanel({
  subject,
  open,
  limited,
  onOpenChange,
  onClosed,
  finalFocus,
}: {
  subject: ConversationSubject;
  open: boolean;
  limited: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  finalFocus: () => HTMLElement | null;
}) {
  const snap = useOrchestratorPreview();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [statusKey, setStatusKey] = useState<{ key: string; params: Record<string, string | number> } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    if (!open) { clearTimer(); setPending(false); }
    return clearTimer;
  }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [messages, pending]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || pending) return;
    const id = nextId.current++;
    setMessages((m) => [...m, { id, role: "user", text }]);
    setDraft("");
    setPending(true);
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const reply = sampleConversationReply(subject, orchestratorPreview.getSnapshot(), text, limited);
      setMessages((m) => [...m, {
        id: nextId.current++,
        role: "agent",
        text: t(reply.messageKey, reply.params),
        approval: reply.includeApproval,
      }]);
      setStatusKey({ key: reply.statusKey, params: reply.params });
      setPending(false);
    }, DELAY_MS);
  };

  // Keep focus inside the dialog when the inline Approve/Decline button unmounts.
  const waitingRef = useRef(snap.approvalWaiting);
  useEffect(() => {
    if (waitingRef.current && !snap.approvalWaiting) {
      const active = document.activeElement;
      if (!active || active === document.body) inputRef.current?.focus();
    }
    waitingRef.current = snap.approvalWaiting;
  }, [snap.approvalWaiting]);

  const agent = subject.agent;
  const contextLine = !limited && subject.source === "approval"
    ? t(snap.approvalWaiting ? "orchestrator.conversation.context_waiting" : "orchestrator.conversation.context_resolved", { action: t("orchestrator.approval_action") })
    : t("orchestrator.conversation.limited", { title: subject.title, state: subject.state });
  const status = limited ? t("orchestrator.conversation.status_sample") : pending
    ? t("orchestrator.conversation.status_draft", { agent })
    : statusKey
      ? t(statusKey.key, statusKey.params)
      : snap.agents[subject.agentId] === "paused"
        ? t("orchestrator.conversation.status_paused", { agent })
        : t("orchestrator.conversation.status_sample");

  return (
    <Sheet open={open} onOpenChange={onOpenChange} onOpenChangeComplete={(o) => { if (!o) onClosed(); }}>
      <SheetContent
        side="right"
        data-testid="conversation-panel"
        data-conversation-panel
        initialFocus={inputRef}
        finalFocus={finalFocus}
        className="data-[side=right]:w-full data-[side=right]:max-w-none data-[side=right]:sm:max-w-md motion-reduce:transition-none"
      >
        <SheetHeader className="gap-1 border-b border-border px-4 py-3 pe-14">
          <SheetTitle className="text-sm font-semibold">{t("orchestrator.conversation.title", { agent })}</SheetTitle>
          <p className="text-xs">{contextLine}</p>
          <p className="text-xs text-muted-foreground">{t("orchestrator.conversation.sample_notice")}</p>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <div role="log" aria-live="polite" aria-relevant="additions" aria-busy={pending} className="flex flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex flex-col gap-2"}>
                {m.role === "user" ? (
                  <p className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm">{m.text}</p>
                ) : (
                  <>
                    <p className="text-sm">{m.text}</p>
                    {m.approval ? (
                      snap.approvalWaiting && !limited
                        ? <ApprovalCard locked={false} inline />
                        : <p className="text-xs text-muted-foreground">{t("orchestrator.conversation.approval_resolved")}</p>
                    ) : null}
                  </>
                )}
              </div>
            ))}
            {pending ? (
              <p data-testid="conversation-typing" className="text-xs text-muted-foreground">
                {t("orchestrator.conversation.typing", { agent })}
              </p>
            ) : null}
          </div>
          <div ref={endRef} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <p role="status" className="text-xs text-muted-foreground">{status}</p>
          <details className="group text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
              {t("orchestrator.conversation.details")}
            </summary>
            <p className="pt-1">{t("orchestrator.conversation.details_body")}</p>
          </details>
          <div className="flex flex-wrap gap-1.5">
            {CONVERSATION_STARTERS.map((s) => (
              <Button key={s.id} variant="outline" size="xs" disabled={pending} onClick={() => send(s.text)}>
                {t(s.labelKey)}
              </Button>
            ))}
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); send(draft); }}
          >
            <Textarea
              ref={inputRef}
              rows={1}
              value={draft}
              aria-label={t("orchestrator.conversation.input_label", { agent })}
              className="max-h-32 min-h-9 flex-1 py-2 text-sm"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
            />
            <Button type="submit" size="sm" disabled={pending || !draft.trim()}>
              <SendIcon className="size-4" aria-hidden="true" />
              {t("orchestrator.conversation.send")}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
