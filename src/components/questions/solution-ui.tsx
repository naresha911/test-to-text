import { createContext, useContext, type MutableRefObject } from "react";

import type { SolutionPromptReveal } from "@/hooks/useSolutionGeneration";
import type { Catalog } from "@/lib/document-types";
import type { SolutionAudience } from "@/lib/question-context";

export type SolutionUiValue = {
  audience?: SolutionAudience | undefined;
  /** Reference catalog for subject/topic pickers. Absent when the screen has none. */
  catalog?: Catalog | undefined;
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
