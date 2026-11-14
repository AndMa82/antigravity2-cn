#!/usr/bin/env python3
"""
Antigravity Token & API Value Real-Time Telemetry Server
Reads local Antigravity SQLite conversation DBs (including WAL) with mtime caching,
computes per-model token usage, API valuation, hourly/daily trends, window rankings,
and live call feeds, and serves both REST JSON APIs and the live dashboard UI.
"""

import argparse
import csv
import datetime
import glob
import io
import json
import os
import sqlite3
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONVERSATIONS_DIR = os.path.expanduser("~/.gemini/antigravity/conversations")
SUMMARIES_DB_PATH = os.path.expanduser("~/.gemini/antigravity/conversation_summaries.db")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_HTML_PATH = os.path.join(SCRIPT_DIR, "index.html")

ENUM_TO_NAME = {
    1318: "Gemini 3.8 Flash (High)",
    1319: "Gemini 3.8 Flash (Medium)",
    1320: "Gemini 3.8 Flash (Low)",
    1322: "Gemini 3.8 Flash Tiered",
    1401: "Claude Opus 5.5 (Medium)",
    1402: "Claude Opus 5.5 (High)",
    1403: "Claude Opus 5.5 (Low)",
    1404: "Claude Sonnet 5.5 (Medium)",
    1405: "Claude Sonnet 5.5 (High)",
    1417: "Gemini 4 Argon (High)",
    1418: "Gemini 4 Argon (Medium)",
    1419: "Gemini 4 Argon (Low)",
    1427: "Gemini 4 Carbon (High)",
    1428: "Gemini 4 Carbon (Medium)",
    1525: "Gemini 4 Hydrogen (High)",
    1526: "Gemini 4 Hydrogen (Medium)",
    1528: "Gemini 4 Hydrogen (XHigh)",
}

