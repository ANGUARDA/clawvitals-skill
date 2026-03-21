/**
 * index.ts — Intent router for the ClawVitals OpenClaw skill.
 *
 * This is the skill entry point. It receives intent-routed messages from
 * OpenClaw and dispatches them to the appropriate handler. Each handler
 * is a thin wrapper that constructs dependencies and delegates to the
 * relevant module.
 */

import { CliRunner } from './cli-runner';
import { CollectorOrchestrator } from './collectors';
import { ControlEvaluator } from './controls/evaluator';
import { loadControlLibrary } from './controls/library';
import { Scorer } from './scoring';
import { DeltaDetector } from './scoring/delta';
import { ReportGenerator } from './reporting';
import { StorageManager } from './reporting/storage';
import { ConfigManager } from './config';
import { TelemetryClient } from './telemetry';
import { SchedulerManager } from './scheduling';
import { ScanOrchestrator } from './orchestrator';

import { formatDetail } from './reporting/detail';
import { formatSummary } from './reporting/summary';
import { SKILL_VERSION, LIBRARY_VERSION, ALERT_TOP_FINDINGS } from './constants';
import type { Severity } from './types';

/**
 * Build the full dependency tree for a scan.
 * Uses a consistent workspace directory for all operations.
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @returns Object containing orchestrator, config, storage, and scheduler instances
 */
function buildDependencies(workspaceDir: string): {
  orchestrator: ScanOrchestrator;
  config: ConfigManager;
  storage: StorageManager;
  scheduler: SchedulerManager;
} {
  const cli = new CliRunner('openclaw');
  const collector = new CollectorOrchestrator(cli);
  const config = new ConfigManager(workspaceDir);
  const exclusions = config.getExclusions();
  const library = loadControlLibrary();
  const evaluator = new ControlEvaluator(library, exclusions);
  const scorer = new Scorer();
  const delta = new DeltaDetector();
  const storage = new StorageManager(workspaceDir);
  const reporter = new ReportGenerator(storage);
  const telemetry = new TelemetryClient();
  const scheduler = new SchedulerManager(cli);

  const orchestrator = new ScanOrchestrator(
    collector, evaluator, scorer, delta, reporter,
    storage, config, telemetry, scheduler, workspaceDir
  );

  return { orchestrator, config, storage, scheduler };
}

/**
 * Handle a manual scan request.
 * Intent patterns: "run clawvitals", "clawvitals scan", "check clawvitals"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @returns Formatted summary message including score, band, delta, and optional first-run prompts
 */
export async function handleScan(workspaceDir: string): Promise<string> {
  const { orchestrator, config } = buildDependencies(workspaceDir);
  const isFirstRun = config.isFirstRun();

  let output = '';
  if (isFirstRun) {
    output += '\u{1F44B} Welcome to ClawVitals \u{2014} your OpenClaw security health check.\n\n';
    output += 'Running your first scan now...\n\n';
  }

  const report = await orchestrator.run({ isScheduled: false });

  // Use the delta already computed by the orchestrator (before the run was stored),
  // not a re-computation which would compare the report against itself.
  const staleExclusions = config.hasStaleExclusions();
  output += formatSummary(report, report.dock_analysis.delta, staleExclusions);

  if (isFirstRun) {
    output += '\n\n---\n';
    output += '\u{1F4C5} Set up recurring scans? Reply with one of:\n';
    output += '  \u{2022} "clawvitals schedule daily"\n';
    output += '  \u{2022} "clawvitals schedule weekly"\n';
    output += '  \u{2022} "clawvitals schedule monthly"\n';
    output += '  \u{2022} "clawvitals schedule off" (manual only)\n';
  }

  const usage = config.getUsage();
  if (usage.telemetry_prompt_state === 'not_shown') {
    output += '\n\n\u{1F4CA} Want to track your security posture over time?\n\n';
    output += 'Enable anonymous scan summaries to help improve ClawVitals. Dashboard coming soon at clawvitals.io/dashboard. ';
    output += 'No findings, file paths, or secrets are ever shared.\n\n';
    output += 'Reply "clawvitals telemetry on" to enable, or ignore to skip.';
  }

  return output;
}

/**
 * Handle a detail report request.
 * Intent patterns: "show clawvitals details", "clawvitals full report"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @returns Full detail report string, or a prompt to run a scan first if no data exists
 */
