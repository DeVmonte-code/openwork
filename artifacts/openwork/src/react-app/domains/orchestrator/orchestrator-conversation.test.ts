declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};
import { CONVERSATION_STARTERS, sampleConversationReply, type ConversationInput, type ConversationSubject, type StarterId } from "./orchestrator-conversation";
import { orchestratorPreview } from "./orchestrator-preview";

const subject: ConversationSubject = {
  agentId: "sender", source: "approval", title: "Sender approval",
  state: "waiting for approval", agent: "Sender", action: "approve sending a reply to 1 recipient",
};
const snapshot = orchestratorPreview.getSnapshot();
const starterInput = (id: StarterId, label = "Sample starter label"): ConversationInput => ({ kind: "starter", id, label });
describe("Sample agent conversation", () => {
  test("waiting starter includes the same pending sample approval", () => {
    const reply = sampleConversationReply(subject, snapshot, starterInput("waiting"));
    expect(reply.messageKey).toBe("orchestrator.conversation.waiting_sender");
    expect(reply.includeApproval).toBe(true);
  });
  test("send starter describes the sample reply", () => {
    expect(sampleConversationReply(subject, snapshot, starterInput("send")).messageKey).toBe("orchestrator.conversation.send_sender");
  });
  test("approval starter explains the sample risk", () => {
    expect(sampleConversationReply(subject, snapshot, starterInput("approval")).messageKey).toBe("orchestrator.conversation.approval_sender");
  });
  test("other typed text uses one polite fallback", () => {
    const reply = sampleConversationReply(subject, snapshot, { kind: "text", text: "Tell me everything" });
    expect(reply.messageKey).toBe("orchestrator.conversation.fallback");
    expect(reply.includeApproval).toBe(false);
  });
  test("typed approve does not mutate or resolve anything", () => {
    expect(sampleConversationReply(subject, snapshot, { kind: "text", text: "approve" }).messageKey).toBe("orchestrator.conversation.fallback");
    expect(orchestratorPreview.getSnapshot()).toEqual(snapshot);
    expect(snapshot.approvalWaiting).toBe(true);
  });
  test("answers are deterministic", () => {
    for (const starter of CONVERSATION_STARTERS) {
      expect(sampleConversationReply(subject, snapshot, starterInput(starter.id))).toEqual(sampleConversationReply(subject, snapshot, starterInput(starter.id)));
    }
  });
  test("limited view contains only title and state, with no approval card", () => {
    const inputs: ConversationInput[] = [
      ...CONVERSATION_STARTERS.map(starter => starterInput(starter.id)),
      { kind: "text", text: "approve" },
    ];
    for (const input of inputs) {
      const reply = sampleConversationReply(subject, snapshot, input, true);
      expect(reply.params).toEqual({ title: subject.title, state: subject.state });
      expect(reply.messageKey).toBe("orchestrator.conversation.limited");
      expect(reply.includeApproval).toBe(false);
    }
  });
  test("typed starter wording and identifiers always use the fallback", () => {
    for (const text of ["What are you waiting for?", "What will you send?", "Why does this need my approval?", " WHAT WILL YOU SEND? ", "waiting", "send", "approval"]) {
      const reply = sampleConversationReply(subject, snapshot, { kind: "text", text });
      expect(reply.messageKey).toBe("orchestrator.conversation.fallback");
      expect(reply.includeApproval).toBe(false);
    }
    expect(orchestratorPreview.getSnapshot()).toEqual(snapshot);
  });
  test("each starter reply is independent of the language or wording of its label", () => {
    for (const starter of CONVERSATION_STARTERS) {
      const baseline = sampleConversationReply(subject, snapshot, starterInput(starter.id));
      for (const label of ["What will you send?", "¿Qué vas a enviar?", "Qu’allez-vous envoyer ?", "何を送りますか？"]) {
        expect(sampleConversationReply(subject, snapshot, starterInput(starter.id, label))).toEqual(baseline);
      }
    }
  });
  test("resolved approval no longer offers the inline card", () => {
    const reply = sampleConversationReply(subject, { ...snapshot, approvalWaiting: false }, starterInput("waiting"));
    expect(reply.messageKey).toBe("orchestrator.conversation.waiting_sender_done");
    expect(reply.includeApproval).toBe(false);
  });
  test("other agents describe the existing sample question without sending", () => {
    const question: ConversationSubject = { ...subject, agentId: "drafter", source: "question", agent: "Drafter", action: "choose a sender address" };
    expect(sampleConversationReply(question, snapshot, starterInput("waiting")).messageKey).toBe("orchestrator.conversation.waiting_question");
    expect(sampleConversationReply(question, snapshot, starterInput("send")).messageKey).toBe("orchestrator.conversation.send_other");
    expect(sampleConversationReply(question, snapshot, starterInput("approval")).messageKey).toBe("orchestrator.conversation.approval_other");
  });
  test("paused agent status and answer agree with sample state", () => {
    const agent: ConversationSubject = { ...subject, agentId: "intake", source: "agent", agent: "Intake" };
    const reply = sampleConversationReply(agent, { ...snapshot, agents: { ...snapshot.agents, intake: "paused" } }, starterInput("waiting"));
    expect(reply.messageKey).toBe("orchestrator.conversation.waiting_paused");
    expect(reply.statusKey).toBe("orchestrator.conversation.status_paused");
  });
});