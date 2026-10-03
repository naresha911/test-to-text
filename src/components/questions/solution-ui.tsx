import { createContext, useContext, type MutableRefObject } from "react";

import type { SolutionPromptReveal } from "@/hooks/useSolutionGeneration";
import type { SolutionAudience } from "@/lib/question-context";

export type SolutionUiValue = {
  audience?: SolutionAudience | undefined;
  queuedIds: Set<string>;
  promptReveal: SolutionPromptReveal | null;
  prompts: MutableRefObject<Map<string, string>>;
};

export const SolutionUiContext = createContext<SolutionUiValue | null>(null);

export function useSolutionUi(): SolutionUiValue | null {
  return useContext(SolutionUiContext);
}
