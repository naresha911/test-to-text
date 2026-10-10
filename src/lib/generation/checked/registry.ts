import { hashSeed } from "@/lib/generation/job-types";
import { combineValidation, type ValidationResult } from "@/lib/generation/validation-types";
import { emptyQuestion, type JsonValue, type Question } from "@/lib/question-schema";

/** Skills whose answer is computed here, then checked again by an independent solver. */
export const CHECKED_SKILL_IDS = [
  "letter_series",
  "coding_decoding",
  "calendar",
  "ranking",
  "symbol_operations",
  "percentage",
  "profit_loss",
  "average",
  "simple_interest",
  "fractions",
  "division",
  "number_formation",
  "multiplication",
  "rounding",
  "speed_time",
  "unitary_method",
  "factors",
  "divisibility",
  "mensuration",
  "angles",
  "linear_equation",
  "work_rate",
  "mean_proportion",
  "metric_measures",
  "ratio_hcf",
  "triangle_area",
  "date_puzzle",
  "clock_direction",
  "dictionary_order",
  "odd_one_out",
  "number_properties",
  "roman_numerals",
  "lcm_hcf",
  "bodmas",
  "decimals",
  "circle",
  "volume_solid",
  "temperature_conversion",
  "question_tags",
  "rational_numbers",
  "squares_roots",
  "cubes_roots",
  "algebraic_identities",
  "factorization",
  "exponents",
  "proportion",
  "quadrilaterals",
  "triangle_properties",
  "parallel_lines",
  "euler_formula",
  "surface_area_volume",
  "discount",
  "compound_interest",
  "statistics",
  "probability",
  "data_interpretation",
  "graphs",
  "matrix_coding",
  "syllogism",
] as const;

export type CheckedSkillId = (typeof CHECKED_SKILL_IDS)[number];

const CHECKED = new Set<string>(CHECKED_SKILL_IDS);

export function isCheckedSkill(skill: string | null | undefined): skill is CheckedSkillId {
  return Boolean(skill && CHECKED.has(skill));
}

type Built = {
  stem: string;
  answer: string;
  wrong: string[];
  hint: string;
  explanation: string;
  spec: Record<string, JsonValue>;
};

type Ctx = {
  seed: number;
  grade: number | null;
  step: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WORDS = ["CAT", "DOG", "FISH", "LION", "BEAR", "FROG", "CRAB", "WOLF"];

function span(seed: number, min: number, max: number): number {
  return min + (seed % (max - min + 1));
}

function small(ctx: Ctx): boolean {
  return (ctx.grade == null || ctx.grade <= 5) && ctx.step === 0;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function fraction(numerator: number, denominator: number): string {
  const sign = numerator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator);
  const top = (sign * Math.abs(numerator)) / divisor;
  const bottom = Math.abs(denominator) / divisor;
  return bottom === 1 ? String(top) : `${top}/${bottom}`;
}

function weekday(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "Sunday";
}

function shiftWord(word: string, shift: number): string {
  return [...word]
    .map((letter) => {
      const code = letter.charCodeAt(0) - 65;
      return String.fromCharCode(((code + shift) % 26) + 65);
    })
    .join("");
}

function letterAt(start: string, step: number, index: number): string {
  const code = start.charCodeAt(0) - 65 + step * index;
  return String.fromCharCode((code % 26) + 65);
}

const CARDINAL_HOURS = [3, 6, 9, 12];
const INTERCARDINAL_HOURS = [1, 2, 4, 5, 7, 8, 10, 11];
const DICT_WORDS = [
  "apple",
  "boat",
  "cloud",
  "drum",
  "eagle",
  "flame",
  "grape",
  "house",
  "ink",
  "jacket",
  "kite",
  "lemon",
  "mango",
  "nest",
  "orange",
  "pearl",
];

function clockDirection(hour: number): string | null {
  if (hour === 12) return "North";
  if (hour === 1 || hour === 2) return "NE";
  if (hour === 3) return "East";
  if (hour === 4 || hour === 5) return "SE";
  if (hour === 6) return "South";
  if (hour === 7 || hour === 8) return "SW";
  if (hour === 9) return "West";
  if (hour === 10 || hour === 11) return "NW";
  return null;
}

function dictionaryOrder(words: string[]): string {
  return [...words].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(", ");
}

function pickDictWords(seed: number): string[] {
  const start = seed % DICT_WORDS.length;
  const words: string[] = [];
  for (let step = 0; words.length < 4; step += 1) {
    const word = DICT_WORDS[(start + step * 3) % DICT_WORDS.length];
    if (word && !words.includes(word)) words.push(word);
  }
  return words;
}

function romanOf(value: number): string {
  const table: Array<[number, string]> = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = Math.max(1, Math.floor(value));
  let out = "";
  for (const [amount, symbol] of table) {
    while (remaining >= amount) {
      out += symbol;
      remaining -= amount;
    }
  }
  return out;
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

function isPrime(value: number): boolean {
  if (!Number.isInteger(value) || value < 2) return false;
  for (let factor = 2; factor * factor <= value; factor += 1) {
    if (value % factor === 0) return false;
  }
  return true;
}

/** Distinct values from a pool, starting at `start`, skipping `exclude`. */
function pickDistinct(
  pool: number[],
  start: number,
  count: number,
  exclude: number[] = [],
): number[] {
  const out: number[] = [];
  for (let step = 0; step < pool.length * 2 && out.length < count; step += 1) {
    const value = pool[(start + step) % pool.length];
    if (value == null || out.includes(value) || exclude.includes(value)) continue;
    out.push(value);
  }
  return out;
}

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
const COMPOSITES = [4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 22, 24, 25, 26, 27, 28];
const LCM_HCF_PAIRS: Array<[number, number]> = [
  [4, 6],
  [6, 8],
  [8, 12],
  [9, 12],
  [10, 15],
  [12, 18],
  [6, 9],
  [10, 14],
  [15, 20],
  [8, 10],
];

const QUESTION_TAG_ITEMS = [
  {
    statement: "She is a doctor",
    tag: "isn't she",
    wrong: ["is she", "doesn't she", "is not she"],
  },
  {
    statement: "They have finished",
    tag: "haven't they",
    wrong: ["have they", "didn't they", "hasn't they"],
  },
  { statement: "He can swim", tag: "can't he", wrong: ["can he", "doesn't he", "couldn't he"] },
  { statement: "You like tea", tag: "don't you", wrong: ["do you", "didn't you", "aren't you"] },
  { statement: "It is raining", tag: "isn't it", wrong: ["is it", "doesn't it", "wasn't it"] },
  {
    statement: "We should go now",
    tag: "shouldn't we",
    wrong: ["should we", "don't we", "wouldn't we"],
  },
];

function money(value: number): string {
  return (value / 100).toFixed(2);
}

/** Circle sums with π = 22/7, for radii that are multiples of 7. */
function circleArea(radius: number): number {
  return 22 * (radius / 7) * radius;
}

function circleCircumference(radius: number): number {
  return 44 * (radius / 7);
}

function celsiusToFahrenheit(celsius: number): number {
  return (9 * celsius) / 5 + 32;
}

function fahrenheitToCelsius(fahrenheit: number): number {
  return (5 * (fahrenheit - 32)) / 9;
}

function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left == null || right == null || (left + right) % 2 !== 0) return null;
  return (left + right) / 2;
}

function modeOf(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const modes = [...counts.entries()].filter(([, count]) => count === max).map(([value]) => value);
  return modes.length === 1 ? (modes[0] ?? null) : null;
}

function positionsCode(word: string): string {
  return [...word].map((letter) => letter.charCodeAt(0) - 64).join("-");
}

const INVERSE_CASES: Array<[number, number, number]> = [
  [4, 6, 8],
  [6, 4, 8],
  [8, 3, 6],
  [12, 4, 16],
  [6, 8, 12],
  [4, 12, 6],
  [9, 4, 6],
  [8, 6, 12],
  [10, 6, 15],
  [12, 3, 9],
];

const QUADRILATERAL_RATIOS: number[][] = [
  [1, 2, 3, 4],
  [1, 2, 4, 5],
  [2, 3, 5, 6],
  [3, 4, 5, 6],
  [2, 4, 5, 7],
  [1, 3, 3, 5],
];

const TRIANGLE_RATIOS: number[][] = [
  [1, 2, 3],
  [2, 3, 4],
  [1, 1, 2],
  [3, 4, 5],
  [2, 2, 5],
  [1, 3, 5],
];

const PYTHAGOREAN_TRIPLES: Array<[number, number, number]> = [
  [3, 4, 5],
  [6, 8, 10],
  [5, 12, 13],
  [8, 15, 17],
  [9, 12, 15],
  [7, 24, 25],
  [10, 24, 26],
  [12, 16, 20],
];

const DATA_LABELS = ["Cricket", "Football", "Hockey", "Tennis"];
const MATRIX_WORDS = ["CAT", "DOG", "FISH", "BOOK", "TREE", "STAR", "LAMP", "FROG"];
const SYLLOGISM_SETS: Array<[string, string, string]> = [
  ["roses", "flowers", "plants"],
  ["dogs", "mammals", "animals"],
  ["squares", "rectangles", "polygons"],
  ["students", "readers", "learners"],
  ["sparrows", "birds", "animals"],
];

function oddOneValue(values: number[], rule: number): number | null {
  if ((rule !== 2 && rule !== 3) || values.length !== 4) return null;
  if (values.some((value) => !Number.isInteger(value)) || new Set(values).size !== 4) return null;
  const outlier = values.filter((value) => value % rule !== 0);
  if (outlier.length !== 1 || values.filter((value) => value % rule === 0).length !== 3)
    return null;
  return outlier[0] ?? null;
}

function cleanOddOne(values: number[], rule: number): number | null {
  const answer = oddOneValue(values, rule);
  if (answer == null) return null;
  const other = oddOneValue(values, rule === 2 ? 3 : 2);
  if (other != null && other !== answer) return null;
  return answer;
}

function placeOutlier(shared: number[], outlier: number, seed: number): number[] {
  const values = [...shared];
  values.splice(seed % 4, 0, outlier);
  return values;
}

function oddOneValues(seed: number, easy: boolean, rule: number): number[] | null {
  if (rule === 2) {
    const start = easy ? 2 + 2 * (seed % 10) : 20 + 2 * (seed % 15);
    const shared = [start, start + 2, start + 4];
    const odds = easy
      ? [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29]
      : [21, 27, 33, 35, 39, 45, 49, 51, 55, 57];
    const outlier = odds[(seed >> 3) % odds.length];
    if (outlier == null) return null;
    const values = placeOutlier(shared, outlier, seed);
    return cleanOddOne(values, 2) == null ? null : values;
  }
  const start = easy ? 3 * (1 + (seed % 7)) : 30 + 3 * (seed % 8);
  const shared = [start, start + 3, start + 6];
  const odds = easy
    ? [1, 5, 7, 11, 13, 17, 19, 23, 25, 29]
    : [25, 31, 35, 37, 41, 43, 47, 49, 53, 55];
  const outlier = odds[(seed >> 3) % odds.length];
  if (outlier == null || shared.includes(outlier)) return null;
  const values = placeOutlier(shared, outlier, seed);
  if (easy && values.some((value) => value < 1 || value >= 30)) return null;
  return cleanOddOne(values, 3) == null ? null : values;
}

