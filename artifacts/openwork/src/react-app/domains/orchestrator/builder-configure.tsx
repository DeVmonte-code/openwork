/** @jsxImportSource react */
import { useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { agentSlug, type AgentDraft, type AgentVisibility, type DraftContext, type DraftIssue } from "./agent-draft";
import { addDraftRequest, attachDraftSkill } from "./agent-rules";
import { ROLE_PRESETS, SAMPLE_CAPABILITIES, SAMPLE_MEMORY, SAMPLE_PEOPLE, SAMPLE_SKILLS } from "./agent-samples";
import { bt, describedBy, FieldIssues, Group, skillLabel } from "./builder-shared";

const VISIBILITIES: readonly AgentVisibility[] = ["orchestrator", "members", "organization"];
const NONE = "none";
const MAX_REQUESTS = 5;

type Props = {
  draft: AgentDraft;
  update: (change: (draft: AgentDraft) => AgentDraft) => void;
  context: DraftContext;
  issues: DraftIssue[];
  show: boolean;
};

function toggled(list: string[], id: string, on: boolean) {
  return on ? (list.includes(id) ? list : [...list, id]) : list.filter((item) => item !== id);
}

function SwitchRow({ id, label, detail, checked, onChange, invalid, describedby }: {
  id: string; label: string; detail?: string; checked: boolean; onChange: (on: boolean) => void; invalid?: boolean; describedby?: string;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <Label htmlFor={id} className="min-w-0 flex-1 flex-wrap gap-x-2 leading-snug">
        <span>{label}</span>
        {detail ? <span className="text-xs font-normal text-muted-foreground">{detail}</span> : null}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-invalid={invalid || undefined} aria-describedby={describedby} />
    </div>
  );
}

export function BuilderConfigure({ draft, update, context, issues, show }: Props) {
  const [skillPick, setSkillPick] = useState("");
  const [skillRefusal, setSkillRefusal] = useState<string | null>(null);
  const [reqName, setReqName] = useState("");
  const [reqDescription, setReqDescription] = useState("");
  const [reqExamples, setReqExamples] = useState<string[]>([]);
  const [reqRefusal, setReqRefusal] = useState<string | null>(null);
  const nextRequest = useRef(1);
  const bad = (field: string) => show && issues.some((issue) => issue.field === field && issue.severity === "error") ? true : undefined;
  const dby = (field: string, extra?: string) => describedBy(issues, field, show, extra);
  const slug = agentSlug(draft.name);

  const attach = () => {
    const sample = SAMPLE_SKILLS.find((skill) => skill.id === skillPick);
    if (!sample) return;
    const result = attachDraftSkill(draft, { id: sample.id, version: sample.version, enabled: true });
    setSkillRefusal(result.refusal);
    if (!result.refusal) update(() => result.draft);
  };

  const addRequest = () => {
    const examples = reqExamples.map((example) => example.trim());
    const result = addDraftRequest(draft, { id: `request-${nextRequest.current}`, name: reqName.trim(), description: reqDescription.trim(), examples });
    setReqRefusal(result.refusal);
    if (result.refusal) return;
    nextRequest.current += 1;
    update(() => result.draft);
    setReqName(""); setReqDescription(""); setReqExamples([]);
  };

  return (
    <div className="flex flex-col gap-6" data-agent-builder-configure>
      <Group id="basics" title={bt("group_basics")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-name">{bt("name")}</Label>
          <Input id="ab-name" data-testid="input-agent-name" required maxLength={80} value={draft.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
            aria-invalid={bad("name")} aria-describedby={dby("name", "ab-slug")} />
          <p id="ab-slug" className="font-mono text-xs text-muted-foreground">{slug ? bt("slug", { slug }) : bt("slug_empty")}</p>
          <FieldIssues issues={issues} field="name" show={show} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-description">{bt("description")}</Label>
          <Input id="ab-description" data-testid="input-agent-description" value={draft.description}
            onChange={(e) => update((d) => ({ ...d, description: e.target.value.replace(/[\r\n]+/g, " ") }))}
            aria-invalid={bad("description")} aria-describedby={dby("description")} />
          <FieldIssues issues={issues} field="description" show={show} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-role">{bt("role")}</Label>
          <Select value={draft.role} onValueChange={(v) => { const role = ROLE_PRESETS.find((r) => r === v); if (role) update((d) => ({ ...d, role })); }}>
            <SelectTrigger id="ab-role" className="w-full sm:w-64"><SelectValue>{(v) => bt(`role_${String(v)}`)}</SelectValue></SelectTrigger>
            <SelectContent>{ROLE_PRESETS.map((r) => <SelectItem key={r} value={r}>{bt(`role_${r}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-reports-to">{bt("reports_to")}</Label>
          <Select value={draft.reportsTo || NONE} onValueChange={(v) => update((d) => ({ ...d, reportsTo: !v || v === NONE ? "" : v }))}>
            <SelectTrigger id="ab-reports-to" className="w-full sm:w-64" aria-invalid={bad("reportsTo")} aria-describedby={dby("reportsTo")}>
              <SelectValue>{(v) => (v === NONE || !v ? bt("reports_none") : context.agents.find((a) => a.id === v)?.name ?? String(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{bt("reports_none")}</SelectItem>
              {context.agents.map((a) => <SelectItem key={a.id} value={a.id} disabled={!a.active}>{a.name}{!a.active ? ` (${bt("inactive")})` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <FieldIssues issues={issues} field="reportsTo" show={show} />
        </div>
      </Group>

      <Group id="instructions" title={bt("group_instructions")}>
        <Label htmlFor="ab-instructions" className="sr-only">{bt("instructions")}</Label>
        <Textarea id="ab-instructions" data-testid="input-agent-instructions" rows={6} maxLength={32000} value={draft.instructions}
          onChange={(e) => update((d) => ({ ...d, instructions: e.target.value }))}
          aria-invalid={bad("instructions")} aria-describedby={dby("instructions", "ab-instructions-count")} />
        <p id="ab-instructions-count" className="text-xs text-muted-foreground" aria-live="polite">{bt("instructions_count", { count: draft.instructions.length })}</p>
        <FieldIssues issues={issues} field="instructions" show={show} />
      </Group>

      <Group id="skills" title={bt("group_skills")}>
        <p id="ab-skills-note" className="text-xs text-muted-foreground">{bt("skills_note")}</p>
        {draft.skills.length ? (
          <ul className="flex flex-col divide-y divide-border border-y border-border" aria-describedby="ab-skills-note">
            {draft.skills.map((skill) => (
              <li key={skill.id} className="flex min-h-10 items-center gap-3 text-sm">
                <Label htmlFor={`ab-skill-${skill.id}`} className="min-w-0 flex-1 truncate">{skillLabel(skill.id)}</Label>
                <span className="font-mono text-xs text-muted-foreground">{bt("skill_version", { version: skill.version })}</span>
                <Switch id={`ab-skill-${skill.id}`} aria-label={bt("skill_enabled", { name: skillLabel(skill.id) })} checked={skill.enabled}
                  onCheckedChange={(on) => update((d) => ({ ...d, skills: d.skills.map((s) => s.id === skill.id ? { ...s, enabled: on } : s) }))} />
                <Button variant="ghost" size="icon-sm" aria-label={bt("remove_skill", { name: skillLabel(skill.id) })}
                  onClick={() => { setSkillRefusal(null); update((d) => ({ ...d, skills: d.skills.filter((s) => s.id !== skill.id) })); }}>
                  <XIcon className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">{bt("skills_empty")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={skillPick} onValueChange={(v) => { setSkillPick(v ?? ""); setSkillRefusal(null); }}>
            <SelectTrigger id="ab-skill-pick" aria-label={bt("skill_pick")} className="w-full sm:w-64" aria-invalid={Boolean(skillRefusal) || bad("skills")} aria-describedby={skillRefusal ? "ab-skill-refusal" : dby("skills")}>
              <SelectValue>{(v) => (v ? skillLabel(String(v)) : bt("skill_pick_placeholder"))}</SelectValue>
            </SelectTrigger>
            <SelectContent>{SAMPLE_SKILLS.map((s) => <SelectItem key={s.id} value={s.id}>{`${t(s.labelKey)} (${s.version})`}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="secondary" size="sm" disabled={!skillPick} onClick={attach} data-testid="button-attach-skill">{bt("attach_skill")}</Button>
        </div>
        <p id="ab-skill-refusal" role="alert" className="text-xs text-destructive empty:hidden">{skillRefusal ? `${t(skillRefusal)} ${t(`${skillRefusal}_action`)}` : null}</p>
        <FieldIssues issues={issues} field="skills" show={show} />
      </Group>

      <Group id="requests" title={bt("group_requests")}>
        {draft.requests.length ? (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {draft.requests.map((request) => (
              <li key={request.id} className="flex min-h-10 items-center gap-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{request.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{request.description}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{bt("request_examples_count", { count: request.examples.length })}</span>
                <Button variant="ghost" size="icon-sm" aria-label={bt("remove_request", { name: request.name })}
                  onClick={() => { setReqRefusal(null); update((d) => ({ ...d, requests: d.requests.filter((r) => r.id !== request.id) })); }}>
                  <XIcon className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">{bt("requests_empty")}</p>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="ab-request-name" className="sr-only">{bt("request_name")}</Label>
          <Input id="ab-request-name" placeholder={bt("request_name")} value={reqName} onChange={(e) => { setReqName(e.target.value); setReqRefusal(null); }}
            aria-invalid={Boolean(reqRefusal) || bad("requests")} aria-describedby={reqRefusal ? "ab-request-refusal" : dby("requests")} />
          <Label htmlFor="ab-request-description" className="sr-only">{bt("request_description")}</Label>
          <Input id="ab-request-description" placeholder={bt("request_description")} value={reqDescription} onChange={(e) => { setReqDescription(e.target.value); setReqRefusal(null); }}
            aria-invalid={Boolean(reqRefusal) || bad("requests")} aria-describedby={reqRefusal ? "ab-request-refusal" : dby("requests")} />
          {reqExamples.map((example, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input id={`ab-request-example-${index}`} aria-label={bt("request_example", { n: index + 1 })} placeholder={bt("request_example", { n: index + 1 })} value={example}
                aria-invalid={Boolean(reqRefusal)} aria-describedby={reqRefusal ? "ab-request-refusal" : undefined}
                onChange={(e) => { setReqRefusal(null); setReqExamples((list) => list.map((item, i) => i === index ? e.target.value : item)); }} />
              <Button variant="ghost" size="icon-sm" aria-label={bt("remove_example", { n: index + 1 })} onClick={() => setReqExamples((list) => list.filter((_, i) => i !== index))}>
                <XIcon className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" disabled={reqExamples.length >= MAX_REQUESTS} onClick={() => setReqExamples((list) => [...list, ""])}>{bt("add_example")}</Button>
            <Button variant="secondary" size="sm" onClick={addRequest} data-testid="button-add-request">{bt("add_request")}</Button>
          </div>
        </div>
        <p id="ab-request-refusal" role="alert" className="text-xs text-destructive empty:hidden">{reqRefusal ? `${t(reqRefusal)} ${t(`${reqRefusal}_action`)}` : null}</p>
        <FieldIssues issues={issues} field="requests" show={show} />
      </Group>

      <Group id="capabilities" title={bt("group_capabilities")}>
        <div className="flex flex-col divide-y divide-border border-y border-border" aria-describedby={dby("capabilityIds")}>
          {SAMPLE_CAPABILITIES.map((c) => (
            <SwitchRow key={c.id} id={`ab-capability-${c.id}`} label={t(c.labelKey)} detail={bt(`risk_${c.risk}`)}
              invalid={bad("capabilityIds")} describedby={dby("capabilityIds")}
              checked={draft.capabilityIds.includes(c.id)} onChange={(on) => update((d) => ({ ...d, capabilityIds: toggled(d.capabilityIds, c.id, on) }))} />
          ))}
        </div>
        <FieldIssues issues={issues} field="capabilityIds" show={show} />
      </Group>

      <Group id="memory" title={bt("group_memory")}>
        <div className="flex flex-col divide-y divide-border border-y border-border">
          {SAMPLE_MEMORY.map((m) => (
            <SwitchRow key={m.id} id={`ab-memory-${m.id}`} label={t(m.labelKey)} detail={t(m.classKey)}
              invalid={bad("memoryIds")} describedby={dby("memoryIds")}
              checked={draft.memoryIds.includes(m.id)} onChange={(on) => update((d) => ({ ...d, memoryIds: toggled(d.memoryIds, m.id, on) }))} />
          ))}
        </div>
        <FieldIssues issues={issues} field="memoryIds" show={show} />
      </Group>

      <Group id="visibility" title={bt("group_visibility")}>
        <Label htmlFor="ab-visibility" className="sr-only">{bt("visibility")}</Label>
        <Select value={draft.visibility} onValueChange={(v) => { const visibility = VISIBILITIES.find((x) => x === v); if (visibility) update((d) => ({ ...d, visibility })); }}>
          <SelectTrigger id="ab-visibility" className="w-full sm:w-64"><SelectValue>{(v) => bt(`visibility_${String(v)}`)}</SelectValue></SelectTrigger>
          <SelectContent>{VISIBILITIES.map((v) => <SelectItem key={v} value={v}>{bt(`visibility_${v}`)}</SelectItem>)}</SelectContent>
        </Select>
      </Group>

      <Group id="outsiders" title={bt("group_outsiders")}>
        <SwitchRow id="ab-outsiders" label={bt("outsiders_label")} detail={bt(draft.readsOutsiders ? "outsiders_yes" : "outsiders_no")}
          checked={draft.readsOutsiders} onChange={(on) => update((d) => ({ ...d, readsOutsiders: on }))} />
      </Group>

      <Group id="cost" title={bt("group_cost")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-cost">{bt("cost")}</Label>
          <Input id="ab-cost" data-testid="input-agent-cost" inputMode="decimal" className="w-full sm:w-40" value={draft.dailyCostLimit}
            onChange={(e) => update((d) => ({ ...d, dailyCostLimit: e.target.value }))}
            aria-invalid={bad("dailyCostLimit")} aria-describedby={dby("dailyCostLimit")} />
          <FieldIssues issues={issues} field="dailyCostLimit" show={show} />
        </div>
      </Group>

      <Group id="approvers" title={bt("group_approvers")}>
        <div className="flex flex-col divide-y divide-border border-y border-border">
          {SAMPLE_PEOPLE.map((p) => (
            <SwitchRow key={p.id} id={`ab-approver-${p.id}`} label={t(p.labelKey)}
              invalid={bad("approverIds")} describedby={dby("approverIds")}
              checked={draft.approverIds.includes(p.id)} onChange={(on) => update((d) => ({ ...d, approverIds: toggled(d.approverIds, p.id, on) }))} />
          ))}
        </div>
        <FieldIssues issues={issues} field="approverIds" show={show} />
      </Group>
    </div>
  );
}
