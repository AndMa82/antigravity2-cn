#!/usr/bin/env node
/**
 * Antigravity Token & API Value Real-Time Telemetry Server (Node.js Edition)
 * Zero external npm dependencies: uses Node built-in `node:sqlite` (Node >= 22.13)
 * and `node:http`, with automatic fallback to `monitor_server.py` if needed.
 * Reads local Antigravity SQLite conversation DBs (including WAL) with mtime caching.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVERSATIONS_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');
const SUMMARIES_DB_PATH = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');
const PYTHON_SERVER_PATH = path.join(__dirname, 'monitor_server.py');

export const ENUM_TO_NAME = {
  1318: 'Gemini 3.8 Flash (High)',
  1319: 'Gemini 3.8 Flash (Medium)',
  1320: 'Gemini 3.8 Flash (Low)',
  1322: 'Gemini 3.8 Flash Tiered',
  1401: 'Claude Opus 5.5 (Medium)',
  1402: 'Claude Opus 5.5 (High)',
  1403: 'Claude Opus 5.5 (Low)',
  1404: 'Claude Sonnet 5.5 (Medium)',
  1405: 'Claude Sonnet 5.5 (High)',
  1417: 'Gemini 4 Argon (High)',
  1418: 'Gemini 4 Argon (Medium)',
  1419: 'Gemini 4 Argon (Low)',
  1427: 'Gemini 4 Carbon (High)',
  1428: 'Gemini 4 Carbon (Medium)',
  1525: 'Gemini 4 Hydrogen (High)',
  1526: 'Gemini 4 Hydrogen (Medium)',
  1528: 'Gemini 4 Hydrogen (XHigh)',
};

// Per 1M tokens: [promo_in, promo_cache, promo_out, std_in, std_cache, std_out]
export const PRICING = {
  'Gemini 4 Argon (High)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Gemini 4 Argon (Medium)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Gemini 4 Argon (Low)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Gemini 4 Carbon (High)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Gemini 4 Carbon (Medium)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Gemini 4 Hydrogen (High)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Gemini 4 Hydrogen (Medium)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Gemini 4 Hydrogen (XHigh)': [2.00, 0.10, 10.00, 4.00, 0.20, 20.00],
  'Claude Opus 5.5 (Medium)': [4.00, 0.20, 20.00, 4.00, 0.20, 20.00],
  'Claude Opus 5.5 (High)': [4.00, 0.20, 20.00, 4.00, 0.20, 20.00],
  'Claude Opus 5.5 (Low)': [4.00, 0.20, 20.00, 4.00, 0.20, 20.00],
  'Claude Sonnet 5.5 (Medium)': [3.00, 0.30, 15.00, 3.00, 0.30, 15.00],
  'Claude Sonnet 5.5 (High)': [3.00, 0.30, 15.00, 3.00, 0.30, 15.00],
  'Gemini 3.8 Flash Tiered': [0.75, 0.075, 3.75, 1.50, 0.15, 7.50],
  'Gemini 3.8 Flash (High)': [0.75, 0.075, 3.75, 1.50, 0.15, 7.50],
  'Gemini 3.8 Flash (Medium)': [0.75, 0.075, 3.75, 1.50, 0.15, 7.50],
  'Gemini 3.8 Flash (Low)': [0.75, 0.075, 3.75, 1.50, 0.15, 7.50],
};

export const MODEL_COLORS = {
  'Gemini 4 Argon (High)': '#6366f1',
  'Gemini 4 Carbon (High)': '#10b981',
  'Gemini 4 Hydrogen (High)': '#06b6d4',
  'Claude Opus 5.5 (Medium)': '#f59e0b',
  'Claude Opus 5.5 (High)': '#ea580c',
  'Gemini 4 Argon (Medium)': '#8b5cf6',
  'Gemini 3.8 Flash Tiered': '#ec4899',
  'Gemini 4 Hydrogen (XHigh)': '#3b82f6',
  'Gemini 3.8 Flash (High)': '#14b8a6',
  'Gemini 3.8 Flash (Medium)': '#2dd4bf',
  'Claude Sonnet 5.5 (Medium)': '#fb923c',
};

const FALLBACK_PALETTE = ['#a855f7', '#22d3ee', '#84cc16', '#f43f5e', '#eab308', '#38bdf8'];
const WIN_COLORS = ['#6366f1', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6'];
const IMAGE_GEN_UNIT_COST = 0.04;

function parseVarint(data, start) {
  let val = 0n;
  let shift = 0n;
  let i = start;
  const n = data.length;
  while (i < n) {
    const b = BigInt(data[i]);
    i += 1;
    val |= (b & 0x7fn) << shift;
    if ((b & 0x80n) === 0n) break;
    shift += 7n;
    if (shift > 63n) break;
  }
  return [Number(BigInt.asUintN(64, val)), i];
}

function parseProtoDict(data) {
  const res = new Map();
  if (!data || !data.length) return res;
  let i = 0;
  const n = data.length;
  while (i < n) {
    let tag;
    [tag, i] = parseVarint(data, i);
    if (!Number.isFinite(tag) || tag <= 0) break;
    const fn = Math.floor(tag / 8);
    const wt = tag & 7;
    let val;
    if (wt === 0) {
      [val, i] = parseVarint(data, i);
    } else if (wt === 1) {
      if (i + 8 > n) break;
      val = data.subarray(i, i + 8);
      i += 8;
    } else if (wt === 2) {
      let ln;
      [ln, i] = parseVarint(data, i);
      if (ln < 0 || i + ln > n) break;
      val = data.subarray(i, i + ln);
      i += ln;
    } else if (wt === 5) {
      if (i + 4 > n) break;
      val = data.subarray(i, i + 4);
      i += 4;
    } else {
      break;
    }
    let arr = res.get(fn);
    if (!arr) {
      arr = [];
      res.set(fn, arr);
    }
    arr.push(val);
  }
  return res;
}

function bytesToUtf8(u8) {
  if (!u8 || !u8.length) return '';
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('utf8');
}

function roundTo(val, digits) {
  const f = 10 ** digits;
  return Math.round((val + Number.EPSILON) * f) / f;
}

function getPricing(modelName, modelId = '') {
  if (PRICING[modelName]) return PRICING[modelName];
  const low = `${modelName} ${modelId}`.toLowerCase();
  if (low.includes('opus')) return [4.00, 0.20, 20.00, 4.00, 0.20, 20.00];
  if (low.includes('sonnet')) return [3.00, 0.30, 15.00, 3.00, 0.30, 15.00];
  if (low.includes('flash')) return [0.75, 0.075, 3.75, 1.50, 0.15, 7.50];
  return [2.00, 0.10, 10.00, 4.00, 0.20, 20.00];
}

function getColor(modelName, idx = 0) {
  if (MODEL_COLORS[modelName]) return MODEL_COLORS[modelName];
  return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

class TelemetryStore {
  constructor(DatabaseSync) {
    this.DatabaseSync = DatabaseSync;
    this._dbCache = new Map(); // dbPath -> { sig, recs, imgs }
    this._summarySig = '';
    this._metaMap = new Map();
  }

  _fileSig(filePath) {
    let s1 = '0:0';
    let s2 = '0:0';
    try {
      const st = fs.statSync(filePath, { bigint: true });
      s1 = `${st.mtimeNs}:${st.size}`;
    } catch {
      // ignore
    }
    try {
      const st2 = fs.statSync(`${filePath}-wal`, { bigint: true });
      s2 = `${st2.mtimeNs}:${st2.size}`;
    } catch {
      // ignore
    }
    return `${s1}|${s2}`;
  }

  _refreshSummaries() {
    const sig = this._fileSig(SUMMARIES_DB_PATH);
    if (sig === this._summarySig && this._metaMap.size > 0) return;
    if (!fs.existsSync(SUMMARIES_DB_PATH)) return;

    let con = null;
    try {
      con = new this.DatabaseSync(SUMMARIES_DB_PATH, { readOnly: true, timeout: 1500 });
      const rows = con
        .prepare('SELECT conversation_id, title, parent_conversation_id, agent_name FROM conversation_summaries')
        .all();
      const meta = new Map();
      for (const row of rows) {
        meta.set(row.conversation_id, [
          row.title || '',
          row.parent_conversation_id || '',
          row.agent_name || '',
        ]);
      }
      this._metaMap = meta;
      this._summarySig = sig;
    } catch {
      // ignore read/lock errors
    } finally {
      if (con) {
        try {
          con.close();
        } catch {
          // ignore
        }
      }
    }
  }

  _parseSingleDb(dbPath) {
    const cid = path.basename(dbPath).slice(0, -3);
    const records = [];
    const imgEvents = [];
    let con = null;

    try {
      con = new this.DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
      const stepMap = new Map();
      const stepIdxTs = new Map();

      const stepRows = con.prepare('SELECT idx, step_type, metadata FROM steps WHERE metadata IS NOT NULL').all();
      for (const row of stepRows) {
        const idx = row.idx;
        const st = row.step_type;
        const meta = row.metadata;
        const d = parseProtoDict(meta);
        const ts = d.has(1) ? (parseProtoDict(d.get(1)[0]).get(1)?.[0] ?? 0) : 0;
        stepIdxTs.set(idx, ts);

        if (d.has(4)) {
          const t4 = parseProtoDict(d.get(4)[0]);
          const tname = t4.has(2) ? bytesToUtf8(t4.get(2)[0]) : '';
          if (tname === 'generate_image') {
            imgEvents.push([ts, cid]);
          }
        }
        if (d.has(9)) {
          const u9 = parseProtoDict(d.get(9)[0]);
          const botId = u9.has(7) ? bytesToUtf8(u9.get(7)[0]) : `step_${idx}`;
          stepMap.set(botId, [ts, idx, st, u9]);
        }
      }

      const genRows = con.prepare('SELECT idx, data FROM gen_metadata').all();
      const seenBots = new Set();
      for (const row of genRows) {
        const gidx = row.idx;
        const blob = row.data;
        const d = parseProtoDict(blob);
        if (!d.has(1)) continue;

        const m1 = parseProtoDict(d.get(1)[0]);
        const u4 = m1.has(4) ? parseProtoDict(m1.get(4)[0]) : new Map();
        const botId = u4.has(7) ? bytesToUtf8(u4.get(7)[0]) : `gen_${gidx}`;
        seenBots.add(botId);

        const me = (m1.get(3)?.[0] ?? 0) || (u4.get(1)?.[0] ?? 0);
        const mid = m1.has(19) ? bytesToUtf8(m1.get(19)[0]) : '';
        const mn = m1.has(21) ? bytesToUtf8(m1.get(21)[0]) : '';
        const kv = {};
        for (const item of m1.get(20) ?? []) {
          const kvd = parseProtoDict(item);
          if (kvd.has(1) && kvd.has(2)) {
            kv[bytesToUtf8(kvd.get(1)[0])] = bytesToUtf8(kvd.get(2)[0]);
          }
        }

        let ts;
        if (stepMap.has(botId)) {
          ts = stepMap.get(botId)[0];
        } else {
          const lastSidx = Number.parseInt(kv.last_step_index ?? '-1', 10);
          if (stepIdxTs.has(lastSidx)) {
            ts = stepIdxTs.get(lastSidx);
          } else if (stepIdxTs.has(lastSidx + 1)) {
            ts = stepIdxTs.get(lastSidx + 1);
          } else {
            ts = 0;
          }
        }

        const inp = u4.get(2)?.[0] ?? 0;
        const out = u4.get(3)?.[0] ?? 0;
        const cache = u4.get(5)?.[0] ?? 0;
        const think = u4.get(9)?.[0] ?? 0;
        const resp = u4.get(10)?.[0] ?? 0;
        const mname = ENUM_TO_NAME[me] || mn || mid || `Unknown(${me})`;
        records.push([ts, cid, me, mid, mname, inp, cache, out, think, resp]);
      }

      for (const [botId, [ts, , , u9]] of stepMap.entries()) {
        if (!seenBots.has(botId)) {
          const me = u9.get(1)?.[0] ?? 0;
          const inp = u9.get(2)?.[0] ?? 0;
          const out = u9.get(3)?.[0] ?? 0;
          const cache = u9.get(5)?.[0] ?? 0;
          const think = u9.get(9)?.[0] ?? 0;
          const resp = u9.get(10)?.[0] ?? 0;
          const mname = ENUM_TO_NAME[me] || `Unknown(${me})`;
          records.push([ts, cid, me, '', mname, inp, cache, out, think, resp]);
        }
      }
    } catch {
      // ignore corrupted/locked db
    } finally {
      if (con) {
        try {
          con.close();
        } catch {
          // ignore
        }
      }
    }

    return [records, imgEvents];
  }

  snapshot() {
    const t0 = performance.now();
    this._refreshSummaries();

    let dbPaths = [];
    try {
      if (fs.existsSync(CONVERSATIONS_DIR)) {
        dbPaths = fs
          .readdirSync(CONVERSATIONS_DIR)
          .filter((name) => name.endsWith('.db'))
          .map((name) => path.join(CONVERSATIONS_DIR, name));
      }
    } catch {
      dbPaths = [];
    }

    const currentSet = new Set(dbPaths);
    for (const stale of this._dbCache.keys()) {
      if (!currentSet.has(stale)) this._dbCache.delete(stale);
    }

    let reparsed = 0;
    const allRecords = [];
    const allImgs = [];

    for (const p of dbPaths) {
      const sig = this._fileSig(p);
      const cached = this._dbCache.get(p);
      let recs;
      let imgs;
      if (cached && cached.sig === sig) {
        recs = cached.recs;
        imgs = cached.imgs;
      } else {
        [recs, imgs] = this._parseSingleDb(p);
        this._dbCache.set(p, { sig, recs, imgs });
        reparsed += 1;
      }
      for (let i = 0; i < recs.length; i += 1) allRecords.push(recs[i]);
      for (let i = 0; i < imgs.length; i += 1) allImgs.push(imgs[i]);
    }

    const metaMap = new Map(this._metaMap);
    const elapsedMs = roundTo(performance.now() - t0, 2);
    return { allRecords, allImgs, metaMap, dbCount: dbPaths.length, reparsed, scanMs: elapsedMs };
  }
}

function getLocalTzHours() {
  return -new Date().getTimezoneOffset() / 60;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toShiftedDate(tsSec, tzHours) {
  return new Date(Math.round((tsSec + tzHours * 3600) * 1000));
}

function formatYmd(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatMd(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
}

function formatMdDash(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatYmdHm(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatYmdHms(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatMdHm(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatMdHms(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatHms(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatHm(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatYmdHour00(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:00`;
}

function formatHour00(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  return `${pad2(d.getUTCHours())}:00`;
}

function startOfDayTs(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  return utcMidnight / 1000 - tzHours * 3600;
}

function startOfHourTs(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  const utcHour = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0);
  return utcHour / 1000 - tzHours * 3600;
}

function startOfMondayTs(tsSec, tzHours) {
  const d = toShiftedDate(tsSec, tzHours);
  const pyWeekday = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const todayTs = startOfDayTs(tsSec, tzHours);
  return todayTs - pyWeekday * 86400;
}

function parseIsoWithDefaultTz(isoStr, tzHours) {
  if (!isoStr || typeof isoStr !== 'string') return Number.NaN;
  const trimmed = isoStr.trim();
  if (!trimmed) return Number.NaN;
  const hasExplicitTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed);
  if (hasExplicitTz) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms / 1000 : Number.NaN;
  }
  // Normalize space separator to T and parse as UTC, then shift by tzHours
  const normalized = trimmed.replace(' ', 'T');
  const ms = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(ms)) return Number.NaN;
  return ms / 1000 - tzHours * 3600;
}

function resolveTimeBounds(preset, customStart = null, customEnd = null, tzHours = null) {
  const tzH = tzHours ?? getLocalTzHours();
  const nowTs = Date.now() / 1000;

  if (preset === 'last_7d') {
    return [nowTs - 7 * 86400, nowTs, '最近 7 天', 'daily'];
  }
  if (preset === 'since_reset') {
    const envReset = (process.env.ANTIGRAVITY_RESET_AT || '').trim();
    if (envReset) {
      const rts = parseIsoWithDefaultTz(envReset, tzH);
      if (Number.isFinite(rts)) {
        return [rts, nowTs, `本周期 (${formatMdHm(rts, tzH)} 起)`, 'daily'];
      }
    }
    const monTs = startOfMondayTs(nowTs, tzH);
    return [monTs, nowTs, `本周周期 (${formatMdDash(monTs, tzH)} 00:00 起)`, 'daily'];
  }
  if (preset === 'since_monday') {
    const monTs = startOfMondayTs(nowTs, tzH);
    return [monTs, nowTs, `自然周 (${formatMdDash(monTs, tzH)} 00:00 起)`, 'daily'];
  }
  if (preset === 'today') {
    const dayTs = startOfDayTs(nowTs, tzH);
    return [dayTs, nowTs, `今日 (${formatMdDash(dayTs, tzH)} 00:00 起)`, 'hourly'];
  }
  if (preset === 'last_24h') {
    return [nowTs - 86400, nowTs, '最近 24 小时', 'hourly'];
  }
  if (preset === 'last_5h') {
    return [nowTs - 5 * 3600, nowTs, '最近 5 小时滚动窗口', 'hourly_15m'];
  }
  if (preset === 'last_1h') {
    return [nowTs - 3600, nowTs, '最近 1 小时', 'minute_5m'];
  }
  if (preset === 'custom' && customStart) {
    const sts = parseIsoWithDefaultTz(customStart, tzH);
    if (Number.isFinite(sts)) {
      const ets = customEnd ? parseIsoWithDefaultTz(customEnd, tzH) : nowTs;
      const finalEnd = Number.isFinite(ets) ? ets : nowTs;
      const span = finalEnd - sts;
      const gran = span > 36 * 3600 ? 'daily' : span > 6 * 3600 ? 'hourly' : 'hourly_15m';
      return [sts, finalEnd, `${formatMdHm(sts, tzH)} ~ ${formatMdHm(finalEnd, tzH)}`, gran];
    }
  }
  return [0.0, nowTs, '全部历史记录', 'daily'];
}

export function computePayload(store, preset = 'last_7d', customStart = null, customEnd = null, tzHours = null) {
  const { allRecords, allImgs, metaMap, dbCount, reparsed, scanMs } = store.snapshot();
  const tzH = tzHours ?? getLocalTzHours();
  const nowTs = Date.now() / 1000;
  const [startTs, endTs, rangeLabel, granularity] = resolveTimeBounds(preset, customStart, customEnd, tzH);

  const recs = [];
  for (let i = 0; i < allRecords.length; i += 1) {
    const r = allRecords[i];
    if (r[0] >= startTs && r[0] <= endTs) recs.push(r);
  }
  const imgs = [];
  for (let i = 0; i < allImgs.length; i += 1) {
    const x = allImgs[i];
    if (x[0] >= startTs && x[0] <= endTs) imgs.push(x);
  }

  const activeSet5m = new Set();
  let recent15mTokens = 0;
  let recent15mPromo = 0.0;
  for (let i = 0; i < allRecords.length; i += 1) {
    const r = allRecords[i];
    const age = nowTs - r[0];
    if (age <= 300) activeSet5m.add(r[1]);
    if (age <= 900) {
      recent15mTokens += r[5] + r[6] + r[7];
      const [pIn, pCa, pOut] = getPricing(r[4], r[3]);
      recent15mPromo += (r[5] / 1e6) * pIn + (r[6] / 1e6) * pCa + (r[7] / 1e6) * pOut;
    }
  }
  const activeConvs5m = activeSet5m.size;

  const byModel = new Map();
  let totIn = 0;
  let totCa = 0;
  let totOut = 0;
  let totTh = 0;
  let totRe = 0;
  let totPIn = 0.0;
  let totPCa = 0.0;
  let totPOut = 0.0;
  let totSIn = 0.0;
  let totSCa = 0.0;
  let totSOut = 0.0;
  let totNcP = 0.0;
  let totNcS = 0.0;

  for (const r of recs) {
    const [, cid, , mid, mname, inp, ca, out, th, resp] = r;
    const [pIn, pCa, pOut, sIn, sCa, sOut] = getPricing(mname, mid);
    const cPIn = (inp / 1e6) * pIn;
    const cPCa = (ca / 1e6) * pCa;
    const cPOut = (out / 1e6) * pOut;
    const cP = cPIn + cPCa + cPOut;

    const cSIn = (inp / 1e6) * sIn;
    const cSCa = (ca / 1e6) * sCa;
    const cSOut = (out / 1e6) * sOut;
    const cS = cSIn + cSCa + cSOut;

    const ncP = ((inp + ca) / 1e6) * pIn + cPOut;
    const ncS = ((inp + ca) / 1e6) * sIn + cSOut;

    let s = byModel.get(mname);
    if (!s) {
      s = {
        name: mname,
        model_id: mid,
        calls: 0,
        convs: new Set(),
        in: 0,
        cache: 0,
        out: 0,
        think: 0,
        resp: 0,
        total: 0,
        promo: 0.0,
        promo_in: 0.0,
        promo_ca: 0.0,
        promo_out: 0.0,
        std: 0.0,
        nc_promo: 0.0,
        nc_std: 0.0,
      };
      byModel.set(mname, s);
    }

    s.calls += 1;
    s.convs.add(cid);
    s.in += inp;
    s.cache += ca;
    s.out += out;
    s.think += th;
    s.resp += resp;
    s.total += inp + ca + out;
    s.promo += cP;
    s.promo_in += cPIn;
    s.promo_ca += cPCa;
    s.promo_out += cPOut;
    s.std += cS;
    s.nc_promo += ncP;
    s.nc_std += ncS;

    totIn += inp;
    totCa += ca;
    totOut += out;
    totTh += th;
    totRe += resp;
    totPIn += cPIn;
    totPCa += cPCa;
    totPOut += cPOut;
    totSIn += cSIn;
    totSCa += cSCa;
    totSOut += cSOut;
    totNcP += ncP;
    totNcS += ncS;
  }

  const sortedModels = Array.from(byModel.values()).sort((a, b) => b.total - a.total);
  const modelsList = sortedModels.map((s, idx) => ({
    name: s.name,
    model_id: s.model_id,
    calls: s.calls,
    conv_count: s.convs.size,
    in: s.in,
    cache: s.cache,
    out: s.out,
    think: s.think,
    resp: s.resp,
    total: s.total,
    promo: roundTo(s.promo, 4),
    promo_in: roundTo(s.promo_in, 4),
    promo_ca: roundTo(s.promo_ca, 4),
    promo_out: roundTo(s.promo_out, 4),
    std: roundTo(s.std, 4),
    nc_promo: roundTo(s.nc_promo, 4),
    nc_std: roundTo(s.nc_std, 4),
    color: getColor(s.name, idx),
  }));

  // Trend series
  const buckets = new Map();
  const makeBucket = (key, label) => ({
    key,
    label,
    calls: 0,
    imgs: 0,
    in: 0,
    cache: 0,
    out: 0,
    total: 0,
    promo: 0.0,
    std: 0.0,
    nc_promo: 0.0,
    nc_std: 0.0,
  });

  if (granularity === 'daily' && recs.length > 0) {
    let minRecTs = recs[0][0];
    for (let i = 1; i < recs.length; i += 1) {
      if (recs[i][0] < minRecTs) minRecTs = recs[i][0];
    }
    let curDay = startOfDayTs(Math.max(startTs, minRecTs), tzH);
    const maxDay = startOfDayTs(endTs, tzH);
    while (curDay <= maxDay + 1) {
      const key = formatYmd(curDay, tzH);
      buckets.set(key, makeBucket(key, formatMd(curDay, tzH)));
      curDay += 86400;
    }
  } else if (granularity === 'hourly') {
    let curHour = startOfHourTs(startTs, tzH);
    while (curHour <= endTs + 0.001) {
      const key = formatYmdHour00(curHour, tzH);
      buckets.set(key, makeBucket(key, formatHour00(curHour, tzH)));
      curHour += 3600;
    }
  } else if (granularity === 'hourly_15m') {
    let curT = Math.floor(startTs / 900) * 900;
    while (curT <= endTs) {
      const key = String(curT);
      buckets.set(key, makeBucket(key, formatHm(curT, tzH)));
      curT += 900;
    }
  } else if (granularity === 'minute_5m') {
    let curT = Math.floor(startTs / 300) * 300;
    while (curT <= endTs) {
      const key = String(curT);
      buckets.set(key, makeBucket(key, formatHm(curT, tzH)));
      curT += 300;
    }
  }

  const bucketKeyForTs = (ts) => {
    if (granularity === 'daily') return formatYmd(ts, tzH);
    if (granularity === 'hourly') return formatYmdHour00(ts, tzH);
    if (granularity === 'hourly_15m') return String(Math.floor(ts / 900) * 900);
    return String(Math.floor(ts / 300) * 300);
  };

  for (const r of recs) {
    const [ts, , , mid, mname, inp, ca, out] = r;
    const k = bucketKeyForTs(ts);
    let b = buckets.get(k);
    if (!b) {
      b = makeBucket(k, granularity === 'daily' ? formatMd(ts, tzH) : formatHm(ts, tzH));
      buckets.set(k, b);
    }
    const [pIn, pCa, pOut, sIn, sCa, sOut] = getPricing(mname, mid);
    const cP = (inp / 1e6) * pIn + (ca / 1e6) * pCa + (out / 1e6) * pOut;
    const cS = (inp / 1e6) * sIn + (ca / 1e6) * sCa + (out / 1e6) * sOut;
    b.calls += 1;
    b.in += inp;
    b.cache += ca;
    b.out += out;
    b.total += inp + ca + out;
    b.promo += cP;
    b.std += cS;
    b.nc_promo += ((inp + ca) / 1e6) * pIn + (out / 1e6) * pOut;
    b.nc_std += ((inp + ca) / 1e6) * sIn + (out / 1e6) * sOut;
  }

  for (const [ts] of imgs) {
    const k = bucketKeyForTs(ts);
    const b = buckets.get(k);
    if (b) b.imgs += 1;
  }

  const trendList = Array.from(buckets.keys())
    .sort()
    .map((k) => {
      const b = buckets.get(k);
      return {
        ...b,
        promo: roundTo(b.promo, 2),
        std: roundTo(b.std, 2),
        nc_promo: roundTo(b.nc_promo, 2),
        nc_std: roundTo(b.nc_std, 2),
      };
    });

  // Root conversation window breakdown
  const byRoot = new Map();
  for (const r of recs) {
    const [ts, cid, , mid, mname, inp, ca, out] = r;
    const [, pid] = metaMap.get(cid) || ['', '', ''];
    const rid = pid || cid;
    const rtitle = (metaMap.get(rid) || ['', '', ''])[0] || rid.slice(0, 8);
    let w = byRoot.get(rid);
    if (!w) {
      w = {
        id: rid,
        title: rtitle,
        calls: 0,
        imgs: 0,
        in: 0,
        cache: 0,
        out: 0,
        total: 0,
        promo: 0.0,
        std: 0.0,
        nc_promo: 0.0,
        nc_std: 0.0,
        models: new Set(),
        last_ts: 0,
      };
      byRoot.set(rid, w);
    }
    const [pIn, pCa, pOut, sIn, sCa, sOut] = getPricing(mname, mid);
    const cP = (inp / 1e6) * pIn + (ca / 1e6) * pCa + (out / 1e6) * pOut;
    const cS = (inp / 1e6) * sIn + (ca / 1e6) * sCa + (out / 1e6) * sOut;
    w.calls += 1;
    w.in += inp;
    w.cache += ca;
    w.out += out;
    w.total += inp + ca + out;
    w.promo += cP;
    w.std += cS;
    w.nc_promo += ((inp + ca) / 1e6) * pIn + (out / 1e6) * pOut;
    w.nc_std += ((inp + ca) / 1e6) * sIn + (out / 1e6) * sOut;
    w.models.add(mname);
    if (ts > w.last_ts) w.last_ts = ts;
  }

  for (const [, cid] of imgs) {
    const [, pid] = metaMap.get(cid) || ['', '', ''];
    const rid = pid || cid;
    const w = byRoot.get(rid);
    if (w) w.imgs += 1;
  }

  const windowsList = Array.from(byRoot.values())
    .sort((a, b) => b.total - a.total)
    .map((w, idx) => {
      const imgFee = w.imgs * IMAGE_GEN_UNIT_COST;
      return {
        id: w.id,
        title: w.title,
        calls: w.calls,
        imgs: w.imgs,
        in: w.in,
        cache: w.cache,
        out: w.out,
        total: w.total,
        promo: roundTo(w.promo + imgFee, 2),
        std: roundTo(w.std + imgFee, 2),
        nc_promo: roundTo(w.nc_promo + imgFee, 2),
        nc_std: roundTo(w.nc_std + imgFee, 2),
        models: Array.from(w.models).sort(),
        last_time: w.last_ts ? formatMdHms(w.last_ts, tzH) : '',
        color: WIN_COLORS[idx % WIN_COLORS.length],
      };
    });

  // Recent live calls feed (newest 30 calls)
  const newestRecs = recs.slice().sort((a, b) => b[0] - a[0]).slice(0, 30);
  const recentCalls = newestRecs.map((r) => {
    const [ts, cid, , mid, mname, inp, ca, out, th] = r;
    const [, pid, aname] = metaMap.get(cid) || ['', '', ''];
    const rid = pid || cid;
    let rtitle = (metaMap.get(rid) || ['', '', ''])[0] || cid.slice(0, 8);
    if (pid && aname) rtitle = `${rtitle} [${aname}]`;

    const [pIn, pCa, pOut, sIn, sCa, sOut] = getPricing(mname, mid);
    const cP = (inp / 1e6) * pIn + (ca / 1e6) * pCa + (out / 1e6) * pOut;
    const cS = (inp / 1e6) * sIn + (ca / 1e6) * sCa + (out / 1e6) * sOut;
    const cNcP = ((inp + ca) / 1e6) * pIn + (out / 1e6) * pOut;
    const cNcS = ((inp + ca) / 1e6) * sIn + (out / 1e6) * sOut;

    return {
      ts,
      time_str: formatHms(ts, tzH),
      date_str: formatMdHms(ts, tzH),
      window: rtitle,
      model: mname,
      in: inp,
      cache: ca,
      out: out,
      think: th,
      total: inp + ca + out,
      promo: roundTo(cP, 4),
      std: roundTo(cS, 4),
      nc_promo: roundTo(cNcP, 4),
      nc_std: roundTo(cNcS, 4),
      color: getColor(mname),
    };
  });

  const totInAll = totIn + totCa;
  const cacheHitRate = totInAll > 0 ? (totCa / totInAll) * 100.0 : 0.0;
  const promoLlm = totPIn + totPCa + totPOut;
  const stdLlm = totSIn + totSCa + totSOut;
  const imgCost = imgs.length * IMAGE_GEN_UNIT_COST;
  const grandTotal = totIn + totCa + totOut;

  let startStr = '-';
  if (startTs > 0) {
    startStr = formatYmdHm(startTs, tzH);
  } else if (recs.length > 0) {
    let earliestTs = recs[0][0];
    for (let i = 1; i < recs.length; i += 1) {
      if (recs[i][0] < earliestTs) earliestTs = recs[i][0];
    }
    startStr = formatYmdHm(earliestTs, tzH);
  }

  const subagentSet = new Set();
  for (const r of recs) {
    if ((metaMap.get(r[1]) || ['', '', ''])[1]) subagentSet.add(r[1]);
  }

  return {
    meta: {
      preset,
      range_label: rangeLabel,
      granularity,
      start_str: startStr,
      end_str: formatYmdHms(endTs, tzH),
      server_time: formatHms(nowTs, tzH),
      db_count: dbCount,
      reparsed,
      scan_ms: scanMs,
      active_convs_5m: activeConvs5m,
    },
    summary: {
      calls: recs.length,
      imgs: imgs.length,
      img_cost: roundTo(imgCost, 2),
      in: totIn,
      cache: totCa,
      out: totOut,
      think: totTh,
      resp: totRe,
      grand_total: grandTotal,
      cache_hit_rate: roundTo(cacheHitRate, 1),
      promo_in: roundTo(totPIn, 2),
      promo_ca: roundTo(totPCa, 2),
      promo_out: roundTo(totPOut, 2),
      promo_llm: roundTo(promoLlm, 2),
      promo_total: roundTo(promoLlm + imgCost, 2),
      std_llm: roundTo(stdLlm, 2),
      std_total: roundTo(stdLlm + imgCost, 2),
      nc_promo_llm: roundTo(totNcP, 2),
      nc_promo_total: roundTo(totNcP + imgCost, 2),
      nc_std_llm: roundTo(totNcS, 2),
      nc_std_total: roundTo(totNcS + imgCost, 2),
      saved_promo: roundTo(totNcP - promoLlm, 2),
      saved_std: roundTo(totNcS - stdLlm, 2),
      burn_tok_per_min: Math.round(recent15mTokens / 15.0),
      burn_usd_per_hr: roundTo(recent15mPromo * 4.0, 2),
      root_windows_count: windowsList.length,
      subagents_count: subagentSet.size,
    },
    models: modelsList,
    trend: trendList,
    windows: windowsList,
    recent_calls: recentCalls,
  };
}

function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(payload) {
  const rows = [];
  rows.push(['统计区间', `${payload.meta.start_str} ~ ${payload.meta.end_str}`]);
  rows.push([]);
  rows.push(['模型名称', '调用次数', '新增输入', '缓存读取', '总输出', '思考Token', '总计Token', '促销优惠价($)', '标准原价($)', '无缓存等效($)']);
  for (const m of payload.models) {
    rows.push([m.name, m.calls, m.in, m.cache, m.out, m.think, m.total, m.promo, m.std, m.nc_promo]);
  }
  const s = payload.summary;
  rows.push(['原生生图(generate_image)', s.imgs, 0, 0, 0, 0, 0, s.img_cost, s.img_cost, s.img_cost]);
  rows.push(['合计', s.calls + s.imgs, s.in, s.cache, s.out, s.think, s.grand_total, s.promo_total, s.std_total, s.nc_promo_total]);
  rows.push([]);
  rows.push(['时间段', '调用次数', '生图数', '新增输入', '缓存读取', '输出', '总Token', '促销优惠价($)', '标准原价($)']);
  for (const d of payload.trend) {
    rows.push([d.key, d.calls, d.imgs, d.in, d.cache, d.out, d.total, d.promo, d.std]);
  }
  const body = `\ufeff${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  return Buffer.from(body, 'utf8');
}

export async function isTokenMonitorHealthy(host = '127.0.0.1', port = 18923, timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: '/api/health', timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(res.statusCode === 200 && data.includes('"ok":true'));
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function tryStartPythonFallback(host, port) {
  if (!fs.existsSync(PYTHON_SERVER_PATH)) {
    return { ok: false, error: 'monitor_server.py not found' };
  }
  for (const pyBin of ['python', 'python3', 'py']) {
    try {
      const child = spawn(pyBin, [PYTHON_SERVER_PATH, '--host', host, '--port', String(port)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      for (let i = 0; i < 15; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        if (await isTokenMonitorHealthy(host, port, 500)) {
          return { ok: true, backend: 'python', pid: child.pid, host, port };
        }
      }
    } catch {
      // try next python binary
    }
  }
  return { ok: false, error: 'Neither node:sqlite nor Python fallback could start Token Monitor' };
}

export async function startTokenMonitorServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 18923);
  const unref = Boolean(options.unref);

  if (await isTokenMonitorHealthy(host, port, 500)) {
    return { ok: true, alreadyRunning: true, host, port, backend: 'existing' };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return tryStartPythonFallback(host, port);
  }

  const store = new TelemetryStore(DatabaseSync);
  try {
    store.snapshot();
  } catch {
    // non-fatal warm-up
  }

  const server = http.createServer((req, res) => {
    const send = (code, contentType, bodyBuf, extraHeaders = {}) => {
      res.writeHead(code, {
        'Content-Type': contentType,
        'Content-Length': bodyBuf.length,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        ...extraHeaders,
      });
      res.end(bodyBuf);
    };

    try {
      const urlObj = new URL(req.url || '/', `http://${host}:${port}`);
      const pathname = urlObj.pathname;
      const preset = urlObj.searchParams.get('preset') || 'last_7d';
      const customStart = urlObj.searchParams.get('start');
      const customEnd = urlObj.searchParams.get('end');
      const tzRaw = urlObj.searchParams.get('tz');
      let tzHours = null;
      if (tzRaw && tzRaw !== 'local') {
        const parsedTz = Number(tzRaw);
        if (Number.isFinite(parsedTz)) tzHours = parsedTz;
      }

      if (pathname === '/' || pathname === '/index.html') {
        try {
          const htmlBuf = fs.readFileSync(INDEX_HTML_PATH);
          send(200, 'text/html; charset=utf-8', htmlBuf);
        } catch (err) {
          send(500, 'text/plain; charset=utf-8', Buffer.from(String(err.message || err), 'utf8'));
        }
        return;
      }

      if (pathname === '/api/health') {
        send(200, 'application/json; charset=utf-8', Buffer.from('{"ok":true}', 'utf8'));
        return;
      }

      if (pathname === '/api/stats') {
        const payload = computePayload(store, preset, customStart, customEnd, tzHours);
        send(200, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(payload), 'utf8'));
        return;
      }

      if (pathname === '/api/export.csv') {
        const payload = computePayload(store, preset, customStart, customEnd, tzHours);
        const csvBuf = buildCsv(payload);
        send(200, 'text/csv; charset=utf-8', csvBuf, {
          'Content-Disposition': 'attachment; filename="antigravity_token_report.csv"',
        });
        return;
      }

      send(404, 'text/plain; charset=utf-8', Buffer.from('Not Found', 'utf8'));
    } catch (err) {
      send(500, 'application/json; charset=utf-8', Buffer.from(JSON.stringify({ ok: false, error: err.message }), 'utf8'));
    }
  });

  return new Promise((resolve) => {
    let retriesLeft = 3;
    server.on('error', async (err) => {
      if (err && err.code === 'EADDRINUSE') {
        if (retriesLeft > 0) {
          retriesLeft -= 1;
          await new Promise((r) => setTimeout(r, 350));
          const stillHealthy = await isTokenMonitorHealthy(host, port, 400);
          if (stillHealthy) {
            resolve({ ok: true, alreadyRunning: true, host, port, backend: 'existing' });
            return;
          }
          try {
            server.listen(port, host);
            return;
          } catch {
            // fall through to resolve false
          }
        }
        const healthy = await isTokenMonitorHealthy(host, port, 600);
        if (healthy) {
          resolve({ ok: true, alreadyRunning: true, host, port, backend: 'existing' });
          return;
        }
      }
      resolve({ ok: false, error: err?.message || String(err), host, port });
    });

    server.listen(port, host, () => {
      if (unref) server.unref();
      resolve({ ok: true, alreadyRunning: false, host, port, backend: 'node:sqlite', server });
    });
  });
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  let host = '127.0.0.1';
  let port = 18923;
  let daemon = false;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--host' && args[i + 1]) {
      host = args[i + 1];
      i += 1;
    } else if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[i + 1]) || 18923;
      i += 1;
    } else if (args[i] === '--daemon') {
      daemon = true;
    }
  }

  const pidFile = path.join(os.homedir(), '.gemini', 'antigravity', 'token-monitor', 'server.pid');
  startTokenMonitorServer({ host, port, unref: false }).then((res) => {
    if (!res.ok) {
      console.error(`[token-monitor] 启动失败: ${res.error}`);
      process.exit(1);
    }
    if (res.server && daemon) {
      try {
        fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        fs.writeFileSync(pidFile, String(process.pid), 'utf8');
      } catch {
        // ignore
      }
      const cleanupPid = () => {
        try {
          if (fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) {
            fs.unlinkSync(pidFile);
          }
        } catch {
          // ignore
        }
        process.exit(0);
      };
      process.on('SIGINT', cleanupPid);
      process.on('SIGTERM', cleanupPid);
    }
    if (!daemon) {
      console.log(`Antigravity Token Monitor (${res.backend}) listening on http://${host}:${port}`);
    }
  });
}
