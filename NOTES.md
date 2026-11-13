# Summary
An overview of what I have accomplished for this takehome exercise.

**Tier 1:** `summarize` is done. The three filtering rules were applied, and the windowing helpers were built to meet the unit tests provided. It also mentions the duplicate check being keyed on ts at first and switched to seq. In the later part of the exercise, I had to extract the filtering and windowing helpers so the business logic can be re-used in the tier 2 objectives.

**Tier 2:** I covered `detectGaps` fully. The method should be able to take a clean array of readings, sort them by `ts`, and report adjacent readings that are more than `gapMs` apart per the `config`. Along the way I used a background agent liberally to work in parallel with drafting out the unit tests to meet the base objectives.
For `createStream`, I attempted to cover the base cases and ran out of time to think about exhausting coverage for any boundary conditions. The function should be able to track each device’s newest accepted `ts`, and the windows it still has open. Once that newest `ts - maxLatenessMs` passes a window’s end, nothing can land in that window anymore, so I emit it and forget it. I leaned on the fact that a resend always has the same `ts` as the original, which explains why I only stored `seqs` while their window is open: anything older would get dropped as too late anyway. Similar to `detectGaps`, I spend most of my AI capital in autocompleting the unit tests after hand-writing the assertion descriptions. In addition to what was asked, I wrote a `test/stream.memory.test.ts`, which uses a test-only stats() hook to show that state stays flat over a simulated 24 hours.

**Known limitations and edge-cases:**
- A device that only sends invalid readings may get held in memory 
- The memory bound depends on resends keeping their original `ts`.
- The device list only grows until `end()` gets called.
- The assumption of throwing an error if `push` gets called after `end()` might have been out of scope.