import type { NumberSeriesRule } from "@/lib/generation/math/spec";

/**
 * Recomputes the next term from the rule and the visible terms.
 * This file does not import the generator.
 */
export function solveNumberSeries(rule: NumberSeriesRule, visible: number[]): number {
  if (visible.length < 3) {
    throw new Error("A number series needs at least three visible terms.");
  }
  if (visible.some((term) => !Number.isInteger(term))) {
    throw new Error("This solver only accepts integer terms.");
  }

  if (rule.kind === "difference_sequence") {
    for (let index = 0; index < visible.length - 1; index += 1) {
      const expectedDiff = rule.initial_difference + index * rule.difference_delta;
      if (visible[index + 1]! - visible[index]! !== expectedDiff) {
        throw new Error("Visible terms do not follow the difference rule.");
      }
    }
    const nextDiff = rule.initial_difference + (visible.length - 1) * rule.difference_delta;
    return visible[visible.length - 1]! + nextDiff;
  }

  if (!Number.isInteger(rule.multiply) || !Number.isInteger(rule.add)) {
    throw new Error("Multiply-add rules must use integers.");
  }
  for (let index = 1; index < visible.length; index += 1) {
    if (visible[index - 1]! * rule.multiply + rule.add !== visible[index]) {
      throw new Error("Visible terms do not follow the multiply-add rule.");
    }
  }
  return visible[visible.length - 1]! * rule.multiply + rule.add;
}
