import type { Config, Gap, Reading } from './types.ts';
import { cleanupReadings } from './cleanupReadings.ts';

const sortByDeviceId = (prev: string, curr: string) => (prev < curr ? -1 : prev > curr ? 1 : 0);

/**
 * Tier 2. Report every gap in each device's accepted readings.
 * See "Tier 2" in the README.
 */
export function detectGaps(readings: Reading[], config: Config): Gap[] {
  if (readings.length === 0) return [];

  const timestampByDeviceMap = new Map<string, number[]>();
  for (const { deviceId, ts } of cleanupReadings(readings, config)) {
    let list = timestampByDeviceMap.get(deviceId);
    if (!list) timestampByDeviceMap.set(deviceId, (list = []));
    list.push(ts);
  }

  const byDeviceIds = Array.from(timestampByDeviceMap.keys()).toSorted(sortByDeviceId);

  const gaps: Gap[] = [];
  for (const deviceId of byDeviceIds) {
    const sortedTimestamps = timestampByDeviceMap.get(deviceId)!.sort((a, b) => a - b);
    for (let idx = 1; idx < sortedTimestamps.length; idx++) {
      const gap = sortedTimestamps[idx] - sortedTimestamps[idx - 1];
      if (gap > config.gapMs) {
        gaps.push({ deviceId, start: sortedTimestamps[idx - 1], end: sortedTimestamps[idx] });
      }
    }
  }
  return gaps;
}
