/**
 * delta.test.ts — Tests for DeltaDetector class.
 */
import { DeltaDetector } from '../../src/scoring/delta';
import type { RunReport, ControlEvaluation } from '../../src/types';

function makeEval(overrides: Partial<ControlEvaluation> = {}): ControlEvaluation {
  return {
    control_id: 'NC-TEST-001',
    control_name: 'Test control',
    domain: 'TEST',
    severity: 'medium',
    status: 'stable',
    result: 'PASS',
    source: 'test',
    source_type: 'authoritative',
    evidence: '',
    remediation: null,
    exclusion_reason: null,
    exclusion_expires: null,
    error_detail: null,
    skip_reason: null,
    introduced_in: '1.0.0',
    ...overrides,
  };
}

function makeReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    version: '1.1.2',
    library_version: '1.0.0',
    meta: {
      host_name: 'test',
      scan_ts: new Date().toISOString(),
      mode: '1',
      openclaw_version: '2026.3.13',
      run_id: 'test-run-1',
      is_scheduled: false,
      success: true,
    },
    sources: {} as RunReport['sources'],
    native_findings: [],
    dock_analysis: {
      stable: { score: 100, band: 'green', domains: [], findings: [] },
      experimental: { findings: [] },
      excluded: [],
      skipped: [],
      delta: { new_findings: [], resolved_findings: [], new_checks: [] },
    },
    ...overrides,
  };
}

describe('DeltaDetector', () => {
  const detector = new DeltaDetector();

  describe('first run (no previous)', () => {
    it('treats all FAILs as new findings', () => {
      const current = makeReport({
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [
              makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),
              makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
            ],
          },
          experimental: { findings: [] },
          excluded: [],
          skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, null);
      expect(result.new_findings).toHaveLength(1);
      expect(result.new_findings[0].control_id).toBe('NC-OC-003');
      expect(result.resolved_findings).toHaveLength(0);
      expect(result.new_checks).toHaveLength(0);
    });

    it('returns empty arrays when no FAILs on first run', () => {
      const current = makeReport({
        dock_analysis: {
          stable: {
            score: 100, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-1', result: 'PASS' })],
          },
          experimental: { findings: [] },
          excluded: [],
          skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, null);
      expect(result.new_findings).toHaveLength(0);
      expect(result.resolved_findings).toHaveLength(0);
      expect(result.new_checks).toHaveLength(0);
    });
  });

  describe('new findings', () => {
    it('detects PASS→FAIL transition as new finding', () => {
      const previous = makeReport({
        dock_analysis: {
          stable: {
            score: 100, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-OC-003', result: 'PASS' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const current = makeReport({
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-OC-003', result: 'FAIL' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.new_findings).toHaveLength(1);
      expect(result.new_findings[0].control_id).toBe('NC-OC-003');
    });

    it('does not flag FAIL→FAIL as a new finding', () => {
      const previous = makeReport({
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-OC-003', result: 'FAIL' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const current = makeReport({
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-OC-003', result: 'FAIL' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.new_findings).toHaveLength(0);
    });
  });

  describe('resolved findings', () => {
    it('detects FAIL→PASS transition as resolved', () => {
      const previous = makeReport({
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const current = makeReport({
        dock_analysis: {
          stable: {
            score: 100, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-AUTH-001', result: 'PASS' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.resolved_findings).toHaveLength(1);
      expect(result.resolved_findings[0].control_id).toBe('NC-AUTH-001');
    });

    it('does not flag FAIL→SKIP as resolved', () => {
      const previous = makeReport({
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const current = makeReport({
        dock_analysis: {
          stable: {
            score: 100, band: 'green', domains: [],
            findings: [makeEval({ control_id: 'NC-AUTH-001', result: 'SKIP' })],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.resolved_findings).toHaveLength(0);
    });
  });

  describe('new checks', () => {
    it('detects control with introduced_in > previous library_version as new check', () => {
      const previous = makeReport({ library_version: '1.0.0' });

      const current = makeReport({
        library_version: '1.1.0',
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [
              makeEval({ control_id: 'NC-NEW-001', result: 'FAIL', introduced_in: '1.1.0' }),
            ],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.new_checks).toHaveLength(1);
      expect(result.new_checks[0].control_id).toBe('NC-NEW-001');
      expect(result.new_findings).toHaveLength(0);
    });

    it('treats FAIL control with introduced_in <= previous library_version as new finding', () => {
      const previous = makeReport({ library_version: '1.0.0' });

      const current = makeReport({
        library_version: '1.1.0',
        dock_analysis: {
          stable: {
            score: 90, band: 'green', domains: [],
            findings: [
              makeEval({ control_id: 'NC-OLD-001', result: 'FAIL', introduced_in: '1.0.0' }),
            ],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.new_findings).toHaveLength(1);
      expect(result.new_checks).toHaveLength(0);
    });
  });

  describe('mixed scenarios', () => {
    it('handles simultaneous new, resolved, and new-check findings', () => {
      const previous = makeReport({
        library_version: '1.0.0',
        dock_analysis: {
          stable: {
            score: 80, band: 'amber', domains: [],
            findings: [
              makeEval({ control_id: 'NC-A', result: 'FAIL', introduced_in: '1.0.0' }),
              makeEval({ control_id: 'NC-B', result: 'PASS', introduced_in: '1.0.0' }),
            ],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const current = makeReport({
        library_version: '1.1.0',
        dock_analysis: {
          stable: {
            score: 70, band: 'amber', domains: [],
            findings: [
              makeEval({ control_id: 'NC-A', result: 'PASS', introduced_in: '1.0.0' }),
              makeEval({ control_id: 'NC-B', result: 'FAIL', introduced_in: '1.0.0' }),
              makeEval({ control_id: 'NC-C', result: 'FAIL', introduced_in: '1.1.0' }),
            ],
          },
          experimental: { findings: [] },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.resolved_findings).toHaveLength(1);
      expect(result.resolved_findings[0].control_id).toBe('NC-A');
      expect(result.new_findings).toHaveLength(1);
      expect(result.new_findings[0].control_id).toBe('NC-B');
      expect(result.new_checks).toHaveLength(1);
      expect(result.new_checks[0].control_id).toBe('NC-C');
    });

    it('includes experimental findings in delta detection', () => {
      const previous = makeReport({
        dock_analysis: {
          stable: { score: 100, band: 'green', domains: [], findings: [] },
          experimental: {
            findings: [makeEval({ control_id: 'NC-EXP-1', result: 'PASS', status: 'experimental' })],
          },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const current = makeReport({
        dock_analysis: {
          stable: { score: 100, band: 'green', domains: [], findings: [] },
          experimental: {
            findings: [makeEval({ control_id: 'NC-EXP-1', result: 'FAIL', status: 'experimental' })],
          },
          excluded: [], skipped: [],
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      });

      const result = detector.detect(current, previous);
      expect(result.new_findings).toHaveLength(1);
      expect(result.new_findings[0].control_id).toBe('NC-EXP-1');
    });
  });
});
