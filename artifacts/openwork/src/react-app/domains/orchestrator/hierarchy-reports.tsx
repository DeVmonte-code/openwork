/** @jsxImportSource react */
import { t } from "@/i18n";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { directReports, getRelationship, managerChain, spanOfControl, type Hierarchy, type HierarchyIssue } from "./hierarchy-rules";
import { SEP, issueText, levelLabel, levelName, useNames } from "./hierarchy-labels";

export function managerRows(h: Hierarchy) {
  return h.agents.filter((a) => a.id === h.topId || spanOfControl(h, a.id) > 0);
}

export function SpanTable({ h }: { h: Hierarchy }) {
  const name = useNames(h);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("orchestrator.h_col_manager")}</TableHead>
          <TableHead>{t("orchestrator.h_col_reports")}</TableHead>
          <TableHead>{t("orchestrator.h_col_count")}</TableHead>
          <TableHead>{t("orchestrator.h_col_limit")}</TableHead>
          <TableHead>{t("orchestrator.h_col_over")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {managerRows(h).map((m) => {
          const rs = directReports(h, m.id);
          const over = rs.length > h.spanLimit;
          return (
            <TableRow key={m.id} className="h-11">
              <TableCell className="font-medium">{name(m.id)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{rs.map((r) => name(r.id)).join(", ") || t("orchestrator.h_none")}</TableCell>
              <TableCell>{rs.length}</TableCell>
              <TableCell>{h.spanLimit}</TableCell>
              <TableCell>{t(over ? "orchestrator.h_yes" : "orchestrator.h_no")}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function DepsTable({ h }: { h: Hierarchy }) {
  const name = useNames(h);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("orchestrator.h_col_agent")}</TableHead>
          <TableHead>{t("orchestrator.h_col_manager")}</TableHead>
          <TableHead>{t("orchestrator.h_col_reliance")}</TableHead>
          <TableHead>{t("orchestrator.h_col_control")}</TableHead>
          <TableHead>{t("orchestrator.h_col_escalation")}</TableHead>
          <TableHead>{t("orchestrator.h_col_path")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {h.agents.map((a) => {
          const rel = getRelationship(h, a.id);
          const chain = managerChain(h, a.id);
          const ok = a.id === h.topId || (chain.length > 0 && chain[chain.length - 1].id === h.topId);
          const path = [
            ...chain.map((c) => name(c.id)),
            ...(ok ? [] : [t("orchestrator.h_without_manager")]),
            t("orchestrator.h_a_person"),
          ].join(SEP);
          return (
            <TableRow key={a.id} className="h-11">
              <TableCell className="font-medium">{name(a.id)}</TableCell>
              <TableCell>{rel ? name(rel.managerId) : t("orchestrator.h_no_manager")}</TableCell>
              <TableCell>{rel ? levelLabel(rel.reliance) : t("orchestrator.h_none")}</TableCell>
              <TableCell>{rel ? levelLabel(rel.control) : t("orchestrator.h_none")}</TableCell>
              <TableCell>{rel ? levelLabel(rel.escalation) : t("orchestrator.h_none")}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{path}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function ExceptionsTable({ issues, h }: { issues: HierarchyIssue[]; h: Hierarchy }) {
  const name = useNames(h);
  if (!issues.length) return <p className="px-1 text-sm text-muted-foreground">{t("orchestrator.h_exceptions_empty")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("orchestrator.h_col_severity")}</TableHead>
          <TableHead>{t("orchestrator.h_col_what")}</TableHead>
          <TableHead>{t("orchestrator.h_col_agent")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((i, n) => (
          <TableRow key={`${i.code}-${i.agentId}-${n}`} className="h-11">
            <TableCell className="font-medium">{t(`orchestrator.h_sev_${i.severity}`)}</TableCell>
            <TableCell className="whitespace-nowrap">{issueText(i, name)}</TableCell>
            <TableCell>{name(i.agentId)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MatrixTable({ h }: { h: Hierarchy }) {
  const name = useNames(h);
  const cols = h.agents.filter((a) => !!getRelationship(h, a.id));
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><span className="sr-only">{t("orchestrator.h_matrix_corner")}</span></TableHead>
            {cols.map((c) => <TableHead key={c.id}>{name(c.id)}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {managerRows(h).map((m) => (
            <TableRow key={m.id} className="h-11">
              <TableHead scope="row" className="font-medium text-foreground">{name(m.id)}</TableHead>
              {cols.map((c) => {
                const rel = getRelationship(h, c.id);
                if (!rel || rel.managerId !== m.id) {
                  return (
                    <TableCell key={c.id} className="text-muted-foreground">
                      <span aria-hidden="true">{"\u2014"}</span>
                      <span className="sr-only">{t("orchestrator.h_matrix_cell_none", { manager: name(m.id), agent: name(c.id) })}</span>
                    </TableCell>
                  );
                }
                return (
                  <TableCell key={c.id}>
                    <span aria-hidden="true">{rel.control} / {rel.reliance}</span>
                    <span className="sr-only">
                      {t("orchestrator.h_matrix_cell", { manager: name(m.id), agent: name(c.id), control: levelName(rel.control), reliance: levelName(rel.reliance) })}
                    </span>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}


