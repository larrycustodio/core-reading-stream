import type { Config, Reading, WindowSummary } from './types.ts';
import { cleanupReadings, compKey } from './cleanupReadings.ts';

const sortWindowSummary = (prev: WindowSummary, curr: WindowSummary) => {
  if (prev.deviceId < curr.deviceId) return -1;
  if (prev.deviceId > curr.deviceId) return 1;
  return prev.windowStart - curr.windowStart;
}

/**
 * Tier 1. Clean `readings` (given in arrival order) and summarize each
 * device's accepted readings per window. See "Rules" in the README.
 */
export function summarize(readings: Reading[], config: Config): WindowSummary[] {
  if (readings.length === 0) return [];

  const windowSummaryMap = new Map<string, WindowSummary>();

  for (const reading of cleanupReadings(readings, config)) {
    const windowStart = Math.floor(reading.ts / config.windowMs) * config.windowMs;
    const readingValue = reading.value ?? 0;
    const summaryKey = compKey([reading.deviceId, windowStart.toString()]);
    const summary = windowSummaryMap.get(summaryKey);

    if (!summary) {
      windowSummaryMap.set(summaryKey, {
        deviceId: reading.deviceId,
        windowStart,
        count: 1,
        min: readingValue,
        max: readingValue,
        avg: readingValue,
      });
    } else {
      windowSummaryMap.set(summaryKey, {
        ...summary,
        count: summary.count + 1,
        min: Math.min(summary.min, readingValue),
        max: Math.max(summary.max, readingValue),
        avg: (summary.avg * summary.count + readingValue) / (summary.count + 1),
      });
    }
  }
  
  return Array.from(windowSummaryMap.values()).toSorted(sortWindowSummary);
}
