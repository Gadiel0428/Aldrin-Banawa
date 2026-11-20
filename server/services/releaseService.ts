/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GitHub Release & Installer Version Resolution Service
 */

import fs from "fs";
import { compareServerSemver, maxSemverVersion, normalizeGitHubRepo } from "../config.ts";
import logger from "../../src/lib/logger.ts";
import type { ServerContext } from "./context.ts";

const GITHUB_CACHE_TTL_MS = 60 * 1000;

export function loadPersistedGitHubReleaseFallback(ctx: ServerContext): void {
  try {
    if (fs.existsSync(ctx.releasePersistFile)) {
      const persisted = JSON.parse(fs.readFileSync(ctx.releasePersistFile, "utf8"));
      if (persisted && persisted.version) {
        ctx.cachedGitHubVersion = String(persisted.version).replace(/^v/i, "").trim();
        logger.info(
          `[RELEASE SYNC] Loaded persisted GitHub release fallback: ${ctx.cachedGitHubVersion}`
        );
      }
    }
  } catch {
    // Ignore release cache read errors
  }
}

export async function fetchGitHubJson(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "JUWEI-WMS-Cloud-Server",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (token && (resp.status === 401 || resp.status === 403 || resp.status === 404)) {
      const publicHeaders: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "JUWEI-WMS-Cloud-Server",
      };
      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), 8000);
      try {
        return await fetch(url, { headers: publicHeaders, signal: retryController.signal });
      } finally {
        clearTimeout(retryTimeout);
      }
    }
    return resp;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getLatestGitHubReleaseVersion(
  ctx: ServerContext,
  buildTimeFallback: string,
  forceRefresh: boolean = false
): Promise<string> {
  if (!ctx.cachedGitHubVersion) {
    try {
      if (fs.existsSync(ctx.releasePersistFile)) {
        const persisted = JSON.parse(fs.readFileSync(ctx.releasePersistFile, "utf8"));
        if (persisted && persisted.version) {
          ctx.cachedGitHubVersion = String(persisted.version).replace(/^v/i, "").trim();
        }
      }
    } catch {
      // Ignore fallback read errors
    }
  }

  const cleanRepo = normalizeGitHubRepo(ctx.config.githubRepo);
  const now = Date.now();

  if (
    !forceRefresh &&
    ctx.cachedGitHubVersion &&
    ctx.lastGitHubFetchTimestamp > 0 &&
    now - ctx.lastGitHubFetchTimestamp < GITHUB_CACHE_TTL_MS
  ) {
    return maxSemverVersion(ctx.cachedGitHubVersion, buildTimeFallback);
  }

  if (ctx.isFetchingGitHubRelease) {
    return maxSemverVersion(ctx.cachedGitHubVersion, buildTimeFallback);
  }

  ctx.isFetchingGitHubRelease = true;
  try {
    const token = ctx.config.githubToken;
    const apiUrl = `https://api.github.com/repos/${cleanRepo}/releases/latest`;
    let resolvedTag = "";

    const resp = await fetchGitHubJson(apiUrl, token);
    if (resp.ok) {
      const releaseData: any = await resp.json();
      if (releaseData && releaseData.tag_name) {
        resolvedTag = String(releaseData.tag_name).trim();
      }
    } else {
      console.warn(
        `[GITHUB RELEASE SYNC] GitHub Releases API returned HTTP ${resp.status} for ${apiUrl}, checking tags fallback...`
      );
    }

    if (!resolvedTag) {
      const tagsUrl = `https://api.github.com/repos/${cleanRepo}/tags?per_page=20`;
      const tagsResp = await fetchGitHubJson(tagsUrl, token);
      if (tagsResp.ok) {
        const tagsData: any[] = await tagsResp.json();
        if (Array.isArray(tagsData) && tagsData.length > 0) {
          const semverTags = tagsData
            .map((t: any) => String(t?.name || "").trim())
            .filter(Boolean)
            .sort((a: string, b: string) => compareServerSemver(b, a));
          if (semverTags[0]) {
            resolvedTag = semverTags[0];
          }
        }
      }
    }

    const parsed = resolvedTag.replace(/^v/i, "").trim();
    if (parsed) {
      ctx.cachedGitHubVersion = parsed;
      ctx.lastGitHubFetchTimestamp = Date.now();
      try {
        fs.writeFileSync(
          ctx.releasePersistFile,
          JSON.stringify(
            {
              version: parsed,
              tag: resolvedTag,
              repository: cleanRepo,
              updatedAt: new Date().toISOString(),
            },
            null,
            2
          ),
          "utf8"
        );
      } catch {
        // Ignore release persistence error
      }
      logger.info(
        `[GITHUB RELEASE SYNC] Authoritative release tag resolved from GitHub (${cleanRepo}): ${resolvedTag} -> version ${parsed}`
      );
    }
  } catch (err: any) {
    console.warn(`[GITHUB RELEASE SYNC] Request to GitHub Releases API failed:`, err?.message || err);
  } finally {
    ctx.isFetchingGitHubRelease = false;
  }

  return maxSemverVersion(ctx.cachedGitHubVersion, buildTimeFallback);
}
