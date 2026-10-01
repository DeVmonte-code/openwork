import { getSessionDraft } from "@/react-app/domains/session/sync/draft-store";
import { newSessionDraftOwnerKey, newSessionDraftSlot } from "@/react-app/domains/session/chat/new-session-destination";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { t } from "@/i18n";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";

/**
 * Seeds the ordinary new-task composer in memory, then opens its existing
 * workspace destination. Sending remains an explicit action in that composer.
 */
export function openOrchestratorDiscussion(
  scope: string | null | undefined,
  workspaceId: string,
  draft: string,
  navigate: (path: string) => void,
) {
  const destination = { workspaceId };
  const ownerKey = newSessionDraftOwnerKey(scope, destination);
  if (!ownerKey) throw new Error(t("orchestrator.discuss_destination_unavailable"));

  const composer = useComposerStateStore.getState();
  const existingState = composer.sessions[ownerKey];
  const persistedText = getSessionDraft(scope, workspaceId, newSessionDraftSlot(destination))?.text ?? "";
  const existingText = existingState?.draft ?? persistedText;
  const combinedDraft = existingText.trim()
    ? `${existingText}${/\s$/.test(existingText) ? "" : "\n\n"}${draft}`
    : draft;

  composer.setDraft(ownerKey, combinedDraft);
  // This is the same new-task destination route. The general entry command also
  // persists pane focus; this sample-only handoff must not write layout storage.
  navigate(workspaceSessionRoute(destination.workspaceId));
}