/** Extra instructions for one skill. Checked oracles do not use these. */
const PROMPTS: Record<string, string> = {
  jumbled_sentences:
    "Write a new jumbled sentence. The stem lists the chunks. Exactly one option is the grammatical order.",
  cloze:
    "Write a new short cloze passage with one blank. The options are the words that could fill it. Exactly one is correct.",
  synonym_antonym:
    "Write a new synonym or antonym item. The stem is one word. The options are single words and exactly one matches the asked relation.",
  idioms:
    "Write a new idiom. The stem is the phrase. The options are meanings and exactly one is right.",
  spelling:
    "Write a spelling item. Exactly one option is spelled correctly. The others are plausible misspellings.",
  one_word_substitution:
    "Write a one-word substitution. The stem is a definition. Exactly one option is the word.",
  comprehension:
    "Write a new reading passage and questions that can be answered only from that passage. Put the passage in \"passage\" and the items in \"sub_questions\".",
  parts_of_speech:
    "Write a sentence and ask which word is a given part of speech. Exactly one option is correct.",
  sentence_completion:
    "Write a sentence with one missing word or phrase. Exactly one option completes it.",
  grammar: "Write an original grammar question at the student's level. Do not copy the source sentence.",
  general_knowledge:
    "Write a new fact question in the same subject as the source. The answer must be a real fact. If you are not sure, leave the answer empty rather than inventing one.",
  symbol_operations:
    "Write a new symbol-operation sum. Define each symbol as one arithmetic operation and give an expression whose value is one of the options.",
  clock_direction:
    "Write a new clock-direction question. State the facing of one hand at a time and ask for the facing at a later time.",
  embedded_figure:
    "The attached image is the source figure. Invent a new simple figure and four option figures. Exactly one option contains the new figure embedded. Describe each option figure in its option \"image_description\" field; figures[].description is only for the question figure. The answer must match your new figure.",
  figure_identity:
    "The attached image is the source figure. Invent a different figure of the same kind and four answer figures. Describe each option figure in its option \"image_description\" field; figures[].description is only for the question figure. Do not copy the source picture onto the new question.",
  meaningful_order:
    "Write a new meaningful-order item: a list of words and options that are sequences. Exactly one sequence is the sensible order.",
  letter_series:
    "Write a new letter series with one gap. Exactly one option completes it. The rule must be consistent.",
  blood_relations:
    "Write a new blood-relation puzzle with one question. The stated relations must make exactly one option true.",
  symbol_arrangement:
    "Write a new symbol-arrangement string and ask for the element at a stated position after a clear removal rule.",
  dictionary_order:
    "Write a new dictionary-order item with four or five words and options that are sequences. Exactly one is alphabetical.",
  calendar:
    "Write a new calendar question with one date and one question about a weekday. Exactly one option is correct.",
  coding_decoding:
    "Write a new coding-decoding item. Show the rule with two examples and ask for one new code. Exactly one option follows the same rule.",
  odd_one_out:
    "Write an odd-one-out item with four options. Exactly one does not belong, and the explanation names the shared property of the other three.",
  figure_pattern:
    "The attached image is the source pattern. Invent a new visual pattern of the same kind and four options. Describe the new pattern in figures[].description and each answer option in its option \"image_description\" field. Exactly one option completes your new pattern.",
  figure_analogy:
    "The attached image shows a source figure analogy. Invent a new pair of figures with the same kind of change, then a third figure and four options. Describe the question figures in figures[].description and each answer option in its option \"image_description\" field. The answer must match the new figures, not the source.",
  word_analogy: "Write a new word analogy A : B :: C : ?. Exactly one option keeps the same relation.",
  number_analogy:
    "Write a new number analogy. The rule that links the first pair must link the second pair to exactly one option.",
  figure_series:
    "The attached image is the source figure series. Invent a new series of the same kind and four option figures. Describe the series in figures[].description and each option figure in its option \"image_description\" field. Exactly one option is the next figure.",
  word_formation:
    "Write a new word-formation item. Give one source word and four candidates. Exactly one cannot be made from those letters.",
  direction_sense:
    "Write a new direction question with turns and distances or a rotated compass. Exactly one option is the final facing or place.",
  venn_diagram:
    "The attached image shows source Venn options. Write three new sets and four different circle relationships. Describe each option figure in its option \"image_description\" field. Exactly one diagram matches the sets.",
  seating_arrangement:
    "Write a new seating arrangement with a short setup and one question. The setup must make exactly one option true.",
  date_puzzle:
    "Write a new date puzzle with two statements that together leave exactly one date.",
  ranking:
    "Write a new ranking-in-a-row question. Give the row length and the shift. Exactly one option is the earlier or later position.",
  missing_number_figure:
    "The attached image is the source number figure. Invent a new figure with a missing number and four options. Describe the figure in figures[].description. The missing number must follow a rule you can explain.",
  profit_loss:
    "Write a new profit-and-loss question with a cost and a gain or loss. Exactly one option is the selling price or gain percent.",
  division:
    "Write a new division question that gives three of dividend, divisor, quotient, and remainder. Exactly one option is the missing value.",
  fractions: "Write a new fraction question. Exactly one option is the simplified value.",
  mensuration:
    "Write a new rectangle question about perimeter, area, or fencing. Exactly one option matches the lengths you chose.",
  number_formation:
    "Write a new largest-or-smallest number item from a given set of digits. Exactly one option is that number.",
  percentage: "Write a new percentage question. Exactly one option is the computed value.",
  ratio_hcf:
    "Write a new ratio or HCF question. Exactly one option is the number or simplified ratio.",
  triangle_area:
    "Write a new triangle-area question from three side lengths that form a triangle. Exactly one option is the area.",
  speed_time:
    "Write a new speed, distance, and time question. Exactly one option is the distance, time, or speed.",
  factors: "Write a new factors question. Exactly one option is the sum or count of the factors.",
  angles:
    "Write a new angle or quadrilateral question. Exactly one option is the angle measure or the shape name.",
  average: "Write a new average question. Exactly one option is the mean.",
  simple_interest:
    "Write a new simple-interest question. Exactly one option is the rate, interest, or amount.",
  metric_measures:
    "Write a new metric conversion. Exactly one option is the value in the requested unit.",
  linear_equation:
    "Write a new one-variable linear equation. Exactly one option is the solution.",
  work_rate:
    "Write a new work-rate question. Exactly one option is the number of workers or days.",
  unitary_method:
    "Write a new unitary-method question. Exactly one option follows from the given rate.",
  mean_proportion:
    "Write a new mean-proportion question. Exactly one option is the geometric mean.",
  divisibility:
    "Write a new divisibility question. Exactly one option is the correct factor or remainder.",
  multiplication:
    "Write a new multiplication that can be computed by a short method. Exactly one option is the product.",
  rounding: "Write a new rounding question. Exactly one option is the rounded value.",
};

