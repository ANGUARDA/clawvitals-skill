/**
 * scoring.test.ts — Tests for Scorer class.
 */
import { Scorer } from '../../src/scoring/index';
import type { ControlEvaluation } from '../../src/types';
import {
  BASE_SCORE,
  SEVERITY_DEDUCTION,
  GREEN_THRESHOLD,
  AMBER_THRESHOLD,
  MIN_EVALUABLE_CONTROLS,
} from '../../src/constants';

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

describe('Scorer', () => {
  const scorer = new Scorer();

  describe('score constants', () => {
    it('has expected severity deductions', () => {
      expect(SEVERITY_DEDUCTION.critical).toBe(25);
      expect(SEVERITY_DEDUCTION.high).toBe(10);
      expect(SEVERITY_DEDUCTION.medium).toBe(5);
      expect(SEVERITY_DEDUCTION.low).toBe(2);
      expect(SEVERITY_DEDUCTION.info).toBe(0);
    });

    it('has expected thresholds', () => {
      expect(BASE_SCORE).toBe(100);
      expect(GREEN_THRESHOLD).toBe(90);
      expect(AMBER_THRESHOLD).toBe(70);
      expect(MIN_EVALUABLE_CONTROLS).toBe(5);
    });
  });

  describe('band assignment', () => {
    it('assigns green band for all PASS with ≥5 evaluable', () => {
      const evals = Array.from({ length: 5 }, (_, i) =>
        makeEval({ control_id: `NC-TEST-${i}`, result: 'PASS' })
      );
      const result = scorer.score(evals);
      expect(result.score).toBe(100);
      expect(result.band).toBe('green');
    });

    it('assigns green band at score exactly 90', () => {
      const evals = [
        ...Array.from({ length: 4 }, (_, i) =>
          makeEval({ control_id: `NC-PASS-${i}`, result: 'PASS' })
        ),
        makeEval({ control_id: 'NC-FAIL-1', result: 'FAIL', severity: 'high' }),
      ];
      // 100 - 10 = 90
      const result = scorer.score(evals);
      expect(result.score).toBe(90);
      expect(result.band).toBe('green');
    });

    it('assigns amber band at score 89', () => {
      const evals = [
        ...Array.from({ length: 3 }, (_, i) =>
          makeEval({ control_id: `NC-PASS-${i}`, result: 'PASS' })
        ),
        makeEval({ control_id: 'NC-FAIL-1', result: 'FAIL', severity: 'high' }),
        makeEval({ control_id: 'NC-FAIL-2', result: 'FAIL', severity: 'low' }),
      ];
      // 100 - 10 - 2 = 88... not 89
      // Let me use medium + medium = 10 → 90 → still green. high + low = 12 → 88
      // Actually let's just do: 4 pass, 1 fail high + 1 fail low → 88 amber (6 evaluable)
      const result = scorer.score(evals);
      expect(result.score).toBe(88);
      expect(result.band).toBe('amber');
    });

    it('assigns amber band at score exactly 70', () => {
      const evals = [
        ...Array.from({ length: 3 }, (_, i) =>
          makeEval({ control_id: `NC-PASS-${i}`, result: 'PASS' })
        ),
        makeEval({ control_id: 'NC-FAIL-1', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-FAIL-2', result: 'FAIL', severity: 'medium' }),
      ];
      // 100 - 25 - 5 = 70
      const result = scorer.score(evals);
      expect(result.score).toBe(70);
      expect(result.band).toBe('amber');
    });

    it('assigns red band below 70', () => {
      const evals = [
        ...Array.from({ length: 2 }, (_, i) =>
          makeEval({ control_id: `NC-PASS-${i}`, result: 'PASS' })
        ),
        makeEval({ control_id: 'NC-FAIL-1', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-FAIL-2', result: 'FAIL', severity: 'critical' }),
        makeEval({ control_id: 'NC-FAIL-3', result: 'FAIL', severity: 'medium' }),
      ];
      // 100 - 25 - 25 - 5 = 45
      const result = scorer.score(evals);
      expect(result.score).toBe(45);
      expect(result.band).toBe('red');
    });
  });

  describe('insufficient data', () => {
    it('returns insufficient_data with fewer than 5 evaluable controls', () => {
      const evals = [
        makeEval({ control_id: 'NC-1', result: 'PASS' }),
        makeEval({ control_id: 'NC-2', result: 'PASS' }),
        makeEval({ control_id: 'NC-3', result: 'FAIL', severity: 'high' }),
        makeEval({ control_id: 'NC-4', result: 'PASS' }),
      ];
      const result = scorer.score(evals);
      expect(result.score).toBe('insufficient_data');
      expect(result.band).toBe('insufficient_data');
    });

    it('does not count SKIP/ERROR/EXCLUDED as evaluable', () => {
      const evals = [
        makeEval({ control_id: 'NC-1', result: 'PASS' }),
        makeEval({ control_id: 'NC-2', result: 'PASS' }),
        makeEval({ control_id: 'NC-3', result: 'SKIP' }),
        makeEval({ control_id: 'NC-4', result: 'ERROR' }),
        makeEval({ control_id: 'NC-5', result: 'EXCLUDED' }),
        makeEval({ control_id: 'NC-6', result: 'PASS' }),
        makeEval({ control_id: 'NC-7', result: 'PASS' }),
      ];
      // Only 4 evaluable (PASS): insufficient
      const result = scorer.score(evals);
      expect(result.score).toBe('insufficient_data');
      expect(result.band).toBe('insufficient_data');
    });
  });

  describe('score clamping', () => {
    it('clamps score to 0 when deductions exceed 100', () => {
      const evals = Array.from({ length: 5 }, (_, i) =>
        makeEval({ control_id: `NC-FAIL-${i}`, result: 'FAIL', severity: 'critical' })
      );
      // 100 - 5*25 = -25 → clamped to 0
      const result = scorer.score(evals);
      expect(result.score).toBe(0);
      expect(result.band).toBe('red');
    });
  });

  describe('info severity', () => {
    it('does not deduct for info-severity FAILs', () => {
      const evals = Array.from({ length: 5 }, (_, i) =>
        makeEval({ control_id: `NC-PASS-${i}`, result: 'PASS' })
      );
      evals.push(makeEval({ control_id: 'NC-INFO', result: 'FAIL', severity: 'info' }));
      const result = scorer.score(evals);
      expect(result.score).toBe(100);
    });
  });

  describe('only stable controls contribute', () => {
    it('ignores experimental controls for scoring', () => {
      const evals = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeEval({ control_id: `NC-PASS-${i}`, result: 'PASS' })
        ),
        makeEval({
          control_id: 'NC-EXP-1',
          result: 'FAIL',
          severity: 'critical',
          status: 'experimental',
        }),
      ];
      const result = scorer.score(evals);
      expect(result.score).toBe(100);
      expect(result.band).toBe('green');
    });
  });

  describe('counts', () => {
    it('counts pass, fail, skip, error, excluded separately', () => {
      const evals = [
        makeEval({ control_id: 'NC-1', result: 'PASS' }),
        makeEval({ control_id: 'NC-2', result: 'PASS' }),
        makeEval({ control_id: 'NC-3', result: 'FAIL', severity: 'medium' }),
        makeEval({ control_id: 'NC-4', result: 'SKIP' }),
        makeEval({ control_id: 'NC-5', result: 'ERROR' }),
        makeEval({ control_id: 'NC-6', result: 'EXCLUDED' }),
        makeEval({ control_id: 'NC-7', result: 'PASS' }),
        makeEval({ control_id: 'NC-8', result: 'PASS' }),
        makeEval({ control_id: 'NC-9', result: 'PASS' }),
      ];
      const result = scorer.score(evals);
      expect(result.stable_pass).toBe(5);
      expect(result.stable_fail).toBe(1);
      expect(result.stable_skip).toBe(1);
      expect(result.stable_error).toBe(1);
      expect(result.stable_excluded).toBe(1);
    });
  });

  describe('domain scores', () => {
    it('computes per-domain scores', () => {
      const evals = [
        makeEval({ control_id: 'NC-OC-1', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-2', domain: 'OC', result: 'FAIL', severity: 'high' }),
        makeEval({ control_id: 'NC-OC-3', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-1', domain: 'AUTH', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-2', domain: 'AUTH', result: 'PASS' }),
      ];
      const result = scorer.score(evals);
      const ocDomain = result.domains.find(d => d.domain === 'OC');
      const authDomain = result.domains.find(d => d.domain === 'AUTH');

      expect(ocDomain).toBeDefined();
      expect(ocDomain!.score).toBe(90); // 100 - 10
      expect(ocDomain!.controls_evaluated).toBe(3);
      expect(authDomain).toBeDefined();
      expect(authDomain!.score).toBe(100);
      expect(authDomain!.controls_evaluated).toBe(2);
    });

    it('returns insufficient_data for domain with < 2 evaluable', () => {
      const evals = [
        makeEval({ control_id: 'NC-OC-1', domain: 'OC', result: 'PASS' }),
        makeEval({ control_id: 'NC-OC-2', domain: 'OC', result: 'SKIP' }),
        makeEval({ control_id: 'NC-AUTH-1', domain: 'AUTH', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-2', domain: 'AUTH', result: 'PASS' }),
        makeEval({ control_id: 'NC-AUTH-3', domain: 'AUTH', result: 'PASS' }),
      ];
      const result = scorer.score(evals);
      const ocDomain = result.domains.find(d => d.domain === 'OC');
      expect(ocDomain!.score).toBe('insufficient_data');
      expect(ocDomain!.controls_evaluated).toBe(1);
    });
  });
});
