import type { Config, Gap, Reading } from './types.ts';

/**
 * Tier 2. Report every gap in each device's accepted readings.
 * See "Tier 2" in the README.
 */
export function detectGaps(readings: Reading[], config: Config): Gap[] {
  if (readings.length === 0) return [];

  const gaps: Gap[] = [];
  return gaps;
}
