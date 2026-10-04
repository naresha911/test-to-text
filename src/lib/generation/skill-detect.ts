import { skillByType } from "@/lib/question-taxonomy";

const MIRROR = /\bmirror(?:\s|-)?image\b|\bwater\s+image\b|\breflection of the figure\b/i;
const SERIES = /\bnumber\s+series\b|\bfind the next\b|\bwhat comes next\b|\bmissing number\b/i;
const GRAMMAR =
  /\bgrammar\b|\btenses?\b|\bprepositions?\b|\barticles?\b|\bactive and passive\b|\breported speech\b|\bparts of speech\b|\bsynonyms?\b|\bantonyms?\b|\bsubject[- ]verb\b/i;

export type SkillDetectInput = {
  stem?: string | null;
  instructions?: string | null;
  type?: string | null;
  figureCount?: number;
  optionImageCount?: number;
  optionTexts?: string[];
  passage?: string | null;
};

function textOf(input: SkillDetectInput): string {
  return [input.instructions, input.stem, input.passage].filter(Boolean).join("\n");
}

function looksLikeNumberSeries(stem: string): boolean {
  const numbers = stem.match(/-?\d+(?:\.\d+)?/g);
  return (numbers?.length ?? 0) >= 4 && /[,;]|…|\.\.\./.test(stem);
}

function optionBlob(input: SkillDetectInput): string {
  return (input.optionTexts ?? []).join(" ").toLowerCase();
}

/**
 * Classify one question into a skill. `unsupported` means no rule matched.
 * More specific figure and reasoning rules run before general knowledge.
 */
export function detectSkill(input: SkillDetectInput): string {
  const text = textOf(input);
  const tagged = text.match(/\[skill:([a-z0-9_]+)\]/i);
  if (tagged?.[1] && skillByType(tagged[1].toLowerCase())) return tagged[1].toLowerCase();
  const stem = (input.stem ?? "").replace(/\s+/g, " ").trim();
  const lower = stem.toLowerCase();
  const figures = (input.figureCount ?? 0) + (input.optionImageCount ?? 0);
  const options = optionBlob(input);

  if (MIRROR.test(text) || (figures > 0 && /\bmirror\b/i.test(text))) return "mirror_image";
  if (/exactly embedded/i.test(text)) return "embedded_figure";
  if (/complete the pattern/i.test(text)) return "figure_pattern";
  if (/first two question figures/i.test(text)) return "figure_analogy";
  if (/option figure that will replace|following series/i.test(text) && figures > 0) {
    return "figure_series";
  }
  if (/relationship between the following elements|\bvenn\b/i.test(text)) return "venn_diagram";
  if (/missing number/i.test(text) && figures > 0) return "missing_number_figure";
  if (
    (input.type === "diagram" || figures > 0) &&
    (/^question figures?$/i.test(stem) || stem.length < 12)
  ) {
    return "figure_identity";
  }

  if (/letter series|gaps in the given letter|set of letters when sequentially/i.test(text)) {
    return "letter_series";
  }
  if (/coded as|code language|code for|means ['"]?\d/i.test(text)) return "coding_decoding";
  if (/means\s*['"]?[+÷\-x×]/i.test(text) || /means\s*['"]?\+/i.test(text)) {
    return "symbol_operations";
  }
  if (/clock/i.test(text) && /minute hand|hour hand/i.test(text)) return "clock_direction";
  if (/most meaningful arrangement/i.test(text)) return "meaningful_order";
  if (/brother of|sister of|how is .+ related|female members/i.test(text)) return "blood_relations";
  if (/consonants and the numbers|study the following arrangement/i.test(text)) {
    return "symbol_arrangement";
  }
  if (/order as found in the dictionary|dictionary order/i.test(text)) return "dictionary_order";
  if (/how many (?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)/i.test(text)) {
    return "calendar";
  }
  if (/odd element|odd one out/i.test(text)) return "odd_one_out";
  if (/related number/i.test(text)) return "number_analogy";
  if (/related word/i.test(text)) return "word_analogy";
  if (/cannot be formed using the letters/i.test(text)) return "word_formation";
  if (/facing towards|becomes north|in which direction/i.test(text)) return "direction_sense";
  if (/sitting to the|sits second|who is sitting/i.test(text)) return "seating_arrangement";
  if (/birthday|born before|born after/i.test(text)) return "date_puzzle";
  if (/in a row of \d+/i.test(text)) return "ranking";
  if ((SERIES.test(text) || looksLikeNumberSeries(stem)) && figures === 0) return "number_series";

  if ((stem.match(/\//g)?.length ?? 0) >= 3) return "jumbled_sentences";
  if (/_{2,}|____/.test(stem)) return "cloze";
  if (/^correct spelling$/i.test(stem)) return "spelling";
  if (/^(one who|someone who|one whom)\b/i.test(stem)) return "one_word_substitution";
  if (/who said these words|what lesson did|came to the help/i.test(text)) return "comprehension";
  if (/\b(adverb|verb|noun|adjective|preposition|conjunction)\b/.test(options)) {
    return "parts_of_speech";
  }
  if (
    GRAMMAR.test(text) ||
    /\b(idiom|phrase)\b/i.test(text)
  ) {
    if (/\bidiom/.test(lower) || /piece of one's mind|kill two birds|fool's paradise/i.test(stem)) {
      return "idioms";
    }
    if (/\bsynonym|\bantonym|\bopposite to\b/i.test(text)) return "synonym_antonym";
    return "grammar";
  }
  if (/^[\p{L}][\p{L}\s'-]{2,40}$/u.test(stem) && (input.optionTexts?.length ?? 0) >= 3) {
    return "synonym_antonym";
  }

  if (/profit|loss|selling price|cost price/i.test(text)) return "profit_loss";
  if (/dividend|divisor|quotient|remainder/i.test(text)) return "division";
  if (/\bfraction\b/i.test(text)) return "fractions";
  if (/rectangle|perimeter|fencing/i.test(text)) return "mensuration";
  if (/percentage|\bpercent\b|% of/i.test(text)) return "percentage";
  if (/h\.?c\.?f|ratio of three|simplest form/i.test(text)) return "ratio_hcf";
  if (/triangle/i.test(text) && /area|sides/i.test(text)) return "triangle_area";
  if (/km\/h|speed of|train leaves|crosses a bridge/i.test(text)) return "speed_time";
  if (/factors of|sum of all factors/i.test(text)) return "factors";
  if (/divisible by/i.test(text)) return "divisibility";
  if (/\baverage\b/i.test(text)) return "average";
  if (/simple interest|\bs\.?\s*i\.?\b/i.test(text)) return "simple_interest";
  if (/quadrilateral|supplementary angle/i.test(text)) return "angles";
  if (/value of x|equation/i.test(text)) return "linear_equation";
  if (/cows|graze a field/i.test(text)) return "work_rate";
  if (/weighs|uniform rod/i.test(text)) return "unitary_method";
  if (/mean proportion/i.test(text)) return "mean_proportion";
  if (/round off|nearest ten/i.test(text)) return "rounding";
  if (/largest \d+ digit/i.test(text)) return "number_formation";
  if (/metric|decagram|kilogram/i.test(text)) return "metric_measures";

  if (/^(which|who|where|when|what)\b/i.test(stem)) return "general_knowledge";
  return "unsupported";
}
