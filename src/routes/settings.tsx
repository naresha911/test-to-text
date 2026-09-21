import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getReaderStatus, READER_ENGINES, type ReaderEngine } from "@/lib/extract.functions";
import { getLocalCatalog, importLocalCatalog } from "@/lib/local-store.functions";
import {
  DEFAULT_READER_SETTINGS,
  READER_LABELS,
  READER_NOTES,
  loadReaderSettings,
  saveReaderSettings,
} from "@/lib/reader-settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Reader settings — PaperParse" },
      {
        name: "description",
        content: "Choose the OCR reader and import exam-prep catalog IDs.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const fetchStatus = useServerFn(getReaderStatus);
  const importCatalog = useServerFn(importLocalCatalog);
  const loadCatalog = useServerFn(getLocalCatalog);
  const catalogInput = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState(DEFAULT_READER_SETTINGS);

  useEffect(() => setSettings(loadReaderSettings()), []);

  const status = useQuery({
    queryKey: ["reader-status"],
    queryFn: () => fetchStatus(),
  });

  const catalog = useQuery({
    queryKey: ["local-catalog"],
    queryFn: () => loadCatalog(),
  });

  function update(engine: ReaderEngine) {
    const next = { ...settings, engine };
    setSettings(next);
    saveReaderSettings(next);
    toast.success(`${READER_LABELS[engine]} will be used for new pages.`);
  }

  function saveModel() {
    const next = { ...settings, model: settings.model.trim() || DEFAULT_READER_SETTINGS.model };
    setSettings(next);
    saveReaderSettings(next);
    toast.success("Model saved.");
  }

  async function onCatalogFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const dump = JSON.parse(text) as unknown;
      const result = await importCatalog({ data: { dump } });
      toast.success(
        `Imported ${result.standards.length} standards, ${result.subjects.length} subjects, ${result.topics.length} topics.`,
      );
      void catalog.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import that JSON dump.");
    }
  }

  const configured: Record<ReaderEngine, boolean> = {
    lovable: status.data?.lovable ?? false,
    openrouter: status.data?.openrouter ?? false,
    vision: status.data?.vision ?? false,
    optiic: status.data?.optiic ?? false,
  };

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl sm:text-4xl">Settings</h1>
        <p className="mt-3 text-muted-foreground">
          Pick which service reads uploaded pages. Import standards/subjects/topics/streams JSON so
          exported IDs match exam-prep.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]">
          <h2 className="text-lg">Catalog IDs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a JSON object with arrays: <code className="font-mono text-xs">standards</code>,{" "}
            <code className="font-mono text-xs">subjects</code>,{" "}
            <code className="font-mono text-xs">topics</code>,{" "}
            <code className="font-mono text-xs">streams</code> (same columns as exam-prep).
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Loaded: {catalog.data?.standards.length ?? 0} standards · {catalog.data?.subjects.length ?? 0}{" "}
            subjects · {catalog.data?.topics.length ?? 0} topics · {catalog.data?.streams.length ?? 0}{" "}
            streams
          </p>
          <Button
            className="mt-3"
            variant="outline"
            type="button"
            onClick={() => catalogInput.current?.click()}
          >
            Import catalog JSON
          </Button>
          <input
            ref={catalogInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              void onCatalogFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        <ul className="mt-8 space-y-3">
          {READER_ENGINES.map((engine) => (
            <li key={engine}>
              <button
                type="button"
                onClick={() => update(engine)}
                aria-pressed={settings.engine === engine}
                className={cn(
                  "w-full rounded-xl border bg-card p-5 text-left shadow-[var(--shadow-paper)] transition-colors",
                  settings.engine === engine
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-primary/60",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg">{READER_LABELS[engine]}</span>
                  {settings.engine === engine ? <Badge>In use</Badge> : null}
                  {status.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : configured[engine] ? (
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Key saved
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">
                      <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      Key missing
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{READER_NOTES[engine]}</p>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]">
          <Label htmlFor="model">OpenRouter model</Label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              id="model"
              className="max-w-sm"
              value={settings.model}
              onChange={(event) => setSettings({ ...settings, model: event.target.value })}
            />
            <Button variant="outline" onClick={saveModel}>
              Save model
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
