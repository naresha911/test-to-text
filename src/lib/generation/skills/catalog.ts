/** Visual skills authored from a source figure. Checked oracles stay out of this list. */
export const VISION_SKILLS = [
  "embedded_figure",
  "figure_pattern",
  "figure_analogy",
  "figure_series",
  "venn_diagram",
  "missing_number_figure",
  "figure_identity",
] as const;

/** Language and reasoning skills authored in text. Checked oracles stay out of this list. */
export const LANGUAGE_SKILLS = [
  "jumbled_sentences",
  "cloze",
  "synonym_antonym",
  "idioms",
  "spelling",
  "one_word_substitution",
  "comprehension",
  "parts_of_speech",
  "sentence_completion",
  "blood_relations",
  "seating_arrangement",
  "word_analogy",
  "meaningful_order",
  "word_formation",
  "symbol_arrangement",
  "general_knowledge",
  "grammar",
  "direction_sense",
] as const;
