// Tier 2 tests for `detectGaps`. These fail until `detectGaps` is implemented.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGaps, type Config, type Reading } from '../src/index.ts';

const config: Config = {
  windowMs: 60_000,
  maxLatenessMs: 5_000,
  gapMs: 10_000,
  validRange: { min: -40, max: 125 },
};

let nextSeq = 1_000;
/** A reading for device `deviceId` at `ts` ms, with a fresh `seq` unless given. */
const r = (deviceId: string, ts: number, value: number | null = 1, seq = nextSeq++): Reading => ({
  deviceId,
  ts,
  seq,
  value,
});

describe('base conditions', () => {
  test('empty input gives no gaps', () => {
    assert.deepEqual(detectGaps([], config), []);
  });

  test('a single reading has no gap', () => {
    assert.deepEqual(detectGaps([r('a', 1_000)], config), []);
  });

  test('a spacing smaller than gapMs is not a gap', () => {
    assert.deepEqual(detectGaps([r('a', 0), r('a', config.gapMs - 1)], config), []);
  });

  test('a spacing of exactly gapMs is not a gap', () => {
    assert.deepEqual(detectGaps([r('a', 0), r('a', config.gapMs)], config), []);
  });

  test('a spacing of gapMs + 1 is a gap', () => {
    assert.deepEqual(detectGaps([r('a', 0), r('a', config.gapMs + 1)], config), [
      { deviceId: 'a', start: 0, end: 10_001 },
    ]);
  });

  test('reports each gap in a run of readings', () => {
    const out = detectGaps([r('a', 0), r('a', 5_000), r('a', 30_000), r('a', 33_000), r('a', 60_000)], config);
    assert.deepEqual(out, [
      { deviceId: 'a', start: 5_000, end: 30_000 },
      { deviceId: 'a', start: 33_000, end: 60_000 },
    ]);
  });

  test('a gap can span a window boundary', () => {
    assert.deepEqual(detectGaps([r('a', 55_000), r('a', 70_000)], config), [
      { deviceId: 'a', start: 55_000, end: 70_000 },
    ]);
  });

  test('gaps are measured per device, not across devices', () => {
    // a and b are interleaved, but each one is steady on its own.
    const out = detectGaps([r('a', 0), r('b', 20_000), r('a', 8_000), r('b', 28_000)], config);
    assert.deepEqual(out, []);
  });
});

describe('ordering', () => {
  test('gaps are measured in ts order, not arrival order', () => {
    // Arrives 0, 20 000, 18 000. In ts order it is 0, 18 000, 20 000, so the gap ends at 18 000.
    const out = detectGaps([r('a', 0), r('a', 20_000), r('a', 18_000)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 18_000 }]);
  });

  test('a late reading that is still accepted can close a gap', () => {
    // 7 000 is exactly maxLatenessMs behind 12 000, so it is accepted and splits 0 -> 12 000.
    const out = detectGaps([r('a', 0), r('a', 12_000), r('a', 7_000)], config);
    assert.deepEqual(out, []);
  });

  test('primary sort is deviceId, using plain string comparison', () => {
    const out = detectGaps(
      [r('b', 0), r('b', 50_000), r('B', 0), r('B', 50_000), r('a', 0), r('a', 50_000), r('c', 0), r('c', 50_000)],
      config,
    );
    // 'B' < 'a' < 'b' < 'c' in code-unit order, whereas localeCompare would put 'B' after 'a'.
    assert.deepEqual(
      out.map((g) => g.deviceId),
      ['B', 'a', 'b', 'c'],
    );
  });

  test('secondary sort is start, within a device', () => {
    const out = detectGaps(
      [
        r('b', 100_000),
        r('a', 200_000),
        r('b', 0),
        r('a', 100_000),
        r('b', 50_000),
        r('a', 0),
        r('a', 150_000),
      ],
      { ...config, maxLatenessMs: 500_000 },
    );
    assert.deepEqual(out, [
      { deviceId: 'a', start: 0, end: 100_000 },
      { deviceId: 'a', start: 100_000, end: 150_000 },
      { deviceId: 'a', start: 150_000, end: 200_000 },
      { deviceId: 'b', start: 0, end: 50_000 },
      { deviceId: 'b', start: 50_000, end: 100_000 },
    ]);
  });
});

describe('filtering', () => {
  test('a device with only invalid readings has no gaps', () => {
    const out = detectGaps(
      [r('a', 0, null), r('a', 30_000, NaN), r('a', 60_000, Infinity), r('a', 90_000, 126), r('a', 120_000, -41)],
      config,
    );
    assert.deepEqual(out, []);
  });

  test('an invalid reading does not split a gap', () => {
    // The null at 15 000 is dropped, so the silence runs from 0 to 30 000.
    const out = detectGaps([r('a', 0), r('a', 15_000, null), r('a', 30_000)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 30_000 }]);
  });

  test('readings outside validRange do not split a gap, but the bounds themselves do', () => {
    const out = detectGaps([r('a', 0), r('a', 15_000, 126), r('a', 20_000, -41), r('a', 30_000)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 30_000 }]);
    const bounds = detectGaps([r('a', 0), r('a', 5_000, -40), r('a', 10_000, 125), r('a', 30_000)], config);
    assert.deepEqual(bounds, [{ deviceId: 'a', start: 10_000, end: 30_000 }]);
  });

  test('a reading more than maxLatenessMs behind is dropped and does not split a gap', () => {
    // 20 000 is 10 000 behind 30 000, which is more than maxLatenessMs.
    const out = detectGaps([r('a', 0), r('a', 30_000), r('a', 20_000)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 30_000 }]);
  });

  test('a reading exactly maxLatenessMs behind is kept', () => {
    // 25 000 is exactly 5 000 behind 30 000, so it is accepted and ends the gap early.
    // 25 000 -> 30 000 is only 5 000, which is not a gap.
    const out = detectGaps([r('a', 0), r('a', 30_000), r('a', 25_000)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 25_000 }]);
  });

  test('a resent reading is dropped', () => {
    // The resend of seq 7 arrives later with a different ts; it must not create a reading at 15 000.
    const out = detectGaps([r('a', 0, 1, 7), r('a', 30_000), r('a', 15_000, 1, 7)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 30_000 }]);
  });

  test('a resend is dropped even when it would pass the lateness check', () => {
    // 15 000 is within maxLatenessMs of 12 000, so only the duplicate rule can drop it.
    const out = detectGaps([r('a', 0, 1, 7), r('a', 12_000), r('a', 15_000, 1, 7), r('a', 30_000)], config);
    assert.deepEqual(out, [
      { deviceId: 'a', start: 0, end: 12_000 },
      { deviceId: 'a', start: 12_000, end: 30_000 },
    ]);
  });

  test('a resend of an invalid reading is also dropped', () => {
    // The first seq 7 is null; its valid resend is still a duplicate, so 15 000 never splits the gap.
    const out = detectGaps([r('a', 0), r('a', 15_000, null, 7), r('a', 15_000, 1, 7), r('a', 30_000)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 30_000 }]);
  });

  test('two distinct readings with the same ts are not duplicates', () => {
    // Different seqs at the same ts are separate readings; neither may be dropped as a resend.
    const out = detectGaps([r('a', 0), r('a', 20_000, 1, 1), r('a', 20_000, 2, 2)], config);
    assert.deepEqual(out, [{ deviceId: 'a', start: 0, end: 20_000 }]);
  });
});