/** Nudge the number inside an answer string, keeping any unit or symbol. */
function bumpAnswer(answer: string, delta: number): string {
  const match = /^([^\d-]*)(-?\d+(?:\.\d+)?)(.*)$/.exec(answer);
  if (match) {
    const prefix = match[1] ?? "";
    const numeric = Number(match[2]);
    const rest = match[3] ?? "";
    return `${prefix}${numeric + delta}${rest}`;
  }
  return `${answer} (${delta})`;
}

function uniqueWrong(answer: string, candidates: string[]): string[] {
  const wrong: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || candidate === answer || wrong.includes(candidate)) continue;
    wrong.push(candidate);
    if (wrong.length === 3) return wrong;
  }
  let extra = 1;
  while (wrong.length < 3) {
    const next = bumpAnswer(answer, extra);
    extra += 1;
    if (next !== answer && !wrong.includes(next)) wrong.push(next);
  }
  return wrong;
}

function num(value: number): string {
  return String(value);
}

const BUILDERS: Record<CheckedSkillId, (ctx: Ctx) => Built> = {
  letter_series(ctx) {
    const step = small(ctx) ? 1 + (ctx.seed % 2) : 2 + (ctx.seed % 3);
    const start = String.fromCharCode(65 + (ctx.seed % 8));
    const shown = [0, 1, 2, 3].map((index) => letterAt(start, step, index));
    const answer = letterAt(start, step, 4);
    return {
      stem: `What is the next letter in the letter series ${shown.join(", ")}, ___?`,
      answer,
      wrong: uniqueWrong(answer, [
        letterAt(start, step, 5),
        letterAt(start, step + 1, 4),
        letterAt(start, Math.max(1, step - 1), 4),
      ]),
      hint: "The gap between neighbouring letters stays the same.",
      explanation: `Each letter moves forward by ${step}. The next letter is ${answer}.`,
      spec: { kind: "checked", skill: "letter_series", start, step, shown: 4 },
    };
  },
  coding_decoding(ctx) {
    const word = WORDS[ctx.seed % WORDS.length] ?? "CAT";
    const shift = small(ctx) ? 1 : 1 + (ctx.seed % 3);
    const answer = shiftWord(word, shift);
    return {
      stem: `In a code language, each letter moves forward by ${shift}. What is the code for ${word}?`,
      answer,
      wrong: uniqueWrong(answer, [
        shiftWord(word, shift + 1),
        shiftWord(word, Math.max(1, shift - 1) === shift ? shift + 2 : Math.max(1, shift - 1)),
        [...answer].reverse().join(""),
      ]),
      hint: "Apply the same shift to every letter.",
      explanation: `${word} shifted by ${shift} is ${answer}.`,
      spec: { kind: "checked", skill: "coding_decoding", word, shift },
    };
  },
  calendar(ctx) {
    const year = 2024;
    const month = 1 + (ctx.seed % 12);
    const day = 1 + (ctx.seed % 27);
    const answer = weekday(year, month, day);
    const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    return {
      stem: `What day of the week is ${day} ${monthName} ${year}?`,
      answer,
      wrong: WEEKDAYS.filter((name) => name !== answer).slice(0, 3),
      hint: "Count the weekday of that calendar date.",
      explanation: `${day} ${monthName} ${year} is a ${answer}.`,
      spec: { kind: "checked", skill: "calendar", year, month, day },
    };
  },
  ranking(ctx) {
    const total = small(ctx) ? 10 + (ctx.seed % 11) : 25 + (ctx.seed % 16);
    const fromLeft = 2 + (ctx.seed % (total - 3));
    const answer = total - fromLeft + 1;
    return {
      stem: `In a row of ${total} students, Ravi is ${fromLeft}th from the left. What is his position from the right?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(answer + 1), num(answer - 1), num(total - fromLeft)]),
      hint: "Position from the right is total minus position from the left, plus one.",
      explanation: `${total} − ${fromLeft} + 1 = ${answer}.`,
      spec: { kind: "checked", skill: "ranking", total, fromLeft },
    };
  },
  symbol_operations(ctx) {
    const add = small(ctx) ? 2 + (ctx.seed % 4) : 6 + (ctx.seed % 8);
    const left = 3 + (ctx.seed % 9);
    const right = 4 + ((ctx.seed >> 3) % 9);
    const answer = left + right + add;
    return {
      stem: `If a ★ b means a + b + ${add}, what is ${left} ★ ${right}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(left + right), num(answer + add), num(left * right)]),
      hint: "Replace the star with the rule, then add.",
      explanation: `${left} + ${right} + ${add} = ${answer}.`,
      spec: { kind: "checked", skill: "symbol_operations", left, right, add },
    };
  },
  percentage(ctx) {
    const percent = [10, 20, 25, 50][ctx.seed % 4] ?? 10;
    const whole = small(ctx) ? percent * (2 + (ctx.seed % 4)) : percent * (6 + (ctx.seed % 6));
    const answer = (whole * percent) / 100;
    return {
      stem: `What is ${percent}% of ${whole}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(answer + percent), num(whole / 10), num(answer * 2)]),
      hint: "Percent means out of 100.",
      explanation: `${percent}% of ${whole} is ${answer}.`,
      spec: { kind: "checked", skill: "percentage", whole, percent },
    };
  },
  profit_loss(ctx) {
    const cost = 100 * (small(ctx) ? 1 : 2 + (ctx.seed % 4));
    const gain = [10, 20, 25][ctx.seed % 3] ?? 10;
    const answer = cost + (cost * gain) / 100;
    return {
      stem: `A book costs ₹${cost}. It is sold at a gain of ${gain}%. What is the selling price?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(cost + gain), num(cost), num(answer + gain)]),
      hint: "Add the gain percent of the cost price.",
      explanation: `Gain is ${gain}% of ${cost}, so the selling price is ${answer}.`,
      spec: { kind: "checked", skill: "profit_loss", cost, gain },
    };
  },
  average(ctx) {
    const count = small(ctx) ? 3 : 4;
    const base = small(ctx) ? 4 + (ctx.seed % 6) : 12 + (ctx.seed % 10);
    const values = Array.from({ length: count }, (_, index) => base + index * 2);
    const answer = values.reduce((sum, value) => sum + value, 0) / count;
    return {
      stem: `What is the average of ${values.join(", ")}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(answer + 2), num(values[0]!), num(answer + count)]),
      hint: "Add the numbers, then divide by how many there are.",
      explanation: `The total is ${answer * count}. Divided by ${count}, the average is ${answer}.`,
      spec: { kind: "checked", skill: "average", values },
    };
  },
  simple_interest(ctx) {
    const principal = small(ctx) ? 500 : 1000 + (ctx.seed % 3) * 500;
    const rate = [4, 5, 10][ctx.seed % 3] ?? 5;
    const years = small(ctx) ? 2 : 2 + (ctx.seed % 3);
    const answer = (principal * rate * years) / 100;
    return {
      stem: `What is the simple interest on ₹${principal} at ${rate}% per year for ${years} years?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [
        num(principal * rate),
        num(answer + years),
        num(answer / 2),
      ]),
      hint: "Simple interest is principal × rate × time ÷ 100.",
      explanation: `${principal} × ${rate} × ${years} ÷ 100 = ${answer}.`,
      spec: { kind: "checked", skill: "simple_interest", principal, rate, years },
    };
  },
  fractions(ctx) {
    const pairs: Array<[number, number, number, number]> = [
      [1, 2, 1, 4],
      [1, 3, 1, 6],
      [1, 4, 1, 4],
      [2, 5, 1, 5],
    ];
    const pair = pairs[ctx.seed % pairs.length] ?? pairs[0]!;
    const answer = fraction(pair[0] * pair[3] + pair[2] * pair[1], pair[1] * pair[3]);
    return {
      stem: `What is ${pair[0]}/${pair[1]} + ${pair[2]}/${pair[3]} in simplest form?`,
      answer,
      wrong: uniqueWrong(answer, [
        `${pair[0] + pair[2]}/${pair[1] + pair[3]}`,
        `${pair[0]}/${pair[3]}`,
        fraction(pair[0] * pair[3] + pair[2] * pair[1], pair[1] + pair[3]),
      ]),
      hint: "Use a common denominator, then simplify.",
      explanation: `The sum in simplest form is ${answer}.`,
      spec: {
        kind: "checked",
        skill: "fractions",
        n1: pair[0],
        d1: pair[1],
        n2: pair[2],
        d2: pair[3],
      },
    };
  },
  division(ctx) {
    const divisor = 2 + (ctx.seed % (small(ctx) ? 6 : 9));
    const quotient = small(ctx) ? 4 + (ctx.seed % 6) : 12 + (ctx.seed % 10);
    const dividend = divisor * quotient;
    return {
      stem: `What is ${dividend} ÷ ${divisor}?`,
      answer: num(quotient),
      wrong: uniqueWrong(num(quotient), [num(quotient + 1), num(divisor), num(quotient - 1)]),
      hint: "Find how many times the divisor fits into the dividend.",
      explanation: `${divisor} × ${quotient} = ${dividend}, so the quotient is ${quotient}.`,
      spec: { kind: "checked", skill: "division", dividend, divisor },
    };
  },
  number_formation(ctx) {
    const pool = small(ctx) ? [1, 2, 3, 4] : [2, 5, 7, 8, 0];
    const digits = pool.map((digit, index) => (digit + (ctx.seed % (index + 2))) % 10);
    const unique = [...new Set(digits)];
    while (unique.length < 4) unique.push((unique.length * 3 + ctx.seed) % 10);
    const answer = [...unique].sort((a, b) => b - a).join("");
    return {
      stem: `What is the largest number that can be formed from the digits ${unique.join(", ")}?`,
      answer,
      wrong: uniqueWrong(answer, [
        [...unique].sort((a, b) => a - b).join(""),
        [...answer].reverse().join(""),
        answer.slice(1) + answer[0],
      ]),
      hint: "Put the largest digit first.",
      explanation: `The largest arrangement is ${answer}.`,
      spec: { kind: "checked", skill: "number_formation", digits: unique },
    };
  },
  multiplication(ctx) {
    const left = small(ctx) ? 3 + (ctx.seed % 7) : 12 + (ctx.seed % 15);
    const right = small(ctx) ? 2 + ((ctx.seed >> 2) % 6) : 11 + ((ctx.seed >> 2) % 9);
    const answer = left * right;
    return {
      stem: `What is ${left} × ${right}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(answer + left), num(answer - right), num(left + right)]),
      hint: "Multiply the two numbers.",
      explanation: `${left} × ${right} = ${answer}.`,
      spec: { kind: "checked", skill: "multiplication", left, right },
    };
  },
  rounding(ctx) {
    const value = small(ctx) ? 21 + (ctx.seed % 60) : 140 + (ctx.seed % 400);
    const place = small(ctx) || ctx.step === 0 ? 10 : 100;
    const answer = Math.round(value / place) * place;
    return {
      stem: `Round ${value} to the nearest ${place === 10 ? "ten" : "hundred"}.`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(answer + place), num(answer - place), num(value)]),
      hint: "Look at the digit just after the place you are rounding to.",
      explanation: `${value} to the nearest ${place} is ${answer}.`,
      spec: { kind: "checked", skill: "rounding", value, place },
    };
  },
  speed_time(ctx) {
    const speed = small(ctx) ? 4 + (ctx.seed % 8) : 30 + (ctx.seed % 20);
    const hours = 2 + (ctx.seed % 4);
    const answer = speed * hours;
    return {
      stem: `A bus travels at ${speed} km/h for ${hours} hours. How far does it go?`,
      answer: `${answer} km`,
      wrong: uniqueWrong(`${answer} km`, [
        `${speed + hours} km`,
        `${answer + speed} km`,
        `${Math.round(answer / hours)} km`,
      ]),
      hint: "Distance is speed multiplied by time.",
      explanation: `${speed} × ${hours} = ${answer} km.`,
      spec: { kind: "checked", skill: "speed_time", speed, hours },
    };
  },
  unitary_method(ctx) {
    const items = small(ctx) ? 4 : 6 + (ctx.seed % 4);
    const each = 5 + (ctx.seed % 8);
    const cost = items * each;
    return {
      stem: `${items} pens cost ₹${cost}. What is the cost of 1 pen?`,
      answer: `₹${each}`,
      wrong: uniqueWrong(`₹${each}`, [`₹${each + 1}`, `₹${cost}`, `₹${items}`]),
      hint: "Divide the total cost by the number of pens.",
      explanation: `${cost} ÷ ${items} = ${each}.`,
      spec: { kind: "checked", skill: "unitary_method", items, cost },
    };
  },
  factors(ctx) {
    const value = [6, 8, 12, 18, 20, 24][ctx.seed % 6] ?? 12;
    let answer = 0;
    for (let factor = 1; factor <= value; factor += 1) {
      if (value % factor === 0) answer += factor;
    }
    return {
      stem: `What is the sum of all factors of ${value}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(value), num(answer - 1), num(answer + value)]),
      hint: "List every number that divides it, including 1 and itself.",
      explanation: `The factors of ${value} add up to ${answer}.`,
      spec: { kind: "checked", skill: "factors", value },
    };
  },
  divisibility(ctx) {
    const divisor = [3, 4, 5, 9][ctx.seed % 4] ?? 3;
    const quotient = 4 + (ctx.seed % 12);
    const value = divisor * quotient;
    const answer = 0;
    return {
      stem: `What is the remainder when ${value} is divided by ${divisor}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), ["1", "2", num(divisor - 1)]),
      hint: "A remainder of 0 means the number divides exactly.",
      explanation: `${value} = ${divisor} × ${quotient}, so the remainder is 0.`,
      spec: { kind: "checked", skill: "divisibility", value, divisor },
    };
  },
  mensuration(ctx) {
    const length = small(ctx) ? 4 + (ctx.seed % 6) : 12 + (ctx.seed % 10);
    const width = 2 + ((ctx.seed >> 2) % 5);
    const answer = length * width;
    return {
      stem: `A rectangle is ${length} cm long and ${width} cm wide. What is its area?`,
      answer: `${answer} sq cm`,
      wrong: uniqueWrong(`${answer} sq cm`, [
        `${2 * (length + width)} sq cm`,
        `${length + width} sq cm`,
        `${answer + width} sq cm`,
      ]),
      hint: "Area of a rectangle is length times width.",
      explanation: `${length} × ${width} = ${answer} sq cm.`,
      spec: { kind: "checked", skill: "mensuration", length, width },
    };
  },
  angles(ctx) {
    const angle = small(ctx) ? 20 + (ctx.seed % 50) : 35 + (ctx.seed % 80);
    const answer = 180 - angle;
    return {
      stem: `What is the supplementary angle of ${angle}°?`,
      answer: `${answer}°`,
      wrong: uniqueWrong(`${answer}°`, [
        `${answer + 10}°`,
        `${Math.max(1, answer - 10)}°`,
        `${360 - angle}°`,
      ]),
      hint: "Supplementary angles add up to 180°.",
      explanation: `180 − ${angle} = ${answer}.`,
      spec: { kind: "checked", skill: "angles", angle },
    };
  },
  linear_equation(ctx) {
    const coefficient = 2 + (ctx.seed % 5);
    const solution = small(ctx) ? 2 + (ctx.seed % 6) : 6 + (ctx.seed % 8);
    const added = 1 + ((ctx.seed >> 3) % 7);
    const total = coefficient * solution + added;
    return {
      stem: `If ${coefficient}x + ${added} = ${total}, what is x?`,
      answer: num(solution),
      wrong: uniqueWrong(num(solution), [num(solution + 1), num(added), num(coefficient)]),
      hint: "Subtract the added number, then divide by the coefficient.",
      explanation: `${total} − ${added} = ${coefficient * solution}, and ${coefficient * solution} ÷ ${coefficient} = ${solution}.`,
      spec: { kind: "checked", skill: "linear_equation", coefficient, added, total },
    };
  },
  work_rate(ctx) {
    const days = [4, 5, 6, 8, 10][ctx.seed % 5] ?? 6;
    const used = days === 4 ? 2 : 2;
    const answer = fraction(used, days);
    return {
      stem: `A person can finish a job in ${days} days. What fraction of the job is finished in ${used} days?`,
      answer,
      wrong: uniqueWrong(answer, [
        fraction(1, days),
        fraction(used, days - 1),
        `${used}/${days + 1}`,
      ]),
      hint: "One day finishes 1 divided by the total days.",
      explanation: `${used} days is ${answer} of the job.`,
      spec: { kind: "checked", skill: "work_rate", days, used },
    };
  },
  mean_proportion(ctx) {
    const left = [4, 9, 16, 25][ctx.seed % 4] ?? 4;
    const right = [9, 16, 25, 36][(ctx.seed + 1) % 4] ?? 16;
    const answer = Math.sqrt(left * right);
    return {
      stem: `What is the mean proportion of ${left} and ${right}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [
        num(left + right),
        num((left + right) / 2),
        num(answer + 2),
      ]),
      hint: "The mean proportion is the square root of the product.",
      explanation: `√(${left} × ${right}) = ${answer}.`,
      spec: { kind: "checked", skill: "mean_proportion", left, right },
    };
  },
  metric_measures(ctx) {
    const kilograms = small(ctx) ? 1 + (ctx.seed % 5) : 3 + (ctx.seed % 8);
    const answer = kilograms * 1000;
    return {
      stem: `How many grams are there in ${kilograms} kg?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [
        num(kilograms * 100),
        num(kilograms * 10),
        num(answer + 100),
      ]),
      hint: "1 kilogram is 1000 grams.",
      explanation: `${kilograms} × 1000 = ${answer}.`,
      spec: { kind: "checked", skill: "metric_measures", kilograms },
    };
  },
  ratio_hcf(ctx) {
    const pairs: Array<[number, number]> = [
      [8, 12],
      [12, 18],
      [15, 25],
      [18, 24],
      [20, 30],
    ];
    const pair = pairs[ctx.seed % pairs.length] ?? pairs[0]!;
    const answer = gcd(pair[0], pair[1]);
    return {
      stem: `What is the HCF of ${pair[0]} and ${pair[1]}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [num(pair[0]), num(1), num(answer * 2)]),
      hint: "The HCF is the greatest number that divides both.",
      explanation: `The HCF of ${pair[0]} and ${pair[1]} is ${answer}.`,
      spec: { kind: "checked", skill: "ratio_hcf", left: pair[0], right: pair[1] },
    };
  },
  triangle_area(ctx) {
    const base = small(ctx) ? 6 + (ctx.seed % 6) : 10 + (ctx.seed % 10);
    const height = 2 + ((ctx.seed >> 2) % 6) * 2;
    const answer = (base * height) / 2;
    return {
      stem: `A triangle has base ${base} cm and height ${height} cm. What is its area?`,
      answer: `${answer} sq cm`,
      wrong: uniqueWrong(`${answer} sq cm`, [
        `${base * height} sq cm`,
        `${base + height} sq cm`,
        `${answer + height} sq cm`,
      ]),
      hint: "Area of a triangle is half of base times height.",
      explanation: `½ × ${base} × ${height} = ${answer} sq cm.`,
      spec: { kind: "checked", skill: "triangle_area", base, height },
    };
  },
  date_puzzle(ctx) {
    const month = 3 + (ctx.seed % 8);
    const day = 12 + (ctx.seed % 14);
    const before = small(ctx) ? 2 + (ctx.seed % 3) : 4 + (ctx.seed % 4);
    const answerDay = day - before;
    const monthName = new Date(Date.UTC(2024, month - 1, 1)).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    const answer = `${answerDay} ${monthName}`;
    return {
      stem: `Meena's birthday is ${before} days before ${day} ${monthName}. What is the date of her birthday?`,
      answer,
      wrong: uniqueWrong(answer, [
        `${day - before + 1} ${monthName}`,
        `${day} ${monthName}`,
        `${answerDay - 1} ${monthName}`,
      ]),
      hint: "Count backward from the given date, staying in the same month.",
      explanation: `${day} minus ${before} is ${answer}.`,
      spec: { kind: "checked", skill: "date_puzzle", month, day, before },
    };
  },
  clock_direction(ctx) {
    const hours = small(ctx) ? CARDINAL_HOURS : INTERCARDINAL_HOURS;
    const hour = hours[ctx.seed % hours.length] ?? 3;
    const answer = clockDirection(hour) ?? "North";
    const pool = small(ctx) ? ["North", "East", "South", "West"] : ["NE", "SE", "SW", "NW"];
    return {
      stem: `A clock shows 12 as North, 3 as East, 6 as South and 9 as West. Which direction does the hour hand point at ${hour} o'clock?`,
      answer,
      wrong: pool.filter((direction) => direction !== answer),
      hint: "12 is North, 3 is East, 6 is South and 9 is West.",
      explanation: `At ${hour} o'clock the hour hand points ${answer}.`,
      spec: { kind: "checked", skill: "clock_direction", hour },
    };
  },
  dictionary_order(ctx) {
    const words = pickDictWords(ctx.seed);
    const answer = dictionaryOrder(words);
    const sorted = answer.split(", ");
    let shown = [...words];
    if (shown.join(", ") === answer) {
      shown = [shown[1]!, shown[0]!, shown[2]!, shown[3]!];
    }
    return {
      stem: `Arrange these words in dictionary order: ${shown.join(", ")}.`,
      answer,
      wrong: [
        [...sorted].reverse().join(", "),
        [sorted[1], sorted[0], sorted[2], sorted[3]].join(", "),
        [sorted[0], sorted[2], sorted[1], sorted[3]].join(", "),
      ],
      hint: "Dictionary order is alphabetical order.",
      explanation: `In dictionary order the words are ${answer}.`,
      spec: { kind: "checked", skill: "dictionary_order", words: shown },
    };
  },
  odd_one_out(ctx) {
    const easy = ctx.grade == null || ctx.grade <= 5;
    const rule = ctx.seed % 2 === 0 ? 2 : 3;
    const values =
      oddOneValues(ctx.seed, easy, rule) ??
      (easy
        ? rule === 2
          ? [2, 4, 8, 9]
          : [3, 6, 12, 5]
        : rule === 2
          ? [22, 34, 46, 15]
          : [33, 36, 42, 25]);
    const answer = cleanOddOne(values, rule) ?? values[values.length - 1] ?? 0;
    return {
      stem: `Which number is the odd one out: ${values.join(", ")}?`,
      answer: num(answer),
      wrong: values.filter((value) => value !== answer).map((value) => num(value)),
      hint:
        rule === 2 ? "Three of the numbers are even." : "Three of the numbers are divisible by 3.",
      explanation:
        rule === 2
          ? `The other three are even. ${answer} is the odd one out.`
          : `The other three are divisible by 3. ${answer} is the odd one out.`,
      spec: { kind: "checked", skill: "odd_one_out", values, rule },
    };
  },
  number_properties(ctx) {
    const wantPrime = ctx.seed % 2 === 0;
    const pool = wantPrime ? PRIMES : COMPOSITES;
    const sharedPool = wantPrime ? COMPOSITES : PRIMES;
    const shared = pickDistinct(sharedPool, ctx.seed % sharedPool.length, 3);
    const outlier = pickDistinct(pool, (ctx.seed >> 3) % pool.length, 1, shared)[0] ?? pool[0]!;
    const values = [...shared];
    values.splice(ctx.seed % 4, 0, outlier);
    const label = wantPrime ? "prime" : "composite";
    return {
      stem: `Which of these is a ${label} number?`,
      answer: num(outlier),
      wrong: shared.map((value) => num(value)),
      hint: wantPrime
        ? "A prime number has exactly two factors: 1 and itself."
        : "A composite number has more than two factors.",
      explanation: wantPrime
        ? `${outlier} is prime. The other three are composite.`
        : `${outlier} is composite. The other three are prime.`,
      spec: { kind: "checked", skill: "number_properties", values, wantPrime },
    };
  },
  roman_numerals(ctx) {
    const value = 4 + (ctx.seed % 96);
    const answer = romanOf(value);
    return {
      stem: `What is the Roman numeral for ${value}?`,
      answer,
      wrong: uniqueWrong(answer, [
        romanOf(value + 1),
        romanOf(Math.max(1, value - 1)),
        romanOf(value + 10 > 100 ? value - 10 : value + 10),
        romanOf(Math.max(1, value - 5)),
      ]),
      hint: "Use I, V, X, L and C, writing the largest value first.",
      explanation: `${value} is written as ${answer}.`,
      spec: { kind: "checked", skill: "roman_numerals", value },
    };
  },
  lcm_hcf(ctx) {
    const useLcm = ctx.seed % 2 === 0;
    const pair = LCM_HCF_PAIRS[ctx.seed % LCM_HCF_PAIRS.length] ?? LCM_HCF_PAIRS[0]!;
    const [left, right] = pair;
    const answer = useLcm ? lcm(left, right) : gcd(left, right);
    const other = useLcm ? gcd(left, right) : lcm(left, right);
    return {
      stem: `What is the ${useLcm ? "LCM" : "HCF"} of ${left} and ${right}?`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [
        num(other),
        num(left * right),
        num(answer + (useLcm ? left : 1)),
      ]),
      hint: useLcm
        ? "The LCM is the smallest number that both numbers divide into."
        : "The HCF is the greatest number that divides both numbers.",
      explanation: `The ${useLcm ? "LCM" : "HCF"} of ${left} and ${right} is ${answer}.`,
      spec: { kind: "checked", skill: "lcm_hcf", left, right, rule: useLcm ? "lcm" : "hcf" },
    };
  },
  bodmas(ctx) {
    const a = 6 + (ctx.seed % 10);
    const b = 2 + ((ctx.seed >> 2) % 6);
    const c = 2 + ((ctx.seed >> 5) % 5);
    const e = 2 + ((ctx.seed >> 9) % 3);
    const k = 2 + ((ctx.seed >> 7) % 4);
    const d = e * k;
    const quotient = d / e;
    const answer = a + b * c - quotient;
    return {
      stem: `Simplify: ${a} + ${b} × ${c} − ${d} ÷ ${e}`,
      answer: num(answer),
      wrong: uniqueWrong(num(answer), [
        num((a + b) * c - quotient),
        num(a + b * c - d),
        num(a + b * (c - quotient)),
      ]),
      hint: "Do multiplication and division before addition and subtraction.",
      explanation: `${b} × ${c} = ${b * c} and ${d} ÷ ${e} = ${quotient}, so ${a} + ${b * c} − ${quotient} = ${answer}.`,
      spec: { kind: "checked", skill: "bodmas", a, b, c, d, e },
    };
  },
  decimals(ctx) {
    const aCents = 10 + (ctx.seed % 40);
    const bCents = 5 + ((ctx.seed >> 3) % 40);
    const total = aCents + bCents;
    const answer = money(total);
    return {
      stem: `What is ${money(aCents)} + ${money(bCents)}?`,
      answer,
      wrong: uniqueWrong(answer, [
        money(total + 10),
        money(Math.max(1, total - 5)),
        money(total - 20 > 0 ? total - 20 : total + 20),
      ]),
      hint: "Line up the decimal points, then add.",
      explanation: `${money(aCents)} + ${money(bCents)} = ${answer}.`,
      spec: { kind: "checked", skill: "decimals", aCents, bCents },
    };
  },
  circle(ctx) {
    const useArea = ctx.seed % 2 === 0;
    const radius = 7 * (1 + (ctx.seed % 3));
    const area = circleArea(radius);
    const circumference = circleCircumference(radius);
    const answer = useArea ? `${area} sq cm` : `${circumference} cm`;
    return {
      stem: useArea
        ? `Find the area of a circle of radius ${radius} cm. (Take π = 22/7)`
        : `Find the circumference of a circle of radius ${radius} cm. (Take π = 22/7)`,
      answer,
      wrong: uniqueWrong(answer, [
        useArea ? `${circumference} sq cm` : `${area} cm`,
        useArea ? `${2 * radius} sq cm` : `${radius} cm`,
        useArea ? `${area / 2} sq cm` : `${4 * circumference} cm`,
      ]),
      hint: useArea
        ? "Area of a circle is π × radius × radius."
        : "Circumference of a circle is 2 × π × radius.",
      explanation: useArea
        ? `π × ${radius}² = ${area} sq cm.`
        : `2 × π × ${radius} = ${circumference} cm.`,
      spec: { kind: "checked", skill: "circle", radius, rule: useArea ? "area" : "circumference" },
    };
  },
  volume_solid(ctx) {
    const isCube = ctx.seed % 2 === 0;
    if (isCube) {
      const side = 2 + (ctx.seed % 6);
      const answer = side * side * side;
      return {
        stem: `Find the volume of a cube of edge ${side} cm.`,
        answer: `${answer} cu cm`,
        wrong: uniqueWrong(`${answer} cu cm`, [
          `${side * side} cu cm`,
          `${6 * side * side} cu cm`,
          `${answer + side} cu cm`,
        ]),
        hint: "Volume of a cube is edge × edge × edge.",
        explanation: `${side}³ = ${answer} cu cm.`,
        spec: { kind: "checked", skill: "volume_solid", solid: "cube", side },
      };
    }
    const length = 2 + (ctx.seed % 6);
    const breadth = 2 + ((ctx.seed >> 3) % 5);
    const height = 2 + ((ctx.seed >> 6) % 4);
    const answer = length * breadth * height;
    return {
      stem: `Find the volume of a cuboid ${length} cm × ${breadth} cm × ${height} cm.`,
      answer: `${answer} cu cm`,
      wrong: uniqueWrong(`${answer} cu cm`, [
        `${length + breadth + height} cu cm`,
        `${2 * (length * breadth + breadth * height + height * length)} cu cm`,
        `${length * breadth} cu cm`,
      ]),
      hint: "Volume of a cuboid is length × breadth × height.",
      explanation: `${length} × ${breadth} × ${height} = ${answer} cu cm.`,
      spec: { kind: "checked", skill: "volume_solid", solid: "cuboid", length, breadth, height },
    };
  },
  temperature_conversion(ctx) {
    const toFahrenheit = ctx.seed % 2 === 0;
    if (toFahrenheit) {
      const celsius = 5 * (1 + (ctx.seed % 7));
      const answer = celsiusToFahrenheit(celsius);
      return {
        stem: `Convert ${celsius}°C to Fahrenheit.`,
        answer: `${answer}°F`,
        wrong: uniqueWrong(`${answer}°F`, [
          `${celsius + 32}°F`,
          `${(9 * celsius) / 5}°F`,
          `${answer + 9}°F`,
        ]),
        hint: "Fahrenheit = (9/5) × Celsius + 32.",
        explanation: `(9/5) × ${celsius} + 32 = ${answer}°F.`,
        spec: {
          kind: "checked",
          skill: "temperature_conversion",
          value: celsius,
          direction: "c2f",
        },
      };
    }
    const steps = 1 + (ctx.seed % 6);
    const fahrenheit = 32 + 9 * steps;
    const answer = fahrenheitToCelsius(fahrenheit);
    return {
      stem: `Convert ${fahrenheit}°F to Celsius.`,
      answer: `${answer}°C`,
      wrong: uniqueWrong(`${answer}°C`, [
        `${answer + 5}°C`,
        `${fahrenheit - 32}°C`,
        `${Math.max(1, answer - 5)}°C`,
      ]),
      hint: "Celsius = (5/9) × (Fahrenheit − 32).",
      explanation: `(5/9) × (${fahrenheit} − 32) = ${answer}°C.`,
      spec: {
        kind: "checked",
        skill: "temperature_conversion",
        value: fahrenheit,
        direction: "f2c",
      },
    };
  },
  question_tags(ctx) {
    const index = ctx.seed % QUESTION_TAG_ITEMS.length;
    const item = QUESTION_TAG_ITEMS[index] ?? QUESTION_TAG_ITEMS[0]!;
    return {
      stem: `Choose the correct question tag: ${item.statement}, ___?`,
      answer: item.tag,
      wrong: item.wrong,
      hint: "A question tag uses the opposite of the statement and matches its helping verb.",
      explanation: `"${item.statement}" is positive, so the tag is "${item.tag}".`,
      spec: { kind: "checked", skill: "question_tags", index },
    };
  },
  rational_numbers(ctx) {
    const d1 = 2 + (ctx.seed % 4);
    const d2 = 3 + ((ctx.seed >> 2) % 4);
    const n1 = (ctx.seed % 2 === 0 ? -1 : 1) * (1 + ((ctx.seed >> 6) % (d1 - 1)));
    const n2 = 1 + ((ctx.seed >> 4) % (d2 - 1));
    const answer = fraction(n1 * d2 + n2 * d1, d1 * d2);
    return {
      stem: `What is ${n1}/${d1} + ${n2}/${d2}?`,
      answer,
      wrong: uniqueWrong(answer, [
        fraction(-n1 * d2 + n2 * d1, d1 * d2),
        fraction(n1 * d2 - n2 * d1, d1 * d2),
        fraction(n1 + n2, d1 + d2),
        fraction(n1 * d2 + n2 * d1, d1 * d2 * 2),
      ]),
      hint: "Use a common denominator, then add. Keep the sign of the first fraction.",
      explanation: `${n1}/${d1} + ${n2}/${d2} = ${answer}.`,
      spec: { kind: "checked", skill: "rational_numbers", n1, d1, n2, d2 },
    };
  },
  squares_roots(ctx) {
    const useRoot = ctx.seed % 2 === 0;
    const k = 4 + (ctx.seed % 21);
    if (useRoot) {
      const value = k * k;
      const answer = num(k);
      return {
        stem: `What is the square root of ${value}?`,
        answer,
        wrong: uniqueWrong(answer, [num(k + 1), num(k - 1), num(Math.round(value / 2))]),
        hint: "Find the number that multiplied by itself gives the value.",
        explanation: `${k} × ${k} = ${value}, so √${value} = ${k}.`,
        spec: { kind: "checked", skill: "squares_roots", rule: "sqrt", value },
      };
    }
    const value = k * k;
    const answer = num(value);
    return {
      stem: `What is ${k}²?`,
      answer,
      wrong: uniqueWrong(answer, [num(k * 2), num(value + k), num(value - k)]),
      hint: "Multiply the number by itself.",
      explanation: `${k}² = ${value}.`,
      spec: { kind: "checked", skill: "squares_roots", rule: "square", value: k },
    };
  },
  cubes_roots(ctx) {
    const useRoot = ctx.seed % 2 === 0;
    const k = 2 + (ctx.seed % 11);
    if (useRoot) {
      const value = k * k * k;
      const answer = num(k);
      return {
        stem: `What is the cube root of ${value}?`,
        answer,
        wrong: uniqueWrong(answer, [num(k + 1), num(k - 1), num(Math.round(value / 3))]),
        hint: "Find the number that multiplied by itself three times gives the value.",
        explanation: `${k}³ = ${value}, so ∛${value} = ${k}.`,
        spec: { kind: "checked", skill: "cubes_roots", rule: "cbrt", value },
      };
    }
    const value = k * k * k;
    const answer = num(value);
    return {
      stem: `What is ${k}³?`,
      answer,
      wrong: uniqueWrong(answer, [num(k * 3), num(value + k * k), num(value - k)]),
      hint: "Multiply the number by itself three times.",
      explanation: `${k}³ = ${value}.`,
      spec: { kind: "checked", skill: "cubes_roots", rule: "cube", value: k },
    };
  },
  algebraic_identities(ctx) {
    if (ctx.seed % 2 === 0) {
      const base = 10 * (2 + (ctx.seed % 8));
      const answer = num(base * base - 1);
      return {
        stem: `Using a suitable identity, find ${base - 1} × ${base + 1}.`,
        answer,
        wrong: uniqueWrong(answer, [
          num(base * base),
          num(base * base + base),
          num(base * base - base),
        ]),
        hint: "Use (a − b)(a + b) = a² − b².",
        explanation: `(${base} − 1)(${base} + 1) = ${base}² − 1 = ${answer}.`,
        spec: { kind: "checked", skill: "algebraic_identities", rule: "diff_squares", base },
      };
    }
    const delta = 2 + (ctx.seed % 5);
    const value = 100 + delta;
    const answer = num(value * value);
    return {
      stem: `Using a suitable identity, find ${value}².`,
      answer,
      wrong: uniqueWrong(answer, [
        num(10000 + delta),
        num(value * 100),
        num(value * value + value),
      ]),
      hint: "Use (a + b)² = a² + 2ab + b².",
      explanation: `(${100} + ${delta})² = 100² + 2 × 100 × ${delta} + ${delta}² = ${answer}.`,
      spec: {
        kind: "checked",
        skill: "algebraic_identities",
        rule: "square_sum",
        base: 100,
        delta,
      },
    };
  },
  factorization(ctx) {
    const p = 1 + (ctx.seed % 9);
    const q = 1 + ((ctx.seed >> 3) % 9);
    const lo = Math.min(p, q);
    const hi = Math.max(p, q);
    const coefficient = p + q;
    const constant = p * q;
    const answer = `(x + ${lo})(x + ${hi})`;
    return {
      stem: `Factorise: x² + ${coefficient}x + ${constant}`,
      answer,
      wrong: uniqueWrong(answer, [
        `(x + ${coefficient})(x + ${constant})`,
        `(x + ${lo})(x − ${hi})`,
        `(x − ${lo})(x − ${hi})`,
      ]),
      hint: "Find two numbers whose sum is the middle coefficient and whose product is the constant.",
      explanation: `${lo} + ${hi} = ${coefficient} and ${lo} × ${hi} = ${constant}, so the factors are ${answer}.`,
      spec: { kind: "checked", skill: "factorization", p: lo, q: hi },
    };
  },
  exponents(ctx) {
    const base = 2 + (ctx.seed % 4);
    const m = 2 + ((ctx.seed >> 2) % 3);
    const n = 1 + ((ctx.seed >> 4) % 3);
    const rule = ctx.seed % 3;
    if (rule === 0) {
      const value = base ** (m + n);
      const answer = num(value);
      return {
        stem: `Simplify: ${base}^${m} × ${base}^${n}`,
        answer,
        wrong: uniqueWrong(answer, [
          num(value + base),
          num(base ** (m * n)),
          num(base ** m + base ** n),
        ]),
        hint: "With the same base, add the exponents.",
        explanation: `${base}^${m} × ${base}^${n} = ${base}^${m + n} = ${answer}.`,
        spec: { kind: "checked", skill: "exponents", rule: "multiply", base, m, n },
      };
    }
    if (rule === 1) {
      const top = m + n;
      const value = base ** (top - n);
      const answer = num(value);
      return {
        stem: `Simplify: ${base}^${top} ÷ ${base}^${n}`,
        answer,
        wrong: uniqueWrong(answer, [
          num(base ** (top + n)),
          num(base ** (top * n)),
          num(value + base),
        ]),
        hint: "With the same base, subtract the exponents.",
        explanation: `${base}^${top} ÷ ${base}^${n} = ${base}^${top - n} = ${answer}.`,
        spec: { kind: "checked", skill: "exponents", rule: "divide", base, m: top, n },
      };
    }
    const powerBase = 2 + (ctx.seed % 2);
    const powerM = 2 + ((ctx.seed >> 2) % 2);
    const power = 3;
    const value = powerBase ** (powerM * power);
    const answer = num(value);
    return {
      stem: `Simplify: (${powerBase}^${powerM})^${power}`,
      answer,
      wrong: uniqueWrong(answer, [
        num(powerBase ** (powerM + power)),
        num(powerBase * powerM * power),
        num(value + powerBase),
      ]),
      hint: "A power raised to a power multiplies the exponents.",
      explanation: `(${powerBase}^${powerM})^${power} = ${powerBase}^${powerM * power} = ${answer}.`,
      spec: {
        kind: "checked",
        skill: "exponents",
        rule: "power",
        base: powerBase,
        m: powerM,
        n: power,
      },
    };
  },
  proportion(ctx) {
    if (ctx.seed % 2 === 0) {
      const items = 2 + (ctx.seed % 6);
      const unit = 2 + ((ctx.seed >> 6) % 10);
      const cost = items * unit;
      const wanted = items + 1 + ((ctx.seed >> 3) % 6);
      const answer = wanted * unit;
      return {
        stem: `If ${items} pens cost ₹${cost}, what is the cost of ${wanted} pens?`,
        answer: `₹${answer}`,
        wrong: uniqueWrong(`₹${answer}`, [
          `₹${cost + unit}`,
          `₹${wanted * cost}`,
          `₹${answer + items}`,
        ]),
        hint: "Find the cost of one pen first, then multiply.",
        explanation: `One pen costs ₹${unit}, so ${wanted} pens cost ₹${answer}.`,
        spec: {
          kind: "checked",
          skill: "proportion",
          rule: "direct",
          a: items,
          b: unit,
          c: wanted,
        },
      };
    }
    const [workers, days, newWorkers] =
      INVERSE_CASES[ctx.seed % INVERSE_CASES.length] ?? INVERSE_CASES[0]!;
    const answer = (workers * days) / newWorkers;
    return {
      stem: `${workers} workers can finish a job in ${days} days. How many days will ${newWorkers} workers take?`,
      answer: `${answer} days`,
      wrong: uniqueWrong(`${answer} days`, [
        `${days} days`,
        `${days + newWorkers} days`,
        `${Math.max(1, answer + 1)} days`,
      ]),
      hint: "More workers take less time — this is inverse proportion.",
      explanation: `${workers} × ${days} = ${newWorkers} × ${answer}, so ${newWorkers} workers take ${answer} days.`,
      spec: {
        kind: "checked",
        skill: "proportion",
        rule: "inverse",
        a: workers,
        b: days,
        c: newWorkers,
      },
    };
  },
  quadrilaterals(ctx) {
    const ratio =
      QUADRILATERAL_RATIOS[ctx.seed % QUADRILATERAL_RATIOS.length] ?? QUADRILATERAL_RATIOS[0]!;
    const sum = ratio.reduce((total, value) => total + value, 0);
    const largest = Math.max(...ratio);
    const answer = (360 * largest) / sum;
    return {
      stem: `The angles of a quadrilateral are in the ratio ${ratio.join(" : ")}. Find the largest angle.`,
      answer: `${answer}°`,
      wrong: uniqueWrong(`${answer}°`, [`${360 - answer}°`, `${180 - answer}°`, `${answer + 10}°`]),
      hint: "The four angles of a quadrilateral add up to 360°.",
      explanation: `The largest angle is ${largest} parts of 360° over ${sum} parts = ${answer}°.`,
      spec: { kind: "checked", skill: "quadrilaterals", ratio },
    };
  },
  triangle_properties(ctx) {
    if (ctx.seed % 2 === 0) {
      const ratio = TRIANGLE_RATIOS[ctx.seed % TRIANGLE_RATIOS.length] ?? TRIANGLE_RATIOS[0]!;
      const sum = ratio.reduce((total, value) => total + value, 0);
      const largest = Math.max(...ratio);
      const answer = (180 * largest) / sum;
      return {
        stem: `The angles of a triangle are in the ratio ${ratio.join(" : ")}. Find the largest angle.`,
        answer: `${answer}°`,
        wrong: uniqueWrong(`${answer}°`, [
          `${360 - answer}°`,
          `${180 - answer}°`,
          `${answer + 15}°`,
        ]),
        hint: "The three angles of a triangle add up to 180°.",
        explanation: `The largest angle is ${largest} parts of 180° over ${sum} parts = ${answer}°.`,
        spec: { kind: "checked", skill: "triangle_properties", rule: "angle_ratio", ratio },
      };
    }
    const [legA, legB, hypotenuse] =
      PYTHAGOREAN_TRIPLES[ctx.seed % PYTHAGOREAN_TRIPLES.length] ?? PYTHAGOREAN_TRIPLES[0]!;
    return {
      stem: `In a right-angled triangle, the two legs are ${legA} cm and ${legB} cm. Find the length of the hypotenuse.`,
      answer: `${hypotenuse} cm`,
      wrong: uniqueWrong(`${hypotenuse} cm`, [
        `${legA + legB} cm`,
        `${hypotenuse + 1} cm`,
        `${Math.abs(legB - legA)} cm`,
      ]),
      hint: "Use Pythagoras' theorem: hypotenuse² = leg₁² + leg₂².",
      explanation: `${legA}² + ${legB}² = ${legA * legA + legB * legB}, so the hypotenuse is ${hypotenuse} cm.`,
      spec: { kind: "checked", skill: "triangle_properties", rule: "pythagoras", a: legA, b: legB },
    };
  },
  parallel_lines(ctx) {
    const angle = 30 + (ctx.seed % 121);
    const other = 180 - angle;
    return {
      stem: `Two parallel lines are cut by a transversal. One pair of co-interior (allied) angles has one angle ${angle}°. Find the measure of the other angle.`,
      answer: `${other}°`,
      wrong: uniqueWrong(`${other}°`, [`${angle}°`, `${90}°`, `${other + 10}°`]),
      hint: "Co-interior angles between parallel lines add up to 180°.",
      explanation: `180° − ${angle}° = ${other}°.`,
      spec: { kind: "checked", skill: "parallel_lines", angle },
    };
  },
  euler_formula(ctx) {
    const faces = 4 + (ctx.seed % 8);
    const vertices = 4 + ((ctx.seed >> 3) % 8);
    const edges = faces + vertices - 2;
    return {
      stem: `A polyhedron has ${faces} faces and ${vertices} vertices. Use Euler's formula to find the number of edges.`,
      answer: num(edges),
      wrong: uniqueWrong(num(edges), [
        num(faces + vertices),
        num(faces + vertices - 1),
        num(edges + 2),
      ]),
      hint: "Euler's formula for a polyhedron is F + V − E = 2.",
      explanation: `E = F + V − 2 = ${faces} + ${vertices} − 2 = ${edges}.`,
      spec: { kind: "checked", skill: "euler_formula", faces, vertices },
    };
  },
  surface_area_volume(ctx) {
    const rule = ctx.seed % 2 === 0 ? "volume" : "surface_area";
    const solid = (ctx.seed >> 1) % 2 === 0 ? "cuboid" : "cube";
    if (solid === "cube") {
      const side = 2 + (ctx.seed % 6);
      const value = rule === "volume" ? side ** 3 : 6 * side * side;
      const unit = rule === "volume" ? "cu cm" : "sq cm";
      return {
        stem:
          rule === "volume"
            ? `Find the volume of a cube of edge ${side} cm.`
            : `Find the total surface area of a cube of edge ${side} cm.`,
        answer: `${value} ${unit}`,
        wrong: uniqueWrong(`${value} ${unit}`, [
          rule === "volume" ? `${6 * side * side} cu cm` : `${side ** 3} sq cm`,
          `${rule === "volume" ? side * side : 4 * side * side} ${unit}`,
          `${value + side} ${unit}`,
        ]),
        hint:
          rule === "volume"
            ? "Volume of a cube is edge × edge × edge."
            : "Total surface area of a cube is 6 × edge².",
        explanation:
          rule === "volume" ? `${side}³ = ${value} cu cm.` : `6 × ${side}² = ${value} sq cm.`,
        spec: { kind: "checked", skill: "surface_area_volume", solid, rule, side },
      };
    }
    const length = 2 + (ctx.seed % 6);
    const breadth = 2 + ((ctx.seed >> 3) % 5);
    const height = 2 + ((ctx.seed >> 6) % 4);
    const value =
      rule === "volume"
        ? length * breadth * height
        : 2 * (length * breadth + breadth * height + height * length);
    const unit = rule === "volume" ? "cu cm" : "sq cm";
    return {
      stem:
        rule === "volume"
          ? `Find the volume of a cuboid ${length} cm × ${breadth} cm × ${height} cm.`
          : `Find the total surface area of a cuboid ${length} cm × ${breadth} cm × ${height} cm.`,
      answer: `${value} ${unit}`,
      wrong: uniqueWrong(`${value} ${unit}`, [
        rule === "volume"
          ? `${2 * (length * breadth + breadth * height + height * length)} cu cm`
          : `${length * breadth * height} sq cm`,
        `${length + breadth + height} ${unit}`,
        `${length * breadth} ${unit}`,
      ]),
      hint:
        rule === "volume"
          ? "Volume of a cuboid is length × breadth × height."
          : "Total surface area is 2(lb + bh + hl).",
      explanation:
        rule === "volume"
          ? `${length} × ${breadth} × ${height} = ${value} cu cm.`
          : `2(${length * breadth} + ${breadth * height} + ${height * length}) = ${value} sq cm.`,
      spec: { kind: "checked", skill: "surface_area_volume", solid, rule, length, breadth, height },
    };
  },
  discount(ctx) {
    const marked = 100 * (2 + (ctx.seed % 8));
    const percent = [5, 10, 20, 25][ctx.seed % 4] ?? 10;
    const cut = (marked * percent) / 100;
    const selling = marked - cut;
    return {
      stem: `The marked price of an item is ₹${marked}. A discount of ${percent}% is given. Find the selling price.`,
      answer: `₹${selling}`,
      wrong: uniqueWrong(`₹${selling}`, [`₹${marked}`, `₹${cut}`, `₹${marked + cut}`]),
      hint: "Selling price = marked price − discount.",
      explanation: `Discount = ₹${cut}, so the selling price is ₹${selling}.`,
      spec: { kind: "checked", skill: "discount", marked, percent },
    };
  },
  compound_interest(ctx) {
    const principal = 1000 * (1 + (ctx.seed % 5));
    const rate = [10, 20, 50][ctx.seed % 3] ?? 10;
    const amount = (principal * (100 + rate) * (100 + rate)) / 10000;
    const interest = amount - principal;
    return {
      stem: `Find the compound interest on ₹${principal} at ${rate}% per year for 2 years.`,
      answer: `₹${interest}`,
      wrong: uniqueWrong(`₹${interest}`, [
        `₹${principal}`,
        `₹${interest + principal}`,
        `₹${(principal * rate * 2) / 100}`,
      ]),
      hint: "Amount = P(1 + r/100)², then compound interest = amount − principal.",
      explanation: `Amount = ₹${amount}, so the compound interest is ₹${interest}.`,
      spec: { kind: "checked", skill: "compound_interest", principal, rate, years: 2 },
    };
  },
  statistics(ctx) {
    const base = 2 + (ctx.seed % 6);
    const rule = ctx.seed % 3;
    if (rule === 0) {
      const values = [base, base + 2, base + 4, base + 6];
      const answer = num(base + 3);
      return {
        stem: `What is the mean of ${values.join(", ")}?`,
        answer,
        wrong: uniqueWrong(answer, [
          num(base + 2),
          num(base + 4),
          num(values.reduce((sum, value) => sum + value, 0)),
        ]),
        hint: "The mean is the total divided by how many numbers there are.",
        explanation: `The total is ${base * 4 + 12}, and ${base * 4 + 12} ÷ 4 = ${answer}.`,
        spec: { kind: "checked", skill: "statistics", rule: "mean", values },
      };
    }
    if (rule === 1) {
      const values = [base, base + 3, base + 7, base + 10, base + 20];
      const answer = num(base + 7);
      return {
        stem: `What is the median of ${values.join(", ")}?`,
        answer,
        wrong: uniqueWrong(answer, [num(base + 3), num(base + 10), num(base + 13)]),
        hint: "Arrange the numbers in order; the median is the middle value.",
        explanation: `In order, the middle value is ${answer}.`,
        spec: { kind: "checked", skill: "statistics", rule: "median", values },
      };
    }
    const values = [base, base, base + 3, base + 3, base + 3];
    const answer = num(base + 3);
    return {
      stem: `What is the mode of ${values.join(", ")}?`,
      answer,
      wrong: uniqueWrong(answer, [num(base), num(base + 1), num(base + 6)]),
      hint: "The mode is the value that appears most often.",
      explanation: `${base + 3} appears three times, so it is the mode.`,
      spec: { kind: "checked", skill: "statistics", rule: "mode", values },
    };
  },
  probability(ctx) {
    const red = 1 + (ctx.seed % 7);
    const blue = 1 + ((ctx.seed >> 3) % 7);
    const total = red + blue;
    const answer = fraction(red, total);
    return {
      stem: `A bag contains ${red} red and ${blue} blue balls. One ball is drawn at random. What is the probability that it is red?`,
      answer,
      wrong: uniqueWrong(answer, [fraction(blue, total), fraction(red, total + 1), fraction(1, 2)]),
      hint: "Probability = favourable outcomes ÷ total outcomes.",
      explanation: `There are ${red} red balls out of ${total}, so the probability is ${answer}.`,
      spec: { kind: "checked", skill: "probability", red, blue },
    };
  },
  data_interpretation(ctx) {
    const a = 3 + (ctx.seed % 5);
    const b = 4 + ((ctx.seed >> 3) % 5);
    const c = 5 + ((ctx.seed >> 6) % 5);
    const d = 14 + ((ctx.seed >> 9) % 4);
    const raw = [a, b, c, d];
    const rotate = ctx.seed % 4;
    const values = raw.map((_, index) => raw[(index + rotate) % 4]!);
    const labels = DATA_LABELS.map((_, index) => DATA_LABELS[(index + rotate) % 4]!);
    const table = labels.map((label, index) => `${label}: ${values[index]}`).join(", ");
    if (ctx.seed % 2 === 0) {
      let maxIndex = 0;
      for (let index = 1; index < values.length; index += 1) {
        if ((values[index] ?? 0) > (values[maxIndex] ?? 0)) maxIndex = index;
      }
      const answer = labels[maxIndex] ?? "Cricket";
      return {
        stem: `The table shows the number of students who chose each sport: ${table}. Which sport is the most popular?`,
        answer,
        wrong: labels.filter((label) => label !== answer),
        hint: "The most popular sport has the highest number of students.",
        explanation: `${answer} has the highest count, so it is the most popular.`,
        spec: { kind: "checked", skill: "data_interpretation", rule: "most", labels, values },
      };
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    const answer = num(total);
    return {
      stem: `The table shows the number of students who chose each sport: ${table}. How many students were surveyed in all?`,
      answer,
      wrong: uniqueWrong(answer, [num(total + a), num(total - a), num(total + b)]),
      hint: "Add the number of students for every sport.",
      explanation: `The total is ${values.join(" + ")} = ${answer}.`,
      spec: { kind: "checked", skill: "data_interpretation", rule: "total", labels, values },
    };
  },
  graphs(ctx) {
    const slope = 1 + (ctx.seed % 5);
    const intercept = 1 + ((ctx.seed >> 3) % 10);
    const x = 1 + ((ctx.seed >> 6) % 8);
    const answer = num(slope * x + intercept);
    return {
      stem: `A line graph represents the equation y = ${slope}x + ${intercept}. Find the value of y when x = ${x}.`,
      answer,
      wrong: uniqueWrong(answer, [
        num(slope + x + intercept),
        num(slope * (x + intercept)),
        num(slope * x + intercept + slope),
      ]),
      hint: "Substitute the value of x into the equation.",
      explanation: `y = ${slope} × ${x} + ${intercept} = ${answer}.`,
      spec: { kind: "checked", skill: "graphs", slope, intercept, x },
    };
  },
  matrix_coding(ctx) {
    const word = MATRIX_WORDS[ctx.seed % MATRIX_WORDS.length] ?? "CAT";
    const answer = positionsCode(word);
    return {
      stem: `In a code, each letter is replaced by its position in the alphabet (A = 1, B = 2, ...). What is the code for ${word}?`,
      answer,
      wrong: uniqueWrong(answer, [
        [...word].map((letter) => letter.charCodeAt(0) - 64 + 1).join("-"),
        [...word]
          .reverse()
          .map((letter) => letter.charCodeAt(0) - 64)
          .join("-"),
        num([...word].reduce((sum, letter) => sum + letter.charCodeAt(0) - 64, 0)),
      ]),
      hint: "Write each letter's alphabet position in order.",
      explanation: `The code for ${word} is ${answer}.`,
      spec: { kind: "checked", skill: "matrix_coding", word },
    };
  },
  syllogism(ctx) {
    const set = SYLLOGISM_SETS[ctx.seed % SYLLOGISM_SETS.length] ?? SYLLOGISM_SETS[0]!;
    const [a, b, c] = set;
    const answer = `All ${a} are ${c}.`;
    return {
      stem: `Statements: All ${a} are ${b}. All ${b} are ${c}. Which conclusion definitely follows?`,
      answer,
      wrong: [`All ${c} are ${a}.`, `No ${a} are ${c}.`, `Some ${a} are not ${c}.`],
      hint: "Chain the two universal statements.",
      explanation: `All ${a} are ${b} and all ${b} are ${c}, so all ${a} are ${c}.`,
      spec: { kind: "checked", skill: "syllogism", a, b, c },
    };
  },
};

function intOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function intsOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) return null;
  return value as number[];
}

function stringsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

export function solveChecked(spec: Record<string, unknown>): string | null {
  const skill = spec["skill"];
  if (typeof skill !== "string" || !isCheckedSkill(skill)) return null;
  if (skill === "letter_series") {
    const start = spec["start"];
    const step = intOf(spec["step"]);
    const shown = intOf(spec["shown"]);
    if (typeof start !== "string" || step == null || shown == null) return null;
    return letterAt(start, step, shown);
  }
  if (skill === "coding_decoding") {
    const word = spec["word"];
    const shift = intOf(spec["shift"]);
    if (typeof word !== "string" || shift == null) return null;
    return shiftWord(word, shift);
  }
  if (skill === "calendar") {
    const year = intOf(spec["year"]);
    const month = intOf(spec["month"]);
    const day = intOf(spec["day"]);
    if (year == null || month == null || day == null) return null;
    return weekday(year, month, day);
  }
  if (skill === "ranking") {
    const total = intOf(spec["total"]);
    const fromLeft = intOf(spec["fromLeft"]);
    if (total == null || fromLeft == null) return null;
    return num(total - fromLeft + 1);
  }
  if (skill === "symbol_operations") {
    const left = intOf(spec["left"]);
    const right = intOf(spec["right"]);
    const add = intOf(spec["add"]);
    if (left == null || right == null || add == null) return null;
    return num(left + right + add);
  }
  if (skill === "percentage") {
    const whole = intOf(spec["whole"]);
    const percent = intOf(spec["percent"]);
    if (whole == null || percent == null || (whole * percent) % 100 !== 0) return null;
    return num((whole * percent) / 100);
  }
  if (skill === "profit_loss") {
    const cost = intOf(spec["cost"]);
    const gain = intOf(spec["gain"]);
    if (cost == null || gain == null || (cost * gain) % 100 !== 0) return null;
    return num(cost + (cost * gain) / 100);
  }
  if (skill === "average") {
    const values = intsOf(spec["values"]);
    if (!values?.length) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total % values.length !== 0) return null;
    return num(total / values.length);
  }
  if (skill === "simple_interest") {
    const principal = intOf(spec["principal"]);
    const rate = intOf(spec["rate"]);
    const years = intOf(spec["years"]);
    if (principal == null || rate == null || years == null) return null;
    if ((principal * rate * years) % 100 !== 0) return null;
    return num((principal * rate * years) / 100);
  }
  if (skill === "fractions") {
    const n1 = intOf(spec["n1"]);
    const d1 = intOf(spec["d1"]);
    const n2 = intOf(spec["n2"]);
    const d2 = intOf(spec["d2"]);
    if (n1 == null || d1 == null || n2 == null || d2 == null || d1 === 0 || d2 === 0) return null;
    return fraction(n1 * d2 + n2 * d1, d1 * d2);
  }
  if (skill === "division") {
    const dividend = intOf(spec["dividend"]);
    const divisor = intOf(spec["divisor"]);
    if (dividend == null || divisor == null || divisor === 0 || dividend % divisor !== 0)
      return null;
    return num(dividend / divisor);
  }
  if (skill === "number_formation") {
    const digits = intsOf(spec["digits"]);
    if (!digits?.length) return null;
    return [...digits].sort((a, b) => b - a).join("");
  }
  if (skill === "multiplication") {
    const left = intOf(spec["left"]);
    const right = intOf(spec["right"]);
    if (left == null || right == null) return null;
    return num(left * right);
  }
  if (skill === "rounding") {
    const value = intOf(spec["value"]);
    const place = intOf(spec["place"]);
    if (value == null || place == null || place === 0) return null;
    return num(Math.round(value / place) * place);
  }
  if (skill === "speed_time") {
    const speed = intOf(spec["speed"]);
    const hours = intOf(spec["hours"]);
    if (speed == null || hours == null) return null;
    return `${speed * hours} km`;
  }
  if (skill === "unitary_method") {
    const items = intOf(spec["items"]);
    const cost = intOf(spec["cost"]);
    if (items == null || cost == null || items === 0 || cost % items !== 0) return null;
    return `₹${cost / items}`;
  }
  if (skill === "factors") {
    const value = intOf(spec["value"]);
    if (value == null || value < 1) return null;
    let sum = 0;
    for (let factor = 1; factor <= value; factor += 1) {
      if (value % factor === 0) sum += factor;
    }
    return num(sum);
  }
  if (skill === "divisibility") {
    const value = intOf(spec["value"]);
    const divisor = intOf(spec["divisor"]);
    if (value == null || divisor == null || divisor === 0) return null;
    return num(value % divisor);
  }
  if (skill === "mensuration") {
    const length = intOf(spec["length"]);
    const width = intOf(spec["width"]);
    if (length == null || width == null) return null;
    return `${length * width} sq cm`;
  }
  if (skill === "angles") {
    const angle = intOf(spec["angle"]);
    if (angle == null) return null;
    return `${180 - angle}°`;
  }
  if (skill === "linear_equation") {
    const coefficient = intOf(spec["coefficient"]);
    const added = intOf(spec["added"]);
    const total = intOf(spec["total"]);
    if (coefficient == null || added == null || total == null || coefficient === 0) return null;
    if ((total - added) % coefficient !== 0) return null;
    return num((total - added) / coefficient);
  }
  if (skill === "work_rate") {
    const days = intOf(spec["days"]);
    const used = intOf(spec["used"]);
    if (days == null || used == null || days === 0) return null;
    return fraction(used, days);
  }
  if (skill === "mean_proportion") {
    const left = intOf(spec["left"]);
    const right = intOf(spec["right"]);
    if (left == null || right == null) return null;
    const root = Math.sqrt(left * right);
    if (!Number.isInteger(root)) return null;
    return num(root);
  }
  if (skill === "metric_measures") {
    const kilograms = intOf(spec["kilograms"]);
    if (kilograms == null) return null;
    return num(kilograms * 1000);
  }
  if (skill === "ratio_hcf") {
    const left = intOf(spec["left"]);
    const right = intOf(spec["right"]);
    if (left == null || right == null) return null;
    return num(gcd(left, right));
  }
  if (skill === "triangle_area") {
    const base = intOf(spec["base"]);
    const height = intOf(spec["height"]);
    if (base == null || height == null || (base * height) % 2 !== 0) return null;
    return `${(base * height) / 2} sq cm`;
  }
  if (skill === "date_puzzle") {
    const month = intOf(spec["month"]);
    const day = intOf(spec["day"]);
    const before = intOf(spec["before"]);
    if (month == null || day == null || before == null || day - before < 1) return null;
    const monthName = new Date(Date.UTC(2024, month - 1, 1)).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    return `${day - before} ${monthName}`;
  }
  if (skill === "clock_direction") {
    const hour = intOf(spec["hour"]);
    if (hour == null) return null;
    return clockDirection(hour);
  }
  if (skill === "dictionary_order") {
    const words = stringsOf(spec["words"]);
    if (!words || words.length !== 4 || new Set(words).size !== 4) return null;
    if (words.some((word) => !/^[a-z]+$/.test(word))) return null;
    return dictionaryOrder(words);
  }
  if (skill === "odd_one_out") {
    const values = intsOf(spec["values"]);
    const rule = intOf(spec["rule"]);
    if (!values || rule == null) return null;
    const answer = oddOneValue(values, rule);
    return answer == null ? null : num(answer);
  }
  if (skill === "number_properties") {
    const values = intsOf(spec["values"]);
    const wantPrime = spec["wantPrime"];
    if (!values || typeof wantPrime !== "boolean") return null;
    const matches = values.filter((value) => isPrime(value) === wantPrime);
    return matches.length === 1 ? num(matches[0]!) : null;
  }
  if (skill === "roman_numerals") {
    const value = intOf(spec["value"]);
    if (value == null || value < 1) return null;
    return romanOf(value);
  }
  if (skill === "lcm_hcf") {
    const left = intOf(spec["left"]);
    const right = intOf(spec["right"]);
    const rule = spec["rule"];
    if (left == null || right == null) return null;
    return num(rule === "lcm" ? lcm(left, right) : gcd(left, right));
  }
  if (skill === "bodmas") {
    const a = intOf(spec["a"]);
    const b = intOf(spec["b"]);
    const c = intOf(spec["c"]);
    const d = intOf(spec["d"]);
    const e = intOf(spec["e"]);
    if (a == null || b == null || c == null || d == null || e == null || e === 0) return null;
    const quotient = d / e;
    if (!Number.isInteger(quotient)) return null;
    return num(a + b * c - quotient);
  }
  if (skill === "decimals") {
    const aCents = intOf(spec["aCents"]);
    const bCents = intOf(spec["bCents"]);
    if (aCents == null || bCents == null) return null;
    return money(aCents + bCents);
  }
  if (skill === "circle") {
    const radius = intOf(spec["radius"]);
    const rule = spec["rule"];
    if (radius == null || radius % 7 !== 0) return null;
    return rule === "area" ? `${circleArea(radius)} sq cm` : `${circleCircumference(radius)} cm`;
  }
  if (skill === "volume_solid") {
    if (spec["solid"] === "cube") {
      const side = intOf(spec["side"]);
      if (side == null) return null;
      return `${side * side * side} cu cm`;
    }
    const length = intOf(spec["length"]);
    const breadth = intOf(spec["breadth"]);
    const height = intOf(spec["height"]);
    if (length == null || breadth == null || height == null) return null;
    return `${length * breadth * height} cu cm`;
  }
  if (skill === "temperature_conversion") {
    const value = intOf(spec["value"]);
    const direction = spec["direction"];
    if (value == null) return null;
    if (direction === "c2f") return `${celsiusToFahrenheit(value)}°F`;
    if (direction === "f2c") {
      const celsius = fahrenheitToCelsius(value);
      return Number.isInteger(celsius) ? `${celsius}°C` : null;
    }
    return null;
  }
  if (skill === "question_tags") {
    const index = intOf(spec["index"]);
    if (index == null) return null;
    return QUESTION_TAG_ITEMS[index]?.tag ?? null;
  }
  if (skill === "rational_numbers") {
    const n1 = intOf(spec["n1"]);
    const d1 = intOf(spec["d1"]);
    const n2 = intOf(spec["n2"]);
    const d2 = intOf(spec["d2"]);
    if (n1 == null || d1 == null || n2 == null || d2 == null || d1 === 0 || d2 === 0) return null;
    return fraction(n1 * d2 + n2 * d1, d1 * d2);
  }
  if (skill === "squares_roots") {
    const value = intOf(spec["value"]);
    if (value == null) return null;
    if (spec["rule"] === "sqrt") {
      const root = Math.sqrt(value);
      return Number.isInteger(root) ? num(root) : null;
    }
    return num(value * value);
  }
  if (skill === "cubes_roots") {
    const value = intOf(spec["value"]);
    if (value == null) return null;
    if (spec["rule"] === "cbrt") {
      const root = Math.cbrt(value);
      return Number.isInteger(root) ? num(root) : null;
    }
    return num(value * value * value);
  }
  if (skill === "algebraic_identities") {
    const base = intOf(spec["base"]);
    if (base == null) return null;
    if (spec["rule"] === "diff_squares") return num(base * base - 1);
    const delta = intOf(spec["delta"]);
    if (delta == null) return null;
    return num((base + delta) * (base + delta));
  }
  if (skill === "factorization") {
    const p = intOf(spec["p"]);
    const q = intOf(spec["q"]);
    if (p == null || q == null) return null;
    return `(x + ${p})(x + ${q})`;
  }
  if (skill === "exponents") {
    const base = intOf(spec["base"]);
    const m = intOf(spec["m"]);
    const n = intOf(spec["n"]);
    if (base == null || m == null || n == null) return null;
    const rule = spec["rule"];
    if (rule === "multiply") return num(base ** (m + n));
    if (rule === "divide") return m >= n ? num(base ** (m - n)) : null;
    return num(base ** (m * n));
  }
  if (skill === "proportion") {
    const a = intOf(spec["a"]);
    const b = intOf(spec["b"]);
    const c = intOf(spec["c"]);
    if (a == null || b == null || c == null || c === 0) return null;
    if (spec["rule"] === "direct") return `₹${b * c}`;
    return Number.isInteger((a * b) / c) ? `${(a * b) / c} days` : null;
  }
  if (skill === "quadrilaterals") {
    const ratio = intsOf(spec["ratio"]);
    if (!ratio?.length) return null;
    const sum = ratio.reduce((total, value) => total + value, 0);
    const value = (360 * Math.max(...ratio)) / sum;
    return Number.isInteger(value) ? `${value}°` : null;
  }
  if (skill === "triangle_properties") {
    if (spec["rule"] === "angle_ratio") {
      const ratio = intsOf(spec["ratio"]);
      if (!ratio?.length) return null;
      const sum = ratio.reduce((total, value) => total + value, 0);
      const value = (180 * Math.max(...ratio)) / sum;
      return Number.isInteger(value) ? `${value}°` : null;
    }
    const a = intOf(spec["a"]);
    const b = intOf(spec["b"]);
    if (a == null || b == null) return null;
    const hypotenuse = Math.sqrt(a * a + b * b);
    return Number.isInteger(hypotenuse) ? `${hypotenuse} cm` : null;
  }
  if (skill === "parallel_lines") {
    const angle = intOf(spec["angle"]);
    if (angle == null) return null;
    return `${180 - angle}°`;
  }
  if (skill === "euler_formula") {
    const faces = intOf(spec["faces"]);
    const vertices = intOf(spec["vertices"]);
    if (faces == null || vertices == null) return null;
    return num(faces + vertices - 2);
  }
  if (skill === "surface_area_volume") {
    const rule = spec["rule"];
    if (spec["solid"] === "cube") {
      const side = intOf(spec["side"]);
      if (side == null) return null;
      return rule === "volume" ? `${side ** 3} cu cm` : `${6 * side * side} sq cm`;
    }
    const length = intOf(spec["length"]);
    const breadth = intOf(spec["breadth"]);
    const height = intOf(spec["height"]);
    if (length == null || breadth == null || height == null) return null;
    return rule === "volume"
      ? `${length * breadth * height} cu cm`
      : `${2 * (length * breadth + breadth * height + height * length)} sq cm`;
  }
  if (skill === "discount") {
    const marked = intOf(spec["marked"]);
    const percent = intOf(spec["percent"]);
    if (marked == null || percent == null) return null;
    return `₹${marked - (marked * percent) / 100}`;
  }
  if (skill === "compound_interest") {
    const principal = intOf(spec["principal"]);
    const rate = intOf(spec["rate"]);
    const years = intOf(spec["years"]);
    if (principal == null || rate == null || years == null || years < 1) return null;
    const amount = (principal * (100 + rate) ** years) / 100 ** years;
    if (!Number.isInteger(amount)) return null;
    return `₹${amount - principal}`;
  }
  if (skill === "statistics") {
    const values = intsOf(spec["values"]);
    if (!values?.length) return null;
    const rule = spec["rule"];
    if (rule === "mean") {
      const total = values.reduce((sum, value) => sum + value, 0);
      return total % values.length === 0 ? num(total / values.length) : null;
    }
    if (rule === "median") {
      const median = medianOf(values);
      return median == null ? null : num(median);
    }
    const mode = modeOf(values);
    return mode == null ? null : num(mode);
  }
  if (skill === "probability") {
    const red = intOf(spec["red"]);
    const blue = intOf(spec["blue"]);
    if (red == null || blue == null || red + blue === 0) return null;
    return fraction(red, red + blue);
  }
  if (skill === "data_interpretation") {
    const values = intsOf(spec["values"]);
    const labels = stringsOf(spec["labels"]);
    if (!values?.length || !labels?.length || labels.length !== values.length) return null;
    if (spec["rule"] === "total") {
      return num(values.reduce((sum, value) => sum + value, 0));
    }
    let maxIndex = 0;
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index] ?? 0) > (values[maxIndex] ?? 0)) maxIndex = index;
    }
    return labels[maxIndex] ?? null;
  }
  if (skill === "graphs") {
    const slope = intOf(spec["slope"]);
    const intercept = intOf(spec["intercept"]);
    const x = intOf(spec["x"]);
    if (slope == null || intercept == null || x == null) return null;
    return num(slope * x + intercept);
  }
  if (skill === "matrix_coding") {
    const word = spec["word"];
    if (typeof word !== "string" || !/^[A-Z]+$/.test(word)) return null;
    return positionsCode(word);
  }
  if (skill === "syllogism") {
    const a = spec["a"];
    const c = spec["c"];
    if (typeof a !== "string" || typeof c !== "string") return null;
    return `All ${a} are ${c}.`;
  }
  return null;
}

