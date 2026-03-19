/**
 * orchestrator.ts — ScanOrchestrator: full scan pipeline.
 *
 * Encapsulates the complete 17-step scan pipeline previously in handleScan.
 * The intent router calls ScanOrchestrator.run() for both manual and
 * scheduled scans.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { CollectorOrchestrator } from './collectors';
import type { ControlEvaluator } from './controls/evaluator';
import type { Scorer } from './scoring';
import type { DeltaDetector } from './scoring/delta';
import type { ReportGenerator } from './reporting';
import type { StorageManager } from './reporting/storage';
import type { ConfigManager } from './config';
import type { TelemetryClient } from './telemetry';
import type { SchedulerManager } from './scheduling';
import type { RunReport, LockFile, ScoreBand } from './types';
import { loadControlLibrary } from './controls/library';
import {
  SKILL_VERSION,
  WORKSPACE_DIR,
  LOCK_FILE,
  LOCK_STALE_SECONDS,
  SECURE_FILE_MODE,
} from './constants';

/** Options for a scan run */
export interface ScanOptions {
  /** Whether this scan was triggered by cron */
  isScheduled: boolean;
}

/**
 * ScanOrchestrator runs the complete scan pipeline.
 * Independently testable — all dependencies are injected.
 */
export class ScanOrchestrator {
  constructor(
    private readonly collector: CollectorOrchestrator,
    private readonly evaluator: ControlEvaluator,
    private readonly scorer: Scorer,
    private readonly delta: DeltaDetector,
    private readonly reporter: ReportGenerator,
    private readonly storage: StorageManager,
    private readonly config: ConfigManager,
    private readonly telemetry: TelemetryClient,
    private readonly scheduler: SchedulerManager,
    private readonly workspaceDir: string
  ) {}

  /** Get the scheduler manager for external use (e.g., schedule prompts) */
  getScheduler(): SchedulerManager {
    return this.scheduler;
  }

  /**
   * Run the complete scan pipeline.
   *
   * Steps:
   * 1. Load config
   * 2. Acquire lock (with stale detection)
   * 3. Collect data from all sources
   * 4. Evaluate controls
   * 5. Score results
   * 6. Detect delta from previous run
   * 7. Assemble and store report
   * 8. Update usage state
   * 9. Send telemetry (fire and forget)
   * 10. Release lock
   *
   * @param options - Scan options (scheduled vs manual)
   * @returns The complete run report
   */
  async run(options: ScanOptions): Promise<RunReport> {
    const lockPath = this.getLockPath();

    // Acquire lock
    this.acquireLock(lockPath);

    try {
      const cvConfig = this.config.getConfig();

      // Collect data from all sources
      const collected = await this.collector.collect();

      // Load control library
      const library = loadControlLibrary();

      // Evaluate all controls
      const evaluations = this.evaluator.evaluate(collected);

      // Separate stable vs experimental
      const stableEvals = evaluations.filter(e => e.status === 'stable');
      const experimentalEvals = evaluations.filter(e => e.status === 'experimental');
      const excludedEvals = evaluations.filter(e => e.result === 'EXCLUDED');
      const skippedEvals = evaluations.filter(e => e.result === 'SKIP');

      // Score stable controls
      const scoreResult = this.scorer.score(evaluations);

      // Determine success: all 3 primary sources succeeded
      const success =
        collected.security_audit.ok &&
        collected.health.ok &&
        collected.update_status.ok;

      // Assemble run report
      const report: RunReport = {
        version: SKILL_VERSION,
        library_version: library.version,
        meta: {
          host_name: cvConfig.host_name,
          scan_ts: new Date().toISOString(),
          mode: '1',
          openclaw_version: collected.version_cmd.version,
          run_id: uuidv4(),
          is_scheduled: options.isScheduled,
          success,
        },
        sources: collected,
        native_findings: collected.security_audit.data?.findings ?? [],
        dock_analysis: {
          stable: {
            score: scoreResult.score,
            band: scoreResult.band,
            domains: scoreResult.domains,
            findings: stableEvals,
          },
          experimental: {
            findings: experimentalEvals,
          },
          excluded: excludedEvals,
          skipped: skippedEvals,
          delta: { new_findings: [], resolved_findings: [], new_checks: [] },
        },
      };

      // Load previous run and detect delta
      const previousRun = this.storage.loadLastRun();
      const deltaResult = this.delta.detect(report, previousRun);
      report.dock_analysis.delta = deltaResult;

      // Check for stale exclusions
      const staleExclusions = this.config.hasStaleExclusions();

      // Generate and store report
      this.reporter.generate(report, deltaResult, staleExclusions);

      // Update usage state
      const usage = this.config.getUsage();
      this.config.updateUsage({
        total_runs: usage.total_runs + 1,
        manual_runs: options.isScheduled ? usage.manual_runs : usage.manual_runs + 1,
        scheduled_runs: options.isScheduled ? usage.scheduled_runs + 1 : usage.scheduled_runs,
        last_run_at: report.meta.scan_ts,
        last_score_band: scoreResult.band as ScoreBand,
        last_stable_fail_count: scoreResult.stable_fail,
      });

      // Fire and forget telemetry
      void this.telemetry.ping(report, this.config.getUsage(), cvConfig);

      return report;
    } finally {
      // Always release lock
      this.releaseLock(lockPath);
    }
  }

  /** Get the lock file path */
  private getLockPath(): string {
    return path.join(this.workspaceDir, WORKSPACE_DIR, LOCK_FILE);
  }

  /**
   * Acquire the scan lock with stale detection.
   * Throws if another scan is actively running.
   */
  private acquireLock(lockPath: string): void {
    if (fs.existsSync(lockPath)) {
      try {
        const content = fs.readFileSync(lockPath, 'utf-8');
        const lock = JSON.parse(content) as LockFile;

        // Check if the lock holder is still alive
        let processAlive = false;
        if (process.platform !== 'win32') {
          try {
            process.kill(lock.pid, 0);
            processAlive = true;
          } catch {
            processAlive = false;
          }
        }

        // Check lock age
        const lockAge = (Date.now() - new Date(lock.started_at).getTime()) / 1000;
        const isStale = lockAge >= LOCK_STALE_SECONDS;

        if (processAlive && !isStale) {
          throw new Error('A scan is already in progress');
        }

        // Stale lock — remove and proceed
        fs.unlinkSync(lockPath);
      } catch (err) {
        if (err instanceof Error && err.message === 'A scan is already in progress') {
          throw err;
        }
        // Lock file corrupted — remove and proceed
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Ignore
        }
      }
    }

    // Write new lock
    const lockDir = path.dirname(lockPath);
    fs.mkdirSync(lockDir, { recursive: true });

    const lock: LockFile = {
      pid: process.pid,
      started_at: new Date().toISOString(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(lock), { mode: SECURE_FILE_MODE });
  }

  /** Release the scan lock */
  private releaseLock(lockPath: string): void {
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Non-fatal — lock cleanup is best-effort
    }
  }
}
