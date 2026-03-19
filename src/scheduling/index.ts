/**
 * scheduling/index.ts — SchedulerManager: cron list/add/edit wrappers.
 *
 * Manages the ClawVitals recurring scan schedule by wrapping the
 * `openclaw cron` CLI commands. Supports daily, weekly, monthly cadences.
 */

import type { CliRunner } from '../cli-runner';
import { CRON_JOB_NAME, CRON_EXPRESSIONS } from '../constants';

/**
 * SchedulerManager wraps OpenClaw cron operations for managing recurring scans.
 */
export class SchedulerManager {
  constructor(private readonly cli: CliRunner) {}

  /**
   * Ensure a recurring scan schedule exists with the specified cadence.
   * Creates a new cron job if none exists, or edits the existing one.
   *
   * @param cadence - The schedule cadence: 'daily', 'weekly', 'monthly', or 'none'
   */
  async ensureSchedule(cadence: 'daily' | 'weekly' | 'monthly' | 'none'): Promise<void> {
    if (cadence === 'none') {
      await this.removeSchedule();
      return;
    }

    const cronExpr = CRON_EXPRESSIONS[cadence];
    if (!cronExpr) {
      throw new Error(`Unknown schedule cadence: ${cadence}`);
    }

    const exists = await this.isScheduled();

    if (exists) {
      await this.cli.run([
        'cron', 'edit',
        '--name', CRON_JOB_NAME,
        '--cron', cronExpr,
      ]);
    } else {
      await this.cli.run([
        'cron', 'add',
        '--name', CRON_JOB_NAME,
        '--cron', cronExpr,
        '--handler', 'clawvitals:handleScheduledScan',
      ]);
    }
  }

  /**
   * Remove the recurring scan schedule if it exists.
   */
  async removeSchedule(): Promise<void> {
    const exists = await this.isScheduled();
    if (exists) {
      await this.cli.run(['cron', 'remove', '--name', CRON_JOB_NAME]);
    }
  }

  /**
   * Check if a recurring scan schedule currently exists.
   *
   * @returns True if the clawvitals cron job is registered
   */
  async isScheduled(): Promise<boolean> {
    try {
      const result = await this.cli.run(['cron', 'list']);
      return result.stdout.includes(CRON_JOB_NAME);
    } catch {
      return false;
    }
  }
}
