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
import { withFileLock } from '@openclaw/plugin-sdk';
import type { CollectorOrchestrator } from './collectors';
import type { ControlEvaluator } from './controls/evaluator';
import type { Scorer } from './scoring';
import type { DeltaDetector } from './scoring/delta';
import type { ReportGenerator } from './reporting';
import type { StorageManager } from './reporting/storage';
import type { ConfigManager } from './config';
import type { TelemetryClient } from './telemetry';
import type { SchedulerManager } from './scheduling';
import type { PlatformClient } from './platform';
import type { RunReport } from './types';
import { loadControlLibrary } from './controls/library';
import {
  SKILL_VERSION,
  WORKSPACE_DIR,
  LOCK_FILE,
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
    private readonly platform: PlatformClient,
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

    // Ensure the lock directory exists
    const lockDir = path.dirname(lockPath);
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }

    // Use the OpenClaw SDK file lock — no process.kill or child_process needed.
    // stale: 120_000 ms matches LOCK_STALE_SECONDS (120s) from constants.
    return withFileLock(
      lockPath,
      {
        retries: { retries: 0, factor: 1, minTimeout: 0, maxTimeout: 0 },
        stale: 120_000,
      },
      async () => {
        const cvConfig = this.config.getConfig();

        // Retry pending org token link if set (spec 6.7)
        await this.retryPendingOrgToken(cvConfig);

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
          last_score_band: scoreResult.band,
          last_stable_fail_count: scoreResult.stable_fail,
        });

        // Purge old runs based on retention policy
        this.storage.purgeOldRuns(cvConfig.retention_days);

        // Fire and forget telemetry
        void this.telemetry.ping(report, this.config.getUsage(), cvConfig);

        return report;
      }
    );
  }

  /**
   * Retry linking a pending org token if one is saved from a previous failed attempt.
   * On success, clears the pending token and sets the active org_token.
   * On failure, logs and continues — the skill still works offline.
   */
  private async retryPendingOrgToken(
    cvConfig: { pending_org_token: string | null; host_name: string }
  ): Promise<void> {
    if (!cvConfig.pending_org_token) return;
    try {
      const usage = this.config.getUsage();
      const result = await this.platform.link(
        cvConfig.pending_org_token,
        usage.install_id,
        cvConfig.host_name
      );
      if (result.ok) {
        this.config.setConfig({
          org_token: cvConfig.pending_org_token,
          pending_org_token: null,
        });
      }
      // On failure: leave pending_org_token for next retry
    } catch {
      // Non-fatal — skill continues without platform link
    }
  }

  /** Get the lock file path */
  private getLockPath(): string {
    return path.join(this.workspaceDir, WORKSPACE_DIR, LOCK_FILE);
  }
}
