// Conversion Review scoring rubric evaluation (spec §Conversion Review Scoring
// Rubric). Pass requires BOTH: total >= 24/30 AND no individual question < 3.

import { CONVERSION_MIN_TOTAL, CONVERSION_MIN_PER_QUESTION } from "./constants";

export interface ConversionEvaluation {
  total: number;
  lowest: number;
  passed: boolean;
}

export function evaluateConversion(scores: number[]): ConversionEvaluation {
  const total = scores.reduce((a, b) => a + b, 0);
  const lowest = scores.length ? Math.min(...scores) : 0;
  const passed = total >= CONVERSION_MIN_TOTAL && lowest >= CONVERSION_MIN_PER_QUESTION;
  return { total, lowest, passed };
}
