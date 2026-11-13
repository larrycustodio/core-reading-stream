import type { Config, Reading } from './types.ts';

export const compKey = (values: string[]): string => values.join('::');

export const isValid = (args: { config: Config, reading: Reading }) => {
  const { config, reading } = args;
  const isFinite = Number.isFinite(reading.value)
  const isInRange = reading.value !== null && reading.value >= config.validRange.min &&
    reading.value <= config.validRange.max;
  return isFinite && isInRange;
}

export function cleanupReadings(readings: Reading[], config: Config): Reading[] {
  const deviceSequenceSet = new Set<string>();
  const latestAcceptedDeviceValueMap = new Map<string, number>();
  const accepted: Reading[] = [];

  for (const reading of readings) {
    // rule 2: remove duplicates (same device + seq seen before, accepted or not).
    const setKey = compKey([reading.deviceId, reading.seq.toString()]);
    if (deviceSequenceSet.has(setKey)) continue;
    deviceSequenceSet.add(setKey);

    // rule 1: invalid values
    if (!isValid({ config, reading })) continue;

    // rule 3: more than maxLatenessMs behind the newest accepted ts for this device.
    const latestTs = latestAcceptedDeviceValueMap.get(reading.deviceId) ?? -Infinity;
    if (reading.ts < latestTs - config.maxLatenessMs) continue;
    latestAcceptedDeviceValueMap.set(reading.deviceId, Math.max(latestTs, reading.ts));

    accepted.push(reading);
  }

  return accepted;
}
