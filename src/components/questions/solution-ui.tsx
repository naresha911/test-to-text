import { createContext, useContext, type MutableRefObject } from "react";

import type { SolutionPromptReveal } from "@/hooks/useSolutionGeneration";
import type { SolutionAudience } from "@/lib/question-context";

export type SolutionUiValue = {
  audience?: SolutionAudience | undefined;
  promptReveal: SolutionPromptReveal | null;
  prompts: MutableRefObject<Map<string, string>>;
  /** Latest ids, read during render. Kept off the context value so queue updates do not re-render every card. */
  generatingIdsRef: MutableRefObject<Set<string>>;
  queuedIdsRef: MutableRefObject<Set<string>>;
};

export const SolutionUiContext = createContext<SolutionUiValue | null>(null);

export function useSolutionUi(): SolutionUiValue | null {
  return useContext(SolutionUiContext);
}
