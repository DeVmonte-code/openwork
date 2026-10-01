/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { ChevronRightIcon, LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { Diagram } from "./hierarchy-diagram";
import { LEVELS, Muted, SEP, issueText, levelLabel, levelName, stateText, useNames } from "./hierarchy-labels";
import { DepsTable, ExceptionsTable, MatrixTable, SpanTable } from "./hierarchy-reports";
import {
  getRelationship,
  listExceptions,
  managerChain,
  managerOf,
  spanOfControl,
  validateChangeManager,
  type ChangeManagerInput,
  type Hierarchy,
  type HierarchyAgent,
  type HierarchyIssue,
} from "./hierarchy-rules";
import { orchestratorPreview, useOrchestratorPreview } from "./orchestrator-preview";

type PreviewState = "default" | "empty" | "locked";

/* ---------- change manager dialog ---------- */

function LevelSelect({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const items = LEVELS.map((n) => ({ value: String(n), label: levelLabel(n) }));
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <span className="min-w-0 text-sm">{label}</span>
      <Select items={items} value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger size="sm" className="w-40 shrink-0" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ChangeManagerDialog({ h, agentId, onClose }: { h: Hierarchy; agentId: string; onClose: () => void }) {
  const name = useNames(h);
  const current = getRelationship(h, agentId);
  const [input, setInput] = useState<ChangeManagerInput>({
    agentId,
    managerId: current?.managerId ?? h.topId,
    control: current?.control ?? 3,
    reliance: current?.reliance ?? 3,
    escalation: current?.escalation ?? 3,
  });
  const issues = validateChangeManager(h, input);
  const refusal = issues.find((i) => i.severity === "refusal");
  const warning = issues.find((i) => i.severity === "warning");
  const unchanged = !!current && current.managerId === input.managerId && current.control === input.control
    && current.reliance === input.reliance && current.escalation === input.escalation;
  const shown = refusal ?? warning;
  const message = shown ? issueText(shown, name) : t(unchanged ? "orchestrator.h_noop" : "orchestrator.h_ready");
  const managerItems = h.agents.map((a) => ({ value: a.id, label: t(a.nameKey) }));

  const save = () => {
    const result = orchestratorPreview.changeManager(input);
    if (!result.changed) {
      const r = result.issues.find((i) => i.severity === "refusal");
      toast(r ? issueText(r, name) : t("orchestrator.h_toast_noop"));
      onClose();
      return;
    }
    toast.undo(t("orchestrator.h_toast_changed", { agent: name(agentId), manager: name(input.managerId) }), {
      undo: {
        label: t("common.undo"),
        onClick: () => {
          const u = result.undo();
          if (!u.undone) {
            const r = u.issues[0];
            toast(r ? issueText(r, name) : t("orchestrator.h_undo_blocked"));
          }
        },
      },
      closeLabel: t("common.close"),
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="lg:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("orchestrator.h_dialog_title", { agent: name(agentId) })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col divide-y divide-border">
          <div className="flex min-h-10 items-center justify-between gap-3 pb-2">
            <span className="text-sm">{t("orchestrator.h_new_manager")}</span>
            <Select items={managerItems} value={input.managerId} onValueChange={(v) => v && setInput({ ...input, managerId: v })}>
              <SelectTrigger size="sm" className="w-40 shrink-0" aria-label={t("orchestrator.h_new_manager")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {h.agents.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.state === "retired"}>{t(a.nameKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <LevelSelect label={t("orchestrator.h_field_control")} value={input.control} onChange={(control) => setInput({ ...input, control })} />
          <LevelSelect label={t("orchestrator.h_field_reliance")} value={input.reliance} onChange={(reliance) => setInput({ ...input, reliance })} />
          <LevelSelect label={t("orchestrator.h_field_escalation")} value={input.escalation} onChange={(escalation) => setInput({ ...input, escalation })} />
        </div>
        <p
          role={refusal ? "alert" : "status"}
          className="flex items-start gap-2 text-xs text-muted-foreground"
        >
          {refusal ? <LockIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
          {message}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={!!refusal} onClick={save}>{t("orchestrator.h_save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- tree ---------- */

type Row = { agent: HierarchyAgent; depth: number };

// Tree placement follows reporting relationships, not the lifecycle-filtered span.
const reportingChildren = (h: Hierarchy, id: string) =>
  h.agents.filter((agent) => getRelationship(h, agent.id)?.managerId === id);

function buildRows(h: Hierarchy, collapsed: Set<string>) {
  const seen = new Set<string>();
  const walk = (a: HierarchyAgent, depth: number, out: Row[]) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push({ agent: a, depth });
    if (collapsed.has(a.id)) {
      markAll(a.id);
      return;
    }
    for (const c of reportingChildren(h, a.id)) walk(c, depth + 1, out);
  };
  // agents hidden by a collapsed ancestor still count as placed
  const markAll = (id: string) => {
    for (const c of reportingChildren(h, id)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      markAll(c.id);
    }
  };
  const main: Row[] = [];
  const top = h.agents.find((a) => a.id === h.topId);
  if (top) walk(top, 0, main);
  const orphans: Row[] = [];
  // Walk unassigned roots first so their children stay beneath them, regardless
  // of the source array order. A fallback keeps malformed sample data visible.
  for (const a of h.agents) {
    if (!seen.has(a.id) && !managerOf(h, a.id)) walk(a, 1, orphans);
  }
  for (const a of h.agents) {
    if (!seen.has(a.id)) walk(a, 1, orphans);
  }
  return { main, orphans };
}

function TreeList({ h, locked, selected, onSelect, onChange }: {
  h: Hierarchy; locked: boolean; selected: string | null; onSelect: (id: string) => void; onChange: (id: string) => void;
}) {
  const name = useNames(h);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { main, orphans } = useMemo(() => buildRows(h, collapsed), [h, collapsed]);
  const toggle = (id: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const renderRow = ({ agent, depth }: Row) => {
    const span = spanOfControl(h, agent.id);
    const isManager = reportingChildren(h, agent.id).length > 0;
    const open = !collapsed.has(agent.id);
    return (
      <li key={agent.id} className="flex h-11 items-center gap-2 pe-1 text-sm" style={{ paddingInlineStart: `${depth * 20 + 4}px` }}>
        {isManager ? (
          <Button
            variant="ghost" size="icon-xs" aria-expanded={open}
            aria-label={t(open ? "orchestrator.h_collapse" : "orchestrator.h_expand", { agent: name(agent.id) })}
            onClick={() => toggle(agent.id)}
          >
            <ChevronRightIcon className={open ? "rotate-90" : ""} />
          </Button>
        ) : <span className="size-6 shrink-0" aria-hidden="true" />}
        <Button
          variant="ghost" size="xs"
          className="min-w-0 truncate rounded-md px-1 py-1 text-start font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 aria-[current=true]:bg-muted"
          aria-current={selected === agent.id}
          aria-label={t("orchestrator.h_select_agent", { agent: name(agent.id) })}
          onClick={() => onSelect(agent.id)}
        >
          {name(agent.id)}
        </Button>
        <span className="shrink-0 text-xs">{stateText(agent.state)}</span>
        {isManager ? <Muted>{t("orchestrator.h_manages", { count: span, limit: h.spanLimit })}</Muted> : null}
        <span className="flex-1" />
        <Button
          variant="ghost" size="xs" disabled={locked}
          title={locked ? t("orchestrator.h_locked_reason") : undefined}
          aria-label={t("orchestrator.h_change_manager_for", { agent: name(agent.id) })}
          onClick={() => onChange(agent.id)}
        >
          {locked ? <LockIcon aria-hidden="true" /> : null}
          {t("orchestrator.h_change_manager")}
        </Button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border border-y border-border">{main.map(renderRow)}</ul>
      {orphans.length ? (
        <section aria-labelledby="h-orphans" className="flex flex-col gap-1">
          <h3 id="h-orphans" className="px-1 text-xs font-medium text-muted-foreground">{t("orchestrator.h_without_manager")}</h3>
          <ul className="flex flex-col divide-y divide-border border-y border-border">{orphans.map(renderRow)}</ul>
        </section>
      ) : null}
    </div>
  );
}

/* ---------- diagram ---------- */

/* ---------- side panel ---------- */

function Panel({ h, id, locked, onChange }: { h: Hierarchy; id: string | null; locked: boolean; onChange: (id: string) => void }) {
  const name = useNames(h);
  if (!id) return <p className="text-xs text-muted-foreground">{t("orchestrator.h_panel_empty")}</p>;
  const mgr = managerOf(h, id);
  const rel = getRelationship(h, id);
  const chain = managerChain(h, id);
  const reports = reportingChildren(h, id);
  const reachesTop = chain.length > 0 && chain[chain.length - 1].id === h.topId;
  const chainText = [
    ...chain.map((a) => name(a.id)),
    ...(id === h.topId || reachesTop ? [] : [t("orchestrator.h_without_manager")]),
    t("orchestrator.h_a_person"),
  ].join(SEP);
  const row = (k: string, v: string) => (
    <div className="flex h-11 items-center justify-between gap-3 border-b border-border text-sm">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 truncate text-end" title={v}>{v}</dd>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{name(id)}</h3>
        <Button
          variant="outline" size="xs" disabled={locked}
          title={locked ? t("orchestrator.h_locked_reason") : undefined}
          aria-label={t("orchestrator.h_change_manager_for", { agent: name(id) })}
          onClick={() => onChange(id)}
        >{t("orchestrator.h_change_manager")}</Button>
      </div>
      <dl className="flex flex-col">
        {row(t("orchestrator.h_reports_to"), mgr ? name(mgr.id) : t("orchestrator.h_no_manager"))}
        {row(t("orchestrator.h_reliance"), rel ? levelLabel(rel.reliance) : t("orchestrator.h_none"))}
        {row(t("orchestrator.h_control"), rel ? levelLabel(rel.control) : t("orchestrator.h_none"))}
        {row(t("orchestrator.h_escalation"), rel ? levelLabel(rel.escalation) : t("orchestrator.h_none"))}
        {row(t("orchestrator.h_chain"), chainText)}
      </dl>
      <section aria-labelledby="h-panel-manages" className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <h4 id="h-panel-manages" className="text-xs font-medium text-muted-foreground">{t("orchestrator.h_manages_heading")}</h4>
          <Muted>{t("orchestrator.h_manages", { count: spanOfControl(h, id), limit: h.spanLimit })}</Muted>
        </div>
        {reports.length ? (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {reports.map((r) => {
              const rr = getRelationship(h, r.id);
              return (
                <li key={r.id} className="flex min-h-10 items-center justify-between gap-2 text-sm">
                  <span className="truncate">{name(r.id)}</span>
                  {rr ? <Muted>{t("orchestrator.h_report_levels", { control: levelName(rr.control), reliance: levelName(rr.reliance) })}</Muted> : null}
                </li>
              );
            })}
          </ul>
        ) : <Muted>{t("orchestrator.h_no_reports")}</Muted>}
      </section>
    </div>
  );
}

/* ---------- reports ---------- */

/* ---------- view ---------- */

export function HierarchyView({ state, loading }: { state: PreviewState; loading: boolean }) {
  const snap = useOrchestratorPreview();
  const h = snap.hierarchy as Hierarchy;
  const locked = state === "locked";
  const [selected, setSelected] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [diagram, setDiagram] = useState(false);
  const exceptions = useMemo(() => listExceptions(h), [h]);
  const attention = exceptions.filter((i) => i.severity !== "info").length;

  if (state === "empty") {
    return <h2 className="text-sm font-medium">{t("orchestrator.h_empty_title")}</h2>;
  }
  if (loading) {
    return (
      <ul className="flex flex-col divide-y divide-border border-y border-border" aria-busy="true" aria-label={t("orchestrator.h_loading")}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <li key={i} className="flex h-11 items-center gap-3 px-3" style={{ paddingInlineStart: `${(i % 3 === 0 ? 0 : 1) * 20 + 12}px` }}>
            <Skeleton className="h-3.5 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-3.5 flex-1 motion-reduce:animate-none" />
            <Skeleton className="h-3.5 w-16 motion-reduce:animate-none" />
          </li>
        ))}
      </ul>
    );
  }

  const openChange = (id: string) => { if (!locked) setChanging(id); };

  return (
    <div className="flex flex-col gap-4">
      {locked ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LockIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>{t("orchestrator.h_locked_who")}</span>
        </p>
      ) : null}
      <Tabs defaultValue="tree">
        <TabsList variant="line" aria-label={t("orchestrator.h_views")} className="h-10 flex-wrap">
          <TabsTrigger value="tree">{t("orchestrator.h_tab_tree")}</TabsTrigger>
          <TabsTrigger value="span">{t("orchestrator.h_tab_span")}</TabsTrigger>
          <TabsTrigger value="deps">{t("orchestrator.h_tab_deps")}</TabsTrigger>
          <TabsTrigger value="exceptions">
            {t("orchestrator.h_tab_exceptions")}
            {attention > 0 ? <span className="text-xs text-muted-foreground" aria-label={`${attention} ${t("orchestrator.h_attention")}`}>{attention}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="matrix">{t("orchestrator.h_tab_matrix")}</TabsTrigger>
        </TabsList>
        <TabsContent value="tree" className="pt-3">
          <div className={`grid gap-6 ${diagram && !selected ? "" : "lg:grid-cols-[minmax(0,1fr)_19rem]"}`}>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-end gap-1" role="group" aria-label={t("orchestrator.h_layout")}>
                <Button variant={diagram ? "ghost" : "secondary"} size="xs" aria-pressed={!diagram} onClick={() => setDiagram(false)}>{t("orchestrator.h_layout_list")}</Button>
                <Button variant={diagram ? "secondary" : "ghost"} size="xs" aria-pressed={diagram} onClick={() => setDiagram(true)}>{t("orchestrator.h_layout_diagram")}</Button>
              </div>
              {diagram
                ? <Diagram h={h} selected={selected} onSelect={setSelected} />
                : <TreeList h={h} locked={locked} selected={selected} onSelect={setSelected} onChange={openChange} />}
            </div>
            {diagram && !selected ? null : (
              <aside className="lg:border-s lg:border-border lg:ps-6">
                <Panel h={h} id={selected} locked={locked} onChange={openChange} />
              </aside>
            )}
          </div>
        </TabsContent>
        <TabsContent value="span" className="pt-3"><SpanTable h={h} /></TabsContent>
        <TabsContent value="deps" className="pt-3"><DepsTable h={h} /></TabsContent>
        <TabsContent value="exceptions" className="pt-3"><ExceptionsTable h={h} issues={exceptions} /></TabsContent>
        <TabsContent value="matrix" className="pt-3"><MatrixTable h={h} /></TabsContent>
      </Tabs>
      {changing ? <ChangeManagerDialog key={changing} h={h} agentId={changing} onClose={() => setChanging(null)} /> : null}
    </div>
  );
}

export default HierarchyView;