# Per 1M tokens: (promo_in, promo_cache, promo_out, std_in, std_cache, std_out)
PRICING = {
    "Gemini 4 Argon (High)":      (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Gemini 4 Argon (Medium)":    (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Gemini 4 Argon (Low)":       (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Gemini 4 Carbon (High)":     (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Gemini 4 Carbon (Medium)":   (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Gemini 4 Hydrogen (High)":   (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Gemini 4 Hydrogen (Medium)": (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Gemini 4 Hydrogen (XHigh)":  (2.00, 0.10, 10.00, 4.00, 0.20, 20.00),
    "Claude Opus 5.5 (Medium)":   (4.00, 0.20, 20.00, 4.00, 0.20, 20.00),
    "Claude Opus 5.5 (High)":     (4.00, 0.20, 20.00, 4.00, 0.20, 20.00),
    "Claude Opus 5.5 (Low)":      (4.00, 0.20, 20.00, 4.00, 0.20, 20.00),
    "Claude Sonnet 5.5 (Medium)": (3.00, 0.30, 15.00, 3.00, 0.30, 15.00),
    "Claude Sonnet 5.5 (High)":   (3.00, 0.30, 15.00, 3.00, 0.30, 15.00),
    "Gemini 3.8 Flash Tiered":    (0.75, 0.075, 3.75, 1.50, 0.15, 7.50),
    "Gemini 3.8 Flash (High)":    (0.75, 0.075, 3.75, 1.50, 0.15, 7.50),
    "Gemini 3.8 Flash (Medium)":  (0.75, 0.075, 3.75, 1.50, 0.15, 7.50),
    "Gemini 3.8 Flash (Low)":     (0.75, 0.075, 3.75, 1.50, 0.15, 7.50),
}

MODEL_COLORS = {
    "Gemini 4 Argon (High)":      "#6366f1",
    "Gemini 4 Carbon (High)":     "#10b981",
    "Gemini 4 Hydrogen (High)":   "#06b6d4",
    "Claude Opus 5.5 (Medium)":   "#f59e0b",
    "Claude Opus 5.5 (High)":     "#ea580c",
    "Gemini 4 Argon (Medium)":    "#8b5cf6",
    "Gemini 3.8 Flash Tiered":    "#ec4899",
    "Gemini 4 Hydrogen (XHigh)":  "#3b82f6",
    "Gemini 3.8 Flash (High)":    "#14b8a6",
    "Gemini 3.8 Flash (Medium)":  "#2dd4bf",
    "Claude Sonnet 5.5 (Medium)": "#fb923c",
}
FALLBACK_PALETTE = ["#a855f7", "#22d3ee", "#84cc16", "#f43f5e", "#eab308", "#38bdf8"]
IMAGE_GEN_UNIT_COST = 0.04


def parse_varint(data, i):
    val = 0
    shift = 0
    n = len(data)
    while i < n:
        b = data[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return val, i


def parse_proto_dict(data):
    i = 0
    n = len(data)
    res = {}
    while i < n:
        tag, i = parse_varint(data, i)
        fn = tag >> 3
        wt = tag & 7
        if wt == 0:
            val, i = parse_varint(data, i)
        elif wt == 1:
            val = data[i : i + 8]
            i += 8
        elif wt == 2:
            ln, i = parse_varint(data, i)
            val = data[i : i + ln]
            i += ln
        elif wt == 5:
            val = data[i : i + 4]
            i += 4
        else:
            break
        res.setdefault(fn, []).append(val)
    return res


def get_pricing(model_name, model_id=""):
    if model_name in PRICING:
        return PRICING[model_name]
    low = (model_name + " " + model_id).lower()
    if "opus" in low:
        return (4.00, 0.20, 20.00, 4.00, 0.20, 20.00)
    if "sonnet" in low:
        return (3.00, 0.30, 15.00, 3.00, 0.30, 15.00)
    if "flash" in low:
        return (0.75, 0.075, 3.75, 1.50, 0.15, 7.50)
    return (2.00, 0.10, 10.00, 4.00, 0.20, 20.00)


def get_color(model_name, idx=0):
    if model_name in MODEL_COLORS:
        return MODEL_COLORS[model_name]
    return FALLBACK_PALETTE[idx % len(FALLBACK_PALETTE)]


class TelemetryStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._db_cache = {}  # db_path -> (signature, records, img_events)
        self._summary_sig = None
        self._meta_map = {}

    def _file_sig(self, path):
        try:
            st = os.stat(path)
            sig1 = (st.st_mtime_ns, st.st_size)
        except OSError:
            sig1 = (0, 0)
        wal = path + "-wal"
        try:
            st2 = os.stat(wal)
            sig2 = (st2.st_mtime_ns, st2.st_size)
        except OSError:
            sig2 = (0, 0)
        return (sig1, sig2)

    def _refresh_summaries(self):
        sig = self._file_sig(SUMMARIES_DB_PATH)
        if sig == self._summary_sig and self._meta_map:
            return
        try:
            con = sqlite3.connect(f"file:{SUMMARIES_DB_PATH}?mode=ro", uri=True, timeout=1.5)
            cur = con.cursor()
            cur.execute("SELECT conversation_id, title, parent_conversation_id, agent_name FROM conversation_summaries")
            meta = {}
            for cid, title, pid, aname in cur.fetchall():
                meta[cid] = (title or "", pid or "", aname or "")
            con.close()
            self._meta_map = meta
            self._summary_sig = sig
        except Exception:
            pass

    def _parse_single_db(self, db_path):
        cid = os.path.basename(db_path)[:-3]
        records = []
        img_events = []
        con = None
        try:
            con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=1.5)
            cur = con.cursor()
            step_map = {}
            step_idx_ts = {}
            cur.execute("SELECT idx, step_type, metadata FROM steps WHERE metadata IS NOT NULL")
            for idx, st, meta in cur.fetchall():
                d = parse_proto_dict(meta)
                ts = parse_proto_dict(d[1][0]).get(1, [0])[0] if 1 in d else 0
                step_idx_ts[idx] = ts
                if 4 in d:
                    t4 = parse_proto_dict(d[4][0])
                    tname = t4.get(2, [b""])[0].decode(errors="ignore")
                    if tname == "generate_image":
                        img_events.append((ts, cid))
                if 9 in d:
                    u9 = parse_proto_dict(d[9][0])
                    bot_id = u9[7][0].decode(errors="ignore") if 7 in u9 else f"step_{idx}"
                    step_map[bot_id] = (ts, idx, st, u9)

            cur.execute("SELECT idx, data FROM gen_metadata")
            seen_bots = set()
            for gidx, blob in cur.fetchall():
                d = parse_proto_dict(blob)
                if 1 not in d:
                    continue
                m1 = parse_proto_dict(d[1][0])
                u4 = parse_proto_dict(m1[4][0]) if 4 in m1 else {}
                bot_id = u4[7][0].decode(errors="ignore") if 7 in u4 else f"gen_{gidx}"
                seen_bots.add(bot_id)
                me = m1.get(3, [0])[0] or u4.get(1, [0])[0]
                mid = m1[19][0].decode(errors="ignore") if 19 in m1 else ""
                mn = m1[21][0].decode(errors="ignore") if 21 in m1 else ""
                kv = {}
                for item in m1.get(20, []):
                    kvd = parse_proto_dict(item)
                    if 1 in kvd and 2 in kvd:
                        kv[kvd[1][0].decode(errors="ignore")] = kvd[2][0].decode(errors="ignore")
                if bot_id in step_map:
                    ts = step_map[bot_id][0]
                else:
                    last_sidx = int(kv.get("last_step_index", -1))
                    ts = step_idx_ts.get(last_sidx, step_idx_ts.get(last_sidx + 1, 0))
                inp = u4.get(2, [0])[0]
                out = u4.get(3, [0])[0]
                cache = u4.get(5, [0])[0]
                think = u4.get(9, [0])[0]
                resp = u4.get(10, [0])[0]
                mname = ENUM_TO_NAME.get(me) or mn or mid or f"Unknown({me})"
                records.append((ts, cid, me, mid, mname, inp, cache, out, think, resp))

            for bot_id, (ts, sidx, st, u9) in step_map.items():
                if bot_id not in seen_bots:
                    me = u9.get(1, [0])[0]
                    inp = u9.get(2, [0])[0]
                    out = u9.get(3, [0])[0]
                    cache = u9.get(5, [0])[0]
                    think = u9.get(9, [0])[0]
                    resp = u9.get(10, [0])[0]
                    mname = ENUM_TO_NAME.get(me) or f"Unknown({me})"
                    records.append((ts, cid, me, "", mname, inp, cache, out, think, resp))
        except Exception:
            pass
        finally:
            if con is not None:
                try:
                    con.close()
                except Exception:
                    pass
        return records, img_events

    def snapshot(self):
        t0 = time.perf_counter()
        with self._lock:
            self._refresh_summaries()
            db_paths = glob.glob(os.path.join(CONVERSATIONS_DIR, "*.db"))
            current_set = set(db_paths)
            for stale in list(self._db_cache.keys()):
                if stale not in current_set:
                    del self._db_cache[stale]

            reparsed = 0
            all_records = []
            all_imgs = []
            for p in db_paths:
                sig = self._file_sig(p)
                cached = self._db_cache.get(p)
                if cached is not None and cached[0] == sig:
                    recs, imgs = cached[1], cached[2]
                else:
                    recs, imgs = self._parse_single_db(p)
                    self._db_cache[p] = (sig, recs, imgs)
                    reparsed += 1
                all_records.extend(recs)
                all_imgs.extend(imgs)

            meta_map = dict(self._meta_map)
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        return all_records, all_imgs, meta_map, len(db_paths), reparsed, elapsed_ms


STORE = TelemetryStore()


def get_local_tz_hours():
    offset = datetime.datetime.now().astimezone().utcoffset()
    if offset is None:
        return 0.0
    return offset.total_seconds() / 3600.0


def resolve_time_bounds(preset, custom_start=None, custom_end=None, tz_hours=None):
    if tz_hours is None:
        tz_hours = get_local_tz_hours()
    tz = datetime.timezone(datetime.timedelta(hours=tz_hours))
    now_dt = datetime.datetime.now(tz)
    now_ts = now_dt.timestamp()

    if preset == "last_7d":
        return now_ts - 7 * 86400, now_ts, "最近 7 天", "daily"
    if preset == "since_reset":
        env_reset = os.environ.get("ANTIGRAVITY_RESET_AT", "").strip()
        if env_reset:
            try:
                rdt = datetime.datetime.fromisoformat(env_reset)
                if rdt.tzinfo is None:
                    rdt = rdt.replace(tzinfo=tz)
                return rdt.timestamp(), now_ts, f"本周期 ({rdt.strftime('%m-%d %H:%M')} 起)", "daily"
            except Exception:
                pass
        days_since_mon = now_dt.weekday()
        mon_dt = (now_dt - datetime.timedelta(days=days_since_mon)).replace(hour=0, minute=0, second=0, microsecond=0)
        return mon_dt.timestamp(), now_ts, f"本周周期 ({mon_dt.strftime('%m-%d')} 00:00 起)", "daily"
    if preset == "since_monday":
        days_since_mon = now_dt.weekday()
        mon_dt = (now_dt - datetime.timedelta(days=days_since_mon)).replace(hour=0, minute=0, second=0, microsecond=0)
        return mon_dt.timestamp(), now_ts, f"自然周 ({mon_dt.strftime('%m-%d')} 00:00 起)", "daily"
    if preset == "today":
        day_dt = now_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        return day_dt.timestamp(), now_ts, f"今日 ({day_dt.strftime('%m-%d')} 00:00 起)", "hourly"
    if preset == "last_24h":
        return now_ts - 86400, now_ts, "最近 24 小时", "hourly"
    if preset == "last_5h":
        return now_ts - 5 * 3600, now_ts, "最近 5 小时滚动窗口", "hourly_15m"
    if preset == "last_1h":
        return now_ts - 3600, now_ts, "最近 1 小时", "minute_5m"
    if preset == "custom" and custom_start:
        try:
            sdt = datetime.datetime.fromisoformat(custom_start)
            if sdt.tzinfo is None:
                sdt = sdt.replace(tzinfo=tz)
            edt = datetime.datetime.fromisoformat(custom_end) if custom_end else now_dt
            if edt.tzinfo is None:
                edt = edt.replace(tzinfo=tz)
            span = edt.timestamp() - sdt.timestamp()
            gran = "daily" if span > 36 * 3600 else ("hourly" if span > 6 * 3600 else "hourly_15m")
            return sdt.timestamp(), edt.timestamp(), f"{sdt.strftime('%m-%d %H:%M')} ~ {edt.strftime('%m-%d %H:%M')}", gran
        except Exception:
            pass
    # all_time fallback
    return 0.0, now_ts, "全部历史记录", "daily"


def compute_payload(preset="last_7d", custom_start=None, custom_end=None, tz_hours=None):
    all_records, all_imgs, meta_map, db_count, reparsed, scan_ms = STORE.snapshot()
    if tz_hours is None:
        tz_hours = get_local_tz_hours()
    tz = datetime.timezone(datetime.timedelta(hours=tz_hours))
    now_ts = time.time()
    start_ts, end_ts, range_label, granularity = resolve_time_bounds(preset, custom_start, custom_end, tz_hours)

    recs = [r for r in all_records if start_ts <= r[0] <= end_ts]
    imgs = [x for x in all_imgs if start_ts <= x[0] <= end_ts]

    # Active conversations in last 5 min across all records
    active_convs_5m = len({r[1] for r in all_records if now_ts - r[0] <= 300})
    # Burn rate over last 15 min (or active window)
    recent_15m_recs = [r for r in all_records if now_ts - r[0] <= 900]
    recent_15m_tokens = sum(r[5] + r[6] + r[7] for r in recent_15m_recs)
    recent_15m_promo = 0.0
    for r in recent_15m_recs:
        p_in, p_ca, p_out, *_ = get_pricing(r[4], r[3])
        recent_15m_promo += r[5] / 1e6 * p_in + r[6] / 1e6 * p_ca + r[7] / 1e6 * p_out

    # Per-model aggregation
    by_model = {}
    tot_in = tot_ca = tot_out = tot_th = tot_re = 0
    tot_p_in = tot_p_ca = tot_p_out = 0.0
    tot_s_in = tot_s_ca = tot_s_out = 0.0
    tot_nc_p = tot_nc_s = 0.0

    for r in recs:
        ts, cid, me, mid, mname, inp, ca, out, th, resp = r
        p_in, p_ca, p_out, s_in, s_ca, s_out = get_pricing(mname, mid)
        c_p_in = inp / 1e6 * p_in
        c_p_ca = ca / 1e6 * p_ca
        c_p_out = out / 1e6 * p_out
        c_p = c_p_in + c_p_ca + c_p_out

        c_s_in = inp / 1e6 * s_in
        c_s_ca = ca / 1e6 * s_ca
        c_s_out = out / 1e6 * s_out
        c_s = c_s_in + c_s_ca + c_s_out

        nc_p = (inp + ca) / 1e6 * p_in + c_p_out
        nc_s = (inp + ca) / 1e6 * s_in + c_s_out

        s = by_model.setdefault(
            mname,
            {
                "name": mname,
                "model_id": mid,
                "calls": 0,
                "convs": set(),
                "in": 0,
                "cache": 0,
                "out": 0,
                "think": 0,
                "resp": 0,
                "total": 0,
                "promo": 0.0,
                "promo_in": 0.0,
                "promo_ca": 0.0,
                "promo_out": 0.0,
                "std": 0.0,
                "nc_promo": 0.0,
                "nc_std": 0.0,
            },
        )
        s["calls"] += 1
        s["convs"].add(cid)
        s["in"] += inp
        s["cache"] += ca
        s["out"] += out
        s["think"] += th
        s["resp"] += resp
        s["total"] += inp + ca + out
        s["promo"] += c_p
        s["promo_in"] += c_p_in
        s["promo_ca"] += c_p_ca
        s["promo_out"] += c_p_out
        s["std"] += c_s
        s["nc_promo"] += nc_p
        s["nc_std"] += nc_s

        tot_in += inp
        tot_ca += ca
        tot_out += out
        tot_th += th
        tot_re += resp
        tot_p_in += c_p_in
        tot_p_ca += c_p_ca
        tot_p_out += c_p_out
        tot_s_in += c_s_in
        tot_s_ca += c_s_ca
        tot_s_out += c_s_out
        tot_nc_p += nc_p
        tot_nc_s += nc_s

    models_list = []
    sorted_models = sorted(by_model.values(), key=lambda x: -x["total"])
    for idx, s in enumerate(sorted_models):
        models_list.append(
            {
                "name": s["name"],
                "model_id": s["model_id"],
                "calls": s["calls"],
                "conv_count": len(s["convs"]),
                "in": s["in"],
                "cache": s["cache"],
                "out": s["out"],
                "think": s["think"],
                "resp": s["resp"],
                "total": s["total"],
                "promo": round(s["promo"], 4),
                "promo_in": round(s["promo_in"], 4),
                "promo_ca": round(s["promo_ca"], 4),
                "promo_out": round(s["promo_out"], 4),
                "std": round(s["std"], 4),
                "nc_promo": round(s["nc_promo"], 4),
                "nc_std": round(s["nc_std"], 4),
                "color": get_color(s["name"], idx),
            }
        )

    # Trend series (daily, hourly, 15m, or 5m depending on range)
    buckets = {}
    if granularity == "daily" and recs:
        min_d = datetime.datetime.fromtimestamp(max(start_ts, min(r[0] for r in recs)), tz=tz).date()
        max_d = datetime.datetime.fromtimestamp(end_ts, tz=tz).date()
        cur_d = min_d
        while cur_d <= max_d:
            key = cur_d.strftime("%Y-%m-%d")
            buckets[key] = {
                "key": key,
                "label": cur_d.strftime("%m/%d"),
                "calls": 0,
                "imgs": 0,
                "in": 0,
                "cache": 0,
                "out": 0,
                "total": 0,
                "promo": 0.0,
                "std": 0.0,
                "nc_promo": 0.0,
                "nc_std": 0.0,
            }
            cur_d += datetime.timedelta(days=1)
    elif granularity == "hourly":
        base_dt = datetime.datetime.fromtimestamp(start_ts, tz=tz).replace(minute=0, second=0, microsecond=0)
        end_dt = datetime.datetime.fromtimestamp(end_ts, tz=tz)
        while base_dt <= end_dt:
            key = base_dt.strftime("%Y-%m-%d %H:00")
            buckets[key] = {
                "key": key,
                "label": base_dt.strftime("%H:00"),
                "calls": 0,
                "imgs": 0,
                "in": 0,
                "cache": 0,
                "out": 0,
                "total": 0,
                "promo": 0.0,
                "std": 0.0,
                "nc_promo": 0.0,
                "nc_std": 0.0,
            }
            base_dt += datetime.timedelta(hours=1)
    elif granularity == "hourly_15m":
        start_bucket = int(start_ts // 900) * 900
        cur_t = start_bucket
        while cur_t <= end_ts:
            dt = datetime.datetime.fromtimestamp(cur_t, tz=tz)
            key = str(cur_t)
            buckets[key] = {
                "key": key,
                "label": dt.strftime("%H:%M"),
                "calls": 0,
                "imgs": 0,
                "in": 0,
                "cache": 0,
                "out": 0,
                "total": 0,
                "promo": 0.0,
                "std": 0.0,
                "nc_promo": 0.0,
                "nc_std": 0.0,
            }
            cur_t += 900
    elif granularity == "minute_5m":
        start_bucket = int(start_ts // 300) * 300
        cur_t = start_bucket
        while cur_t <= end_ts:
            dt = datetime.datetime.fromtimestamp(cur_t, tz=tz)
            key = str(cur_t)
            buckets[key] = {
                "key": key,
                "label": dt.strftime("%H:%M"),
                "calls": 0,
                "imgs": 0,
                "in": 0,
                "cache": 0,
                "out": 0,
                "total": 0,
                "promo": 0.0,
                "std": 0.0,
                "nc_promo": 0.0,
                "nc_std": 0.0,
            }
            cur_t += 300

    def bucket_key_for_ts(ts):
        if granularity == "daily":
            return datetime.datetime.fromtimestamp(ts, tz=tz).strftime("%Y-%m-%d")
        if granularity == "hourly":
            return datetime.datetime.fromtimestamp(ts, tz=tz).strftime("%Y-%m-%d %H:00")
        if granularity == "hourly_15m":
            return str(int(ts // 900) * 900)
        return str(int(ts // 300) * 300)

    for r in recs:
        ts, cid, me, mid, mname, inp, ca, out, th, resp = r
        k = bucket_key_for_ts(ts)
        if k not in buckets:
            dt = datetime.datetime.fromtimestamp(ts, tz=tz)
            buckets[k] = {
                "key": k,
                "label": dt.strftime("%m/%d") if granularity == "daily" else dt.strftime("%H:%M"),
                "calls": 0,
                "imgs": 0,
                "in": 0,
                "cache": 0,
                "out": 0,
                "total": 0,
                "promo": 0.0,
                "std": 0.0,
                "nc_promo": 0.0,
                "nc_std": 0.0,
            }
        b = buckets[k]
        p_in, p_ca, p_out, s_in, s_ca, s_out = get_pricing(mname, mid)
        c_p = inp / 1e6 * p_in + ca / 1e6 * p_ca + out / 1e6 * p_out
        c_s = inp / 1e6 * s_in + ca / 1e6 * s_ca + out / 1e6 * s_out
        b["calls"] += 1
        b["in"] += inp
        b["cache"] += ca
        b["out"] += out
        b["total"] += inp + ca + out
        b["promo"] += c_p
        b["std"] += c_s
        b["nc_promo"] += (inp + ca) / 1e6 * p_in + out / 1e6 * p_out
        b["nc_std"] += (inp + ca) / 1e6 * s_in + out / 1e6 * s_out

    for ts, _ in imgs:
        k = bucket_key_for_ts(ts)
        if k in buckets:
            buckets[k]["imgs"] += 1

    trend_list = []
    for k in sorted(buckets.keys()):
        b = buckets[k]
        b["promo"] = round(b["promo"], 2)
        b["std"] = round(b["std"], 2)
        b["nc_promo"] = round(b["nc_promo"], 2)
        b["nc_std"] = round(b["nc_std"], 2)
        trend_list.append(b)

    # Root conversation window breakdown
    by_root = {}
    for r in recs:
        ts, cid, me, mid, mname, inp, ca, out, th, resp = r
        title, pid, aname = meta_map.get(cid, ("", "", ""))
        rid = pid if pid else cid
        rtitle = meta_map.get(rid, ("", "", ""))[0] or rid[:8]
        w = by_root.setdefault(
            rid,
            {
                "id": rid,
                "title": rtitle,
                "calls": 0,
                "imgs": 0,
                "in": 0,
                "cache": 0,
                "out": 0,
                "total": 0,
                "promo": 0.0,
                "std": 0.0,
                "nc_promo": 0.0,
                "nc_std": 0.0,
                "models": set(),
                "last_ts": 0,
            },
        )
        p_in, p_ca, p_out, s_in, s_ca, s_out = get_pricing(mname, mid)
        c_p = inp / 1e6 * p_in + ca / 1e6 * p_ca + out / 1e6 * p_out
        c_s = inp / 1e6 * s_in + ca / 1e6 * s_ca + out / 1e6 * s_out
        w["calls"] += 1
        w["in"] += inp
        w["cache"] += ca
        w["out"] += out
        w["total"] += inp + ca + out
        w["promo"] += c_p
        w["std"] += c_s
        w["nc_promo"] += (inp + ca) / 1e6 * p_in + out / 1e6 * p_out
        w["nc_std"] += (inp + ca) / 1e6 * s_in + out / 1e6 * s_out
        w["models"].add(mname)
        if ts > w["last_ts"]:
            w["last_ts"] = ts

    for ts, cid in imgs:
        title, pid, aname = meta_map.get(cid, ("", "", ""))
        rid = pid if pid else cid
        if rid in by_root:
            by_root[rid]["imgs"] += 1

    windows_list = []
    win_colors = ["#6366f1", "#10b981", "#06b6d4", "#f59e0b", "#8b5cf6", "#ec4899", "#3b82f6", "#14b8a6"]
    for idx, w in enumerate(sorted(by_root.values(), key=lambda x: -x["total"])):
        img_fee = w["imgs"] * IMAGE_GEN_UNIT_COST
        windows_list.append(
            {
                "id": w["id"],
                "title": w["title"],
                "calls": w["calls"],
                "imgs": w["imgs"],
                "in": w["in"],
                "cache": w["cache"],
                "out": w["out"],
                "total": w["total"],
                "promo": round(w["promo"] + img_fee, 2),
                "std": round(w["std"] + img_fee, 2),
                "nc_promo": round(w["nc_promo"] + img_fee, 2),
                "nc_std": round(w["nc_std"] + img_fee, 2),
                "models": sorted(w["models"]),
                "last_time": datetime.datetime.fromtimestamp(w["last_ts"], tz=tz).strftime("%m-%d %H:%M:%S") if w["last_ts"] else "",
                "color": win_colors[idx % len(win_colors)],
            }
        )

    # Recent live calls feed (newest 30 calls)
    recent_calls = []
    for r in sorted(recs, key=lambda x: x[0], reverse=True)[:30]:
        ts, cid, me, mid, mname, inp, ca, out, th, resp = r
        title, pid, aname = meta_map.get(cid, ("", "", ""))
        rid = pid if pid else cid
        rtitle = meta_map.get(rid, ("", "", ""))[0] or cid[:8]
        if pid and aname:
            rtitle = f"{rtitle} [{aname}]"
        p_in, p_ca, p_out, s_in, s_ca, s_out = get_pricing(mname, mid)
        c_p = inp / 1e6 * p_in + ca / 1e6 * p_ca + out / 1e6 * p_out
        c_s = inp / 1e6 * s_in + ca / 1e6 * s_ca + out / 1e6 * s_out
        c_nc_p = (inp + ca) / 1e6 * p_in + out / 1e6 * p_out
        c_nc_s = (inp + ca) / 1e6 * s_in + out / 1e6 * s_out
        recent_calls.append(
            {
                "ts": ts,
                "time_str": datetime.datetime.fromtimestamp(ts, tz=tz).strftime("%H:%M:%S"),
                "date_str": datetime.datetime.fromtimestamp(ts, tz=tz).strftime("%m-%d %H:%M:%S"),
                "window": rtitle,
                "model": mname,
                "in": inp,
                "cache": ca,
                "out": out,
                "think": th,
                "total": inp + ca + out,
                "promo": round(c_p, 4),
                "std": round(c_s, 4),
                "nc_promo": round(c_nc_p, 4),
                "nc_std": round(c_nc_s, 4),
                "color": get_color(mname),
            }
        )

    tot_in_all = tot_in + tot_ca
    cache_hit_rate = (tot_ca / tot_in_all * 100.0) if tot_in_all > 0 else 0.0
    promo_llm = tot_p_in + tot_p_ca + tot_p_out
    std_llm = tot_s_in + tot_s_ca + tot_s_out
    img_cost = len(imgs) * IMAGE_GEN_UNIT_COST
    grand_total = tot_in + tot_ca + tot_out

    if start_ts > 0:
        start_str = datetime.datetime.fromtimestamp(start_ts, tz=tz).strftime("%Y-%m-%d %H:%M")
    elif recs:
        earliest_ts = min(r[0] for r in recs)
        start_str = datetime.datetime.fromtimestamp(earliest_ts, tz=tz).strftime("%Y-%m-%d %H:%M")
    else:
        start_str = "-"

    return {
        "meta": {
            "preset": preset,
            "range_label": range_label,
            "granularity": granularity,
            "start_str": start_str,
            "end_str": datetime.datetime.fromtimestamp(end_ts, tz=tz).strftime("%Y-%m-%d %H:%M:%S"),
            "server_time": datetime.datetime.now(tz).strftime("%H:%M:%S"),
            "db_count": db_count,
            "reparsed": reparsed,
            "scan_ms": scan_ms,
            "active_convs_5m": active_convs_5m,
        },
        "summary": {
            "calls": len(recs),
            "imgs": len(imgs),
            "img_cost": round(img_cost, 2),
            "in": tot_in,
            "cache": tot_ca,
            "out": tot_out,
            "think": tot_th,
            "resp": tot_re,
            "grand_total": grand_total,
            "cache_hit_rate": round(cache_hit_rate, 1),
            "promo_in": round(tot_p_in, 2),
            "promo_ca": round(tot_p_ca, 2),
            "promo_out": round(tot_p_out, 2),
            "promo_llm": round(promo_llm, 2),
            "promo_total": round(promo_llm + img_cost, 2),
            "std_llm": round(std_llm, 2),
            "std_total": round(std_llm + img_cost, 2),
            "nc_promo_llm": round(tot_nc_p, 2),
            "nc_promo_total": round(tot_nc_p + img_cost, 2),
            "nc_std_llm": round(tot_nc_s, 2),
            "nc_std_total": round(tot_nc_s + img_cost, 2),
            "saved_promo": round(tot_nc_p - promo_llm, 2),
            "saved_std": round(tot_nc_s - std_llm, 2),
            "burn_tok_per_min": round(recent_15m_tokens / 15.0, 0),
            "burn_usd_per_hr": round(recent_15m_promo * 4.0, 2),
            "root_windows_count": len(windows_list),
            "subagents_count": len({r[1] for r in recs if meta_map.get(r[1], ("", "", ""))[1]}),
        },
        "models": models_list,
        "trend": trend_list,
        "windows": windows_list,
        "recent_calls": recent_calls,
    }


def build_csv(payload):
    buf = io.StringIO()
    buf.write("\ufeff")
    w = csv.writer(buf)
    w.writerow(["统计区间", payload["meta"]["start_str"] + " ~ " + payload["meta"]["end_str"]])
    w.writerow([])
    w.writerow(["模型名称", "调用次数", "新增输入", "缓存读取", "总输出", "思考Token", "总计Token", "促销优惠价($)", "标准原价($)", "无缓存等效($)"])
    for m in payload["models"]:
        w.writerow([m["name"], m["calls"], m["in"], m["cache"], m["out"], m["think"], m["total"], m["promo"], m["std"], m["nc_promo"]])
    w.writerow(["原生生图(generate_image)", payload["summary"]["imgs"], 0, 0, 0, 0, 0, payload["summary"]["img_cost"], payload["summary"]["img_cost"], payload["summary"]["img_cost"]])
    s = payload["summary"]
    w.writerow(["合计", s["calls"] + s["imgs"], s["in"], s["cache"], s["out"], s["think"], s["grand_total"], s["promo_total"], s["std_total"], s["nc_promo_total"]])
    w.writerow([])
    w.writerow(["时间段", "调用次数", "生图数", "新增输入", "缓存读取", "输出", "总Token", "促销优惠价($)", "标准原价($)"])
    for d in payload["trend"]:
        w.writerow([d["key"], d["calls"], d["imgs"], d["in"], d["cache"], d["out"], d["total"], d["promo"], d["std"]])
    return buf.getvalue().encode("utf-8")


class MonitorHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        return

    def _send(self, code, content_type, body_bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        preset = qs.get("preset", ["last_7d"])[0]
        custom_start = qs.get("start", [None])[0]
        custom_end = qs.get("end", [None])[0]
        tz_hours = None
        if "tz" in qs and qs["tz"][0] != "local":
            try:
                tz_hours = float(qs["tz"][0])
            except ValueError:
                tz_hours = None

        if parsed.path in ("/", "/index.html"):
            try:
                with open(INDEX_HTML_PATH, "rb") as f:
                    self._send(200, "text/html; charset=utf-8", f.read())
            except OSError as e:
                self._send(500, "text/plain; charset=utf-8", str(e).encode("utf-8"))
            return

        if parsed.path == "/api/health":
            self._send(200, "application/json; charset=utf-8", b'{"ok":true}')
            return

        if parsed.path == "/api/stats":
            payload = compute_payload(preset, custom_start, custom_end, tz_hours)
            self._send(200, "application/json; charset=utf-8", json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            return

        if parsed.path == "/api/export.csv":
            payload = compute_payload(preset, custom_start, custom_end, tz_hours)
            csv_bytes = build_csv(payload)
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="antigravity_token_report.csv"')
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.end_headers()
            self.wfile.write(csv_bytes)
            return

        self._send(404, "text/plain; charset=utf-8", b"Not Found")


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18923)
    args = parser.parse_args()

    # Warm up cache once at startup
    STORE.snapshot()

    server = ReusableThreadingHTTPServer((args.host, args.port), MonitorHandler)
    print(f"Antigravity Token Monitor listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

