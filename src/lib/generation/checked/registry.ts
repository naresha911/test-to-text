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

function oddOneValue(values: number[], rule: number): number | null {
  if ((rule !== 2 && rule !== 3) || values.length !== 4) return null;
  if (values.some((value) => !Number.isInteger(value)) || new Set(values).size !== 4) return null;
  const outlier = values.filter((value) => value % rule !== 0);
  if (outlier.length !== 1 || values.filter((value) => value % rule === 0).length !== 3) return null;
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

function uniqueWrong(answer: string, candidates: string[]): string[] {
  const wrong: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || candidate === answer || wrong.includes(candidate)) continue;
    wrong.push(candidate);
    if (wrong.length === 3) return wrong;
  }
  let extra = 1;
  while (wrong.length < 3) {
    const next = `${Number(answer) + extra * 3}`;
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
      wrong: uniqueWrong(num(answer), [num(principal * rate), num(answer + years), num(answer / 2)]),
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
      wrong: uniqueWrong(`${answer}°`, [`${answer + 10}°`, `${Math.max(1, answer - 10)}°`, `${360 - angle}°`]),
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
      wrong: uniqueWrong(answer, [fraction(1, days), fraction(used, days - 1), `${used}/${days + 1}`]),
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
      wrong: uniqueWrong(num(answer), [num(left + right), num((left + right) / 2), num(answer + 2)]),
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
      wrong: uniqueWrong(num(answer), [num(kilograms * 100), num(kilograms * 10), num(answer + 100)]),
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
    const pool = small(ctx)
      ? ["North", "East", "South", "West"]
      : ["NE", "SE", "SW", "NW"];
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
      (easy ? (rule === 2 ? [2, 4, 8, 9] : [3, 6, 12, 5]) : rule === 2 ? [22, 34, 46, 15] : [33, 36, 42, 25]);
    const answer = cleanOddOne(values, rule) ?? values[values.length - 1] ?? 0;
    return {
      stem: `Which number is the odd one out: ${values.join(", ")}?`,
      answer: num(answer),
      wrong: values.filter((value) => value !== answer).map((value) => num(value)),
      hint: rule === 2 ? "Three of the numbers are even." : "Three of the numbers are divisible by 3.",
      explanation:
        rule === 2
          ? `The other three are even. ${answer} is the odd one out.`
          : `The other three are divisible by 3. ${answer} is the odd one out.`,
      spec: { kind: "checked", skill: "odd_one_out", values, rule },
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
    if (dividend == null || divisor == null || divisor === 0 || dividend % divisor !== 0) return null;
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
    difficulty: step > 0 ? "hard" : small({ seed, grade: options.grade ?? null, step }) ? "easy" : "medium",
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
      details: solved == null ? "The checked rule could not be solved." : `Solver answer is ${solved}.`,
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
