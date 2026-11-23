/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FIFO Color Calendar & Startup Color Repair Service
 */

import fs from "fs";
import type { FifoColorsMap, FifoRepairAuditEntry } from "../../shared/types.ts";
import logger from "../../src/lib/logger.ts";
import {
  DEFAULT_FIFO_COLORS_BY_MONTH,
  FIFO_KNOWN_COLOR_NAMES,
  type FifoStartupRepairReport,
  type ServerContext,
} from "./context.ts";
import { getManilaTodayString } from "../../src/lib/businessDate.ts";

export function getMonthFromDate(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  if (!str) return null;
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const month = parseInt(ymdMatch[2], 10);
    if (month >= 1 && month <= 12) return month;
  }
  const d = new Date(str.includes("T") ? str : `${str}T00:00:00`);
  if (!isNaN(d.getTime())) {
    return d.getMonth() + 1;
  }
  return null;
}

export function getFifoColorForDate(
  ctx: ServerContext,
  receivedDate?: string | null,
  calendar?: FifoColorsMap
): string {
  const monthNum = getMonthFromDate(receivedDate);
  if (!monthNum) return "Silver";
  const activeMap = calendar || ctx.state?.fifoColorsByMonth || DEFAULT_FIFO_COLORS_BY_MONTH;
  return activeMap[monthNum]?.name || DEFAULT_FIFO_COLORS_BY_MONTH[monthNum]?.name || "Silver";
}

export function isValidFifoColorName(
  ctx: ServerContext,
  color: unknown,
  calendar?: FifoColorsMap
): boolean {
  if (color === undefined || color === null) return false;
  const s = String(color).trim();
  if (
    !s ||
    /^\d+$/.test(s) ||
    s.toLowerCase() === "n/a" ||
    s.toLowerCase() === "undefined" ||
    s.toLowerCase() === "null"
  ) {
    return false;
  }
  if (FIFO_KNOWN_COLOR_NAMES.has(s.toLowerCase())) return true;
  const activeMap = calendar || ctx.state?.fifoColorsByMonth || DEFAULT_FIFO_COLORS_BY_MONTH;
  return Object.values(activeMap).some((m: any) => m?.name?.toLowerCase() === s.toLowerCase());
}

