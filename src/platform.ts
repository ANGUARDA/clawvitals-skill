/**
 * platform.ts — PlatformClient: no-op wrapper for Phase 1 (pre-platform).
 *
 * All platform API calls are wrapped here. In Phase 1, every call returns
 * { ok: false, error: 'platform_not_available' }. When Phase 3 ships the
 * platform, only this module needs updating.
 */

/** Result of a platform API call */
export interface PlatformResult {
  /** Whether the call succeeded */
  ok: boolean;
  /** Error message on failure */
  error?: string;
  /** Response data on success */
  data?: Record<string, unknown>;
}

/**
 * PlatformClient wraps all platform API interactions.
 * Phase 1: all methods are no-ops returning a clear "not available" response.
 */
export class PlatformClient {
  /**
   * Link an installation to an Anguarda account.
   * Phase 1: returns platform_not_available.
   */
  link(
    _orgToken: string,
    _installId: string,
    _hostName: string
  ): Promise<PlatformResult> {
    return Promise.resolve({ ok: false, error: 'platform_not_available' });
  }

  /**
   * Register an agent with the platform.
   * Phase 1: returns platform_not_available.
   */
  register(
    _orgToken: string,
    _installId: string
  ): Promise<PlatformResult> {
    return Promise.resolve({ ok: false, error: 'platform_not_available' });
  }
}
