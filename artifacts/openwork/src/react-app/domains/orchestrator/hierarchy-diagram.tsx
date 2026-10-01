/** @jsxImportSource react */
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { getRelationship, type Hierarchy } from "./hierarchy-rules";
import { Muted, levelName, useNames } from "./hierarchy-labels";

const NW = 176, NH = 44, GX = 16, GY = 76;

export function Diagram({ h, selected, onSelect }: { h: Hierarchy; selected: string | null; onSelect: (id: string) => void }) {
  const name = useNames(h);
  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    let leaf = 0;
    const place = (id: string, depth: number, trail: Set<string>): number => {
      trail.add(id);
      const kids = h.agents.filter((agent) => getRelationship(h, agent.id)?.managerId === id)
        .filter((k) => !trail.has(k.id) && !pos.has(k.id));
      let x: number;
      if (!kids.length) { x = leaf++ * (NW + GX); } else {
        const xs = kids.map((k) => place(k.id, depth + 1, trail));
        x = (xs[0] + xs[xs.length - 1]) / 2;
      }
      pos.set(id, { x, y: depth * (NH + GY) });
      return x;
    };
    place(h.topId, 0, new Set());
    const width = Math.max(leaf, 1) * (NW + GX) - GX;
    const height = Math.max(...Array.from(pos.values()).map((p) => p.y), 0) + NH;
    return { pos, width, height };
  }, [h]);
  const orphans = h.agents.filter((a) => !layout.pos.has(a.id));
  const edges = h.relationships.filter((r) => r.status === "active" && layout.pos.has(r.agentId) && layout.pos.has(r.managerId));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto border-y border-border py-4">
        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }} role="group" aria-label={t("orchestrator.h_diagram_label")}>
          <svg className="pointer-events-none absolute inset-0 text-muted-foreground" width={layout.width} height={layout.height} aria-hidden="true">
            {edges.map((r) => {
              const p = layout.pos.get(r.managerId)!;
              const c = layout.pos.get(r.agentId)!;
              const x1 = p.x + NW / 2, y1 = p.y + NH, x2 = c.x + NW / 2, y2 = c.y;
              const my = y1 + GY / 2;
              const line = (dx: number, w: number, dash?: string) => (
                <path d={`M${x1 + dx} ${y1} V${my} H${x2 + dx} V${y2}`} fill="none" stroke="currentColor" strokeWidth={w} strokeDasharray={dash} />
              );
              return <g key={r.id}>{line(-3, 0.5 + r.control * 0.4)}{line(3, 0.5 + r.reliance * 0.4, "4 3")}</g>;
            })}
          </svg>
          {edges.map((r) => {
            const parent = layout.pos.get(r.managerId)!;
            const child = layout.pos.get(r.agentId)!;
            return (
              <div
                key={`levels-${r.id}`}
                className="absolute bg-background px-1 text-center text-xs text-muted-foreground"
                style={{ left: child.x, top: parent.y + NH + GY / 2 + 4, width: NW }}
                aria-label={t("orchestrator.h_edge", {
                  agent: name(r.agentId), manager: name(r.managerId),
                  control: levelName(r.control), reliance: levelName(r.reliance),
                })}
              >
                <span className="block">{t("orchestrator.h_col_control")}: {r.control} · {levelName(r.control)}</span>
                <span className="block">{t("orchestrator.h_col_reliance")}: {r.reliance} · {levelName(r.reliance)}</span>
              </div>
            );
          })}
          {h.agents.filter((a) => layout.pos.has(a.id)).map((a) => {
            const p = layout.pos.get(a.id)!;
            const rel = getRelationship(h, a.id);
            const label = rel
              ? t("orchestrator.h_edge", { agent: name(a.id), manager: name(rel.managerId), control: levelName(rel.control), reliance: levelName(rel.reliance) })
              : t("orchestrator.h_select_agent", { agent: name(a.id) });
            return (
              <Button
                key={a.id} variant="outline" aria-label={label} aria-current={selected === a.id}
                onClick={() => onSelect(a.id)}
                className="absolute flex items-center justify-center truncate rounded-md border border-border bg-background px-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 aria-[current=true]:bg-muted"
                style={{ left: p.x, top: p.y, width: NW, height: NH }}
              >
                {name(a.id)}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-1">
        <Muted>{t("orchestrator.h_legend_control")}</Muted>
        <Muted>{t("orchestrator.h_legend_reliance")}</Muted>
      </div>
      {orphans.length ? (
        <section aria-labelledby="h-d-orphans" className="flex flex-col gap-1">
          <h3 id="h-d-orphans" className="px-1 text-xs font-medium text-muted-foreground">{t("orchestrator.h_without_manager")}</h3>
          <ul className="flex flex-wrap gap-2">
            {orphans.map((a) => (
              <li key={a.id}>
                <Button variant="outline" size="sm" aria-current={selected === a.id} onClick={() => onSelect(a.id)}>{name(a.id)}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}


