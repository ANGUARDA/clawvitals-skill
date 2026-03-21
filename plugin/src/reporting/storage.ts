/**
 * reporting/storage.ts — StorageManager: run file persistence, last-success pointer, retention.
 *
 * Manages the filesystem layout for scan history:
 * - Each run stored in {workspace}/clawvitals/runs/{ISO-timestamp}/
 * - last-success.json pointer updated only on successful runs
 * - File permissions set to 600 for security
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunReport, RunMeta, LastSuccessPointer } from '../types';
import {
  WORKSPACE_DIR,
  RUNS_DIR,
  LAST_SUCCESS_FILE,
  SECURE_FILE_MODE,
} from '../constants';

/**
 * StorageManager handles reading and writing scan run data to the filesystem.
 *
 * Run directory layout:
 * - {workspace}/clawvitals/runs/{ISO-timestamp}/report.json
 * - {workspace}/clawvitals/runs/{ISO-timestamp}/report.txt
 * - {workspace}/clawvitals/last-success.json → points to last successful run
 */
export class StorageManager {
  private readonly baseDir: string;

  /**
   * @param workspaceDir - The OpenClaw workspace directory
   */
  constructor(workspaceDir: string) {
    this.baseDir = path.join(workspaceDir, WORKSPACE_DIR);
  }

  /** Get the absolute path to the runs directory */
  getRunsDir(): string {
    return path.join(this.baseDir, RUNS_DIR);
  }

  /**
   * Write a scan run to disk. Creates the run directory, writes report.json
   * and report.txt, and updates last-success.json if the run succeeded.
   *
   * @param report - The complete run report
   * @param detailText - Human-readable detail report text
   */
  writeRun(report: RunReport, detailText: string): void {
    const runDir = path.join(this.getRunsDir(), report.meta.scan_ts);
    fs.mkdirSync(runDir, { recursive: true });

    const reportPath = path.join(runDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: SECURE_FILE_MODE });

    const textPath = path.join(runDir, 'report.txt');
    fs.writeFileSync(textPath, detailText, { mode: SECURE_FILE_MODE });

    // Only update last-success pointer when all 3 primary sources succeeded
    if (report.meta.success) {
      const pointerPath = path.join(this.baseDir, LAST_SUCCESS_FILE);
      const pointer: LastSuccessPointer = { run_dir: report.meta.scan_ts };
      fs.writeFileSync(pointerPath, JSON.stringify(pointer, null, 2), { mode: SECURE_FILE_MODE });
    }
  }

  /**
   * Load the last successful run report.
   *
   * Returns null if: pointer file doesn't exist, is corrupted/unparseable,
   * run_dir field is missing, or the pointed-to run file is missing.
   * Never throws — callers treat null as "no prior run".
   */
  loadLastRun(): RunReport | null {
    try {
      const pointerPath = path.join(this.baseDir, LAST_SUCCESS_FILE);
      if (!fs.existsSync(pointerPath)) return null;

      const pointerContent = fs.readFileSync(pointerPath, 'utf-8');
      const pointer = JSON.parse(pointerContent) as Record<string, unknown>;

      if (typeof pointer.run_dir !== 'string' || !pointer.run_dir) return null;

      const reportPath = path.join(this.getRunsDir(), pointer.run_dir, 'report.json');
      if (!fs.existsSync(reportPath)) return null;

      const reportContent = fs.readFileSync(reportPath, 'utf-8');
      return JSON.parse(reportContent) as RunReport;
    } catch {
      return null;
    }
  }

  /**
   * List recent runs with metadata for the history command.
   *
   * @param limit - Maximum number of runs to return
   * @returns Array of run metadata sorted by timestamp (newest first)
   */
  listRuns(limit: number): RunMeta[] {
    const runsDir = this.getRunsDir();
    if (!fs.existsSync(runsDir)) return [];

    try {
      const entries = fs.readdirSync(runsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse()
        .slice(0, limit);

      const metas: RunMeta[] = [];
      for (const dirName of entries) {
        const reportPath = path.join(runsDir, dirName, 'report.json');
        try {
          const content = fs.readFileSync(reportPath, 'utf-8');
          const report = JSON.parse(content) as RunReport;
          metas.push({
            run_dir: dirName,
            scan_ts: report.meta.scan_ts,
            score: report.dock_analysis.stable.score,
            band: report.dock_analysis.stable.band,
            success: report.meta.success,
            is_scheduled: report.meta.is_scheduled,
          });
        } catch {
          // Skip corrupted run files
          metas.push({
            run_dir: dirName,
            scan_ts: dirName,
            score: null,
            band: null,
            success: false,
            is_scheduled: false,
          });
        }
      }

      return metas;
    } catch {
      return [];
    }
  }

  /**
   * Remove run directories older than the retention period.
   *
   * @param retentionDays - Number of days to retain runs
   */
  purgeOldRuns(retentionDays: number): void {
    const runsDir = this.getRunsDir();
    if (!fs.existsSync(runsDir)) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    try {
      const entries = fs.readdirSync(runsDir, { withFileTypes: true })
        .filter(e => e.isDirectory());

      for (const entry of entries) {
        try {
          const dirDate = new Date(entry.name);
          if (!isNaN(dirDate.getTime()) && dirDate < cutoff) {
            fs.rmSync(path.join(runsDir, entry.name), { recursive: true, force: true });
          }
        } catch {
          // Skip unparseable directory names
        }
      }
    } catch {
      // Non-fatal — retention cleanup is best-effort
    }
  }
}
