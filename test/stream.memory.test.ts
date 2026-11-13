// Tier 2: memory stays bounded however long the stream runs.
// Uses the test-only `stats()` hook on the object `createStream` returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStream } from '../src/stream.ts';
import type { Config, Reading } from '../src/index.ts';

const config: Config = {
  windowMs: 60_000,
  maxLatenessMs: 5_000,
  gapMs: 10_000,
  validRange: { min: -40, max: 125 },
};

test('state stays bounded over a long stream with resends, invalid and late readings', () => {
  const s = createStream(config);
  const devices = ['a', 'b', 'c'];
  const hours = 24;
  const perDeviceRate = 1; // readings per second

  let peakWindows = 0;
  let peakSeqs = 0;
  let windowsOut = 0;

  for (let i = 0; i < hours * 3600; i++) {
    for (const deviceId of devices) {
      const ts = i * 1_000;
      const value = i % 97 === 0 ? null : 20;
      const reading: Reading = { deviceId, ts, seq: i, value };
      windowsOut += s.push(reading).length;
      if (i % 50 === 0) windowsOut += s.push({ ...reading }).length; // resend
      if (i % 31 === 0 && i > 0) windowsOut += s.push({ deviceId, ts: ts - 4_000, seq: -i - 1, value: 1 }).length; // late, still on time
      if (i % 37 === 0 && i > 0) windowsOut += s.push({ deviceId, ts: ts - 30_000, seq: -i - 1_000_000, value: 1 }).length; // too late
    }
    const { openWindows, trackedSeqs } = s.stats();
    peakWindows = Math.max(peakWindows, openWindows);
    peakSeqs = Math.max(peakSeqs, trackedSeqs);
  }
  windowsOut += s.end().length;

  // Every window came out, and only a couple per device were ever open at once.
  assert.equal(windowsOut, devices.length * hours * 60);
  // A device keeps at most the window being filled plus the one still inside the lateness horizon.
  assert.ok(peakWindows <= devices.length * 2, `peak open windows ${peakWindows}`);
  // Seqs are only kept for open windows: about two windows' worth of readings per device.
  const perWindow = (config.windowMs / 1_000) * perDeviceRate;
  assert.ok(peakSeqs <= devices.length * 2 * perWindow * 1.1, `peak tracked seqs ${peakSeqs}`);
});

test('end releases all state', () => {
  const s = createStream(config);
  for (let i = 0; i < 1_000; i++) s.push({ deviceId: 'a', ts: i * 1_000, seq: i, value: 1 });
  s.end();
  assert.deepEqual(s.stats(), { devices: 0, openWindows: 0, trackedSeqs: 0 });
});
