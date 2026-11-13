import type { Config, Reading, WindowSummary } from './types.ts';
import { cleanupReadings, compKey } from './cleanupReadings.ts';

const sortWindowSummary = (prev: WindowSummary, curr: WindowSummary) => {
  if (prev.deviceId < curr.deviceId) return -1;
  if (prev.deviceId > curr.deviceId) return 1;
  return prev.windowStart - curr.windowStart;
}

export const windowStartOf = (ts: number, config: Config): number =>
  Math.floor(ts / config.windowMs) * config.windowMs;

export const addToSummary = (
  summary: WindowSummary | undefined,
  reading: Reading,
  windowStart: number,
): WindowSummary => {
  const readingValue = reading.value ?? 0;

  if (!summary) {
    return {
      deviceId: reading.deviceId,
      windowStart,
      count: 1,
      min: readingValue,
      max: readingValue,
      avg: readingValue,
    };
  }
  return {
    ...summary,
    count: summary.count + 1,
    min: Math.min(summary.min, readingValue),
    max: Math.max(summary.max, readingValue),
    avg: (summary.avg * summary.count + readingValue) / (summary.count + 1),
  };
}

/**
 * Tier 1. Clean `readings` (given in arrival order) and summarize each
 * device's accepted readings per window. See "Rules" in the README.
 */
export function summarize(readings: Reading[], config: Config): WindowSummary[] {
  if (readings.length === 0) return [];

  const windowSummaryMap = new Map<string, WindowSummary>();

  for (const reading of cleanupReadings(readings, config)) {
    const windowStart = windowStartOf(reading.ts, config);
    const summaryKey = compKey([reading.deviceId, windowStart.toString()]);
    windowSummaryMap.set(summaryKey, addToSummary(windowSummaryMap.get(summaryKey), reading, windowStart));
  }
  
  return Array.from(windowSummaryMap.values()).toSorted(sortWindowSummary);
}
