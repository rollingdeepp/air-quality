import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { parseEther, formatEther } from "viem";
import {
  fundPool, registerZone, submitReading, gradeAir, payout,
  clearQuarantine, advanceEpoch, setAdmin,
  getReport, getCounts, getPoolBalance, listAll, listZonesOf,
  getWindowStats, getConstants,
  ZoneReport, ZoneRow, Counts, WindowStats, Constants, Call,
} from "./contractService";
import { HazeField } from "./HazeField";

type Hex = `0x${string}`;

const STATUS_LABEL = ["REGISTERED", "STREAMING", "GRADED", "PAID", "QUARANTINED"];
const SEV: Record<string, number> = { HAZARDOUS: 4, STALE_SENSOR: 3, MODERATE: 2, GOOD: 1, "": 0 };

function shortAddr(a: string): string { return a && a.length > 12 ? `${a.slice(0, 6)}\u2026${a.slice(-4)}` : a || "-"; }
function gen(w: string): string { try { const v = formatEther(BigInt(w || "0")); return v.length > 9 ? Number(v).toFixed(3) : v; } catch { return "0"; } }
function bandColor(c: Call): string {
  return c === "GOOD" ? "#34d399" : c === "MODERATE" ? "#fbbf24" : c === "HAZARDOUS" ? "#fb5070" : c === "STALE_SENSOR" ? "#a78bfa" : "#64748b";
}
function bandClass(c: Call): "good" | "mod" | "haz" | "stale" | "pend" {
  return c === "GOOD" ? "good" : c === "MODERATE" ? "mod" : c === "HAZARDOUS" ? "haz" : c === "STALE_SENSOR" ? "stale" : "pend";
}

// ─── Inline icons (no external icon dependency) ──────────────────────────────
const Ic = {
  wind: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h18" /></svg>,
  pin: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  gauge: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 14l4-4M4 18a8 8 0 1 1 16 0" /></svg>,
  cast: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 17a4 4 0 0 1 4 4M2 13a8 8 0 0 1 8 8M2 9a12 12 0 0 1 12 12M2 6h18a1 1 0 0 1 1 1v12" /></svg>,
  warn: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  check: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  shield: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  info: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>,
};

function AqiRing({ aqi, call }: { aqi: number; call: Call }) {
  const pct = Math.max(4, Math.min(100, (aqi / 300) * 100));
  const col = bandColor(call);
  const r = 52; const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 130 130" width="130" height="130">
      <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
      <circle cx="65" cy="65" r={r} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} transform="rotate(-90 65 65)" />
      <text x="65" y="60" textAnchor="middle" className="ring-num" fill="#eef4fb">{aqi || "-"}</text>
      <text x="65" y="80" textAnchor="middle" className="ring-lab" fill={col}>AQI</text>
    </svg>
  );
}

