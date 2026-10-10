import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyCalibrationProposal,
  getCalibrationRun,
  getCalibrationStatus,
  listCalibrationAlerts,
  listCalibrationProposals,
  listCalibrationRuns,
  rejectCalibrationProposal,
  resolveCalibrationAlert,
  runCalibration,
} from "@/lib/calibration.functions";
import { CALIBRATABLE_SKILLS } from "@/lib/generation/calibration/skills";
import { SOURCE_AGENT_IDS, type SourceAgentId } from "@/lib/document-types";
import { sourceAgent } from "@/lib/generation/agents/source-agents";
import type { CalibrationCase } from "@/lib/generation/calibration/types";
import { getLocalCatalog } from "@/lib/local-store.functions";

export const Route = createFileRoute("/calibrate")({
  head: () => ({
    meta: [
      { title: "Calibrate agents — PaperParse" },
      {
        name: "description",
        content:
          "Test the generation agents against approved past-paper questions and tune their skills.",
      },
    ],
  }),
  component: CalibratePage,
});

const DEFAULT_SKILLS = ["number_series", "grammar", "mirror_image"].filter((skill) =>
  CALIBRATABLE_SKILLS.includes(skill),
);

function CalibratePage() {
  const queryClient = useQueryClient();
  const catalogFn = useServerFn(getLocalCatalog);
  const statusFn = useServerFn(getCalibrationStatus);
  const runsFn = useServerFn(listCalibrationRuns);
  const runDetailFn = useServerFn(getCalibrationRun);
  const proposalsFn = useServerFn(listCalibrationProposals);
  const alertsFn = useServerFn(listCalibrationAlerts);
  const runFn = useServerFn(runCalibration);
  const applyFn = useServerFn(applyCalibrationProposal);
  const rejectFn = useServerFn(rejectCalibrationProposal);
  const resolveFn = useServerFn(resolveCalibrationAlert);

  const catalog = useQuery({ queryKey: ["local-catalog"], queryFn: () => catalogFn() });
  const status = useQuery({ queryKey: ["calibration-status"], queryFn: () => statusFn() });
  const runs = useQuery({ queryKey: ["calibration-runs"], queryFn: () => runsFn() });
  const proposals = useQuery({
    queryKey: ["calibration-proposals"],
    queryFn: () => proposalsFn(),
  });
  const alerts = useQuery({ queryKey: ["calibration-alerts"], queryFn: () => alertsFn() });

  const latestRunId = runs.data?.[0]?.id ?? null;
  const runDetail = useQuery({
    queryKey: ["calibration-run", latestRunId],
    queryFn: () => runDetailFn({ data: { id: latestRunId as string } }),
    enabled: Boolean(latestRunId),
  });

  const [agent, setAgent] = useState<SourceAgentId>("past_paper");
  const [standardId, setStandardId] = useState(5);
  const [streamId, setStreamId] = useState<number | "">("");
  const [subjectId, setSubjectId] = useState<number | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SKILLS));
  const [casesPerSkill, setCasesPerSkill] = useState(3);

  const streams = useMemo(() => {
    const all = catalog.data?.streams ?? [];
    return all.filter((stream) => stream.standard_id == null || stream.standard_id === standardId);
  }, [catalog.data?.streams, standardId]);

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ["calibration-status"] });
    void queryClient.invalidateQueries({ queryKey: ["calibration-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["calibration-run"] });
    void queryClient.invalidateQueries({ queryKey: ["calibration-proposals"] });
    void queryClient.invalidateQueries({ queryKey: ["calibration-alerts"] });
  }

  const runMutation = useMutation({
    mutationFn: () =>
      runFn({
        data: {
          scope: {
            agent,
            standard_id: standardId,
            subject_id: subjectId === "" ? null : subjectId,
            stream_id: streamId === "" ? null : streamId,
            skills: [...selected],
          },
          casesPerSkill,
        },
      }),
    onSuccess: (result) => {
      const summary = result.summary;
      toast.success(
        `Calibration finished: ${summary.passed}/${summary.cases} passed, ${summary.alerts} alert${
          summary.alerts === 1 ? "" : "s"
        }.`,
      );
      invalidateAll();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Calibration failed.");
      invalidateAll();
    },
  });

  const applyMutation = useMutation({
    mutationFn: (id: string) => applyFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Proposal applied. Future generations use the new prompt.");
      invalidateAll();
    },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { id } }),
    onSuccess: () => {
      toast.message("Proposal rejected.");
      invalidateAll();
    },
  });
  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveFn({ data: { id } }),
    onSuccess: () => {
      toast.message("Alert resolved.");
      invalidateAll();
    },
  });

  function toggleSkill(skill: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }

  const openAlerts = status.data?.alerts ?? [];
  const casesBySkill = useMemo(() => {
    const groups = new Map<string, CalibrationCase[]>();
    for (const item of runDetail.data?.cases ?? []) {
      const list = groups.get(item.skill_type) ?? [];
      list.push(item);
      groups.set(item.skill_type, list);
    }
    return groups;
  }, [runDetail.data]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <h1 className="font-display text-2xl">Calibrate agents</h1>
            <p className="text-sm text-muted-foreground">
              Generate questions for a skill, compare them to approved past-paper questions, and
              tune the agents. Low-risk settings apply automatically; prompt edits wait for you.
            </p>
          </div>
        </div>

        {openAlerts.length > 0 ? (
          <section className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <h2 className="text-sm font-semibold text-destructive">
              {openAlerts.length} open alert{openAlerts.length === 1 ? "" : "s"}
            </h2>
            {openAlerts.map((alert) => (
              <div key={alert.id} className="flex items-start gap-3 text-sm">
                <span className="text-foreground">{alert.reason}</span>
                <Button
                  className="ml-auto shrink-0"
                  size="sm"
                  variant="outline"
                  onClick={() => resolveMutation.mutate(alert.id)}
                >
                  Resolve
                </Button>
              </div>
            ))}
          </section>
        ) : null}

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Scope</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="cal-agent">Agent</Label>
              <select
                id="cal-agent"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={agent}
                onChange={(event) => setAgent(event.target.value as SourceAgentId)}
              >
                {SOURCE_AGENT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {sourceAgent(id)?.label ?? id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cal-standard">Standard</Label>
              <select
                id="cal-standard"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={standardId}
                onChange={(event) => {
                  setStandardId(Number(event.target.value));
                  setStreamId("");
                  setSubjectId("");
                }}
              >
                {(catalog.data?.standards ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cal-stream">Stream</Label>
              <select
                id="cal-stream"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={streamId}
                onChange={(event) =>
                  setStreamId(event.target.value === "" ? "" : Number(event.target.value))
                }
              >
                <option value="">Any</option>
                {streams.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cal-subject">Subject</Label>
              <select
                id="cal-subject"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={subjectId}
                onChange={(event) =>
                  setSubjectId(event.target.value === "" ? "" : Number(event.target.value))
                }
              >
                <option value="">Any</option>
                {(catalog.data?.subjects ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cal-cases">Questions per skill</Label>
              <Input
                id="cal-cases"
                className="w-24"
                type="number"
                min={1}
                max={10}
                value={casesPerSkill}
                onChange={(event) => setCasesPerSkill(Number(event.target.value) || 1)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Skills</Label>
              <button
                type="button"
                className="text-xs text-primary underline"
                onClick={() => setSelected(new Set(CALIBRATABLE_SKILLS))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-xs text-primary underline"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            </div>
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto rounded-md border border-border p-2">
              {CALIBRATABLE_SKILLS.map((skill) => (
                <label
                  key={skill}
                  className={`cursor-pointer rounded-full border px-2 py-1 text-xs ${
                    selected.has(skill)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={selected.has(skill)}
                    onChange={() => toggleSkill(skill)}
                  />
                  {skill.replaceAll("_", " ")}
                </label>
              ))}
            </div>
          </div>

          <Button
            disabled={runMutation.isPending || selected.size === 0}
            onClick={() => runMutation.mutate()}
          >
            {runMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Gauge className="h-4 w-4" aria-hidden="true" />
            )}
            {runMutation.isPending ? "Calibrating…" : "Run calibration"}
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Latest results</h2>
          {runDetail.data?.run ? (
            <p className="text-xs text-muted-foreground">
              {runDetail.data.run.scope.document_title
                ? `From paper: ${runDetail.data.run.scope.document_title}`
                : "Manual run"}
            </p>
          ) : null}
          {!latestRunId ? (
            <p className="text-sm text-muted-foreground">No calibration runs yet.</p>
          ) : runDetail.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-3">
              {[...casesBySkill.entries()].map(([skill, cases]) => {
                const passed = cases.filter((entry) => entry.passed).length;
                return (
                  <details key={skill} className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      {skill.replaceAll("_", " ")} — {passed}/{cases.length} passed
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {cases.map((entry) => (
                        <li key={entry.id} className="rounded-md bg-muted/40 p-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className={entry.passed ? "text-primary" : "text-destructive"}>
                              {entry.passed ? "PASS" : "FAIL"}
                            </span>
                            <span className="text-muted-foreground">
                              score {entry.score.toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-1 text-foreground">
                            <span className="text-muted-foreground">Generated: </span>
                            {entry.generated?.stem?.slice(0, 240) ?? "(generation failed)"}
                          </div>
                          {(entry.structural?.notes.length || entry.judge?.reasons.length) && (
                            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                              {[...(entry.structural?.notes ?? []), ...(entry.judge?.reasons ?? [])]
                                .slice(0, 4)
                                .map((note, index) => (
                                  <li key={index}>{note}</li>
                                ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Prompt proposals</h2>
          {(proposals.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No proposals. Prompt edits appear here for approval — low-risk settings apply on their
              own.
            </p>
          ) : (
            <ul className="space-y-3">
              {(proposals.data ?? []).map((proposal) => (
                <li key={proposal.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {(proposal.skill_type ?? "prompt").replaceAll("_", " ")}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {proposal.status}
                    </span>
                  </div>
                  {proposal.rationale ? (
                    <p className="mt-1 text-xs text-muted-foreground">{proposal.rationale}</p>
                  ) : null}
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">
                    {proposal.after}
                  </pre>
                  {proposal.status === "proposed" ? (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => applyMutation.mutate(proposal.id)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rejectMutation.mutate(proposal.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Alert history</h2>
          {(alerts.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(alerts.data ?? []).map((alert) => (
                <li key={alert.id} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      alert.resolved_at ? "bg-muted-foreground" : "bg-destructive"
                    }`}
                  />
                  <span className="text-foreground">{alert.reason}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {alert.resolved_at ? "resolved" : alert.severity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