export function generateCheckedQuestion(options: {
  skill: string;
  seedKey: string;
  questionId: string;
  number: string;
  grade?: number | null;
  difficultyStep?: number;
  sourceQuestionId?: string | null;
  jobId?: string | null;
}): Question {
  if (!isCheckedSkill(options.skill)) {
    throw new Error(`No checked generator for ${options.skill}.`);
  }
  const seed = hashSeed(options.seedKey);
  const step = options.difficultyStep ?? 0;
  const built = BUILDERS[options.skill]({
    seed,
    grade: options.grade ?? null,
    step,
  });
  const wrong = uniqueWrong(built.answer, built.wrong);
  const correctSlot = seed % 4;
  const ordered = [...wrong];
  ordered.splice(correctSlot, 0, built.answer);
  const correctKey = String.fromCharCode(65 + correctSlot);
  return emptyQuestion({
    id: options.questionId,
    number: options.number,
    type: "mcq",
    skill_type: options.skill,
    stem: built.stem,
    options: ordered.map((text, index) => ({
      key: String.fromCharCode(65 + index),
      text,
      is_correct: index === correctSlot,
    })),
    answer_keys: [correctKey],
    hint: built.hint,
    explanation: built.explanation,
    marks: 1,
    difficulty:
      step > 0 ? "hard" : small({ seed, grade: options.grade ?? null, step }) ? "easy" : "medium",
    tags: [options.skill],
    approved: false,
    approval_status: "generated",
    math_spec: built.spec,
    source_question_id: options.sourceQuestionId ?? null,
    generation_job_id: options.jobId ?? null,
    source: options.sourceQuestionId ?? "ai_mock",
  });
}