// Dual-line rolling-window chart: raw (faint) vs smoothed (bright Kalman line).
function WindowChart({ raw, smoothed, color }: { raw: number[]; smoothed: number[]; color: string }) {
  const W = 560, H = 150, pad = 10;
  const n = Math.max(raw.length, smoothed.length);
  if (n === 0) return <div className="chart-empty mono">no readings in window yet</div>;
  const all = [...raw, ...smoothed];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const xAt = (i: number) => pad + (n <= 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const yAt = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  return (
    <svg className="wchart" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} x2={W - pad} y1={pad + g * (H - 2 * pad)} y2={pad + g * (H - 2 * pad)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      <path d={path(raw)} fill="none" stroke="rgba(148,163,184,0.55)" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={path(smoothed)} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {smoothed.map((v, i) => <circle key={i} cx={xAt(i)} cy={yAt(v)} r="2.4" fill={color} />)}
    </svg>
  );
}

export function App() {
  const { address, isConnected } = useAccount();
  const acct = address as Hex | undefined;

  // forms
  const [zone, setZone] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [aqiRaw, setAqiRaw] = useState("");
  const [sensorNote, setSensorNote] = useState("");
  const [fund, setFund] = useState("");
  const [adminAddr, setAdminAddr] = useState("");

  // data
  const [rows, setRows] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Counts>({ next: 0, graded: 0, hazardous: 0, quarantined: 0, epoch: 0, totalPaid: "0" });
  const [pool, setPool] = useState("0");
  const [constants, setConstants] = useState<Constants | null>(null);
  const [myZones, setMyZones] = useState<number[]>([]);

  const [selId, setSelId] = useState<number | null>(null);
  const [sel, setSel] = useState<ZoneReport | null>(null);
  const [stats, setStats] = useState<WindowStats | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [netErr, setNetErr] = useState(false);

  const isAdminOfSel = useMemo(
    () => !!(sel && address && sel.holder.toLowerCase() === address.toLowerCase()),
    [sel, address]
  );

  const refreshSel = useCallback(async (id: number) => {
    try {
      const [r, s] = await Promise.all([getReport(id), getWindowStats(id)]);
      setSel(r); setStats(s);
    } catch { /* keep last */ }
  }, []);

  const refreshAll = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const [c, p, list] = await Promise.all([getCounts(), getPoolBalance(), listAll()]);
      setCounts(c); setPool(p); setRows(list);
      if (address) { try { setMyZones(await listZonesOf(address)); } catch { /* */ } }
      if (selId != null) await refreshSel(selId);
      setNetErr(false);
    } catch { setNetErr(true); } finally { setLoading(false); }
  }, [address, selId, refreshSel]);

  useEffect(() => { getConstants().then(setConstants).catch(() => {}); }, []);

  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 12000);
    const onVis = () => { if (!document.hidden) refreshAll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [refreshAll]);

  async function selectZone(id: number) { setSelId(id); await refreshSel(id); }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setNote("");
    try { return await fn(); }
    catch (e) { setNote(String((e as Error).message || e).slice(0, 220)); return undefined; }
    finally { setBusy(null); refreshAll(); }
  }

  async function onRegister() {
    if (!acct) return;
    if (zone.trim().length < 2) return setNote("Name the zone, e.g. Harbor District.");
    if (!lat.trim() || !lon.trim()) return setNote("Enter station latitude and longitude.");
    const id = await run("Registering the zone", () => registerZone(acct, zone, lat, lon));
    if (id != null) { setZone(""); setLat(""); setLon(""); await selectZone(id); setNote(`Zone #${id} registered. Submit a reading.`); }
  }
  async function onSubmit() {
    if (!acct || selId == null) return setNote("Select a zone first.");
    const v = Number(aqiRaw);
    if (!(v >= 0 && v <= 500)) return setNote("AQI raw must be 0..500.");
    await run("Submitting the reading", () => submitReading(acct, selId, Math.round(v), sensorNote));
    setAqiRaw(""); setSensorNote("");
  }
  async function onGrade() { if (acct && selId != null) await run("The panel is reading the air", () => gradeAir(acct, selId)); }
  async function onPay() { if (acct && selId != null) await run("Releasing the zone payout", () => payout(acct, selId)); }
  async function onFund() {
    if (!acct) return;
    if (!(Number(fund) > 0)) return setNote("Fund the pool in GEN, e.g. 1.5");
    await run("Funding the pool", () => fundPool(acct, parseEther(fund.trim())));
    setFund("");
  }
  async function onClearQuarantine() { if (acct && selId != null) await run("Clearing quarantine", () => clearQuarantine(acct, selId)); }
  async function onAdvanceEpoch() { if (acct) await run("Advancing the epoch", () => advanceEpoch(acct)); }
  async function onSetAdmin() {
    if (!acct) return;
    if (!/^0x[0-9a-fA-F]{40}$/.test(adminAddr.trim())) return setNote("Enter a valid 0x admin address.");
    await run("Rotating admin", () => setAdmin(acct, adminAddr));
    setAdminAddr("");
  }

  const worstCall = useMemo<Call>(() => {
    let best: Call = ""; let s = -1;
    for (const r of rows) { const v = SEV[r.call] ?? 0; if (v > s) { s = v; best = r.call; } }
    return best;
  }, [rows]);

  const focus: ZoneReport | null = sel ?? (rows[0] ?? null);

  return (
    <>
      <HazeField color={bandColor(worstCall)} />
      <div className="hz">
        <header className="bar">
          <div className="wm">{Ic.wind}<span>HazeLine</span></div>
          <span className="bar-mid mono">streaming sensor consensus</span>
          <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        </header>

        <section className="hero">
          <div className="hcopy">
            <span className="kick mono">{Ic.cast} Air-quality registry v2</span>
            <h1>Read the air,<br /><span className="em">not the forecast.</span></h1>
            <p>HazeLine streams sensor readings into a rolling window, Kalman-smooths them, resists stale-sensor attacks, and grades each zone against live web AQI evidence. Graded zones draw relief from the pool.</p>
            <div className="legend">
              <span className="lg good"><i />GOOD</span>
              <span className="lg mod"><i />MODERATE</span>
              <span className="lg haz"><i />HAZARDOUS</span>
              <span className="lg stale"><i />STALE_SENSOR</span>
            </div>
          </div>
          <div className="readout">
            <AqiRing aqi={focus?.aqi ?? 0} call={focus?.call ?? ""} />
            <div className="ro-meta">
              <span className={`chip ${bandClass(focus?.call ?? "")}`}>{focus?.call || "AWAITING READ"}</span>
              <h3>{focus?.zone || "No zone yet"}</h3>
              <p className="coord mono">{Ic.pin} {focus?.latitude || "-"}, {focus?.longitude || "-"}</p>
              {focus && <p className="conf mono">confidence {(focus.confidenceBps / 10).toFixed(1)}%</p>}
            </div>
          </div>
        </section>

        <main className="console">
          {netErr && <div className="strip">{Ic.warn} Lost the station feed. Showing the last sweep; retrying every 12s.</div>}

          {/* get_counts header stat strip */}
          <div className="stats">
            <div><b>{counts.next}</b><span>zones</span></div>
            <div><b>{counts.graded}</b><span>graded</span></div>
            <div><b>{counts.hazardous}</b><span>hazardous</span></div>
            <div><b>{counts.quarantined}</b><span>quarantined</span></div>
            <div><b>{counts.epoch}</b><span>epoch</span></div>
            <div><b>{gen(pool)}</b><span>GEN pool</span></div>
            <div><b>{gen(counts.totalPaid)}</b><span>GEN paid</span></div>
          </div>

          <div className="cols">
            <section className="main">
              <div className="mh"><h2>Registered zones</h2><span className="mono mut">register &middot; stream &middot; grade &middot; pay</span></div>
              {loading ? <div className="skel">{[0, 1, 2].map(i => <div key={i} className="sk" />)}</div>
              : rows.length === 0 ? <p className="empty">No zones registered yet. Register the first on the right.</p>
              : <div className="zrows">{rows.map(r => (
                  <button key={r.id} className={`zrow ${selId === r.id ? "on" : ""}`} onClick={() => selectZone(r.id)}>
                    <span className={`pip ${bandClass(r.call)}`} />
                    <span className="zname">{r.zone || "zone"}{r.staleFlag && <em className="stale-tag mono">STALE</em>}</span>
                    <span className="zco mono">{r.latitude || "-"}, {r.longitude || "-"}</span>
                    <span className="zaqi mono">{r.aqi || "-"}</span>
                    <span className={`chip sm ${bandClass(r.call)}`}>{r.call || STATUS_LABEL[r.status]?.toLowerCase() || "open"}</span>
                  </button>
                ))}</div>}

              {sel && selId != null && (
                <div className="detail">
                  {(sel.status === 4 || sel.staleFlag) && (
                    <div className="quar">{Ic.warn} <b>QUARANTINED &mdash; stale-sensor attack detected.</b> Identical or low-variance readings tripped the deterministic stale check. An admin must clear quarantine after sensor replacement.</div>
                  )}

                  <div className="dh">
                    <h3>{Ic.gauge} Zone #{sel.zoneId} &middot; {sel.zone}</h3>
                    <span className={`chip ${bandClass(sel.call)}`}>{sel.call || "awaiting read"}</span>
                  </div>

                  <div className="dgrid">
                    <AqiRing aqi={sel.aqi} call={sel.call} />
                    <div className="dkv">
                      <div className="kv"><span>Status</span><b>{STATUS_LABEL[sel.status] ?? sel.status}</b></div>
                      <div className="kv"><span>Verdict / call</span><b>{sel.call || "\u2014"}</b></div>
                      <div className="kv"><span>Confidence</span><b className="mono">{(sel.confidenceBps / 10).toFixed(1)}% ({sel.confidenceBps} bps)</b></div>
                      <div className="kv"><span>Latest raw AQI</span><b className="mono">{sel.rawAqiLast}</b></div>
                      <div className="kv"><span>Smoothed AQI</span><b className="mono">{sel.aqi}</b></div>
                      <div className="kv"><span>Submissions</span><b className="mono">{sel.submitCount}</b></div>
                      <div className="kv"><span>Last grade epoch</span><b className="mono">{sel.lastGradeEpoch}</b></div>
                      <div className="kv"><span>Pool share</span><b>{gen(sel.poolShare)} GEN</b></div>
                    </div>
                  </div>

                  <div className="meta-row">
                    <div className="kv"><span>Holder</span><b className="mono">{shortAddr(sel.holder)}</b></div>
                    <div className="kv"><span>Coordinates</span><b className="mono">{sel.latitude}, {sel.longitude}</b></div>
                    <div className="kv"><span>Stale flag</span><b className="mono">{sel.staleFlag ? "true" : "false"}</b></div>
                    <div className="kv"><span>Web evidence hash</span><b className="mono">{sel.webEvidenceHash || "\u2014"}</b></div>
                  </div>
                  {sel.sourceUrl && (
                    <p className="src"><span className="mono mut">source url</span><a href={sel.sourceUrl} target="_blank" rel="noreferrer" className="mono">{sel.sourceUrl}</a></p>
                  )}

                  {/* rolling-window chart: raw vs smoothed */}
                  <div className="chart-wrap">
                    <div className="chart-head">
                      <h4>{Ic.cast} Rolling window &middot; {sel.readingsRaw.length} readings</h4>
                      <div className="chart-leg mono">
                        <span><i className="ll raw" />raw</span>
                        <span><i className="ll sm" style={{ background: bandColor(sel.call) }} />smoothed</span>
                      </div>
                    </div>
                    <WindowChart raw={sel.readingsRaw} smoothed={sel.readingsSmoothed} color={bandColor(sel.call)} />
                    {sel.readingTimestamps.length > 0 && (
                      <p className="ts mono mut">epochs: {sel.readingTimestamps.join(", ")}</p>
                    )}
                  </div>

                  {/* get_window_stats panel */}
                  {stats && (
                    <div className="wstats">
                      <span className="mono mut">window stats</span>
                      <div className="wgrid">
                        <div><b className="mono">{stats.count}</b><span>count</span></div>
                        <div><b className="mono">{stats.rawMin}</b><span>raw min</span></div>
                        <div><b className="mono">{stats.rawMax}</b><span>raw max</span></div>
                        <div><b className="mono">{stats.rawMean}</b><span>raw mean</span></div>
                        <div><b className="mono">{stats.smoothedLast}</b><span>smoothed last</span></div>
                        <div><b className={`mono ${stats.staleCheck ? "danger" : ""}`}>{stats.staleCheck ? "STALE" : "ok"}</b><span>stale check</span></div>
                      </div>
                    </div>
                  )}

                  {sel.rationale && <p className="why"><span className="mono mut">panel rationale</span>{sel.rationale}</p>}

                  {/* actions */}
                  <div className="acts">
                    <button className="go" disabled={!isConnected || !!busy || sel.status !== 1} onClick={onGrade} title="grade_air (anyone, needs >= 3 readings while STREAMING)">{Ic.gauge} Grade the air</button>
                    <button className="go alt" disabled={!isConnected || !!busy || sel.status !== 2 || sel.call === "GOOD"} onClick={onPay} title="payout (after GRADED, non-GOOD)">Release payout</button>
                    {sel.status === 3 && <p className="done">{Ic.check} Zone settled &mdash; {gen(sel.poolShare)} GEN released.</p>}
                  </div>

                  {/* admin-gated actions: on-chain revert if not admin */}
                  <div className="admin">
                    <span className="mono mut">{Ic.shield} admin actions (revert on-chain unless you are the admin)</span>
                    <div className="admin-btns">
                      <button className="ghost sm" disabled={!isConnected || !!busy || sel.status !== 4} onClick={onClearQuarantine}>Clear quarantine</button>
                      <button className="ghost sm" disabled={!isConnected || !!busy} onClick={onAdvanceEpoch}>Advance epoch</button>
                    </div>
                    <div className="admin-set">
                      <input className="mono" value={adminAddr} onChange={e => setAdminAddr(e.target.value)} placeholder="0x new admin address" />
                      <button className="ghost sm" disabled={!isConnected || !!busy} onClick={onSetAdmin}>Set admin</button>
                    </div>
                    {isAdminOfSel && <p className="mono mut hint">You hold this zone.</p>}
                  </div>
                </div>
              )}
            </section>

            <aside className="side">
              <div className="card">
                <h4>{Ic.pin} Register a zone</h4>
                <label>Zone name</label>
                <input value={zone} onChange={e => setZone(e.target.value)} placeholder="e.g. Harbor District" />
                <div className="two">
                  <div><label>Latitude</label><input className="mono" value={lat} onChange={e => setLat(e.target.value)} placeholder="34.0407" inputMode="decimal" /></div>
                  <div><label>Longitude</label><input className="mono" value={lon} onChange={e => setLon(e.target.value)} placeholder="-118.2468" inputMode="decimal" /></div>
                </div>
                <button className="go full" disabled={!isConnected || !!busy} onClick={onRegister}>{isConnected ? "Register zone" : "Connect a wallet"}</button>
              </div>

              <div className="card">
                <h4>{Ic.cast} Submit a reading</h4>
                <p className="ph">{selId != null ? `Streaming into zone #${selId} (holder only).` : "Select a zone above to attach a reading."}</p>
                <label>Raw AQI (0&ndash;500)</label>
                <input className="mono" value={aqiRaw} onChange={e => setAqiRaw(e.target.value)} placeholder="e.g. 138" inputMode="numeric" />
                <label>Sensor note</label>
                <textarea value={sensorNote} onChange={e => setSensorNote(e.target.value)} placeholder="PM2.5 spike near the freight corridor." rows={2} />
                <button className="ghost full" disabled={!isConnected || !!busy || selId == null} onClick={onSubmit}>Attach reading</button>
              </div>

              <div className="card">
                <h4>{Ic.gauge} Relief pool</h4>
                <p className="ph">{gen(pool)} GEN backs hazardous &amp; moderate payouts. {gen(counts.totalPaid)} GEN paid out so far.</p>
                <label>Add (GEN)</label>
                <input value={fund} onChange={e => setFund(e.target.value)} placeholder="e.g. 1.5" inputMode="decimal" />
                <button className="ghost full" disabled={!isConnected || !!busy} onClick={onFund}>{isConnected ? "Fund the pool" : "Connect a wallet"}</button>
              </div>

              {/* list_zones_of connected wallet */}
              <div className="card">
                <h4>{Ic.pin} My zones</h4>
                {!isConnected ? <p className="ph">Connect a wallet to see the zones you hold.</p>
                : myZones.length === 0 ? <p className="ph">You hold no zones yet.</p>
                : <div className="chips">{myZones.map(id => (
                    <button key={id} className="zchip mono" onClick={() => selectZone(id)}>#{id}</button>
                  ))}</div>}
                <p className="acct mono">{isConnected ? shortAddr(address || "") : "wallet not connected"}</p>
              </div>

              {/* get_constants legend / info panel */}
              {constants && (
                <div className="card">
                  <h4>{Ic.info} Protocol constants</h4>
                  <div className="const">
                    <div><span>AQI max</span><b className="mono">{constants.AQI_MAX}</b></div>
                    <div><span>AQI tol</span><b className="mono">{constants.AQI_TOL}</b></div>
                    <div><span>GOOD ceil</span><b className="mono">&le; {constants.GOOD_CEIL}</b></div>
                    <div><span>MODERATE ceil</span><b className="mono">&le; {constants.MODERATE_CEIL}</b></div>
                    <div><span>Window max</span><b className="mono">{constants.WINDOW_MAX}</b></div>
                    <div><span>Stale run</span><b className="mono">{constants.STALE_RUN_THRESHOLD}</b></div>
                    <div><span>Stale var (bps)</span><b className="mono">{constants.STALE_VARIANCE_BPS}</b></div>
                    <div><span>Kalman new/old</span><b className="mono">{constants.KALMAN_NEW_WEIGHT}/{constants.KALMAN_OLD_WEIGHT}</b></div>
                    <div><span>Pay hazardous</span><b className="mono">{constants.PCT_HAZARDOUS}%</b></div>
                    <div><span>Pay moderate</span><b className="mono">{constants.PCT_MODERATE}%</b></div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </main>

        {(busy || note) && <div className="toast">{busy ? `${busy}\u2026` : note}</div>}
      </div>
    </>
  );
}
