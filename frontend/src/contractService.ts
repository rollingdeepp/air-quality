import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 240_000;

export type Call = "GOOD" | "MODERATE" | "HAZARDOUS" | "STALE_SENSOR" | "";

// status: 0 REGISTERED, 1 STREAMING, 2 GRADED, 3 PAID, 4 QUARANTINED
export interface ZoneReport {
  zoneId: number;
  holder: string;
  zone: string;
  latitude: string;
  longitude: string;
  sourceUrl: string;
  status: number;
  call: Call;
  aqi: number;
  rawAqiLast: number;
  rationale: string;
  poolShare: string;
  readingsRaw: number[];
  readingsSmoothed: number[];
  readingTimestamps: number[];
  submitCount: number;
  staleFlag: boolean;
  lastGradeEpoch: number;
  confidenceBps: number;
  webEvidenceHash: string;
}
export interface ZoneRow extends ZoneReport { id: number; }

export interface Counts {
  next: number;
  graded: number;
  hazardous: number;
  quarantined: number;
  epoch: number;
  totalPaid: string;
}

export interface WindowStats {
  zoneId: number;
  count: number;
  rawMin: number;
  rawMax: number;
  rawMean: number;
  smoothedLast: number;
  staleCheck: boolean;
}

export interface Constants {
  AQI_MAX: number;
  AQI_TOL: number;
  GOOD_CEIL: number;
  MODERATE_CEIL: number;
  WINDOW_MAX: number;
  STALE_RUN_THRESHOLD: number;
  STALE_VARIANCE_BPS: number;
  KALMAN_NEW_WEIGHT: number;
  KALMAN_OLD_WEIGHT: number;
  PCT_HAZARDOUS: number;
  PCT_MODERATE: number;
}

// ─── Clients ──────────────────────────────────────────────────────────────
function readClient() { return createClient({ chain: studionet, account: createAccount() }); }
function writeClient(account: Hex) { return createClient({ chain: studionet, account }); }

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS); });
  try {
    await Promise.race([
      client.waitForTransactionReceipt({ hash: hash as never, status: TransactionStatus.ACCEPTED, interval: 5000, retries: 64 }),
      timeout,
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

// Defensive parser: works whether genlayer-js returns an object (by key) or a
// positional array/tuple (by index).
function pick(obj: any, key: string, idx: number): any {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) return obj[idx];
  if (typeof obj === "object" && key in obj) return obj[key];
  return undefined;
}

function numArr(v: any): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x) || 0);
}

// ─── WRITES ─────────────────────────────────────────────────────────────────

// PAYABLE — funds the relief pool with attached GEN value.
export async function fundPool(account: Hex, wei: bigint): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "fund_pool", args: [], value: wei })) as Hex;
  await waitAccepted(wc, h);
}

// register_zone(zone, latitude, longitude) -> u32 (new zone id)
export async function registerZone(account: Hex, zone: string, latitude: string, longitude: string): Promise<number> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "register_zone", args: [zone.trim(), latitude.trim(), longitude.trim()], value: 0n })) as Hex;
  await waitAccepted(wc, h);
  const c = await getCounts();
  return c.next - 1;
}

// submit_reading(zone_id, aqi_raw, sensor_note) -> dict
export async function submitReading(account: Hex, zoneId: number, aqiRaw: number, sensorNote: string): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "submit_reading", args: [zoneId, aqiRaw, sensorNote.trim()], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}

