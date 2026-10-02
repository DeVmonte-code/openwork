declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};
import { CONVERSATION_STARTERS, sampleConversationReply, type ConversationSubject } from "./orchestrator-conversation";
import { orchestratorPreview } from "./orchestrator-preview";

const subject: ConversationSubject = {
  agentId: "sender", source: "approval", title: "Sender approval",
  state: "waiting for approval", agent: "Sender", action: "approve sending a reply to 1 recipient",
};
const snapshot = orchestratorPreview.getSnapshot();
describe("Sample agent conversation", () => {
  test("waiting starter includes the same pending sample approval", () => {
    const reply = sampleConversationReply(subject, snapshot, "What are you waiting for?");
    expect(reply.messageKey).toBe("orchestrator.conversation.waiting_sender");
    expect(reply.includeApproval).toBe(true);
  });
  test("send starter describes the sample reply", () => {
    expect(sampleConversationReply(subject, snapshot, "What will you send?").messageKey).toBe("orchestrator.conversation.send_sender");
  });
  test("approval starter explains the sample risk", () => {
    expect(sampleConversationReply(subject, snapshot, "Why does this need my approval?").messageKey).toBe("orchestrator.conversation.approval_sender");
  });
  test("other typed text uses one polite fallback", () => {
    const reply = sampleConversationReply(subject, snapshot, "Tell me everything");
    expect(reply.messageKey).toBe("orchestrator.conversation.fallback");
    expect(reply.includeApproval).toBe(false);
  });
  test("typed approve does not mutate or resolve anything", () => {
    expect(sampleConversationReply(subject, snapshot, "approve").messageKey).toBe("orchestrator.conversation.fallback");
    expect(orchestratorPreview.getSnapshot()).toEqual(snapshot);
    expect(snapshot.approvalWaiting).toBe(true);
  });
  test("answers are deterministic", () => {
    for (const starter of CONVERSATION_STARTERS) {
      expect(sampleConversationReply(subject, snapshot, starter.text)).toEqual(sampleConversationReply(subject, snapshot, starter.text));
    }
  });
  test("limited view contains only title and state, with no approval card", () => {
    for (const text of [...CONVERSATION_STARTERS.map(starter => starter.text), "approve"]) {
      const reply = sampleConversationReply(subject, snapshot, text, true);
      expect(reply.params).toEqual({ title: subject.title, state: subject.state });
      expect(reply.messageKey).toBe("orchestrator.conversation.limited");
      expect(reply.includeApproval).toBe(false);
    }
  });
  test("starter matching ignores surrounding space and case", () => {
    expect(sampleConversationReply(subject, snapshot, " WHAT WILL YOU SEND? ").messageKey).toBe("orchestrator.conversation.send_sender");
  });
  test("resolved approval no longer offers the inline card", () => {
    const reply = sampleConversationReply(subject, { ...snapshot, approvalWaiting: false }, "What are you waiting for?");
    expect(reply.messageKey).toBe("orchestrator.conversation.waiting_sender_done");
    expect(reply.includeApproval).toBe(false);
  });
  test("other agents describe the existing sample question without sending", () => {
    const question: ConversationSubject = { ...subject, agentId: "drafter", source: "question", agent: "Drafter", action: "choose a sender address" };
    expect(sampleConversationReply(question, snapshot, "What are you waiting for?").messageKey).toBe("orchestrator.conversation.waiting_question");
    expect(sampleConversationReply(question, snapshot, "What will you send?").messageKey).toBe("orchestrator.conversation.send_other");
    expect(sampleConversationReply(question, snapshot, "Why does this need my approval?").messageKey).toBe("orchestrator.conversation.approval_other");
  });
  test("paused agent status and answer agree with sample state", () => {
    const agent: ConversationSubject = { ...subject, agentId: "intake", source: "agent", agent: "Intake" };
    const reply = sampleConversationReply(agent, { ...snapshot, agents: { ...snapshot.agents, intake: "paused" } }, "What are you waiting for?");
    expect(reply.messageKey).toBe("orchestrator.conversation.waiting_paused");
    expect(reply.statusKey).toBe("orchestrator.conversation.status_paused");
  });
});