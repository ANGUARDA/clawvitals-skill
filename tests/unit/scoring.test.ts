/**
 * Unit tests for the Scorer.
 *
 * Tests the weighted deduction algorithm, band assignment thresholds,
 * insufficient_data handling, and per-domain scoring.
 */

import { Scorer } from '../../src/scoring';
import type { ControlEvaluation } from '../../src/types';

/** Build a minimal control evaluation for testing */
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
    evidence: 'test evidence',
    remediation: null,
    exclusion_reason: null,
    exclusion_expires: null,
    error_detail: null,
    skip_reason: null,
    introduced_in: '0.1.0',
    ...overrides,
  };
}

describe('Scorer', () => {
  const scorer = new Scorer();

  describe('score calculation', () => {
    it('should return 100 when all stable controls pass', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-008', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-002', result: 'PASS', domain: 'VERS' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(100);
      expect(result.band).toBe('green');
      expect(result.stable_pass).toBe(6);
      expect(result.stable_fail).toBe(0);
    });

    it('should deduct 25 points for a critical failure', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-004', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-OC-008', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-002', result: 'PASS', domain: 'VERS' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(75);
      expect(result.band).toBe('amber');
    });

    it('should deduct 10 points for a high failure', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL', severity: 'high' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-008', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-002', result: 'PASS', domain: 'VERS' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(90);
      expect(result.band).toBe('green');
    });

    it('should deduct 5 points for a medium failure', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-008', result: 'FAIL', severity: 'medium' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-002', result: 'PASS', domain: 'VERS' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(95);
      expect(result.band).toBe('green');
    });

    it('should deduct 2 points for a low-severity failure', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-1', result: 'FAIL', severity: 'low' }),
        makeEval({ control_id: 'NC-2', result: 'PASS' }),
        makeEval({ control_id: 'NC-3', result: 'PASS' }),
        makeEval({ control_id: 'NC-4', result: 'PASS' }),
        makeEval({ control_id: 'NC-5', result: 'PASS' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(98);
    });

    it('should deduct 0 points for info-level failure', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-003', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-004', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-008', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-009', result: 'FAIL', severity: 'info' }),
        makeEval({ control_id: 'NC-AUTH-001', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-001', result: 'PASS', domain: 'VERS' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(100);
      expect(result.band).toBe('green');
    });

    it('should accumulate multiple deductions', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-003', result: 'FAIL', severity: 'high' }),     // -10
        makeEval({ control_id: 'NC-OC-004', result: 'FAIL', severity: 'critical' }), // -25
        makeEval({ control_id: 'NC-OC-008', result: 'FAIL', severity: 'medium' }),    // -5
        makeEval({ control_id: 'NC-AUTH-001', result: 'FAIL', severity: 'high' }),     // -10
        makeEval({ control_id: 'NC-VERS-001', result: 'PASS', domain: 'VERS' }),
        makeEval({ control_id: 'NC-VERS-002', result: 'PASS', domain: 'VERS' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(50); // 100 - 10 - 25 - 5 - 10
      expect(result.band).toBe('red');
    });

    it('should clamp score to minimum of 0', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-1', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-2', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-3', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-4', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-5', result: 'FAIL', severity: 'critical' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(0);
      expect(result.band).toBe('red');
    });
  });

  describe('band assignment', () => {
    it('should assign green band for score >= 90', () => {
      const evaluations = Array.from({ length: 5 }, (_, i) =>
        makeEval({ control_id: `NC-T-${String(i).padStart(3, '0')}`, result: 'PASS' })
      );
      const result = scorer.score(evaluations);
      expect(result.band).toBe('green');
    });

    it('should assign amber band for score >= 70 and < 90', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-1', result: 'FAIL', severity: 'high' }),   // -10
        makeEval({ control_id: 'NC-2', result: 'FAIL', severity: 'high' }),   // -10
        makeEval({ control_id: 'NC-3', result: 'PASS' }),
        makeEval({ control_id: 'NC-4', result: 'PASS' }),
        makeEval({ control_id: 'NC-5', result: 'PASS' }),
      ];

      const result = scorer.score(evaluations);
      expect(result.score).toBe(80);
      expect(result.band).toBe('amber');
    });

    it('should assign red band for score < 70', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-1', result: 'FAIL', severity: 'critical' }), // -25
        makeEval({ control_id: 'NC-2', result: 'FAIL', severity: 'high' }),     // -10
        makeEval({ control_id: 'NC-3', result: 'PASS' }),
        makeEval({ control_id: 'NC-4', result: 'PASS' }),
        makeEval({ control_id: 'NC-5', result: 'PASS' }),
      ];

      const result = scorer.score(evaluations);
      expect(result.score).toBe(65);
      expect(result.band).toBe('red');
    });
  });

  describe('insufficient_data handling', () => {
    it('should return insufficient_data when fewer than 5 controls are evaluable', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-1', result: 'PASS' }),
        makeEval({ control_id: 'NC-2', result: 'PASS' }),
        makeEval({ control_id: 'NC-3', result: 'SKIP' }),
        makeEval({ control_id: 'NC-4', result: 'ERROR' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe('insufficient_data');
      expect(result.band).toBe('insufficient_data');
    });

    it('should count PASS and FAIL as evaluable, not SKIP or ERROR', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-1', result: 'PASS' }),
        makeEval({ control_id: 'NC-2', result: 'FAIL', severity: 'high' }),
        makeEval({ control_id: 'NC-3', result: 'PASS' }),
        makeEval({ control_id: 'NC-4', result: 'SKIP' }),
        makeEval({ control_id: 'NC-5', result: 'SKIP' }),
      ];

      const result = scorer.score(evaluations);

      // Only 3 evaluable → insufficient_data
      expect(result.score).toBe('insufficient_data');
      expect(result.band).toBe('insufficient_data');
    });
  });

  describe('experimental controls', () => {
    it('should not include experimental controls in scoring', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-1', result: 'PASS' }),
        makeEval({ control_id: 'NC-2', result: 'PASS' }),
        makeEval({ control_id: 'NC-3', result: 'PASS' }),
        makeEval({ control_id: 'NC-4', result: 'PASS' }),
        makeEval({ control_id: 'NC-5', result: 'PASS' }),
        makeEval({ control_id: 'NC-EXP-1', result: 'FAIL', severity: 'critical', status: 'experimental' }),
      ];

      const result = scorer.score(evaluations);

      expect(result.score).toBe(100); // Experimental FAIL not deducted
      expect(result.band).toBe('green');
      expect(result.stable_pass).toBe(5);
      expect(result.stable_fail).toBe(0);
    });
  });

  describe('per-domain scoring', () => {
    it('should compute domain scores when enough controls exist', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-1', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-2', domain: 'OC', result: 'FAIL', severity: 'high' }),
        makeEval({ control_id: 'NC-OC-3', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-1', domain: 'VERS', result: 'PASS' }),
        makeEval({ control_id: 'NC-VERS-2', domain: 'VERS', result: 'PASS' }),
      ];

      const result = scorer.score(evaluations);

      const ocDomain = result.domains.find(d => d.domain === 'OC');
      expect(ocDomain).toBeDefined();
      expect(ocDomain!.score).toBe(90); // 100 - 10
      expect(ocDomain!.controls_evaluated).toBe(3);

      const versDomain = result.domains.find(d => d.domain === 'VERS');
      expect(versDomain).toBeDefined();
      expect(versDomain!.score).toBe(100);
    });

    it('should return insufficient_data for domains with < 2 evaluable controls', () => {
      const evaluations = [
        makeEval({ control_id: 'NC-OC-1', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-2', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-3', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-1', domain: 'AUTH', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-2', domain: 'AUTH', result: 'SKIP' }),
      ];

      const result = scorer.score(evaluations);

      const authDomain = result.domains.find(d => d.domain === 'AUTH');
      expect(authDomain).toBeDefined();
      expect(authDomain!.score).toBe('insufficient_data');
    });
  });
});
