# ClawVitals Code Review — Round 1

**Reviewer:** Claude Opus 4.6
**Branch:** `feat/initial-implementation`
**Date:** 2026-03-19

---

## BLOCKERS

**[BLOCKER] B1 — handleDetail recomputes delta against null, making all FAILs appear as new findings**
- File: `src/index.ts` (lines 114-115)
- Issue: `handleDetail` creates a new `DeltaDetector` and calls `detect(lastRun, null)`. With `previous = null`, the DeltaDetector classifies ALL current FAILs as `new_findings`. This means the detail report always shows every failure as "New since last scan" even if they've existed for months.
- Required fix: Use the delta already stored in the report: replace lines 114-115 with `const delta = lastRun.dock_analysis.delta;` — the delta was already computed and persisted during the original scan.

---

**[BLOCKER] B2 — Telemetry endpoint has no HTTPS-only validation**
- File: `src/telemetry/index.ts` (line 44)
- Issue: The telemetry client sends data to whatever URL is in `config.telemetry_endpoint` without validating it starts with `https://`. If the config is tampered with or misconfigured to `http://`, anonymous scan data would be sent in cleartext.
- Required fix: Add a guard at the top of the `ping()` method (after the `telemetry_enabled` check):
  ```ts
  if (!config.telemetry_endpoint.startsWith('https://')) return;
  ```

---

**[BLOCKER] B3 — DeltaDetector does not use `introduced_in` to distinguish new_finding vs new_check**
- File: `src/scoring/delta.ts` (lines 55-68)
- Issue: The spec requires distinguishing `new_finding` (existing control that regressed to FAIL) from `new_check` (control from a newer library version, not present in the previous scan) by comparing each control's `introduced_in` against the previous report's `library_version`. The current code uses a simple presence check (`!prevEval`), which is a reasonable approximation but does not implement the specified algorithm. Additionally, `ControlEvaluation` does not carry `introduced_in`, so the spec's algorithm cannot be implemented without extending the type.
- Required fix:
  1. Add `introduced_in: string` to the `ControlEvaluation` interface in `types.ts`
  2. Populate it in `ControlEvaluator.buildBaseEvaluation()` from `control.introduced_in`
  3. In `DeltaDetector.detect()`, when a control is not in `previousMap`, compare its `introduced_in` against `previous.library_version` using semver. If `introduced_in > previous.library_version` → `new_check`. Otherwise → `new_finding`.

---

**[BLOCKER] B4 — CliRunner binary validation happens at `run()` time, not construction time**
- File: `src/cli-runner.ts` (line 90)
- Issue: The spec requires that the binary allowlist check throws at **construction time**, not exec time. The current CliRunner has no constructor parameter for the binary — it is passed per-call to `run()`. While the security invariant is maintained (no disallowed binary is ever executed), the API shape does not match the spec.
- Required fix: Refactor CliRunner to accept the binary name in the constructor and validate it there:
  ```ts
  export class CliRunner {
    private readonly binary: string;
    constructor(binary: string) {
      if (!ALLOWED_BINARIES.includes(binary)) {
        throw new CliDisallowedBinaryError(binary);
      }
      this.binary = binary;
    }
    async run(args: string[], options?: CliRunOptions): Promise<CliRunResult> { ... }
  }
  ```
  Then update all call sites: `new CliRunner('openclaw')` for collectors/scheduler, `new CliRunner('node')` where needed.

---

## MAJORS

**[MAJOR] M1 — 10 exported handler functions lack @param and @returns JSDoc**
- File: `src/index.ts`
- Issue: All handler functions (`handleScan`, `handleDetail`, `handleHistory`, `handleSchedule`, `handleScheduledScan`, `handleTelemetry`, `handleLink`, `handleConfig`, `handleStatus`, `handleExclusions`) have description-only JSDoc but are missing `@param` and `@returns` tags. For an open-source project, every exported function must have complete JSDoc per the checklist.
- Required fix: Add `@param` and `@returns` tags to all 10 handler functions. The `buildDependencies` private function and `severityRank` helper should also get `@param`/`@returns`.

---

