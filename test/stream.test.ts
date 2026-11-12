// Tier 2 tests for `createStream`. These fail until `createStream` is implemented.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStream, summarize, type Config, type Reading, type WindowSummary } from '../src/index.ts';

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

/** Windows within one call can come back in any order, so sort before comparing. */
const sorted = (windows: WindowSummary[]): WindowSummary[] =>
  windows.toSorted((x, y) => (x.deviceId < y.deviceId ? -1 : x.deviceId > y.deviceId ? 1 : x.windowStart - y.windowStart));

const win = (deviceId: string, windowStart: number, count: number, min: number, max: number, avg: number): WindowSummary => ({
  deviceId,
  windowStart,
  count,
  min,
  max,
  avg,
});

// With windowMs 60 000 and maxLatenessMs 5 000, window [0, 60 000) closes once a device's
// newest accepted ts reaches 65 000, because the horizon (newest - maxLatenessMs) is then 60 000.
describe('push', () => {
  test('returns a window once its device horizon reaches the window end', () => {
    const s = createStream(config);
    assert.deepEqual(s.push(r('a', 1_000, 4)), []);
    assert.deepEqual(s.push(r('a', 2_000, 6)), []);
    assert.deepEqual(sorted(s.push(r('a', 65_000, 9))), [win('a', 0, 2, 4, 6, 5)]);
  });

  test('a reading exactly at the horizon is accepted, so the window does not close early', () => {
    const s = createStream(config);
    s.push(r('a', 1_000, 1));
    // Newest is 64 999, so the horizon is 59 999: a reading at 59 999 is still on time.
    assert.deepEqual(s.push(r('a', 64_999, 1)), []);
    assert.deepEqual(s.push(r('a', 59_999, 3)), []);
    // Now the horizon passes the end of window 0, and the horizon reading is included.
    assert.deepEqual(sorted(s.push(r('a', 65_000, 1))), [win('a', 0, 2, 1, 3, 2)]);
  });

  test('a window with data still inside the lateness horizon stays open', () => {
    const s = createStream(config);
    s.push(r('a', 59_999, 1));
    assert.deepEqual(s.push(r('a', 64_999, 1)), []);
    assert.deepEqual(s.push(r('a', 62_000, 1)), []);
  });

  test('returns [] when no window has closed', () => {
    const s = createStream(config);
    for (const ts of [1_000, 2_000, 3_000, 500]) assert.deepEqual(s.push(r('a', ts)), []);
  });

  test('returns each window exactly once', () => {
    const s = createStream(config);
    s.push(r('a', 10_000));
    assert.equal(s.push(r('a', 70_000)).length, 1);
    assert.deepEqual(s.push(r('a', 71_000)), []);
    assert.deepEqual(
      sorted(s.end()).map((w) => w.windowStart),
      [60_000],
    );
  });

  test('closes several windows in one call when a device jumps forward', () => {
    const s = createStream(config);
    s.push(r('a', 10_000));
    s.push(r('a', 70_000));
    const out = s.push(r('a', 200_000));
    assert.deepEqual(
      sorted(out).map((w) => w.windowStart),
      [60_000],
    );
    assert.deepEqual(
      sorted(s.end()).map((w) => w.windowStart),
      [180_000],
    );
  });

  test("another device's progress does not close a window", () => {
    const s = createStream(config);
    s.push(r('a', 1_000));
    assert.deepEqual(s.push(r('b', 500_000)), []);
    assert.deepEqual(
      sorted(s.end()).map((w) => [w.deviceId, w.windowStart]),
      [
        ['a', 0],
        ['b', 480_000],
      ],
    );
  });

  test('invalid and out-of-range readings are filtered out', () => {
    const s = createStream(config);
    for (const value of [null, NaN, Infinity, -Infinity, 126, -41]) assert.deepEqual(s.push(r('a', 1_000, value)), []);
    assert.deepEqual(s.end(), []);
  });

  test('the bounds of validRange are accepted', () => {
    const s = createStream(config);
    s.push(r('a', 1_000, -40));
    s.push(r('a', 2_000, 125));
    assert.deepEqual(s.end(), [win('a', 0, 2, -40, 125, 42.5)]);
  });

  test('an invalid reading does not move the horizon', () => {
    const s = createStream(config);
    s.push(r('a', 1_000, 1));
    assert.deepEqual(s.push(r('a', 100_000, null)), []);
    assert.deepEqual(s.end(), [win('a', 0, 1, 1, 1, 1)]);
  });

  test('duplicates are dropped and the first arrival wins', () => {
    const s = createStream(config);
    s.push(r('a', 1_000, 1, 7));
    s.push(r('a', 2_000, 3));
    s.push(r('a', 1_000, 50, 7));
    assert.deepEqual(s.end(), [win('a', 0, 2, 1, 3, 2)]);
  });

  test('the same seq on different devices is not a duplicate', () => {
    const s = createStream(config);
    s.push(r('a', 1_000, 1, 7));
    s.push(r('b', 1_000, 1, 7));
    assert.equal(s.end().length, 2);
  });

  test('a duplicate of an invalid reading is dropped', () => {
    const s = createStream(config);
    s.push(r('a', 1_000, null, 7));
    assert.deepEqual(s.push(r('a', 1_000, 5, 7)), []);
    assert.deepEqual(s.end(), []);
  });

  test('a reading more than maxLatenessMs behind is dropped', () => {
    const s = createStream(config);
    s.push(r('a', 10_000, 1));
    assert.equal(s.push(r('a', 70_000, 1)).length, 1); // closes window 0
    assert.deepEqual(s.push(r('a', 64_999, 100)), []); // 5 001 behind: too late
    assert.deepEqual(s.end(), [win('a', 60_000, 1, 1, 1, 1)]);
  });

  test('a reading exactly maxLatenessMs behind is accepted', () => {
    const s = createStream(config);
    s.push(r('a', 70_000, 1));
    s.push(r('a', 65_000, 3));
    assert.deepEqual(s.end(), [win('a', 60_000, 2, 1, 3, 2)]);
  });

  test('a late reading cannot reopen a window that already came out', () => {
    const s = createStream(config);
    s.push(r('a', 10_000, 1));
    assert.equal(s.push(r('a', 65_000, 1)).length, 1);
    assert.deepEqual(s.push(r('a', 20_000, 1)), []);
    assert.ok(s.end().every((w) => w.windowStart !== 0));
  });
});

