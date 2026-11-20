/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized Server Configuration & Startup Validation
 */

import fs from "fs";
import path from "path";
import logger from "../src/lib/logger.ts";

export const DEFAULT_PORT = 3000;
export const DEFAULT_GITHUB_REPO = "Gadiel0428/Aldrin-Banawa";

export interface BundleVersionInfo {
  fileContent: Record<string, unknown> | null;
  bundleVersion: string;
}

export interface ServerConfig {
  port: number;
  dataDir: string;
  backupsDir: string;
  configuredDataDirRaw: string;
  configuredDataDir: string | null;
  isDataDirConfigured: boolean;
  isInsideProjectSource: boolean;
  dataFileSqlite: string;
  dataFileJson: string;
  dataFile: string;
  githubRepo: string;
  githubToken?: string;
  publicServerUrl: string;
  publicServerSource: string;
  nodeEnv: string;
  isProduction: boolean;
  version: string;
  getStorageFilePath: (filename: string) => string;
}

export function compareServerSemver(a: string, b: string): number {
  const cleanA = String(a || "").replace(/^v/i, "").trim();
  const cleanB = String(b || "").replace(/^v/i, "").trim();
  if (!cleanA && !cleanB) return 0;
  if (!cleanA) return -1;
  if (!cleanB) return 1;
  const pa = cleanA.split(/[.-]/).map((p: string) => (/^\d+$/.test(p) ? parseInt(p, 10) : 0));
  const pb = cleanB.split(/[.-]/).map((p: string) => (/^\d+$/.test(p) ? parseInt(p, 10) : 0));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function maxSemverVersion(...versions: Array<string | null | undefined>): string {
  let best = "";
  for (const v of versions) {
    const clean = String(v || "").replace(/^v/i, "").trim();
    if (!clean) continue;
    if (!best || compareServerSemver(clean, best) > 0) {
      best = clean;
    }
  }
  return best;
}

export function resolveServerBundleVersion(rootDir: string = process.cwd()): BundleVersionInfo {
  const possiblePaths = [
    path.join(rootDir, "dist", "build-info.json"),
    path.join(rootDir, "public", "build-info.json"),
    path.join(rootDir, "build-info.json"),
  ];

  let fileContent: Record<string, unknown> | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          fileContent = parsed as Record<string, unknown>;
          break;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  let pkgVersion = "";
  try {
    const pkgRaw: unknown = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    if (pkgRaw && typeof pkgRaw === "object" && "version" in pkgRaw) {
      const ver = (pkgRaw as { version?: unknown }).version;
      if (typeof ver === "string" || typeof ver === "number") {
        pkgVersion = String(ver).replace(/^v/i, "").trim();
      }
    }
  } catch {
    // Package version unavailable
  }

  const rawFileVer = fileContent && "version" in fileContent ? fileContent.version : "";
  const fileVersion =
    typeof rawFileVer === "string" || typeof rawFileVer === "number"
      ? String(rawFileVer).replace(/^v/i, "").trim()
      : "";
  const bundleVersion = maxSemverVersion(fileVersion, pkgVersion);

  return { fileContent, bundleVersion };
}

export function normalizeGitHubRepo(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

function validatePort(rawPort: string): number {
  if (!rawPort) return DEFAULT_PORT;
  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`[CONFIG VALIDATION ERROR] Invalid PORT "${rawPort}". Must be an integer between 1 and 65535.`);
  }
  const parsed = parseInt(rawPort, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`[CONFIG VALIDATION ERROR] Invalid PORT "${rawPort}". Must be between 1 and 65535.`);
  }
  return parsed;
}

function validateGitHubRepo(rawRepo: string): string {
  const candidate = rawRepo ? normalizeGitHubRepo(rawRepo) : DEFAULT_GITHUB_REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate)) {
    throw new Error(
      `[CONFIG VALIDATION ERROR] Invalid GITHUB_REPO "${rawRepo}". Expected "owner/repo" format.`
    );
  }
  return candidate;
}

function resolvePublicServerAddress(
  rootDir: string,
  port: number
): { publicServerUrl: string; publicServerSource: string } {
  const envUrl =
    process.env.PUBLIC_SERVER_URL?.trim() ||
    process.env.CENTRAL_SERVER_URL?.trim() ||
    process.env.VITE_CENTRAL_SERVER_URL?.trim() ||
    "";

  if (envUrl) {
    let parsed: URL;
    try {
      parsed = new URL(envUrl.includes("://") ? envUrl : `http://${envUrl}`);
    } catch {
      throw new Error(`[CONFIG VALIDATION ERROR] Invalid public server URL "${envUrl}".`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `[CONFIG VALIDATION ERROR] Public server URL "${envUrl}" must use http:// or https://.`
      );
    }
    return {
      publicServerUrl: parsed.toString().replace(/\/+$/, ""),
      publicServerSource: "environment",
    };
  }

  const configCandidates = [
    path.join(rootDir, "dist", "server-config.json"),
    path.join(rootDir, "public", "server-config.json"),
    path.join(rootDir, "server-config.json"),
  ];

  for (const cfgPath of configCandidates) {
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (raw && typeof raw === "object") {
        const record = raw as { centralServerUrl?: unknown; centralServerHost?: unknown };
        const candidateUrl =
          typeof record.centralServerUrl === "string" && record.centralServerUrl.trim()
            ? record.centralServerUrl.trim()
            : typeof record.centralServerHost === "string" && record.centralServerHost.trim()
            ? `http://${record.centralServerHost.trim().replace(/^https?:\/\//i, "")}`
            : "";

        if (candidateUrl) {
          const parsed = new URL(candidateUrl.includes("://") ? candidateUrl : `http://${candidateUrl}`);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return {
              publicServerUrl: parsed.toString().replace(/\/+$/, ""),
              publicServerSource: path.relative(rootDir, cfgPath) || "server-config.json",
            };
          }
        }
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    publicServerUrl: `http://localhost:${port}`,
    publicServerSource: "default",
  };
}