// grade_air(zone_id) -> dict  (callable by anyone)
export async function gradeAir(account: Hex, zoneId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "grade_air", args: [zoneId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}

// payout(zone_id) -> dict
export async function payout(account: Hex, zoneId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "payout", args: [zoneId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}

// clear_quarantine(zone_id) [admin]
export async function clearQuarantine(account: Hex, zoneId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "clear_quarantine", args: [zoneId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}

// advance_epoch() [admin]
export async function advanceEpoch(account: Hex): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "advance_epoch", args: [], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}

// set_admin(new_admin) [admin]
export async function setAdmin(account: Hex, newAdmin: string): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "set_admin", args: [newAdmin.trim()], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}

// ─── VIEWS ────────────────────────────────────────────────────────────────

// get_report(zone_id) -> dict
export async function getReport(zoneId: number): Promise<ZoneReport> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_report", args: [zoneId] });
  return {
    zoneId: Number(pick(r, "zone_id", 0) ?? zoneId),
    holder: String(pick(r, "holder", 1) ?? ""),
    zone: String(pick(r, "zone", 2) ?? ""),
    latitude: String(pick(r, "latitude", 3) ?? ""),
    longitude: String(pick(r, "longitude", 4) ?? ""),
    sourceUrl: String(pick(r, "source_url", 5) ?? ""),
    status: Number(pick(r, "status", 6) ?? 0),
    call: String(pick(r, "call", 7) ?? "") as Call,
    aqi: Number(pick(r, "aqi", 8) ?? 0),
    rawAqiLast: Number(pick(r, "raw_aqi_last", 9) ?? 0),
    rationale: String(pick(r, "rationale", 10) ?? ""),
    poolShare: String(pick(r, "pool_share", 11) ?? "0"),
    readingsRaw: numArr(pick(r, "readings_raw", 12)),
    readingsSmoothed: numArr(pick(r, "readings_smoothed", 13)),
    readingTimestamps: numArr(pick(r, "reading_timestamps", 14)),
    submitCount: Number(pick(r, "submit_count", 15) ?? 0),
    staleFlag: Boolean(pick(r, "stale_flag", 16) ?? false),
    lastGradeEpoch: Number(pick(r, "last_grade_epoch", 17) ?? 0),
    confidenceBps: Number(pick(r, "confidence_bps", 18) ?? 0),
    webEvidenceHash: String(pick(r, "web_evidence_hash", 19) ?? ""),
  };
}

// get_pool_balance() -> str (wei)
export async function getPoolBalance(): Promise<string> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_pool_balance", args: [] });
  return String(r ?? "0");
}

// list_zones() -> list[int]
export async function listZones(): Promise<number[]> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "list_zones", args: [] });
  return numArr(r);
}

// list_zones_of(holder_hex) -> list[int]
export async function listZonesOf(holderHex: string): Promise<number[]> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "list_zones_of", args: [holderHex] });
  return numArr(r);
}

// get_counts() -> "next||graded||hazardous||quarantined||epoch||total_paid"
export async function getCounts(): Promise<Counts> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_counts", args: [] });
  const p = String(r ?? "").split("||");
  return {
    next: Number(p[0]) || 0,
    graded: Number(p[1]) || 0,
    hazardous: Number(p[2]) || 0,
    quarantined: Number(p[3]) || 0,
    epoch: Number(p[4]) || 0,
    totalPaid: p[5] ?? "0",
  };
}

// get_window_stats(zone_id) -> dict
export async function getWindowStats(zoneId: number): Promise<WindowStats> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_window_stats", args: [zoneId] });
  return {
    zoneId: Number(pick(r, "zone_id", 0) ?? zoneId),
    count: Number(pick(r, "count", 1) ?? 0),
    rawMin: Number(pick(r, "raw_min", 2) ?? 0),
    rawMax: Number(pick(r, "raw_max", 3) ?? 0),
    rawMean: Number(pick(r, "raw_mean", 4) ?? 0),
    smoothedLast: Number(pick(r, "smoothed_last", 5) ?? 0),
    staleCheck: Boolean(pick(r, "stale_check", 6) ?? false),
  };
}

// get_constants() -> dict
export async function getConstants(): Promise<Constants> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_constants", args: [] });
  const g = (k: string) => Number(pick(r, k, 0) ?? 0);
  return {
    AQI_MAX: g("AQI_MAX"),
    AQI_TOL: g("AQI_TOL"),
    GOOD_CEIL: g("GOOD_CEIL"),
    MODERATE_CEIL: g("MODERATE_CEIL"),
    WINDOW_MAX: g("WINDOW_MAX"),
    STALE_RUN_THRESHOLD: g("STALE_RUN_THRESHOLD"),
    STALE_VARIANCE_BPS: g("STALE_VARIANCE_BPS"),
    KALMAN_NEW_WEIGHT: g("KALMAN_NEW_WEIGHT"),
    KALMAN_OLD_WEIGHT: g("KALMAN_OLD_WEIGHT"),
    PCT_HAZARDOUS: g("PCT_HAZARDOUS"),
    PCT_MODERATE: g("PCT_MODERATE"),
  };
}

// Convenience: fetch full report rows for every registered zone.
export async function listAll(): Promise<ZoneRow[]> {
  const ids = await listZones();
  if (ids.length === 0) return [];
  const ordered = [...ids].sort((a, b) => b - a);
  const rows = await Promise.all(ordered.map(async (id) => {
    try { const r = await getReport(id); return { id, ...r }; } catch { return null; }
  }));
  return rows.filter((r): r is ZoneRow => r !== null);
}
