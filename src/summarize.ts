import type { Config, Reading, WindowSummary } from './types.ts';

const compKey = (values: string[]): string => values.join('::');

const isValid = (args: { config: Config, reading: Reading }) => {
  const { config, reading } = args;
  const isFinite = Number.isFinite(reading.value)
  const isInRange = reading.value !== null && reading.value >= config.validRange.min &&
    reading.value <= config.validRange.max;
  return isFinite && isInRange;
}

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

  const deviceSequenceSet = new Set<string>();
  const latestAcceptedDeviceValueMap = new Map<string, number>();
  const windowSummaryMap = new Map<string, WindowSummary>();

  for (const reading of readings) {
    // rule 2
    const setKey = compKey([reading.deviceId, reading.ts.toString()]);
    if (deviceSequenceSet.has(setKey)) continue;
    deviceSequenceSet.add(setKey);

    // rule 1
    if (!isValid({ config, reading })) continue;

    // rule 3
    const latestTs = latestAcceptedDeviceValueMap.get(reading.deviceId) ?? -Infinity;
    if (reading.ts < latestTs - config.maxLatenessMs) continue;
    latestAcceptedDeviceValueMap.set(reading.deviceId, Math.max(latestTs, reading.ts));

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
