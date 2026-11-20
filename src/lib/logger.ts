/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function normalizeLogLevel(raw: unknown): LogLevel | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'debug' || cleaned === 'info' || cleaned === 'warn' || cleaned === 'error' || cleaned === 'silent') {
    return cleaned;
  }
  return null;
}

export function getLogLevel(): LogLevel {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) {
      const parsed = normalizeLogLevel(process.env.LOG_LEVEL);
      if (parsed) return parsed;
    }
  } catch {
    // Ignore in restricted browser environments
  }

  try {
    const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: Record<string, unknown> }).env : undefined;
    if (metaEnv) {
      const parsed = normalizeLogLevel(metaEnv.LOG_LEVEL ?? metaEnv.VITE_LOG_LEVEL);
      if (parsed) return parsed;
    }
  } catch {
    // Ignore
  }

  try {
    const g = globalThis as unknown as { LOG_LEVEL?: unknown };
    const parsed = normalizeLogLevel(g?.LOG_LEVEL);
    if (parsed) return parsed;
  } catch {
    // Ignore
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const parsed = normalizeLogLevel(
        localStorage.getItem('LOG_LEVEL') ?? localStorage.getItem('juwei_wms_log_level')
      );
      if (parsed) return parsed;
    }
  } catch {
    // Ignore
  }

  return 'info';
}

function shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
  const current = getLogLevel();
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[current];
}

export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.debug(...args);
    }
  },
  info(...args: unknown[]): void {
    if (shouldLog('info')) {
      console.info(...args);
    }
  },
  warn(...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(...args);
    }
  },
  error(...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(...args);
    }
  },
};

export default logger;