export function loadAndValidateServerConfig(): ServerConfig {
  const projectRootDir = path.resolve(process.cwd());
  const rawPort = process.env.PORT ? process.env.PORT.trim() : "";
  const port = validatePort(rawPort);

  const configuredDataDirRaw = process.env.JUWEI_DATA_DIR ? process.env.JUWEI_DATA_DIR.trim() : "";
  const configuredDataDir = configuredDataDirRaw ? path.resolve(configuredDataDirRaw) : null;
  const dataDir = configuredDataDir || projectRootDir;
  const isDataDirConfigured = Boolean(configuredDataDir);

  if (configuredDataDir) {
    try {
      if (fs.existsSync(configuredDataDir)) {
        const stat = fs.statSync(configuredDataDir);
        if (!stat.isDirectory()) {
          throw new Error(
            `[CONFIG VALIDATION ERROR] JUWEI_DATA_DIR "${configuredDataDir}" exists and is not a directory.`
          );
        }
      } else {
        fs.mkdirSync(configuredDataDir, { recursive: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("[CONFIG VALIDATION ERROR]")) throw err;
      throw new Error(
        `[CONFIG VALIDATION ERROR] Cannot access or create JUWEI_DATA_DIR "${configuredDataDir}": ${msg}`
      );
    }
  }

  const getStorageFilePath = (filename: string): string => {
    if (configuredDataDirRaw) {
      try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        return path.join(dataDir, filename);
      } catch {
        // Fall back below if directory creation fails mid-flight
      }
    }
    return path.join(projectRootDir, filename);
  };

  const dataFileSqlite = getStorageFilePath("central-database.sqlite");
  const dataFileJson = getStorageFilePath("central-database.json");
  const dataFile = dataFileSqlite;
  const backupsDir = path.join(path.dirname(dataFile), "backups");

  const resolvedDataFile = path.resolve(dataFile);
  const isInsideProjectSource =
    resolvedDataFile.startsWith(projectRootDir) &&
    (!configuredDataDir || !resolvedDataFile.startsWith(configuredDataDir));

  const rawGithubRepo = process.env.GITHUB_REPO ? process.env.GITHUB_REPO.trim() : "";
  const githubRepo = validateGitHubRepo(rawGithubRepo);
  const githubToken =
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined;

  const { publicServerUrl, publicServerSource } = resolvePublicServerAddress(projectRootDir, port);

  const nodeEnv = process.env.NODE_ENV ? process.env.NODE_ENV.trim() : "development";
  const isProduction = nodeEnv === "production";
  const { bundleVersion } = resolveServerBundleVersion(projectRootDir);
  const version = bundleVersion || "0.0.0";

  return {
    port,
    dataDir,
    backupsDir,
    configuredDataDirRaw,
    configuredDataDir,
    isDataDirConfigured,
    isInsideProjectSource,
    dataFileSqlite,
    dataFileJson,
    dataFile,
    githubRepo,
    githubToken,
    publicServerUrl,
    publicServerSource,
    nodeEnv,
    isProduction,
    version,
    getStorageFilePath,
  };
}

export function printServerStartupSummary(
  config: ServerConfig,
  meta: { instanceId: string; bootTime?: string }
): void {
  const lines = [
    "================================================================================",
    "  JUWEI WMS CENTRAL SERVER - STARTUP CONFIGURATION SUMMARY",
    "--------------------------------------------------------------------------------",
    `  Version        : v${config.version}`,
    `  Port           : ${config.port} (${config.nodeEnv})`,
    `  Data Folder    : ${config.dataDir}${config.isDataDirConfigured ? "" : " (default: cwd)"}`,
    `  Backup Folder  : ${config.backupsDir}`,
    `  Public Address : ${config.publicServerUrl} (${config.publicServerSource})`,
    `  GitHub Repo    : ${config.githubRepo}`,
    `  Instance ID    : ${meta.instanceId}`,
    "================================================================================",
  ];
  logger.info(`\n${lines.join("\n")}`);
}