export function handleDetail(workspaceDir: string): string {
  const { config, storage } = buildDependencies(workspaceDir);
  const lastRun = storage.loadLastRun();

  if (!lastRun) {
    return 'No scan found \u{2014} run "run clawvitals" first.';
  }

  const delta = lastRun.dock_analysis.delta;

  config.updateUsage({
    detail_requests: config.getUsage().detail_requests + 1,
  });

  return formatDetail(lastRun, delta);
}

/**
 * Handle a history request.
 * Intent pattern: "clawvitals history"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @returns Formatted table of recent scan runs, or a prompt to run a scan first
 */
export function handleHistory(workspaceDir: string): string {
  const { storage } = buildDependencies(workspaceDir);
  const runs = storage.listRuns(10);

  if (runs.length === 0) {
    return 'No scan history found \u{2014} run "run clawvitals" first.';
  }

  const lines: string[] = ['\u{1F4CB} ClawVitals Scan History\n'];
  lines.push('Date                     | Score | Band   | Type');
  lines.push('-------------------------|-------|--------|----------');

  for (const run of runs) {
    const scoreStr = run.score !== null ? String(run.score).padStart(5) : '  N/A';
    const bandStr = (run.band ?? 'N/A').padEnd(6);
    const typeStr = run.is_scheduled ? 'scheduled' : 'manual';
    lines.push(`${run.scan_ts.padEnd(25)}| ${scoreStr} | ${bandStr} | ${typeStr}`);
  }

  return lines.join('\n');
}

/**
 * Handle a schedule configuration request.
 * Intent patterns: "clawvitals schedule daily/weekly/monthly/off"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @param message - The user's message containing the desired schedule cadence
 * @returns Confirmation message indicating the new schedule state
 */
export async function handleSchedule(
  workspaceDir: string,
  message: string
): Promise<string> {
  const { scheduler, config } = buildDependencies(workspaceDir);

  const cadenceMatch = /schedule\s+(daily|weekly|monthly|off)/i.exec(message);
  const rawCadence = cadenceMatch?.[1]?.toLowerCase() ?? 'weekly';

  const normalizedCadence = (rawCadence === 'off' ? 'none' : rawCadence) as 'daily' | 'weekly' | 'monthly' | 'none';
  await scheduler.ensureSchedule(normalizedCadence);

  if (normalizedCadence === 'none') {
    config.updateUsage({ schedule_enabled: false });
    return '\u{2705} Recurring scans disabled. Run "clawvitals scan" for manual scans.';
  }

  config.updateUsage({ schedule_enabled: true });
  return `\u{2705} Recurring ${rawCadence} scans enabled. You'll be alerted on new critical/high findings.`;
}

/**
 * Handle a scheduled scan (invoked by cron).
 * Only delivers an alert if there are new critical/high findings.
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @returns Alert message string if new critical/high findings exist, or null if no alert is needed
 */
export async function handleScheduledScan(workspaceDir: string): Promise<string | null> {
  const { orchestrator } = buildDependencies(workspaceDir);
  const report = await orchestrator.run({ isScheduled: true });

  // Only alert if new critical/high stable findings
  const newCritHigh = report.dock_analysis.delta.new_findings.filter(
    f => f.status === 'stable' && (f.severity === 'critical' || f.severity === 'high')
  );

  if (newCritHigh.length === 0) return null;

  // Format alert with top findings
  const topFindings = newCritHigh
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, ALERT_TOP_FINDINGS);

  let alert = `\u{1F6A8} ClawVitals Alert \u{2014} ${report.meta.host_name}\n`;
  alert += `New findings since last scan: ${newCritHigh.length}\n\n`;

  topFindings.forEach((f, i) => {
    alert += `${i + 1}. [${f.control_id}] ${f.control_name} \u{2014} ${f.severity.toUpperCase()}\n`;
    if (f.remediation) {
      alert += `   Fix: ${f.remediation}\n`;
    }
  });

  alert += '\nFull report: run "show clawvitals details"';

  return alert;
}

/**
 * Handle a telemetry toggle request.
 * Intent patterns: "clawvitals telemetry on/off"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @param message - The user's message containing "on" or "off"
 * @returns Confirmation message indicating the new telemetry state
 */
export function handleTelemetry(workspaceDir: string, message: string): string {
  const { config } = buildDependencies(workspaceDir);
  const enable = message.toLowerCase().includes('on');

  config.setConfig({ telemetry_enabled: enable });
  config.updateUsage({
    telemetry_prompt_state: enable ? 'accepted' : 'declined',
  });

  return enable
    ? '\u{2705} Telemetry enabled. Your anonymous scan summaries will help us improve ClawVitals.'
    : '\u{2705} Telemetry disabled.';
}

