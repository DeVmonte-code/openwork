declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};

import { discussionDraft, discussionWorkspace, originChatAvailable, type NeedOrigin } from "./orchestrator-discussion";

const available = [{ id: "origin-workspace", label: "Origin" }, { id: "current-workspace", label: "Current" }];
const localOrigin: NeedOrigin = { kind: "chat", surface: "web", workspaceId: "origin-workspace", chatId: "sample-chat" };
const remoteOrigin: NeedOrigin = { kind: "chat", surface: "desktop", workspaceId: "elsewhere", chatId: "other-chat" };

describe("Orchestrator discussion destination", () => {
  test("uses the originating workspace when it is on this device", () => {
    expect(discussionWorkspace(localOrigin, available, "current-workspace")).toBe("origin-workspace");
  });
  test("uses the current workspace when the origin is not on this device", () => {
    expect(discussionWorkspace(remoteOrigin, available, "current-workspace")).toBe("current-workspace");
  });
  test("uses the first available workspace when none is currently in use", () => {
    expect(discussionWorkspace(remoteOrigin, available)).toBe("origin-workspace");
    expect(discussionWorkspace(remoteOrigin, available, "not-available")).toBe("origin-workspace");
  });
  test("has no destination when no workspaces are available", () => {
    expect(discussionWorkspace(localOrigin, [], "origin-workspace")).toBe(null);
  });
  test("uses current or first workspace for outside-tool and Orchestrator origins", () => {
    expect(discussionWorkspace({ kind: "outside-tool" }, available, "current-workspace")).toBe("current-workspace");
    expect(discussionWorkspace({ kind: "orchestrator" }, available)).toBe("origin-workspace");
  });
  test("only offers Open chat for a chat origin whose workspace is available", () => {
    expect(originChatAvailable(localOrigin, available)).toBe(true);
    expect(originChatAvailable(remoteOrigin, available)).toBe(false);
    expect(originChatAvailable(localOrigin, [])).toBe(false);
    expect(originChatAvailable({ kind: "outside-tool" }, available)).toBe(false);
    expect(originChatAvailable({ kind: "orchestrator" }, available)).toBe(false);
  });
});

describe("Orchestrator discussion draft", () => {
  const item = { title: "Sender approval", state: "waiting for approval", agent: "Sender", action: "Send reply to 1 recipient." };
  const templates = { normal: "{title} is {state}. {agent} needs input on: {action}", limited: "{title} is {state}." };
  const url = "https://example.test/orchestrator";
  test("normal draft includes the action, agent and link back", () => {
    expect(discussionDraft(item, false, url, templates)).toBe(
      "Sender approval is waiting for approval. Sender needs input on: Send reply to 1 recipient.\n\nhttps://example.test/orchestrator",
    );
  });
  test("limited draft contains only title, state and link back", () => {
    expect(discussionDraft(item, true, url, templates)).toBe(
      "Sender approval is waiting for approval.\n\nhttps://example.test/orchestrator",
    );
  });
  test("limited draft never expands protected tokens even in an incorrect template", () => {
    expect(discussionDraft(item, true, url, { ...templates, limited: "{title}: {state}; {agent}{action}" })).toBe(
      "Sender approval: waiting for approval;\n\nhttps://example.test/orchestrator",
    );
  });
});