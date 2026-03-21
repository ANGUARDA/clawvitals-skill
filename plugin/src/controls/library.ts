/**
 * controls/library.ts — Control library loader with version validation.
 *
 * Loads the bundled control library JSON and validates its version
 * against the skill's expected version range. The library is the
 * authoritative source of control definitions, severities, and metadata.
 */

import { z } from 'zod';
import type { ControlLibrary } from '../types';
import libraryJson from './library.v1.0.json';

/** Zod schema for validating the control library structure */
const ControlSchema = z.object({
  id: z.string().regex(/^NC-[A-Z]+-\d{3}$/),
  name: z.string().max(80),
  domain: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  mode: z.number().int().min(1).max(3),
  status: z.enum(['stable', 'experimental', 'deprecated', 'deferred']),
  introduced_in: z.string(),
  description: z.string(),
  why_it_matters: z.string(),
  check: z.object({
    source: z.string(),
    source_type: z.enum(['authoritative', 'contextual', 'derived']),
    prerequisite: z.string().optional(),
    prerequisite_skip_reason: z.string().optional(),
    condition: z.string(),
  }),
  evidence_template: z.string(),
  remediation: z.string(),
  references: z.array(z.string()).min(1),
  false_positive_notes: z.string(),
});

const ControlLibrarySchema = z.object({
  version: z.string(),
  generated: z.string(),
  controls: z.array(ControlSchema),
});

/**
 * Load and validate the bundled control library.
 *
 * @returns The validated control library
 * @throws Error if the library fails schema validation
 */
export function loadControlLibrary(): ControlLibrary {
  const validated = ControlLibrarySchema.parse(libraryJson);
  return validated;
}

/**
 * Check if a library version is within an acceptable range.
 * Simple SemVer check: major must match, minor must be >= minimum.
 *
 * @param version - The library version to check
 * @param expectedMajor - Expected major version
 * @param expectedMinor - Minimum minor version
 * @returns True if the version is compatible
 */
export function isVersionCompatible(
  version: string,
  expectedMajor: number,
  expectedMinor: number
): boolean {
  const parts = version.split('.');
  const major = parseInt(parts[0] ?? '0', 10);
  const minor = parseInt(parts[1] ?? '0', 10);
  return major === expectedMajor && minor >= expectedMinor;
}
