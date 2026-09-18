"use client";

import type { RdLedgerEntry, RdProject } from "./rd-client";

export const LEGACY_PROJECTS_KEY = "suyu-rd-projects-v1";
export const LEGACY_LEDGER_KEY = "suyu-rd-ledger-v1";
export const LEGACY_MIGRATED_KEY = "suyu-rd-database-migrated-v1";

export type LegacyRdDataset = { projects: RdProject[]; ledger: RdLedgerEntry[] };

function readArray<T>(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value as T[] : null;
  } catch { return null; }
}

/** Reads only data physically saved by an older browser version. Demo fallback data is never returned. */
export function getLegacyRdDataset(): LegacyRdDataset | null {
  const projects = readArray<RdProject>(LEGACY_PROJECTS_KEY);
  const ledger = readArray<RdLedgerEntry>(LEGACY_LEDGER_KEY);
  if (!projects && !ledger) return null;
  return { projects: projects ?? [], ledger: ledger ?? [] };
}

export function legacyMigrationDone() {
  return typeof window !== "undefined" && window.localStorage.getItem(LEGACY_MIGRATED_KEY) === "1";
}

export function markLegacyMigrationDone() {
  if (typeof window !== "undefined") window.localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
}