function markedText(question: Question): string | null {
  const key =
    question.answer_keys[0] ?? question.options.find((option) => option.is_correct)?.key ?? null;
  if (!key) return null;
  return question.options.find((option) => option.key === key)?.text ?? null;
}

export function validateCheckedQuestion(question: Question, createdAt?: string): ValidationResult {
  const spec = question.math_spec;
  const solved = spec ? solveChecked(spec) : null;
  const marked = markedText(question);
  const checks = [
    {
      name: "math",
      status: solved == null ? ("failed" as const) : ("passed" as const),
      details:
        solved == null ? "The checked rule could not be solved." : `Solver answer is ${solved}.`,
    },
    {
      name: "answer",
      status: solved != null && marked === solved ? ("passed" as const) : ("failed" as const),
      details:
        solved != null && marked === solved
          ? "Marked answer matches the solver."
          : `Marked answer ${marked ?? "missing"} does not match the solver value ${solved ?? "missing"}.`,
    },
    {
      name: "schema",
      status:
        question.options.length === 4 && question.stem.trim()
          ? ("passed" as const)
          : ("failed" as const),
      details:
        question.options.length === 4
          ? "Question has a stem and four options."
          : "Question needs four options.",
    },
  ];
  return combineValidation(checks, createdAt);
}
