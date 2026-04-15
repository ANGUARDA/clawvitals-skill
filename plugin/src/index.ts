/**
 * index.ts — ClawVitals plugin entry point.
 *
 * This plugin extends ClawVitals (the skill) with:
 *   - Recurring scheduled scans (cron)
 *   - Posture history stored locally and synced to clawvitals.io/dashboard
 *   - Regression and critical finding alerts via OpenClaw messaging
 *   - Fleet management via user-set installation aliases
 *
 * PLUGIN PATTERN:
 *   External OpenClaw plugins export a plain object (or function) with a
 *   `register(api: OpenClawPluginApi)` method. Tools implement the AgentTool
 *   interface from @mariozechner/pi-agent-core:
 *     { name, label, description, parameters (TSchema), execute(toolCallId, params) }
 *
 * TELEMETRY DEFAULT:
 *   The skill (on ClawHub) is stateless — no telemetry, no network calls, locked.
 *   The plugin defaults telemetry to ON because it exists to power clawvitals.io/dashboard.
 *   Without telemetry, the dashboard has no data. Users can opt out at any time.
 *
 * ALIAS:
 *   Users/agents can set a human-readable alias (e.g. "prod-server-1") for
 *   fleet management on the dashboard. NEVER derived from machine identifiers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk/core';
import { validateAlias, formatInstallDisplay } from './alias.js';
import { validateCron, DEFAULT_CRON } from './scheduler.js';
import type { PluginConfig, PluginInstallState, TrialReminderPayload, TrialStatus } from './plugin-config.js';

// ── Scan pipeline imports (for cron-triggered scans) ──────────────────────
import { CliRunner } from './cli-runner.js';
import { CollectorOrchestrator } from './collectors/index.js';
import { ControlEvaluator } from './controls/evaluator.js';
import { loadControlLibrary } from './controls/library.js';
import { Scorer } from './scoring/index.js';
import { DeltaDetector } from './scoring/delta.js';
import { ReportGenerator } from './reporting/index.js';
import { StorageManager } from './reporting/storage.js';
import { ConfigManager } from './config/index.js';
import { TelemetryClient } from './telemetry/index.js';
import { SchedulerManager } from './scheduling/index.js';
import { ScanOrchestrator } from './orchestrator.js';
import { formatSummary } from './reporting/summary.js';
import { formatDetail } from './reporting/detail.js';
import type { DeltaResult, ExpandedEvaluation } from './types.js';
import { CRON_JOB_NAME, PLUGIN_VERSION } from './constants.js';
import { matchesIntent, SCAN_PATTERNS, DETAIL_PATTERNS, EXPANDED_SCAN_PATTERNS, STANDARD_SCAN_PATTERNS, parseMode } from './intents.js';
import { PluginTelemetryClient } from './telemetry.js';
import { evaluateAlert, resolveAlertConfig } from './alerts.js';
import type { ScanSnapshot } from './alerts.js';
import { scanCognitiveFiles } from './cognitive/inventory.js';
import { approveFile } from './cognitive/drift.js';
import { getLatestReport } from './cognitive/export.js';
import { scanForTampering } from './cognitive/tamper.js';
import { detectConfigDrift } from './cognitive/config-drift.js';

export * from './plugin-config.js';
export * from './telemetry.js';
export * from './scheduler.js';
export * from './alerts.js';
export * from './alias.js';

// ── Workspace resolution ───────────────────────────────────────────────────

/** Resolve the OpenClaw workspace root (where clawvitals/ sub-dir lives). */
function resolveWorkspaceDir(): string {
  return path.join(os.homedir(), '.openclaw', 'workspace');
}

// ── State file (persisted to plugin data dir) ──────────────────────────────

const PLUGIN_DIR = path.join(os.homedir(), '.openclaw', 'plugins', 'clawvitals');
const CONFIG_FILE = path.join(PLUGIN_DIR, 'config.json');
const STATE_FILE  = path.join(PLUGIN_DIR, 'state.json');

