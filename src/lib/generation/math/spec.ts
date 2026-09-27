export type NumberSeriesRule =
  | {
      kind: "difference_sequence";
      initial_difference: number;
      difference_delta: number;
    }
  | {
      kind: "multiply_add";
      multiply: number;
      add: number;
    };

export type NumberSeriesSpec = {
  kind: "number_series";
  rule: NumberSeriesRule;
  visible_terms: number[];
};

export function isNumberSeriesSpec(value: unknown): value is NumberSeriesSpec {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record["kind"] !== "number_series" || !Array.isArray(record["visible_terms"])) return false;
  const rule = record["rule"];
  if (!rule || typeof rule !== "object") return false;
  const kind = (rule as Record<string, unknown>)["kind"];
  return kind === "difference_sequence" || kind === "multiply_add";
}
