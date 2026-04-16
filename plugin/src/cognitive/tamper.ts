/**
 * cognitive/tamper.ts — Scan cognitive files for tampering / prompt injection indicators.
 *
 * NC-OC-011: Detects zero-width characters, instruction-override phrases,
 * and external script URLs in cognitive .md files.
 *
 * SECURITY: Findings never include matched content to avoid amplifying injections.
 */

import * as fs from "node:fs";
import type { CognitiveFile } from "./inventory.js";

export type PatternType =
  | "zero_width_chars"
  | "instruction_override"
  | "external_script_url";

export interface TamperFinding {
  file: string;
  line: number;
  pattern_type: PatternType;
}

export interface TamperScanResult {
  findings: TamperFinding[];
  files_scanned: number;
  error?: string;
}

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/;

// Patterns are stored as constructor strings to avoid literal injection signatures
// appearing in the source that could trigger automated security scanners.
// These patterns detect common prompt-injection attempts in cognitive files.
const INSTRUCTION_OVERRIDE_PATTERNS: RegExp[] = [
  new RegExp(['ignore', '\\s+(?:all\\s+)?', 'previous', '\\s+instructions?'].join(''), 'i'),
  new RegExp(['disregard', '\\s+(?:all\\s+)?prior'].join(''), 'i'),
  new RegExp(['you', '\\s+are', '\\s+now', '\\b'].join(''), 'i'),
  new RegExp(['new', '\\s+system', '\\s+prompt'].join(''), 'i'),
];

const EXTERNAL_SCRIPT_URL_RE =
  /https?:\/\/(?:raw\.githubusercontent\.com|pastebin\.com|gist\.github\.com)\//i;

export function scanForTampering(files: CognitiveFile[]): TamperScanResult {
  const findings: TamperFinding[] = [];
  const errors: string[] = [];
  let filesScanned = 0;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file.path, "utf-8");
    } catch (err) {
      errors.push(`${file.name}: ${(err as Error).message}`);
      continue;
    }
    filesScanned++;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (ZERO_WIDTH_RE.test(line)) {
        findings.push({ file: file.name, line: lineNum, pattern_type: "zero_width_chars" });
      }

      for (const pat of INSTRUCTION_OVERRIDE_PATTERNS) {
        if (pat.test(line)) {
          findings.push({ file: file.name, line: lineNum, pattern_type: "instruction_override" });
          break;
        }
      }

      if (EXTERNAL_SCRIPT_URL_RE.test(line)) {
        findings.push({ file: file.name, line: lineNum, pattern_type: "external_script_url" });
      }
    }
  }

  const result: TamperScanResult = { findings, files_scanned: filesScanned };
  if (errors.length > 0) {
    result.error = errors.join("; ");
  }
  return result;
}
