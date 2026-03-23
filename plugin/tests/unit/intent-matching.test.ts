/**
 * intent-matching.test.ts — Tests for user command intent detection.
 *
 * These tests verify that the plugin correctly identifies scan commands
 * and intercepts them before the LLM/skill can handle them.
 */
import { matchesIntent, SCAN_PATTERNS, DETAIL_PATTERNS } from '../../src/intents';

describe('matchesIntent', () => {
  describe('scan patterns', () => {
    it('matches "run clawvitals"', () => {
      expect(matchesIntent('run clawvitals', SCAN_PATTERNS)).toBe(true);
    });

    it('matches "clawvitals scan"', () => {
      expect(matchesIntent('clawvitals scan', SCAN_PATTERNS)).toBe(true);
    });

    it('matches "check clawvitals"', () => {
      expect(matchesIntent('check clawvitals', SCAN_PATTERNS)).toBe(true);
    });

    it('matches "clawvitals check"', () => {
      expect(matchesIntent('clawvitals check', SCAN_PATTERNS)).toBe(true);
    });

    it('matches with leading/trailing whitespace', () => {
      expect(matchesIntent('  run clawvitals  ', SCAN_PATTERNS)).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(matchesIntent('Run ClawVitals', SCAN_PATTERNS)).toBe(true);
      expect(matchesIntent('RUN CLAWVITALS', SCAN_PATTERNS)).toBe(true);
    });

    it('matches when followed by additional text', () => {
      expect(matchesIntent('run clawvitals please', SCAN_PATTERNS)).toBe(true);
    });
  });

  describe('detail patterns', () => {
    it('matches "show clawvitals details"', () => {
      expect(matchesIntent('show clawvitals details', DETAIL_PATTERNS)).toBe(true);
    });

    it('matches "clawvitals full report"', () => {
      expect(matchesIntent('clawvitals full report', DETAIL_PATTERNS)).toBe(true);
    });

    it('matches "clawvitals details"', () => {
      expect(matchesIntent('clawvitals details', DETAIL_PATTERNS)).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(matchesIntent('SHOW CLAWVITALS DETAILS', DETAIL_PATTERNS)).toBe(true);
    });
  });

  describe('non-matching inputs', () => {
    it('does not match unrelated commands', () => {
      expect(matchesIntent('run some other scan', SCAN_PATTERNS)).toBe(false);
      expect(matchesIntent('what is my score', SCAN_PATTERNS)).toBe(false);
    });

    it('does not match scan pattern against detail patterns', () => {
      expect(matchesIntent('run clawvitals', DETAIL_PATTERNS)).toBe(false);
    });

    it('does not match detail pattern against scan patterns', () => {
      expect(matchesIntent('show clawvitals details', SCAN_PATTERNS)).toBe(false);
    });

    it('does not match empty string', () => {
      expect(matchesIntent('', SCAN_PATTERNS)).toBe(false);
    });

    it('does not match partial word (clawvital without s)', () => {
      expect(matchesIntent('run clawvital', SCAN_PATTERNS)).toBe(false);
    });
  });

  describe('SCAN_PATTERNS and DETAIL_PATTERNS are non-overlapping', () => {
    it('no scan pattern matches detail patterns', () => {
      for (const pattern of SCAN_PATTERNS) {
        expect(matchesIntent(pattern, DETAIL_PATTERNS)).toBe(false);
      }
    });

    it('no detail pattern matches scan patterns', () => {
      for (const pattern of DETAIL_PATTERNS) {
        expect(matchesIntent(pattern, SCAN_PATTERNS)).toBe(false);
      }
    });
  });
});
