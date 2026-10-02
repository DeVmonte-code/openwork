// Sample-only origin metadata. Never put conversation contents in an origin.
export type NeedOrigin =
  | { kind: "chat"; surface: "desktop" | "web"; workspaceId: string; chatId: string }
  | { kind: "outside-tool" }
  | { kind: "orchestrator" };

export type DiscussionWorkspace = { id: string; label: string };

export function discussionWorkspace(
  origin: NeedOrigin,
  available: readonly DiscussionWorkspace[],
  currentWorkspaceId?: string | null,
): string | null {
  if (origin.kind === "chat" && available.some((workspace) => workspace.id === origin.workspaceId)) {
    return origin.workspaceId;
  }
  return available.find((workspace) => workspace.id === currentWorkspaceId)?.id
    ?? available[0]?.id
    ?? null;
}

export function originChatAvailable(origin: NeedOrigin, available: readonly DiscussionWorkspace[]): boolean {
  return origin.kind === "chat" && available.some((workspace) => workspace.id === origin.workspaceId);
}

export type DiscussionSummary = {
  title: string;
  state: string;
  agent: string;
  action: string;
};

export function discussionDraft(
  item: DiscussionSummary,
  limited: boolean,
  templates: { normal: string; limited: string },
): string {
  // In limited view even a template containing an agent/action token cannot leak it.
  const visible: Record<string, string> = limited
    ? { title: item.title, state: item.state }
    : { title: item.title, state: item.state, agent: item.agent, action: item.action };
  const template = limited ? templates.limited : templates.normal;
  const summary = template.replace(/\{(title|state|agent|action)\}/g, (_token, key: string) => visible[key] ?? "").trim();
  return summary;
}