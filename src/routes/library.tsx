import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Loader2, ScanText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { QuestionCard } from "@/components/questions/QuestionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  QUESTION_TYPE_LABELS,
  buildExport,
  type Question,
  type QuestionType,
} from "@/lib/question-schema";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Your paper library — PaperParse" },
      {
        name: "description",
        content:
          "Browse the question papers you have digitised, review every question type and download the JSON again.",
      },
      { property: "og:title", content: "Your paper library — PaperParse" },
      {
        property: "og:description",
        content: "Review and re-download the structured JSON of every paper you have digitised.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

type PaperRow = {
  id: string;
  title: string;
  subject: string | null;
  exam: string | null;
  notes: string | null;
  questions: unknown;
  created_at: string;
};

function figurePaths(questions: Question[]): string[] {
  const paths: string[] = [];
  const walk = (list: Question[]) => {
    for (const question of list) {
      for (const figure of question.figures) if (figure.image_path) paths.push(figure.image_path);
      walk(question.sub_questions);
    }
  };
  walk(questions);
  return paths;
}

function PaperDetail({ paper }: { paper: PaperRow }) {
  const questions = (Array.isArray(paper.questions) ? paper.questions : []) as Question[];
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const paths = figurePaths(questions);
    if (!paths.length) return;
    let active = true;
    void supabase.storage
      .from("paper-images")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        if (!active || !data) return;
        const map: Record<string, string> = {};
        for (const item of data) if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
        setUrls(map);
      });
    return () => {
      active = false;
    };
  }, [paper.id]);

  const counts = new Map<QuestionType, number>();
  for (const question of questions) counts.set(question.type, (counts.get(question.type) ?? 0) + 1);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {[...counts.entries()].map(([type, count]) => (
          <Badge key={type} variant="outline">
            {QUESTION_TYPE_LABELS[type]} {count}
          </Badge>
        ))}
      </div>
      {questions.map((question, index) => (
        <QuestionCard
          key={question.id ?? index}
          question={question}
          index={index}
          resolve={(path) => urls[path]}
        />
      ))}
    </div>
  );
}

function LibraryPage() {
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const papers = useQuery({
    queryKey: ["papers", session?.user.id],
    enabled: !!session,
    queryFn: async (): Promise<PaperRow[]> => {
      const { data, error } = await supabase
        .from("papers")
        .select("id, title, subject, exam, notes, questions, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PaperRow[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("papers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Paper deleted.");
      void queryClient.invalidateQueries({ queryKey: ["papers"] });
    },
    onError: () => toast.error("Could not delete that paper."),
  });

  function download(paper: PaperRow) {
    const questions = (Array.isArray(paper.questions) ? paper.questions : []) as Question[];
    const payload = buildExport(
      { title: paper.title, subject: paper.subject, exam: paper.exam, notes: paper.notes },
      questions,
      paper.id,
    );
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${paper.title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-primary">
            <ScanText className="h-5 w-5" aria-hidden="true" />
            <span className="font-display text-xl">PaperParse</span>
          </Link>
          <Button variant="ghost" size="sm" className="ml-auto" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to converter
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-4xl">Your library</h1>
        <p className="mt-2 text-muted-foreground">
          Every paper you saved, with its questions and JSON export.
        </p>

        {loading || papers.isLoading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : !session ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">Sign in to see your saved papers.</p>
            <Button className="mt-4" asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        ) : !papers.data?.length ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground">
              Nothing saved yet. Convert a paper and hit “Save to library”.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/">Convert a paper</Link>
            </Button>
          </div>
        ) : (
          <ul className="mt-8 space-y-4">
            {papers.data.map((paper) => {
              const count = Array.isArray(paper.questions) ? paper.questions.length : 0;
              const open = openId === paper.id;
              return (
                <li
                  key={paper.id}
                  className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="mr-auto min-w-0">
                      <h2 className="truncate text-2xl">{paper.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          paper.subject,
                          paper.exam,
                          `${count} question${count === 1 ? "" : "s"}`,
                          new Date(paper.created_at).toLocaleDateString(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => download(paper)}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      JSON
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(open ? null : paper.id)}>
                      {open ? "Hide" : "Review"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(paper.id)}
                      aria-label={`Delete ${paper.title}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </div>
                  {open ? <PaperDetail paper={paper} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