export function repairFifoTagColorsOnStartup(
  ctx: ServerContext,
  commitDatabaseFn: (ctx: ServerContext) => boolean
): FifoStartupRepairReport {
  logger.info(
    "[FIFO STARTUP AUDIT] Beginning inspection of FIFO tag colors across stock and receiving records..."
  );
  let stocksRepaired = 0;
  let receivingRepaired = 0;
  const newRepairs: FifoRepairAuditEntry[] = [];
  const nowIso = new Date().toISOString();

  // 1. Scan Stock Records
  if (Array.isArray(ctx.state.stocks)) {
    ctx.state.stocks.forEach((stock: any) => {
      const currentColor = stock.fifoColor ?? stock.fifo_color;
      if (!isValidFifoColorName(ctx, currentColor, ctx.state.fifoColorsByMonth)) {
        const recDate =
          stock.receivedDate || stock.received_date || stock.date || stock.updated_at || getManilaTodayString();
        const newColor = getFifoColorForDate(ctx, recDate, ctx.state.fifoColorsByMonth);
        const auditEntry: FifoRepairAuditEntry = {
          id: `FIFO-AUDIT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          collection: "stocks",
          recordId: String(stock.id || stock.record_id),
          partCode: stock.partCode || stock.part_code,
          receivedDate: recDate,
          oldFifoColor: currentColor,
          newFifoColor: newColor,
          timestamp: nowIso,
          reason:
            currentColor === undefined || currentColor === null || currentColor === ""
              ? "Missing FIFO color tag; recomputed from receivedDate"
              : /^\d+$/.test(String(currentColor).trim())
                ? `Numeric FIFO month code ('${currentColor}') normalized to canonical color name`
                : `Unrecognized color value ('${currentColor}') normalized to canonical color name`,
        };

        stock.fifoColor = newColor;
        stock.version = (Number(stock.version) || 1) + 1;
        stock.updated_at = nowIso;

        newRepairs.push(auditEntry);
        ctx.fifoRepairAuditLogs.unshift(auditEntry);
        stocksRepaired++;

        logger.debug(
          `[FIFO REPAIR AUDIT] Repaired Stock [ID: ${stock.id}] (${stock.partCode || "N/A"}): Old '${currentColor}' -> New '${newColor}' (Date: ${recDate})`
        );
      }
    });
  }

  // 2. Scan Receiving Records
  if (Array.isArray(ctx.state.receiving)) {
    ctx.state.receiving.forEach((rcv: any) => {
      const currentColor = rcv.fifoColorCode ?? rcv.fifo_color_code ?? rcv.fifoColor;
      if (!isValidFifoColorName(ctx, currentColor, ctx.state.fifoColorsByMonth)) {
        const recDate =
          rcv.receivedDate || rcv.received_date || rcv.date || rcv.updated_at || getManilaTodayString();
        const newColor = getFifoColorForDate(ctx, recDate, ctx.state.fifoColorsByMonth);
        const auditEntry: FifoRepairAuditEntry = {
          id: `FIFO-AUDIT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          collection: "receiving",
          recordId: String(rcv.id || rcv.record_id),
          partCode: rcv.partCode || rcv.part_code,
          receivedDate: recDate,
          oldFifoColor: currentColor,
          newFifoColor: newColor,
          timestamp: nowIso,
          reason:
            currentColor === undefined || currentColor === null || currentColor === ""
              ? "Missing FIFO color code; recomputed from receivedDate"
              : /^\d+$/.test(String(currentColor).trim())
                ? `Numeric FIFO month code ('${currentColor}') normalized to canonical color name`
                : `Unrecognized color value ('${currentColor}') normalized to canonical color name`,
        };

        rcv.fifoColorCode = newColor;
        rcv.fifoColor = newColor;
        rcv.version = (Number(rcv.version) || 1) + 1;
        rcv.updated_at = nowIso;

        newRepairs.push(auditEntry);
        ctx.fifoRepairAuditLogs.unshift(auditEntry);
        receivingRepaired++;

        logger.debug(
          `[FIFO REPAIR AUDIT] Repaired Receiving [ID: ${rcv.id}] (${rcv.partCode || "N/A"}): Old '${currentColor}' -> New '${newColor}' (Date: ${recDate})`
        );
      }
    });
  }

  // 3. Persist changes if any repairs were made
  if (newRepairs.length > 0) {
    if (ctx.fifoRepairAuditLogs.length > 1000) {
      ctx.fifoRepairAuditLogs = ctx.fifoRepairAuditLogs.slice(0, 1000);
    }
    try {
      fs.writeFileSync(
        ctx.fifoRepairAuditLogFile,
        JSON.stringify(ctx.fifoRepairAuditLogs, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("[FIFO REPAIR AUDIT] Failed to save audit log file to disk:", err);
    }

    commitDatabaseFn(ctx);
    logger.info(
      `[FIFO DATA REPAIR SUMMARY] REPAIRED ${stocksRepaired} stock record(s) and ${receivingRepaired} receiving record(s). Database persisted to SQLite.`
    );

    ctx.chatMessages.push({
      id: `fifo-repair-${Date.now()}`,
      sender: "System",
      text: `[FIFO TAG AUDIT] Completed startup data repair: ${stocksRepaired} stock record(s) and ${receivingRepaired} receiving record(s) updated to canonical monthly FIFO colors based on received dates.`,
      timestamp: nowIso,
      isSystem: true,
    });
  } else {
    logger.info(
      `[FIFO DATA REPAIR SUMMARY] Clean check completed: all ${ctx.state.stocks?.length || 0} stock records and ${ctx.state.receiving?.length || 0} receiving records already possess valid FIFO tag colors. No repairs required.`
    );
  }

  const report: FifoStartupRepairReport = {
    stocksScanned: ctx.state.stocks?.length || 0,
    stocksRepaired,
    receivingScanned: ctx.state.receiving?.length || 0,
    receivingRepaired,
    repairs: newRepairs,
  };
  ctx.initialFifoRepairReport = report;
  return report;
}
