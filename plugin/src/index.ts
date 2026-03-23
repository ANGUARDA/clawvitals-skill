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
import type { DeltaResult } from './types.js';
import { CRON_JOB_NAME, PLUGIN_VERSION } from './constants.js';
import { PluginTelemetryClient } from './telemetry.js';
import { evaluateAlert, resolveAlertConfig } from './alerts.js';
import type { ScanSnapshot } from './alerts.js';

export * from './plugin-config.js';
export * from './telemetry.js';
export * from './scheduler.js';
export * from './alerts.js';
export * from './alias.js';

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

  const stableFails = report.dock_analysis.stable.findings.filter(f => f.result === 'FAIL').length;
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
  const currentSnapshot: ScanSnapshot = {
    score:          typeof score === 'number' ? score : 'insufficient_data',
    band:           report.dock_analysis.stable.band,
    fail_count:     stableFails,
    critical_count: report.dock_analysis.stable.findings.filter(
      f => f.result === 'FAIL' && f.severity === 'critical'
    ).length,
    scan_ts: report.meta.scan_ts,
  };

  // Build previous snapshot from delta data if available
  const prevFindings = report.dock_analysis.delta?.resolved_findings ?? [];
  const hasPreviousRun = report.dock_analysis.delta !== undefined;
  const previousSnapshot: ScanSnapshot | null = hasPreviousRun
    ? {
        score:          'insufficient_data', // delta doesn't store prev score; alert logic uses fail_count
        band:           'unknown',
        fail_count:     stableFails - (report.dock_analysis.delta?.new_findings?.length ?? 0)
                        + prevFindings.length,
        critical_count: 0,
        scan_ts:        '',
      }
    : null;

  const alert = evaluateAlert(currentSnapshot, previousSnapshot, alertConfig);
  if (alert) {
    return alert.message + `\n\n📊 View dashboard: https://clawvitals.io/dashboard`;
  }

  // Silent — no regression, no new criticals. Return null (don't send a message).
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

const SCAN_PATTERNS = [
  'run clawvitals',
  'clawvitals scan',
  'check clawvitals',
  'clawvitals check',
];

const DETAIL_PATTERNS = [
  'show clawvitals details',
  'clawvitals full report',
  'clawvitals details',
];

function matchesIntent(prompt: string, patterns: string[]): boolean {
  const normalised = prompt.trim().toLowerCase();
  return patterns.some(p => normalised.startsWith(p));
}

// ── Manual scan runner ────────────────────────────────────────────────────

/**
 * Run a manual (user-triggered) scan.
 * Returns the full formatted output including the plugin header.
 */
async function runManualScan(workspaceDir: string, detailed: boolean): Promise<string> {
  const orchestrator = buildScanDependencies(workspaceDir);
  const report = await orchestrator.run({ isScheduled: false });

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

  const header = pluginHeader();
  const body = detailed
    ? formatDetail(report, delta)
    : formatSummary(report, delta, staleExclusions);
  const dashboardLine = `\n📊 View your dashboard: https://clawvitals.io/dashboard`;

  return `${header}\n\n${body}${dashboardLine}`;
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
            return textResult(
              "Your ClawVitals Pro trial has ended. You're now on the Free plan.\n" +
              `To restore fleet access and full history, say 'upgrade ClawVitals'.\n` +
              `Upgrade URL: ${trial.upgrade_url}`
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
            `✅ Webhook configured: ${data.webhook_url}\n\n` +
            `🔐 Webhook secret (shown once — saved to state.json):\n${data.webhook_secret}\n\n` +
            `Use the X-ClawVitals-Signature header to verify incoming webhooks.`
          );

        } catch (err) {
          return textResult(`❌ Error configuring webhook: ${(err as Error).message}`);
        }
      },
    }), { names: ['clawvitals_configure_webhook'] });

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
      const workspaceDir = ctx.workspaceDir ?? (api.config as { workspace?: { path?: string } })?.workspace?.path ?? os.homedir();

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
