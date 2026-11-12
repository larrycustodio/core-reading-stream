import type { Config, Reading, WindowSummary } from './types.ts';
import { isValid } from './cleanupReadings.ts';
import { addToSummary, windowStartOf } from './summarize.ts';

export type Stream = {
  /** Accept one reading, in arrival order. Returns any windows that just became final. */
  push(reading: Reading): WindowSummary[];
  /** The input is over. Returns every window still open. */
  end(): WindowSummary[];
};

export type StreamStats = { devices: number; openWindows: number; trackedSeqs: number };

type OpenWindow = { summary?: WindowSummary; seqs: Set<number> };

type DeviceState = {
  /** Newest accepted ts for this device; -Infinity until one is accepted. */
  newestTs: number;
  windows: Map<number, OpenWindow>;
};

export function createStream(config: Config): Stream & { stats(): StreamStats } {
  const devices = new Map<string, DeviceState>();
  let ended = false;

  /** Remove and return every window of `device` that is behind its horizon. */
  const closeFinalWindows = (device: DeviceState): WindowSummary[] => {
    const horizon = device.newestTs - config.maxLatenessMs;
    const closed: WindowSummary[] = [];
    for (const [windowStart, window] of device.windows) {
      if (windowStart + config.windowMs > horizon) continue;
      if (window.summary) closed.push(window.summary);
      device.windows.delete(windowStart);
    }
    return closed;
  };

  return {
    push(reading) {
      if (ended) throw new Error('push after end');

      let device = devices.get(reading.deviceId);
      if (!device) devices.set(reading.deviceId, (device = { newestTs: -Infinity, windows: new Map() }));

      // rule 3 (checked first): too late. This also drops resends whose window has closed.
      if (reading.ts < device.newestTs - config.maxLatenessMs) return [];

      const windowStart = windowStartOf(reading.ts, config);
      let window = device.windows.get(windowStart);
      if (!window) device.windows.set(windowStart, (window = { seqs: new Set() }));

      // rule 2: duplicate, whether or not the earlier one was accepted.
      if (window.seqs.has(reading.seq)) return [];
      window.seqs.add(reading.seq);

      // rule 1: invalid value. Its seq stays recorded so a valid resend is still dropped.
      if (!isValid({ config, reading })) return [];

      window.summary = addToSummary(window.summary, reading, windowStart);

      if (reading.ts <= device.newestTs) return [];
      device.newestTs = reading.ts;
      return closeFinalWindows(device);
    },

    end() {
      if (ended) return [];
      ended = true;
      const remaining: WindowSummary[] = [];
      for (const device of devices.values()) {
        for (const window of device.windows.values()) {
          if (window.summary) remaining.push(window.summary);
        }
      }
      devices.clear();
      return remaining;
    },

    stats() {
      let openWindows = 0;
      let trackedSeqs = 0;
      for (const device of devices.values()) {
        openWindows += device.windows.size;
        for (const window of device.windows.values()) trackedSeqs += window.seqs.size;
      }
      return { devices: devices.size, openWindows, trackedSeqs };
    },
  };
}
