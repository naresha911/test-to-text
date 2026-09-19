import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CircleAlert, Loader2, ScanText } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { getReaderStatus, READER_ENGINES, type ReaderEngine } from "@/lib/extract.functions";
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
        content:
          "Choose which reader digitises your question papers — the built-in AI reader, OpenRouter, Google Cloud Vision or Optiic — and check which API keys are saved.",
      },
      { property: "og:title", content: "Reader settings — PaperParse" },
      {
        property: "og:description",
        content: "Pick your OCR engine and model, and see which API keys are configured.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { session, loading } = useAuth();
  const fetchStatus = useServerFn(getReaderStatus);
  const [settings, setSettings] = useState(DEFAULT_READER_SETTINGS);

  useEffect(() => setSettings(loadReaderSettings()), []);

  const status = useQuery({
    queryKey: ["reader-status"],
    queryFn: () => fetchStatus(),
    enabled: !!session,
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

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </main>
    );
  }

  const configured: Record<ReaderEngine, boolean> = {
    lovable: status.data?.lovable ?? false,
    openrouter: status.data?.openrouter ?? false,
    vision: status.data?.vision ?? false,
    optiic: status.data?.optiic ?? false,
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-primary">
            <ScanText className="h-5 w-5" aria-hidden="true" />
            <span className="font-display text-xl">PaperParse</span>
          </Link>
          <Button variant="ghost" size="sm" className="ml-auto" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl sm:text-4xl">Reader settings</h1>
        <p className="mt-3 text-muted-foreground">
          Pick which service reads your uploaded pages. Keys are stored securely on the server and
          are never shown in the browser.
        </p>

        {!session ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-paper)]">
            <h2 className="text-xl">Sign in first</h2>
            <Button className="mt-4" asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        ) : (
          <>
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
                      {status.isPending ? null : configured[engine] ? (
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
              <p className="mt-1 text-sm text-muted-foreground">
                Any vision-capable model id from openrouter.ai/models, for example{" "}
                <code className="font-mono text-xs">google/gemini-2.5-flash</code> or{" "}
                <code className="font-mono text-xs">qwen/qwen2.5-vl-72b-instruct:free</code>.
              </p>
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

            <div className="mt-6 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
              <p>
                A key shown as missing means it has not been saved yet — ask in the chat to add it and
                a secure form will open. Google Cloud Vision returns text only, so its pages are
                organised into questions by a language model afterwards.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
