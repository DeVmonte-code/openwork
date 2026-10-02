/** @jsxImportSource react */
import type { ReactNode } from "react";
import { LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { orchestratorPreview } from "./orchestrator-preview";

// One approval card for both the page and the sample conversation. Same action,
// data, risk, and the same store transition on either surface.
export function ApprovalCard({
  locked,
  inline = false,
  extra,
  footer,
}: {
  locked: boolean;
  inline?: boolean;
  extra?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      data-testid="approval-card"
      className={inline
        ? "flex flex-col gap-3 border-y border-border py-3"
        : "flex flex-col gap-3 rounded-xl border border-border p-4"}
    >
      <p className="text-sm font-medium">{t("orchestrator.approval_action")}</p>
      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("orchestrator.approval_agent")}</dt><dd>{t("orchestrator.approval_sender")}</dd>
        <dt className="text-muted-foreground">{t("orchestrator.approval_data")}</dt><dd>{t("orchestrator.approval_data_value")}</dd>
        <dt className="text-muted-foreground">{t("orchestrator.approval_risk")}</dt><dd>{t("orchestrator.approval_risk_value")}</dd>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline" size="sm" disabled={locked}
            title={locked ? t("orchestrator.approval_locked_reason") : undefined}
            onClick={() => { orchestratorPreview.resolveApproval(); toast(t("orchestrator.toast_declined")); }}
          >
            {locked ? <LockIcon className="size-4" aria-hidden="true" /> : null}
            {t("orchestrator.decline")}
          </Button>
          <Button
            size="sm" disabled={locked}
            title={locked ? t("orchestrator.approval_locked_reason") : undefined}
            onClick={() => { orchestratorPreview.resolveApproval(); toast.success(t("orchestrator.toast_sample_approved")); }}
          >
            {locked ? <LockIcon className="size-4" aria-hidden="true" /> : null}
            {t("orchestrator.approve")}
          </Button>
        </div>
        {extra}
      </div>
      {locked ? <p className="text-xs text-muted-foreground">{t("orchestrator.approval_locked_reason")}</p> : null}
      {footer}
    </div>
  );
}