function ensureDir(): void {
  if (!fs.existsSync(PLUGIN_DIR)) {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadConfig(): PluginConfig {
  ensureDir();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw) as PluginConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: PluginConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function loadState(): PluginInstallState {
  ensureDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw) as PluginInstallState;
  } catch {
    // First run — generate install identity
    const state: PluginInstallState = {
      install_id: randomUUID(),
      installed_at: new Date().toISOString(),
      total_pings: 0,
      last_ping_at: null,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    return state;
  }
}

function saveState(state: PluginInstallState): void {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

// ── Scan pipeline factory ─────────────────────────────────────────────────

/**
 * Build the full scan dependency tree.
 * workspaceDir is the OpenClaw workspace directory (passed from plugin context).
 */
function buildScanDependencies(workspaceDir: string): ScanOrchestrator {
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
  return new ScanOrchestrator(
    collector, evaluator, scorer, delta, reporter,
    storage, config, telemetry, scheduler, workspaceDir
  );
}

/**
 * Run a scheduled scan, evaluate alerts, send plugin telemetry.
 * Returns a summary string to deliver to the user (or null for silent clean runs).
 */
async function runScheduledScan(workspaceDir: string): Promise<string | null> {
  const orchestrator = buildScanDependencies(workspaceDir);
  const report = await orchestrator.run({ isScheduled: true });

  // Build plugin telemetry ping
  const pluginConfig = loadConfig();
  const pluginState = loadState();
  const telemetryClient = new PluginTelemetryClient(pluginConfig, pluginState);

  // M5: Exclude info-severity FAILs from fail count (NC-OC-009 is INFO/not-scored)
  const stableFails = report.dock_analysis.stable.findings.filter(
    f => f.result === 'FAIL' && f.severity !== 'info'
  ).length;
  const stablePasses = report.dock_analysis.stable.findings.filter(f => f.result === 'PASS').length;
  const score = report.dock_analysis.stable.score;

  await telemetryClient.ping({
    version:         report.version,
    library_version: report.library_version,
    score:           typeof score === 'number' ? score : 'insufficient_data',
    band:            report.dock_analysis.stable.band,
    fail_count:      stableFails,
    pass_count:      stablePasses,
    is_scheduled:    true,
  });

  // Update plugin ping count in state
  pluginState.total_pings = (pluginState.total_pings ?? 0) + 1;
  pluginState.last_ping_at = new Date().toISOString();
  saveState(pluginState);

  // Evaluate alert: compare to previous run snapshot from delta
  const alertConfig = resolveAlertConfig(pluginConfig);
  // M5: stableFails already excludes info-severity FAILs (NC-OC-009 is INFO/not-scored)
  const currentSnapshot: ScanSnapshot = {
    score:          typeof score === 'number' ? score : 'insufficient_data',
    band:           report.dock_analysis.stable.band,
    fail_count:     stableFails,
    critical_count: report.dock_analysis.stable.findings.filter(
      f => f.result === 'FAIL' && f.severity === 'critical'
    ).length,
    scan_ts: report.meta.scan_ts,
  };

  // M2: Load previous snapshot directly from StorageManager for accurate fail counts
  // M5: Exclude info-severity FAILs from fail_count (NC-OC-009 is INFO/not-scored)
  const previousRun = new StorageManager(workspaceDir).loadLastRun();
  const previousSnapshot: ScanSnapshot | null = previousRun
    ? {
        score:          previousRun.dock_analysis.stable.score,
        band:           previousRun.dock_analysis.stable.band,
        fail_count:     previousRun.dock_analysis.stable.findings.filter(
          f => f.result === 'FAIL' && f.severity !== 'info'
        ).length,
        critical_count: previousRun.dock_analysis.stable.findings.filter(
          f => f.result === 'FAIL' && f.severity === 'critical'
        ).length,
        scan_ts:        previousRun.meta.scan_ts,
      }
    : null;

  // Cognitive tamper scan (NC-OC-011 experimental)
  const cogInventory = scanCognitiveFiles(workspaceDir);
  const tamperResult = scanForTampering(cogInventory.files);
  let tamperNote = '';
  if (tamperResult.findings.length === 0) {
    tamperNote = '\n\n✅ No suspicious patterns detected in cognitive files.';
  } else {
    const lines = tamperResult.findings.map(
      f => `⚠️ Suspicious pattern detected: ${f.pattern_type}. Review your cognitive files manually — do not share the content if it looks like an injection attempt.`
    );
    tamperNote = '\n\n' + lines.join('\n');
  }

  const alert = evaluateAlert(currentSnapshot, previousSnapshot, alertConfig);
  if (alert) {
    return alert.message + tamperNote + `\n\n📊 View dashboard: https://clawvitals.io/dashboard`;
  }

  // If no alert but tamper findings exist, still report them
  if (tamperResult.findings.length > 0) {
    return tamperNote.trim() + `\n\n📊 View dashboard: https://clawvitals.io/dashboard`;
  }

  // Silent — no regression, no new criticals, no tampering. Return null (don't send a message).
  return null;
}

// ── Plugin header ─────────────────────────────────────────────────────────

/** One-line header prepended to all plugin-driven scan output. */
function pluginHeader(): string {
  return `ClawVitals Plugin v${PLUGIN_VERSION} 🔌`;
}

// ── Intent matchers ───────────────────────────────────────────────────────
// Mirror the patterns from the ClawHub skill's skill.json intents so that
// the plugin intercepts them before the skill (or LLM) gets a chance.

// Re-export for convenience (consumers can import from either location)
export { matchesIntent, SCAN_PATTERNS, DETAIL_PATTERNS, EXPANDED_SCAN_PATTERNS, STANDARD_SCAN_PATTERNS, parseMode } from './intents.js';

// ── Manual scan runner ────────────────────────────────────────────────────

/**
 * Run a manual (user-triggered) scan.
 * Returns the full formatted output including the plugin header.
 */
async function runManualScan(workspaceDir: string, detailed: boolean, mode: 'standard' | 'expanded' = 'standard'): Promise<string> {
  const orchestrator = buildScanDependencies(workspaceDir);
  const report = await orchestrator.run({ isScheduled: false, mode });

  // Fire plugin telemetry
  const pluginConfig = loadConfig();
  const pluginState = loadState();
  const telemetryClient = new PluginTelemetryClient(pluginConfig, pluginState);

  const stableFails = report.dock_analysis.stable.findings.filter(f => f.result === 'FAIL').length;
  const stablePasses = report.dock_analysis.stable.findings.filter(f => f.result === 'PASS').length;

  await telemetryClient.ping({
    version:         report.version,
    library_version: report.library_version,
    score:           typeof report.dock_analysis.stable.score === 'number'
                       ? report.dock_analysis.stable.score
                       : 'insufficient_data',
    band:            report.dock_analysis.stable.band,
    fail_count:      stableFails,
    pass_count:      stablePasses,
    is_scheduled:    false,
  });

  // Update ping state
  pluginState.total_pings = (pluginState.total_pings ?? 0) + 1;
  pluginState.last_ping_at = new Date().toISOString();
  saveState(pluginState);

  const delta: DeltaResult = report.dock_analysis.delta ?? {
    new_findings: [], resolved_findings: [], new_checks: [],
  };
  const staleExclusions = false; // manual scans: no stale exclusion warning needed

  // Cognitive tamper scan (NC-OC-011 experimental)
  const cogInventory = scanCognitiveFiles(workspaceDir);
  const tamperResult = scanForTampering(cogInventory.files);
  let tamperNote = '';
  if (tamperResult.findings.length === 0) {
    tamperNote = '\n\n✅ No suspicious patterns detected in cognitive files.';
  } else {
    const lines = tamperResult.findings.map(
      f => `⚠️ Suspicious pattern detected: ${f.pattern_type}. Review your cognitive files manually — do not share the content if it looks like an injection attempt.`
    );
    tamperNote = '\n\n' + lines.join('\n');
  }

  // Configuration drift detection
  const storage = new StorageManager(workspaceDir);
  const previousRun = storage.loadLastRun();
  let driftNote = '';
  if (previousRun) {
    const driftResult = detectConfigDrift(report.sources, previousRun.sources);
    if (driftResult.has_drift) {
      const changeLines = driftResult.changes.map(c => {
        if (c.change_type === 'added') return `  • ${c.field}: appeared (was not present)`;
        if (c.change_type === 'removed') return `  • ${c.field}: removed (was ${JSON.stringify(c.previous)})`;
        return `  • ${c.field}: ${JSON.stringify(c.previous)} → ${JSON.stringify(c.current)}`;
      });
      driftNote = '\n\n🔧 Configuration changes since last scan:\n' + changeLines.join('\n');
    }
  }

  const header = pluginHeader();
  const body = detailed
    ? formatDetail(report, delta)
    : formatSummary(report, delta, staleExclusions);
  const dashboardLine = `\n📊 View your dashboard: https://clawvitals.io/dashboard`;

  // Format expanded controls section if present
  let expandedSection = '';
  if (report.dock_analysis.expanded) {
    const { findings, new_failures, new_passes } = report.dock_analysis.expanded;
    const skipped = findings.filter(f => f.result === 'SKIP').length;
    expandedSection = '\n\n━━━ EXPANDED CONTROLS ━━━━━━━━━━━━━━━━━━━━━';
    for (const f of findings) {
      const icon = f.result === 'PASS' ? '✅' : f.result === 'FAIL' ? '❌' : f.result === 'SKIP' ? '⏭️' : '⚠️';
      expandedSection += `\n${icon} ${f.control_id} ${f.name}: ${f.result}`;
      if (f.result === 'FAIL') {
        expandedSection += `\n   Evidence: ${f.evidence}`;
        expandedSection += `\n   Fix: ${f.remediation}`;
      }
    }
    expandedSection += `\nExpanded: ${new_failures} new findings · ${new_passes} passed · ${skipped} skipped`;
  }

  let output = `${header}\n\n${body}${expandedSection}${tamperNote}${driftNote}${dashboardLine}`;

  // Heartbeat suggestion on first scan
  if (pluginState.total_pings === 1) {
    const interval = 30;
    output += `\n\n💡 Tip: Add this to your HEARTBEAT.md for automatic checks every ${interval} minutes:\n- Run clawvitals and report any new issues since last check`;
  }

  return output;
}

function nextCronDescription(cron: string, enabled: boolean): string {
  if (!enabled) return 'N/A (disabled)';
  if (cron === DEFAULT_CRON) return 'daily at 9:00 AM';
  return `per schedule: \`${cron}\``;
}

// ── Agent API helpers ──────────────────────────────────────────────────────

const AGENT_API_BASE = 'https://clawvitals-agent-api.workers.dev';

function getAgentToken(): string | null {
  const state = loadState();
  // Agent session token stored in state (set by skill during link flow)
  return (state as PluginInstallState & { agent_session_token?: string }).agent_session_token ?? null;
}

async function agentGet(path: string): Promise<Response> {
  const token = getAgentToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${AGENT_API_BASE}${path}`, { method: 'GET', headers });
}

async function agentPost(path: string, body: Record<string, unknown> = {}): Promise<Response> {
  const token = getAgentToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${AGENT_API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ── Trial webhook handler (exported for skill use) ─────────────────────────

/**
 * Generate an agent nudge message from a trial reminder webhook payload.
 * Export for OpenClaw skill to call when it receives the webhook.
 */
export function handleTrialWebhook(payload: TrialReminderPayload): string {
  if (payload.type === 'trial_expired') {
    return (
      "Your ClawVitals Pro trial has ended. You're now on the Free plan — " +
      "I'll keep running scans on your primary instance. To restore fleet access " +
      "and full history, say 'upgrade ClawVitals' and I'll sort it."
    );
  }

  const featureList = payload.features_at_risk
    .map(f => {
      switch (f) {
        case 'fleet_view': return 'fleet view';
        case 'pdf_reports': return 'PDF reports';
        case '90_day_history': return '90-day history';
        default: return f;
      }
    })
    .join(', ');

  if (payload.days_remaining === 9) {
    return (
      `Quick heads up — your ClawVitals Pro trial has 9 days left. ` +
      `You've been using ${featureList}. ` +
      `If you'd like to keep those, I can set up your subscription now. ` +
      `Want me to handle it, or remind you closer to the deadline?`
    );
  }

  if (payload.days_remaining === 3) {
    return (
      `ClawVitals trial ends in 3 days. You currently have ${payload.instance_count} instance${payload.instance_count !== 1 ? 's' : ''} linked — ` +
      `on Free you'd keep 1. Want to upgrade? I can walk you through it now. ` +
      `It takes about 2 minutes.`
    );
  }

  if (payload.days_remaining === 1) {
    const scoreStr = payload.current_score !== null
      ? `${payload.current_score}/100 (${payload.current_band ?? 'unknown'})`
      : 'not yet available';
    return (
      `Last day of your ClawVitals trial. Your score is ${scoreStr}. ` +
      `To keep access to fleet view, extended history, and all ${payload.instance_count} instance${payload.instance_count !== 1 ? 's' : ''}, ` +
      `you'll need Pro at £12/mo. Want me to open the upgrade page, ` +
      `or would you prefer to move to Free?`
    );
  }

  // Fallback for any other days_remaining value
  return (
    `Your ClawVitals Pro trial has ${payload.days_remaining} days remaining. ` +
    `Say 'upgrade ClawVitals' to continue with ${featureList}.`
  );
}

