/**
 * config/index.ts — ConfigManager: config.json, usage.json, exclusions.json.
 *
 * Manages all persistent state for ClawVitals. All files are written with
 * chmod 600 to protect sensitive data. Handles first-run initialization
 * and exclusion expiry checking.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  ClawVitalsConfig,
  UsageState,
  Exclusion,
} from '../types';
import {
  WORKSPACE_DIR,
  CONFIG_FILE,
  USAGE_FILE,
  EXCLUSIONS_FILE,
  SECURE_FILE_MODE,
  DEFAULT_CONFIG,
  SKILL_VERSION,
  EXCLUSION_STALE_DAYS,
} from '../constants';

/**
 * ConfigManager handles all persistent configuration and state files.
 *
 * File locations (relative to workspace):
 * - clawvitals/config.json — user configuration
 * - clawvitals/usage.json — usage statistics and state
 * - clawvitals/exclusions.json — control exclusions
 */
export class ConfigManager {
  private readonly baseDir: string;

  /**
   * @param workspaceDir - The OpenClaw workspace directory
   */
  constructor(workspaceDir: string) {
    this.baseDir = path.join(workspaceDir, WORKSPACE_DIR);
  }

  /**
   * Get the current configuration, initializing with defaults if needed.
   *
   * @returns The current ClawVitals configuration
   */
  getConfig(): ClawVitalsConfig {
    const configPath = path.join(this.baseDir, CONFIG_FILE);
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content) as Partial<ClawVitalsConfig>;
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      // Fall through to defaults on read/parse errors
    }

    // Initialize with defaults
    this.ensureDir();
    this.writeSecureJson(configPath, DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Update configuration with partial values.
   *
   * @param partial - Fields to update
   */
  setConfig(partial: Partial<ClawVitalsConfig>): void {
    const current = this.getConfig();
    const updated = { ...current, ...partial };
    this.ensureDir();
    this.writeSecureJson(path.join(this.baseDir, CONFIG_FILE), updated);
  }

  /**
   * Get the current usage state, initializing on first run.
   *
   * @returns The current usage state
   */
  getUsage(): UsageState {
    const usagePath = path.join(this.baseDir, USAGE_FILE);
    try {
      if (fs.existsSync(usagePath)) {
        const content = fs.readFileSync(usagePath, 'utf-8');
        return JSON.parse(content) as UsageState;
      }
    } catch {
      // Fall through to initialization on read/parse errors
    }

    // First run — initialize usage state
    const initial: UsageState = {
      install_id: uuidv4(),
      installed_at: new Date().toISOString(),
      dock_version: SKILL_VERSION,
      total_runs: 0,
      manual_runs: 0,
      scheduled_runs: 0,
      detail_requests: 0,
      last_run_at: null,
      last_score_band: null,
      last_stable_fail_count: null,
      schedule_enabled: false,
      telemetry_prompt_state: 'not_shown',
      elevated_tools_acknowledged: false,
    };

    this.ensureDir();
    this.writeSecureJson(usagePath, initial);
    return initial;
  }

  /**
   * Update usage state with partial values.
   *
   * @param partial - Fields to update
   */
  updateUsage(partial: Partial<UsageState>): void {
    const current = this.getUsage();
    const updated = { ...current, ...partial };
    this.ensureDir();
    this.writeSecureJson(path.join(this.baseDir, USAGE_FILE), updated);
  }

  /**
   * Get all exclusions from the exclusions file.
   *
   * @returns Array of exclusions (may be empty)
   */
  getExclusions(): Exclusion[] {
    const config = this.getConfig();
    const exclusionsPath = path.join(this.baseDir, config.exclusions_path || EXCLUSIONS_FILE);
    try {
      if (fs.existsSync(exclusionsPath)) {
        const content = fs.readFileSync(exclusionsPath, 'utf-8');
        return JSON.parse(content) as Exclusion[];
      }
    } catch {
      // Return empty on read/parse errors
    }
    return [];
  }

  /**
   * Add an exclusion to the exclusions file.
   *
   * @param exclusion - The exclusion to add
   */
  addExclusion(exclusion: Exclusion): void {
    const exclusions = this.getExclusions();
    exclusions.push(exclusion);
    const config = this.getConfig();
    const exclusionsPath = path.join(this.baseDir, config.exclusions_path || EXCLUSIONS_FILE);
    this.ensureDir();
    this.writeSecureJson(exclusionsPath, exclusions);
  }

  /**
   * Check if an exclusion is currently active (not expired).
   *
   * @param exclusion - The exclusion to check
   * @returns True if the exclusion is active
   */
  isExclusionActive(exclusion: Exclusion): boolean {
    if (exclusion.expires) {
      return new Date(exclusion.expires) > new Date();
    }
    return true;
  }

  /**
   * Check if any exclusions are stale (no expiry and older than 90 days).
   *
   * @returns True if any exclusions are stale
   */
  hasStaleExclusions(): boolean {
    const exclusions = this.getExclusions();
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - EXCLUSION_STALE_DAYS * 24 * 60 * 60 * 1000);

    return exclusions.some(ex => {
      if (ex.expires) return false;
      return new Date(ex.created_at) < staleCutoff;
    });
  }

  /**
   * Check if this is a first run (usage.json doesn't exist or last_run_at is null).
   *
   * @returns True if this is the first scan
   */
  isFirstRun(): boolean {
    const usagePath = path.join(this.baseDir, USAGE_FILE);
    try {
      if (!fs.existsSync(usagePath)) return true;
      const content = fs.readFileSync(usagePath, 'utf-8');
      const usage = JSON.parse(content) as UsageState;
      return usage.last_run_at === null;
    } catch {
      return true;
    }
  }

  /** Ensure the base directory exists */
  private ensureDir(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  /** Write JSON to a file with secure (600) permissions */
  private writeSecureJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: SECURE_FILE_MODE });
  }
}
