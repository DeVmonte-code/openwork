import type { DiscussionSummary } from "./orchestrator-discussion";
import type { AgentId, OrchestratorSnapshot } from "./orchestrator-preview";

export type ConversationSubject = DiscussionSummary & {
  agentId: AgentId;
  source: "approval" | "question" | "outsideQuestion" | "agent";
};
type StarterId = "waiting" | "send" | "approval";
export const CONVERSATION_STARTERS: readonly { id: StarterId; labelKey: string; text: string }[] = [
  { id: "waiting", labelKey: "orchestrator.conversation.starter_waiting", text: "What are you waiting for?" },
  { id: "send", labelKey: "orchestrator.conversation.starter_send", text: "What will you send?" },
  { id: "approval", labelKey: "orchestrator.conversation.starter_approval", text: "Why does this need my approval?" },
];
export type SampleConversationReply = {
  messageKey: string;
  params: Record<string, string | number>;
  statusKey: string;
  includeApproval: boolean;
};
type ConversationSnapshot = Pick<OrchestratorSnapshot, "approvalWaiting" | "questionOpen" | "outsideQuestionOpen" | "agents">;
const key = (name: string) => `orchestrator.conversation.${name}`;

// A deterministic rehearsal only: no model, tools, I/O, or state mutations.
export function sampleConversationReply(
  subject: ConversationSubject,
  snapshot: ConversationSnapshot,
  message: string,
  limited = false,
): SampleConversationReply {
  if (limited) {
    return {
      messageKey: key("limited"),
      params: { title: subject.title, state: subject.state },
      statusKey: key("status_sample"),
      includeApproval: false,
    };
  }
  const params = { agent: subject.agent, action: subject.action, title: subject.title, state: subject.state };
  const paused = snapshot.agents[subject.agentId] === "paused";
  const statusKey = key(paused ? "status_paused" : "status_draft");
  const starter = CONVERSATION_STARTERS.find(candidate => candidate.text.toLowerCase() === message.trim().toLowerCase());
  if (!starter) return { messageKey: key("fallback"), params, statusKey, includeApproval: false };
  const sender = subject.agentId === "sender";
  if (starter.id === "send") {
    return { messageKey: key(sender ? "send_sender" : "send_other"), params, statusKey, includeApproval: false };
  }
  if (starter.id === "approval") {
    return { messageKey: key(sender ? "approval_sender" : "approval_other"), params, statusKey, includeApproval: false };
  }
  if (sender) {
    return {
      messageKey: key(snapshot.approvalWaiting ? "waiting_sender" : "waiting_sender_done"),
      params,
      statusKey,
      includeApproval: snapshot.approvalWaiting,
    };
  }
  const needsAnswer = (subject.agentId === "drafter" && snapshot.questionOpen)
    || (subject.agentId === "research" && snapshot.outsideQuestionOpen);
  return {
    messageKey: key(paused ? "waiting_paused" : needsAnswer ? "waiting_question" : "waiting_agent"),
    params,
    statusKey,
    includeApproval: false,
  };
}