// ── Tool helpers ───────────────────────────────────────────────────────────

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: null,
  };
}

// ── Tool definitions ───────────────────────────────────────────────────────

const SetAliasSchema = Type.Object({
  alias: Type.String({
    description: 'Display name for this installation, e.g. "prod-server-1". Max 64 chars.',
    minLength: 1,
    maxLength: 64,
  }),
});

const SetScheduleSchema = Type.Object({
  cron: Type.Optional(Type.String({
    description: '5-field cron expression, e.g. "0 9 * * *" for 9 AM daily.',
  })),
  enabled: Type.Optional(Type.Boolean({
    description: 'true to enable scheduled scans, false to disable.',
  })),
});

const TelemetrySchema = Type.Object({
  enabled: Type.Boolean({
    description: 'true to enable telemetry (default), false to opt out.',
  }),
});

// ── Plugin ─────────────────────────────────────────────────────────────────

const clawvitalsPlugin = {
  id: 'clawvitals',
  name: 'ClawVitals',
  description: 'Security posture tracking, recurring scans, delta alerts, and fleet dashboard.',
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // ── clawvitals_set_alias ─────────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_set_alias',
      label: 'ClawVitals: Set Alias',
      description:
        'Set a human-readable display name for this OpenClaw installation on the ' +
        'ClawVitals dashboard. Useful for fleet management so installs show as ' +
        '"prod-server-1" instead of a raw UUID. Max 64 chars.',
      parameters: SetAliasSchema,
      execute: async (_id: string, params: Static<typeof SetAliasSchema>) => {
        const result = validateAlias(params.alias);
        if (!result.valid) {
          return textResult(`❌ Invalid alias: ${result.error}`);
        }
        const config = loadConfig();
        config.telemetry = { ...config.telemetry, alias: result.normalized };
        saveConfig(config);
        const state = loadState();
        const display = formatInstallDisplay(state.install_id, result.normalized);
        return textResult(
          `✅ Alias set to "${result.normalized}".\n` +
          `Dashboard display: ${display}\n` +
          `It will appear on clawvitals.io/dashboard from your next scan.`
        );
      },
    }), { names: ['clawvitals_set_alias'] });

    // ── clawvitals_show_identity ─────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_show_identity',
      label: 'ClawVitals: Show Identity',
      description:
        'Show the ClawVitals install ID and alias for this installation. ' +
        'The install ID is a random UUID — no PII. Used for fleet management on the dashboard.',
      parameters: Type.Object({}),
      execute: async (_id: string, _params: Record<string, never>) => {
        const state = loadState();
        const config = loadConfig();
        const alias = config.telemetry?.alias;
        const display = formatInstallDisplay(state.install_id, alias);
        const aliasLine = alias
          ? `🏷️  Alias:       ${alias}`
          : `🏷️  Alias:       (not set — use clawvitals_set_alias)`;
        return textResult(
          `🆔 ClawVitals Identity\n\n` +
          `📍 Install ID:  ${state.install_id}\n` +
          `${aliasLine}\n` +
          `📊 Dashboard:   ${display}\n` +
          `📅 Installed:   ${state.installed_at}\n` +
          `🔢 Total pings: ${state.total_pings}`
        );
      },
    }), { names: ['clawvitals_show_identity'] });

    // ── clawvitals_telemetry ─────────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_telemetry',
      label: 'ClawVitals: Telemetry',
      description:
        'Enable or disable ClawVitals telemetry — anonymous posture data sent to ' +
        'clawvitals.io/dashboard. Enabled by default because it powers the dashboard. ' +
        'Disabling stops data appearing on the dashboard.',
      parameters: TelemetrySchema,
      execute: async (_id: string, params: Static<typeof TelemetrySchema>) => {
        const config = loadConfig();
        config.telemetry = { ...config.telemetry, enabled: params.enabled };
        saveConfig(config);
        const status = params.enabled ? 'enabled ✅' : 'disabled ❌';
        const note = params.enabled
          ? 'Scan summaries will be sent to clawvitals.io/dashboard from your next scan.'
          : 'No data will be sent to the dashboard. Local scan history is unaffected.';
        return textResult(`ClawVitals telemetry ${status}.\n${note}`);
      },
    }), { names: ['clawvitals_telemetry'] });

    // ── clawvitals_set_schedule ──────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_set_schedule',
      label: 'ClawVitals: Set Schedule',
      description:
        'Set the cron expression for recurring ClawVitals scans. ' +
        'Default is daily at 9 AM (0 9 * * *). Pass enabled=false to disable scheduling.',
      parameters: SetScheduleSchema,
      execute: async (_id: string, params: Static<typeof SetScheduleSchema>) => {
        if (params.cron === undefined && params.enabled === undefined) {
          return textResult('❌ Provide at least one of: cron (expression) or enabled (true/false).');
        }
        const config = loadConfig();
        const schedule = { ...config.schedule };
        if (params.enabled !== undefined) schedule.enabled = params.enabled;
        if (params.cron !== undefined) {
          const err = validateCron(params.cron);
          if (err) return textResult(`❌ Invalid cron expression: ${err}`);
          schedule.cron = params.cron;
        }
        config.schedule = schedule;
        saveConfig(config);

        const isEnabled = schedule.enabled !== false;
        const cron = schedule.cron ?? DEFAULT_CRON;

        // Register or remove the cron job via OpenClaw CLI
        try {
          const cli = new CliRunner('openclaw');
          const scheduler = new SchedulerManager(cli);
          if (isEnabled) {
            // ensureSchedule maps the cron expression to a named cadence for
            // the CLI. We pass the raw cron directly via the custom path.
            const exists = await scheduler.isScheduled();
            if (exists) {
              await cli.run(['cron', 'edit', '--name', CRON_JOB_NAME, '--cron', cron]);
            } else {
              await cli.run([
                'cron', 'add',
                '--name', CRON_JOB_NAME,
                '--cron', cron,
                '--handler', 'clawvitals:scheduled-scan',
              ]);
            }
          } else {
            await scheduler.removeSchedule();
          }
        } catch (err) {
          return textResult(
            `⚠️ Config saved but cron registration failed: ${(err as Error).message}\n` +
            `You can retry with: openclaw cron add --name ${CRON_JOB_NAME} --cron "${cron}" --handler clawvitals:scheduled-scan`
          );
        }

        return textResult(
          `✅ Schedule updated.\n` +
          `Status:   ${isEnabled ? 'enabled ✅' : 'disabled ❌'}\n` +
          `Cron:     ${cron}\n` +
          `Next run: ${nextCronDescription(cron, isEnabled)}`
        );
      },
    }), { names: ['clawvitals_set_schedule'] });

    // ── clawvitals_status ────────────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_status',
      label: 'ClawVitals: Status',
      description:
        'Show the current ClawVitals plugin status: schedule, telemetry, alias, and install identity.',
      parameters: Type.Object({}),
      execute: async (_id: string, _params: Record<string, never>) => {
        const config = loadConfig();
        const state = loadState();
        const telemetryEnabled = config.telemetry?.enabled !== false;
        const scheduleEnabled = config.schedule?.enabled !== false;
        const cron = config.schedule?.cron ?? DEFAULT_CRON;
        const alias = config.telemetry?.alias;
        return textResult(
          `📊 ClawVitals Plugin Status\n\n` +
          `🗓️  Schedule:    ${scheduleEnabled ? `enabled ✅  (${cron})` : 'disabled ❌'}\n` +
          `⏭️  Next run:    ${nextCronDescription(cron, scheduleEnabled)}\n` +
          `📡 Telemetry:   ${telemetryEnabled ? 'enabled ✅' : 'disabled ❌'}\n` +
          `🏷️  Alias:       ${alias ?? '(not set)'}\n` +
          `🆔 Install ID:  ${state.install_id}\n` +
          `🔢 Total pings: ${state.total_pings}`
        );
      },
    }), { names: ['clawvitals_status'] });

    // ── clawvitals_trial_status ──────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_trial_status',
      label: 'ClawVitals: Trial Status',
      description:
        'Check your ClawVitals Pro trial status — days remaining, features at risk, ' +
        'and how to upgrade. Returns a conversational summary.',
      parameters: Type.Object({}),
      execute: async (_id: string, _params: Record<string, never>) => {
        try {
          const response = await agentGet('/agent/status');
          if (!response.ok) {
            return textResult(
              '❌ Could not fetch trial status. Make sure ClawVitals is linked to your account.'
            );
          }

          const data = await response.json() as {
            trial?: TrialStatus | null;
          };

          const trial = data.trial;
          if (!trial) {
            return textResult(
              "ClawVitals isn't linked to an account yet. " +
              "Run 'clawvitals register' to get started."
            );
          }

          if (trial.plan === 'pro') {
            return textResult("✅ You're on ClawVitals Pro — full access active.");
          }

          if (trial.plan === 'free') {
            // M1: Validate upgrade_url starts with https://
            if (typeof trial.upgrade_url !== 'string' || !trial.upgrade_url.startsWith('https://')) {
              return textResult(
                "You're on the ClawVitals Free plan. You have 1 instance and 7-day history.\n" +
                `To upgrade to Pro (fleet view, PDF reports, 90-day history), say 'upgrade ClawVitals'.`
              );
            }
            return textResult(
              "You're on the ClawVitals Free plan. You have 1 instance and 7-day history.\n" +
              `To upgrade to Pro (fleet view, PDF reports, 90-day history), say 'upgrade ClawVitals'.\n` +
              `Upgrade URL: ${trial.upgrade_url}`
            );
          }

          // trial plan
          const daysLeft = trial.days_remaining ?? 0;
          const endsDate = trial.ends_at
            ? new Date(trial.ends_at).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })
            : 'soon';

          const featuresUsing = ['fleet view', 'PDF reports', '90-day history'];

          if (daysLeft <= 0) {
            // M1: Validate upgrade_url starts with https://
            const upgradeUrlExpired =
              typeof trial.upgrade_url === 'string' && trial.upgrade_url.startsWith('https://')
                ? `\nUpgrade URL: ${trial.upgrade_url}`
                : '';
            return textResult(
              "Your ClawVitals Pro trial has ended. You're now on the Free plan.\n" +
              `To restore fleet access and full history, say 'upgrade ClawVitals'.${upgradeUrlExpired}`
            );
          }

          return textResult(
            `⏳ Your ClawVitals Pro trial has ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left (ends ${endsDate}).\n` +
            `You're currently using: ${featuresUsing.join(', ')}.\n` +
            `To keep these after your trial, say 'upgrade ClawVitals'.`
          );

        } catch (err) {
          return textResult(`❌ Error fetching trial status: ${(err as Error).message}`);
        }
      },
    }), { names: ['clawvitals_trial_status'] });

    // ── clawvitals_upgrade ───────────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_upgrade',
      label: 'ClawVitals: Upgrade to Pro',
      description:
        'Initiate the ClawVitals Pro upgrade flow. Returns a Stripe checkout link. ' +
        'Use when the user says they want to upgrade or subscribe.',
      parameters: Type.Object({}),
      execute: async (_id: string, _params: Record<string, never>) => {
        try {
          const response = await agentPost('/agent/upgrade');
          if (!response.ok) {
            const err = await response.json() as { error?: string };
            return textResult(
              `❌ Could not initiate upgrade: ${err.error ?? response.statusText}. ` +
              `Make sure ClawVitals is linked to your account first.`
            );
          }

          const data = await response.json() as {
            ok: boolean;
            checkout_url: string;
            message: string;
          };

          // M1: Validate checkout_url starts with https://
          if (typeof data.checkout_url !== 'string' || !data.checkout_url.startsWith('https://')) {
            return textResult('❌ Upgrade failed: received an invalid checkout URL from the server.');
          }

          return textResult(
            `Here's your upgrade link: ${data.checkout_url}\n` +
            `Opens Stripe checkout — takes about 2 minutes.`
          );

        } catch (err) {
          return textResult(`❌ Error initiating upgrade: ${(err as Error).message}`);
        }
      },
    }), { names: ['clawvitals_upgrade'] });

    // ── clawvitals_configure_webhook ─────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_configure_webhook',
      label: 'ClawVitals: Configure Notification Webhook',
      description:
        'Set the webhook URL for ClawVitals to send trial reminders and alerts to your agent. ' +
        'The webhook secret is returned once and stored securely.',
      parameters: Type.Object({
        webhook_url: Type.String({
          description: 'The HTTPS URL to receive ClawVitals webhooks.',
        }),
      }),
      execute: async (_id: string, params: { webhook_url: string }) => {
        if (!params.webhook_url.startsWith('https://')) {
          return textResult('❌ Webhook URL must use https://');
        }

        try {
          const response = await agentPost('/agent/webhook/configure', {
            webhook_url: params.webhook_url,
          });

          if (!response.ok) {
            const err = await response.json() as { error?: string };
            return textResult(`❌ Could not configure webhook: ${err.error ?? response.statusText}`);
          }

          const data = await response.json() as {
            ok: boolean;
            webhook_url: string;
            webhook_secret: string;
          };

          // Store webhook secret securely in state (mode 0600)
          const state = loadState();
          state.webhook_secret = data.webhook_secret;
          saveState(state);

          return textResult(
            `✅ Webhook configured. Secret saved securely to state.json — retrieve it from ~/.openclaw/plugins/clawvitals/state.json if needed.`
          );

        } catch (err) {
          return textResult(`❌ Error configuring webhook: ${(err as Error).message}`);
        }
      },
    }), { names: ['clawvitals_configure_webhook'] });

    // ── clawvitals_exclude ───────────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_exclude',
      label: 'ClawVitals: Add Exclusion',
      description:
        'Suppress a specific ClawVitals control from being flagged. ' +
        'Use when a finding is intentional or not applicable to your setup. ' +
        'Exclusions are stored in exclusions.json and shown in scan reports. ' +
        'Optional: set an expiry date (ISO 8601) after which the exclusion is automatically lifted.',
      parameters: Type.Object({
        control_id: Type.String({
          description: 'Control ID to exclude, e.g. "NC-OC-005"',
          pattern: '^NC-[A-Z]+-\\d+$',
        }),
        reason: Type.String({
          description: 'Why this control is being excluded.',
          minLength: 5,
          maxLength: 200,
        }),
        expires: Type.Optional(Type.String({
          description: 'ISO 8601 expiry date, e.g. "2026-06-01". Omit for no expiry.',
        })),
      }),
      execute: async (_id: string, params: { control_id: string; reason: string; expires?: string }) => {
        const workspaceDir = resolveWorkspaceDir();
        const config = new ConfigManager(workspaceDir);
        const exclusion = {
          controlId: params.control_id.toUpperCase(),
          reason: params.reason,
          created_at: new Date().toISOString(),
          created_by: 'plugin',
          ...(params.expires ? { expires: params.expires } : {}),
        };
        config.addExclusion(exclusion);
        const expiryStr = params.expires
          ? `Expires: ${params.expires}`
          : 'No expiry (permanent until removed)';
        return textResult(
          `✅ Exclusion added for ${exclusion.controlId}.\n` +
          `Reason: ${exclusion.reason}\n` +
          `${expiryStr}\n\n` +
          `This control will show as EXCLUDED in future scans. ` +
          `Run 'clawvitals exclusions' to view all active exclusions.`
        );
      },
    }), { names: ['clawvitals_exclude'] });

    // ── clawvitals_exclusions ────────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_exclusions',
      label: 'ClawVitals: List Exclusions',
      description:
        'List all active ClawVitals exclusions. Shows control ID, reason, creation date, ' +
        'and expiry. Expired exclusions are shown separately.',
      parameters: Type.Object({}),
      execute: async (_id: string, _params: Record<string, never>) => {
        const workspaceDir = resolveWorkspaceDir();
        const config = new ConfigManager(workspaceDir);
        const all = config.getExclusions();
        if (all.length === 0) {
          return textResult('No exclusions configured. All controls are evaluated normally.');
        }
        const now = new Date();
        const active = all.filter(ex => !ex.expires || new Date(ex.expires) > now);
        const expired = all.filter(ex => ex.expires && new Date(ex.expires) <= now);
        const formatExclusion = (ex: { controlId: string; reason: string; created_at: string; expires?: string }) => {
          const expiry = ex.expires ? `expires ${ex.expires}` : 'permanent';
          return `• ${ex.controlId} — ${ex.reason} (${expiry}, added ${ex.created_at.slice(0, 10)})`;
        };
        let out = `📋 ClawVitals Exclusions\n\n`;
        out += `Active (${active.length}):\n${active.map(formatExclusion).join('\n') || '  none'}`;
        if (expired.length > 0) {
          out += `\n\nExpired (${expired.length}) — no longer suppressing:\n${expired.map(formatExclusion).join('\n')}`;
        }
        return textResult(out);
      },
    }), { names: ['clawvitals_exclusions'] });

    // ── clawvitals_approve_baseline ─────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_approve_baseline',
      label: 'ClawVitals: Approve Cognitive Baseline',
      description:
        'Approve a cognitive file (or all files) into the drift-detection baseline. ' +
        'Pass filename="all" to approve every file in the current inventory.',
      parameters: Type.Object({
        filename: Type.String({
          description: 'Name of the cognitive file to approve (e.g. "SOUL.md"), or "all" to approve everything.',
        }),
      }),
      execute: async (_id: string, params: { filename: string }) => {
        const workspaceDir = resolveWorkspaceDir();
        const inventory = scanCognitiveFiles(workspaceDir);

        if (inventory.error) {
          return textResult(`❌ Could not scan workspace: ${inventory.error}`);
        }

        if (inventory.files.length === 0) {
          return textResult('No cognitive files found in workspace. Nothing to approve.');
        }

        if (params.filename === 'all') {
          // M7: Provide clear confirmation listing ALL approved files for auditability
          for (const file of inventory.files) {
            approveFile(workspaceDir, file.name, inventory, 'plugin');
          }
          const fileList = inventory.files.map(f => `  • ${f.name} (sha256: ${f.sha256.slice(0, 12)}…)`).join('\n');
          return textResult(
            `✅ ALL ${inventory.files.length} cognitive file(s) approved into baseline:\n` +
            fileList + '\n\n' +
            `⚠️ Note: Approving all files marks them as trusted. ` +
            `Future changes to any of these files will trigger drift alerts.`
          );
        }

        const match = inventory.files.find(f => f.name === params.filename);
        if (!match) {
          return textResult(
            `❌ File "${params.filename}" not found in inventory. Available files:\n` +
            inventory.files.map(f => `  • ${f.name}`).join('\n')
          );
        }

        approveFile(workspaceDir, params.filename, inventory, 'plugin');
        return textResult(`✅ Approved "${params.filename}" (sha256: ${match.sha256.slice(0, 12)}…) into baseline.`);
      },
    }), { names: ['clawvitals_approve_baseline'] });

    // ── clawvitals_export ────────────────────────────────────────────────
    api.registerTool(() => ({
      name: 'clawvitals_export',
      label: 'ClawVitals: Export Scan Report',
      description:
        'Export the most recent ClawVitals scan report. Returns the report content ' +
        'in markdown format (default) or the directory path.',
      parameters: Type.Object({
        format: Type.Optional(Type.Union([
          Type.Literal('markdown'),
          Type.Literal('path'),
        ], {
          description: 'Output format: "markdown" (default) returns report content, "path" returns directory path.',
        })),
      }),
      execute: async (_id: string, params: { format?: 'markdown' | 'path' }) => {
        const workspaceDir = resolveWorkspaceDir();
        const format = params.format ?? 'markdown';
        const result = getLatestReport(workspaceDir, format);

        if (!result.found) {
          return textResult(result.message ?? 'No scan history yet. Run clawvitals first.');
        }

        if (format === 'path') {
          return textResult(`📁 Latest scan directory: ${result.path}`);
        }

        return textResult(result.content ?? '');
      },
    }), { names: ['clawvitals_export'] });

    // ── Scan intent + cron hook ───────────────────────────────────────────
    //
    // This hook intercepts two distinct trigger types:
    //
    // 1. User-triggered scan intents ("run clawvitals", "show clawvitals details")
    //    — matches the same patterns as the ClawHub skill's intents, runs the
    //    full programmatic pipeline instead, and short-circuits the LLM.
    //    This ensures the plugin always wins when both skill and plugin are installed.
    //
    // 2. Cron triggers (trigger="cron", CRON_JOB_NAME in prompt)
    //    — scheduled scan, silent unless regression/critical found.
    api.on('before_agent_start', async (_event, ctx) => {
      const prompt = _event.prompt ?? '';
      const workspaceDir = ctx.workspaceDir ?? resolveWorkspaceDir();

      // ── Cron: scheduled scan ───────────────────────────────────────────
      if (ctx.trigger === 'cron' && prompt.includes(CRON_JOB_NAME)) {
        try {
          const alertMessage = await runScheduledScan(workspaceDir);
          if (alertMessage) {
            return { prependContext: alertMessage };
          }
          return { prependContext: '✅ ClawVitals scheduled scan complete — no new issues.' };
        } catch (err) {
          return {
            prependContext:
              `⚠️ ClawVitals scheduled scan failed: ${(err as Error).message ?? 'unknown error'}`,
          };
        }
      }

      // ── User: detail report request ────────────────────────────────────
      if (matchesIntent(prompt, DETAIL_PATTERNS)) {
        try {
          const output = await runManualScan(workspaceDir, /* detailed */ true);
          return { prependContext: output };
        } catch (err) {
          return {
            prependContext:
              `${pluginHeader()}\n\n⚠️ Scan failed: ${(err as Error).message ?? 'unknown error'}`,
          };
        }
      }

      // ── User: expanded scan ─────────────────────────────────────────────
      if (matchesIntent(prompt, EXPANDED_SCAN_PATTERNS)) {
        try {
          const output = await runManualScan(workspaceDir, /* detailed */ false, 'expanded');
          return { prependContext: output };
        } catch (err) {
          return {
            prependContext:
              `${pluginHeader()}\n\n⚠️ Expanded scan failed: ${(err as Error).message ?? 'unknown error'}`,
          };
        }
      }

      // ── User: explicit standard scan ────────────────────────────────────
      if (matchesIntent(prompt, STANDARD_SCAN_PATTERNS)) {
        try {
          const output = await runManualScan(workspaceDir, /* detailed */ false, 'standard');
          return { prependContext: output };
        } catch (err) {
          return {
            prependContext:
              `${pluginHeader()}\n\n⚠️ Scan failed: ${(err as Error).message ?? 'unknown error'}`,
          };
        }
      }

      // ── User: standard scan ────────────────────────────────────────────
      if (matchesIntent(prompt, SCAN_PATTERNS)) {
        try {
          const output = await runManualScan(workspaceDir, /* detailed */ false);
          return { prependContext: output };
        } catch (err) {
          return {
            prependContext:
              `${pluginHeader()}\n\n⚠️ Scan failed: ${(err as Error).message ?? 'unknown error'}`,
          };
        }
      }
    });
  },
};

export default clawvitalsPlugin;