describe('end', () => {
  test('returns [] for an empty stream', () => {
    assert.deepEqual(createStream(config).end(), []);
  });

  test('returns [] when every window has already come out', () => {
    const s = createStream(config);
    s.push(r('a', 1_000));
    assert.equal(s.push(r('a', 65_000)).length, 1); // closes window 0
    assert.equal(s.end().length, 1); // window 60 000
    assert.deepEqual(s.end(), []);
  });

  test('returns every window still open, including those of quiet devices', () => {
    const s = createStream(config);
    s.push(r('a', 1_000, 2));
    s.push(r('b', 1_000, 4));
    s.push(r('c', 61_000, 6));
    const closed = s.push(r('a', 130_000, 8)); // closes a's window 0 only
    assert.deepEqual(sorted(closed), [win('a', 0, 1, 2, 2, 2)]);
    assert.deepEqual(sorted(s.end()), [
      win('a', 120_000, 1, 8, 8, 8),
      win('b', 0, 1, 4, 4, 4),
      win('c', 60_000, 1, 6, 6, 6),
    ]);
  });

  test('push after end throws', () => {
    // The README does not say what push after end should do; this pins it down as an error.
    const s = createStream(config);
    s.push(r('a', 1_000));
    s.end();
    assert.throws(() => s.push(r('a', 2_000)));
  });

  test('a second end returns []', () => {
    const s = createStream(config);
    s.push(r('a', 1_000));
    assert.equal(s.end().length, 1);
    assert.deepEqual(s.end(), []);
  });
});

describe('happy path', () => {
  /** Feed every reading through push, then end, and collect all windows that came out. */
  const runStream = (readings: Reading[]): WindowSummary[] => {
    const s = createStream(config);
    const out: WindowSummary[] = [];
    for (const reading of readings) out.push(...s.push(reading));
    out.push(...s.end());
    return out;
  };

  const assertSameAsSummarize = (readings: Reading[]) => {
    const streamed = sorted(runStream(readings));
    const expected = summarize(readings, config);
    assert.equal(streamed.length, expected.length);
    streamed.forEach((w, i) => {
      const e = expected[i]!;
      assert.equal(w.deviceId, e.deviceId);
      assert.equal(w.windowStart, e.windowStart);
      assert.equal(w.count, e.count);
      assert.equal(w.min, e.min);
      assert.equal(w.max, e.max);
      assert.ok(Math.abs(w.avg - e.avg) < 1e-9, `avg ${w.avg} vs ${e.avg}`);
    });
  };

  test('push and end together match summarize on a hand-built messy input', () => {
    assertSameAsSummarize([
      r('a', 1_000, 1),
      r('b', 2_000, 5),
      r('a', 70_000, 3),
      r('a', 66_000, 4), // late but accepted
      r('a', 1_500, 99), // too late
      r('b', 3_000, null), // invalid
      r('a', 70_000, 3, 5_000),
      r('a', 70_000, 8, 5_000), // resend
      r('c', 130_000, 126), // out of range
      r('c', 130_000, 7),
      r('b', 300_000, -40),
    ]);
  });

  test('each window comes out exactly once across push and end', () => {
    const readings = [r('a', 1_000), r('a', 65_000), r('b', 2_000), r('a', 200_000), r('b', 90_000)];
    const keys = runStream(readings).map((w) => `${w.deviceId}:${w.windowStart}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('push and end together match summarize on the sample data', () => {
    const readings: Reading[] = JSON.parse(readFileSync(new URL('../data/sample.json', import.meta.url), 'utf8'));
    assertSameAsSummarize(readings);
  });
});
