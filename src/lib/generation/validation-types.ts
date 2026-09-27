export const VALIDATOR_VERSION = "slice-1";

export type ValidationStatus = "passed" | "failed" | "needs_review";

export type ValidationCheckStatus = "passed" | "failed" | "skipped" | "needs_review";

export type ValidationCheck = {
  name: string;
  status: ValidationCheckStatus;
  details?: string | null;
};

export type ValidationResult = {
  status: ValidationStatus;
  checks: ValidationCheck[];
  errors: string[];
  validator_version: string;
  created_at: string;
};

export function combineValidation(
  checks: ValidationCheck[],
  createdAt = new Date().toISOString(),
): ValidationResult {
  const errors = checks
    .filter((check) => check.status === "failed" || check.status === "needs_review")
    .map((check) => check.details || check.name);
  const status: ValidationStatus = checks.some((check) => check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status === "needs_review")
      ? "needs_review"
      : "passed";
  return {
    status,
    checks,
    errors,
    validator_version: VALIDATOR_VERSION,
    created_at: createdAt,
  };
}
