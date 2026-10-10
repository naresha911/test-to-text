export type {
  AgentId,
  AuthorBrief,
  PaperPlan,
  SlotPlan,
  SubjectIdResolver,
} from "@/lib/generation/agents/types";
export { buildPaperPlan, expandSlots } from "@/lib/generation/agents/paper-architect";
export {
  SOURCE_AGENTS,
  sourceAgent,
  sourceAgentForKind,
  type SourceAgent,
} from "@/lib/generation/agents/source-agents";
