/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { emptyAgentDraft, type AgentDraft, type DraftContext } from "./agent-draft";
import { checkAgentDraft } from "./agent-rules";
import { useOrchestratorPreview } from "./orchestrator-preview";
import { BuilderConfigure } from "./builder-configure";
import { BuilderPreview } from "./builder-preview";
import { bt } from "./builder-shared";
import "./agent-builder.css";

type BuilderTab = "configure" | "preview";

// Draft lives in this component only: closing unmounts and discards it.
export function AgentBuilder({ onClose }: { onClose: () => void }) {
  const snap = useOrchestratorPreview();
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [tab, setTab] = useState<BuilderTab>("configure");
  const [checked, setChecked] = useState(false);
  const agents = snap.hierarchy.agents;
  const context = useMemo<DraftContext>(() => ({
    agents: agents.map((a) => ({ id: a.id, name: t(a.nameKey), slug: a.id, active: a.state !== "draft" && a.state !== "retired" && a.state !== "stopped" })),
  }), [agents]);
  const issues = useMemo(() => checkAgentDraft(draft, context), [draft, context]);
  const update = (change: (d: AgentDraft) => AgentDraft) => setDraft(change);

  return (
    <section data-agent-builder aria-labelledby="ab-title" className="flex flex-col gap-4 border-y border-border py-4 motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:animate-none">
      <div className="flex items-center justify-between gap-3">
        <h2 id="ab-title" className="text-base font-semibold tracking-tight">{bt("title")}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-builder">{bt("discard")}</Button>
      </div>
      <Tabs value={tab} onValueChange={(v) => { const next: BuilderTab = v === "preview" ? "preview" : "configure"; if (next === "preview") setChecked(true); setTab(next); }}>
        <TabsList variant="line" activateOnFocus aria-label={bt("tabs_label")}>
          <TabsTrigger value="configure" id="ab-tab-configure">{bt("tab_configure")}</TabsTrigger>
          <TabsTrigger value="preview" id="ab-tab-preview">{bt("tab_preview")}</TabsTrigger>
        </TabsList>
        <TabsContent value="configure" keepMounted className="motion-reduce:transition-none pt-2">
          <BuilderConfigure draft={draft} update={update} context={context} issues={issues} show={checked} />
        </TabsContent>
        <TabsContent value="preview" keepMounted className="motion-reduce:transition-none pt-2">
          <BuilderPreview draft={draft} context={context} issues={issues} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
