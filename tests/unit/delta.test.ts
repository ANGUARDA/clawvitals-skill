/**
 * Unit tests for the DeltaDetector.
 *
 * Tests new finding detection, resolved finding detection,
 * new check detection, and first-run (null previous) behavior.
 */

import { DeltaDetector } from '../../src/scoring/delta';
import type { RunReport, ControlEvaluation } from '../../src/types';

/** Build a minimal ControlEvaluation for testing */
function makeEval(overrides: Partial<ControlEvaluation>): ControlEvaluation {
  return {
    control_id: 'NC-TEST-001',
    control_name: 'Test Control',
    domain: 'OC',
    severity: 'medium',
    status: 'stable',
    result: 'PASS',
    source: 'test',
    source_type: 'authoritative',
    evidence: 'test',
    remediation: null,
    exclusion_reason: null,
    exclusion_expires: null,
    error_detail: null,
    skip_reason: null,
    ...overrides,
  };
}

/** Build a minimal RunReport for testing */
function makeReport(
  stableFindings: ControlEvaluation[],
  experimentalFindings: ControlEvaluation[] = [],
  libraryVersion = '0.1.0'
): RunReport {
  return {
    version: '0.1.0',
    library_version: libraryVersion,
    meta: {
      host_name: 'test',
      scan_ts: new Date().toISOString(),
      mode: '1',
      openclaw_version: '2026.3.13',
      run_id: 'test-run-id',
      is_scheduled: false,
      success: true,
    },
    sources: {
      security_audit: { ok: true, data: null, ts: null, error: null },
      health: { ok: true, data: null, ts: null, error: null },
      update_status: { ok: true, data: null, ts: null, error: null },
      version_cmd: { ok: true, version: '2026.3.13', error: null },
      attack_surface: null,
    },
    native_findings: [],
    dock_analysis: {
      stable: {
        score: 100,
        band: 'green',
        domains: [],
        findings: stableFindings,
      },
      experimental: {
        findings: experimentalFindings,
      },
      excluded: [],
      skipped: [],
      delta: { new_findings: [], resolved_findings: [], new_checks: [] },
    },
  };
}

describe('DeltaDetector', () => {
  const detector = new DeltaDetector();

  describe('first run (null previous)', () => {
    it('should treat all current FAILs as new findings on first run', () => {
      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL' }),
      ]);

      const result = detector.detect(current, null);

      expect(result.new_findings).toHaveLength(2);
      expect(result.new_findings.map(f => f.control_id)).toContain('NC-OC-003');
      expect(result.new_findings.map(f => f.control_id)).toContain('NC-AUTH-001');
      expect(result.resolved_findings).toHaveLength(0);
      expect(result.new_checks).toHaveLength(0);
    });

    it('should return empty delta when no FAILs exist on first run', () => {
      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
      ]);

      const result = detector.detect(current, null);

      expect(result.new_findings).toHaveLength(0);
      expect(result.resolved_findings).toHaveLength(0);
      expect(result.new_checks).toHaveLength(0);
    });
  });

  describe('new findings', () => {
    it('should detect a control that was PASS but is now FAIL', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
      ]);

      const result = detector.detect(current, previous);

      expect(result.new_findings).toHaveLength(1);
      expect(result.new_findings[0]!.control_id).toBe('NC-OC-003');
    });

    it('should detect a control that was SKIP but is now FAIL', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'SKIP' }),
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),
      ]);

      const result = detector.detect(current, previous);

      expect(result.new_findings).toHaveLength(1);
    });

    it('should not flag a control that was already FAIL as a new finding', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),
      ]);

      const result = detector.detect(current, previous);

      expect(result.new_findings).toHaveLength(0);
    });
  });

  describe('resolved findings', () => {
    it('should detect a control that was FAIL but is now PASS', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL' }),
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL' }),
      ]);

      const result = detector.detect(current, previous);

      expect(result.resolved_findings).toHaveLength(1);
      expect(result.resolved_findings[0]!.control_id).toBe('NC-OC-003');
    });

    it('should not flag a control that stayed PASS as resolved', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
      ]);

      const result = detector.detect(current, previous);

      expect(result.resolved_findings).toHaveLength(0);
    });
  });

  describe('new checks', () => {
    it('should detect a new control not in the previous scan', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-NEW-001', result: 'FAIL' }),
      ]);

      const result = detector.detect(current, previous);

      expect(result.new_checks).toHaveLength(1);
      expect(result.new_checks[0]!.control_id).toBe('NC-NEW-001');
    });

    it('should not flag a new control that PASSes as a new check', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-NEW-001', result: 'PASS' }),
      ]);

      const result = detector.detect(current, previous);

      expect(result.new_checks).toHaveLength(0);
    });
  });

  describe('mixed scenarios', () => {
    it('should handle simultaneous new, resolved, and unchanged findings', () => {
      const previous = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL' }),   // will resolve
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),   // will become new finding
        makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL' }), // stays FAIL
      ]);

      const current = makeReport([
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),   // resolved
        makeEval({ control_id: 'NC-OC-004', result: 'FAIL' }),   // new finding
        makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL' }), // unchanged
      ]);

      const result = detector.detect(current, previous);

      expect(result.new_findings).toHaveLength(1);
      expect(result.new_findings[0]!.control_id).toBe('NC-OC-004');
      expect(result.resolved_findings).toHaveLength(1);
      expect(result.resolved_findings[0]!.control_id).toBe('NC-OC-003');
    });
  });
});
