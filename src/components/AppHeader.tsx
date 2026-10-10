import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, Library, ScanText, Settings, Sparkles } from "lucide-react";

import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCalibrationStatus } from "@/lib/calibration.functions";
import { SOURCE_AGENT_IDS } from "@/lib/document-types";
import { SOURCE_AGENTS } from "@/lib/generation/agents/source-agents";

export function AppHeader() {
  const statusFn = useServerFn(getCalibrationStatus);
  const { data } = useQuery({
    queryKey: ["calibration-status"],
    queryFn: () => statusFn(),
    refetchInterval: 60_000,
  });
  const alertCount = data?.openAlerts ?? 0;

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" search={{ id: undefined }} className="flex items-center gap-2 text-primary">
          <ScanText className="h-5 w-5" aria-hidden="true" />
          <span className="font-display text-xl">PaperParse</span>
        </Link>
        <nav className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Generate paper
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Complete paper</DropdownMenuLabel>
              {SOURCE_AGENT_IDS.map((id) => {
                const entry = SOURCE_AGENTS[id];
                return (
                  <DropdownMenuItem key={id} asChild>
                    <Link to="/mock-new" search={{ mode: "syllabus", agent: id }}>
                      <span className="flex flex-col">
                        <span className="font-medium">{entry.label}</span>
                        <span className="text-xs text-muted-foreground">{entry.summary}</span>
                      </span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/mock-new">From instructions…</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/library">
              <Library className="h-4 w-4" aria-hidden="true" />
              Library
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/calibrate">
              <Gauge className="h-4 w-4" aria-hidden="true" />
              Calibrate
              {alertCount > 0 ? (
                <span
                  className="ml-1 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground"
                  aria-label={`${alertCount} calibration alerts`}
                >
                  {alertCount}
                </span>
              ) : null}
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">
              <Settings className="h-4 w-4" aria-hidden="true" />
              Settings
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
