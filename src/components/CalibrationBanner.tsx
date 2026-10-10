import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getCalibrationStatus } from "@/lib/calibration.functions";

/** Warns on generation pages when a skill is out of calibration. */
export function CalibrationBanner() {
  const statusFn = useServerFn(getCalibrationStatus);
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery({
    queryKey: ["calibration-status"],
    queryFn: () => statusFn(),
  });

  if (dismissed || !data || data.openAlerts === 0) return null;

  const skills = [...new Set(data.alerts.map((alert) => alert.skill_type).filter(Boolean))];
  const label =
    skills.length === 1 ? (skills[0] as string).replaceAll("_", " ") : `${skills.length} skills`;

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
      <span className="text-foreground">
        <span className="font-medium">Agent calibration needed.</span> {label} may produce wrong
        data — test {skills.length === 1 ? "it" : "them"} before generating.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link to="/calibrate">Run calibration</Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