**[MAJOR] M2 — scoring.test.ts does not test the `low` severity deduction (-2)**
- File: `tests/unit/scoring.test.ts`
- Issue: Tests cover critical (-25), high (-10), medium (-5), and info (0) deductions, but there is no test for the `low` (-2) deduction defined in `SEVERITY_DEDUCTION`. While no stable control in v0.1.0 has `low` severity, the scorer handles it and the constant exists — it should be tested.
- Required fix: Add a test case:
  ```ts
  it('should deduct 2 points for a low-severity failure', () => {
    const evaluations = [
      makeEval({ control_id: 'NC-1', result: 'FAIL', severity: 'low' }),
      ...fourPassEvals,
    ];
    const result = scorer.score(evaluations);
    expect(result.score).toBe(98);
  });
  ```

---

**[MAJOR] M3 — 3 experimental controls have real evaluation logic instead of SKIP stubs**
- File: `src/controls/evaluator.ts` (lines 131-517)
- Issue: The checklist requires "All 8 experimental control stubs return SKIP with reason 'experimental control'". NC-OC-002, NC-OC-005, and NC-OC-006 have full evaluation logic returning PASS/FAIL instead of SKIP. The fixture tests validate this real behavior, suggesting it's intentional, but it contradicts the checklist requirement.
- Required fix: Confirm with product whether the 3 controls should be stubs or have real logic. If stubs are required, replace the `evaluateExperimental` switch cases for NC-OC-002/005/006 with the default SKIP return. If real logic is intended, update the checklist/spec to reflect this.

---

**[MAJOR] M4 — CI workflow uses a single job instead of separate jobs for each check**
- File: `.github/workflows/ci.yml`
- Issue: The checklist specifies "Jobs: typecheck, lint, unit tests, integration tests, bundle size check" (plural "jobs"). The current CI has all five as steps within a single `test` job. This means a lint failure blocks unit tests from running, and there's no parallelism.
- Required fix: Split into separate jobs. At minimum, `typecheck` and `lint` should run in parallel, and `unit-tests` and `integration-tests` should be separate jobs:
  ```yaml
  jobs:
    typecheck:
      ...
    lint:
      ...
    unit-tests:
      needs: [typecheck]
      ...
    integration-tests:
      needs: [typecheck]
      ...
    bundle-size:
      needs: [typecheck]
      ...
  ```

---

## MINORS

**[MINOR] N1 — Experimental stub skip reason wording differs from spec**
- File: `src/controls/evaluator.ts` (line 148)
- Issue: The SKIP reason is `'Experimental control — not yet validated for scoring'` but the checklist says `reason 'experimental control'`. While the current message is more informative, it should match the spec wording if exactness is required.
- Required fix: If literal match is needed, change to `'experimental control'`. Otherwise, keep as-is (current wording is better for end users).

---

**[MINOR] N2 — `formatDetail` and `formatSummary` duplicate BAND_EMOJI map**
- Files: `src/reporting/detail.ts` (line 12), `src/reporting/summary.ts` (line 13)
- Issue: The same `BAND_EMOJI` record is defined identically in both files. This is a minor DRY violation.
- Required fix: Move `BAND_EMOJI` to `constants.ts` and import from both files.

---

**[MINOR] N3 — `ControlEvaluator` class JSDoc lacks `@description` tag**
- File: `src/controls/evaluator.ts` (line 29)
- Issue: The class has a block-level JSDoc description but doesn't use the `@description` tag explicitly. Most classes follow this pattern. Standard TypeScript convention doesn't require `@description`, but if the checklist requires it literally, all classes should be updated.
- Required fix: Only if literal `@description` tag is required by project convention.

---

**[MINOR] N4 — `handleDetail` delta section is cosmetically wrong even after B1 fix**
- File: `src/index.ts` (line 121)
- Issue: Even after fixing B1, the stored `lastRun.dock_analysis.delta` will show the delta *from the time that scan was run* (vs. the scan before it). This is actually correct, but could confuse users who expect "delta since last scan" to update each time they view the detail. Consider adding a note in the output like "Changes detected at scan time."
- Required fix: No code change needed — just noting for product awareness.

---

## SUMMARY

| Severity | Count |
|----------|-------|
| BLOCKER  | 4     |
| MAJOR    | 4     |
| MINOR    | 4     |

**Overall verdict: NEEDS FIXES**

The implementation is solid architecturally — clean module boundaries, good type safety, comprehensive tests, and proper security controls (chmod 600, binary allowlist, no console.log, strict mode). The blockers are focused: a delta-display bug (B1), missing HTTPS validation (B2), a spec-algorithm mismatch in DeltaDetector (B3), and a CliRunner API shape issue (B4). The majors are mostly about documentation completeness and spec-compliance. Once the 4 blockers are resolved, this is close to shippable.