/**
 * Handle a config update request.
 * Intent pattern: "clawvitals config {key} {value}"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @param message - The user's message containing the config key and value
 * @returns Confirmation message, current config dump, or validation error
 */
export function handleConfig(workspaceDir: string, message: string): string {
  const { config } = buildDependencies(workspaceDir);

  const configMatch = /config\s+(\S+)\s+(.+)/i.exec(message);
  if (!configMatch?.[1] || !configMatch[2]) {
    const current = config.getConfig();
    return `Current configuration:\n${JSON.stringify(current, null, 2)}`;
  }

  const key = configMatch[1];
  const value = configMatch[2].trim();

  const allowedKeys = ['host_name', 'retention_days', 'alert_threshold'];
  if (!allowedKeys.includes(key)) {
    return `Unknown config key "${key}". Allowed keys: ${allowedKeys.join(', ')}`;
  }

  if (key === 'retention_days') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) {
      return 'retention_days must be a positive number.';
    }
    config.setConfig({ retention_days: num });
  } else if (key === 'alert_threshold') {
    const validThresholds: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
    if (!validThresholds.includes(value as Severity)) {
      return `alert_threshold must be one of: ${validThresholds.join(', ')}`;
    }
    config.setConfig({ alert_threshold: value as Severity });
  } else {
    config.setConfig({ [key]: value });
  }

  return `\u{2705} Configuration updated: ${key} = ${value}`;
}

/**
 * Handle a status request.
 * Intent pattern: "clawvitals status"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @returns Formatted status summary including host, version, score, and feature states
 */
export function handleStatus(workspaceDir: string): string {
  const { config } = buildDependencies(workspaceDir);
  const cvConfig = config.getConfig();
  const usage = config.getUsage();

  const lines: string[] = ['\u{1F3E5} ClawVitals Status\n'];
  lines.push(`Host: ${cvConfig.host_name}`);
  lines.push(`Skill version: ${SKILL_VERSION}`);
  lines.push(`Library version: ${LIBRARY_VERSION}`);
  lines.push(`Total scans: ${usage.total_runs}`);
  lines.push(`Last scan: ${usage.last_run_at ?? 'never'}`);
  lines.push(`Last score: ${usage.last_score_band ?? 'N/A'}`);
  lines.push(`Schedule: ${usage.schedule_enabled ? 'enabled' : 'disabled'}`);
  lines.push(`Telemetry: ${cvConfig.telemetry_enabled ? 'enabled' : 'disabled'}`);


  return lines.join('\n');
}

/**
 * Handle an exclusion management request.
 * Intent patterns: "clawvitals exclude NC-XXX-NNN ...", "clawvitals exclusions"
 *
 * @param workspaceDir - Absolute path to the OpenClaw workspace directory
 * @param message - The user's message containing the exclusion command or "exclusions" to list
 * @returns Exclusion list, confirmation of new exclusion, or usage instructions
 */
export function handleExclusions(workspaceDir: string, message: string): string {
  const { config } = buildDependencies(workspaceDir);

  // List exclusions
  if (/exclusions$/i.test(message.trim())) {
    const exclusions = config.getExclusions();
    if (exclusions.length === 0) {
      return 'No active exclusions.';
    }

    const lines = ['\u{1F4CB} Active Exclusions:\n'];
    for (const ex of exclusions) {
      const active = config.isExclusionActive(ex) ? '\u{2705}' : '\u{274C} expired';
      lines.push(`${active} ${ex.controlId}: ${ex.reason}`);
      if (ex.expires) {
        lines.push(`   Expires: ${ex.expires}`);
      }
    }
    return lines.join('\n');
  }

  // Add exclusion: "clawvitals exclude NC-XXX-NNN reason 'some reason'"
  const excludeMatch = /exclude\s+(NC-[A-Z]+-\d{3})\s+(?:for\s+\S+\s+)?(?:reason\s+)?['"]?(.+?)['"]?\s*$/i.exec(message);
  if (!excludeMatch?.[1]) {
    return 'Usage: clawvitals exclude NC-XXX-NNN reason "your reason"';
  }

  config.addExclusion({
    controlId: excludeMatch[1],
    reason: excludeMatch[2] ?? 'No reason provided',
    created_at: new Date().toISOString(),
  });

  return `\u{2705} Exclusion added for ${excludeMatch[1]}.`;
}

/**
 * Rank severity for sorting (lower = more severe).
 *
 * @param severity - The severity level to rank
 * @returns Numeric rank where 0 is most severe (critical) and 4 is least (info)
 */
function severityRank(severity: Severity): number {
  const ranks: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  return ranks[severity];
}