export function skillAuthorPrompt(skill: string): string | null {
  return PROMPTS[skill] ?? null;
}

/** How hard this skill should be for a class, and one optional step up. */
export function skillDifficultyGuidance(
  skill: string,
  grade: number | null,
  step: number,
): string {
  const classLine =
    grade == null
      ? "Keep the question at the same level as the source."
      : `Write for class ${grade}. Stay within about two grades of that class.`;
  const adjust =
    step > 0
      ? "Make it one step harder than the source: more steps, a less obvious rule, or a less famous fact. Stay inside the class ceiling."
      : step < 0
        ? "Make it one step easier than the source: smaller or simpler numbers, a more obvious rule, or a more familiar fact. Stay inside the class."
        : "Match the source difficulty.";
  if (skill === "number_series") {
    const band =
      grade != null && grade <= 5
        ? "Use one arithmetic rule and integers under 30."
        : "A higher class may use two steps or larger integers.";
    return `${classLine} ${band} ${adjust}`;
  }
  if (skill === "general_knowledge") {
    return `${classLine} Use a real fact from that class syllabus. Harder means a less obvious fact, not a bigger number.`;
  }
  if (skill === "date_puzzle") {
    return `${classLine} A harder puzzle adds one extra constraint and still leaves exactly one date. ${adjust}`;
  }
  return `${classLine} ${adjust}`;
}
