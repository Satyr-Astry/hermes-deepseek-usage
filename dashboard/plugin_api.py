"""DeepSeek 用量与余额 · 后端 (plugin_api.py)
================================================
挂载于 /api/plugins/deepseek-usage/

端点：
  GET /balance  —— 余额（含 5 分钟缓存 + 自动快照记录）
  GET /pricing  —— 峰谷时段状态 + 切换倒计时 + 价格表
  GET /history  —— 余额快照历史（消耗趋势）

峰谷规则（官方 2026-09 核实）：
  高峰 = 北京时间 周一至周五 9:00-12:00、14:00-18:00；其余为空闲
  空闲价 = 高峰价 × 0.5
  价格快照（USD / 百万 tokens，空闲价；来源：官方定价页 2026-09-10）：
    deepseek-flash:   输入 0.15 | 输出 0.60 | 缓存读 0.003
    deepseek-v4-pro:  输入 0.66 | 输出 1.98 | 缓存读 0.022

安全：key 只在网关进程读（环境变量或 $HERMES_HOME/.env），绝不下发前端。
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

BALANCE_URL = "https://api.deepseek.com/user/balance"
CACHE_TTL_SECONDS = 300          # 余额缓存 5 分钟
SNAPSHOT_MIN_GAP = 600           # 快照最小间隔 10 分钟（防抖）
SNAPSHOT_MAX = 2000              # 快照上限

# 价格快照（USD / M tokens，空闲价；高峰 = ×2）
PRICES = {
    "deepseek-flash":  {"in": 0.15, "out": 0.60, "cache_read": 0.003, "label": "DeepSeek Flash"},
    "deepseek-v4-pro": {"in": 0.66, "out": 1.98, "cache_read": 0.022, "label": "DeepSeek V4 Pro"},
}

BJ = timezone(timedelta(hours=8))   # 北京时间（无夏令时，固定 UTC+8）

_cache: dict = {"at": 0.0, "data": None}


# ---------------- 工具 ----------------
def _plugin_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def _history_file() -> Path:
    d = _plugin_dir() / "data"
    d.mkdir(exist_ok=True)
    return d / "balance_history.json"


def _api_key() -> str | None:
    key = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if key:
        return key
    try:
        home = _hermes_home()
        env_file = home / ".env"
        if env_file.is_file():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("DEEPSEEK_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    except Exception:
        pass
    return None


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return get_hermes_home()
    except Exception:
        pass
    val = os.environ.get("HERMES_HOME", "").strip()
    if val:
        return Path(val)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA", "").strip()
        return (Path(base) if base else Path.home() / "AppData" / "Local") / "hermes"
    return Path.home() / ".hermes"


def _load_history() -> list:
    f = _history_file()
    if f.is_file():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_snapshot(balance: float, currency: str):
    hist = _load_history()
    now = time.time()
    if hist and now - hist[-1].get("t", 0) < SNAPSHOT_MIN_GAP:
        return
    hist.append({"t": now, "balance": balance, "currency": currency})
    hist = hist[-SNAPSHOT_MAX:]
    try:
        _history_file().write_text(
            json.dumps(hist, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


# ---------------- 峰谷时段 ----------------
def _peak_state(now: datetime | None = None) -> dict:
    """当前时段 + 下一个切换点 + 倒计时（分钟）"""
    now = now or datetime.now(BJ)
    wd = now.weekday()          # 0=周一 … 4=周五, 5-6=周末
    m = now.hour * 60 + now.minute

    def is_peak(wd_, m_):
        return wd_ < 5 and (9 * 60 <= m_ < 12 * 60 or 14 * 60 <= m_ < 18 * 60)

    peak = is_peak(wd, m)

    # 下一个切换点（分钟制搜索：以 1 分钟步进向前找，最多 8 天）
    switch_at = None
    probe = now
    for _ in range(8 * 24 * 60):
        probe += timedelta(minutes=1)
        if is_peak(probe.weekday(), probe.hour * 60 + probe.minute) != peak:
            switch_at = probe
            break

    remaining_min = None
    if switch_at is not None:
        remaining_min = int((switch_at - now).total_seconds() // 60)

    return {
        "period": "peak" if peak else "idle",
        "period_label": "高峰" if peak else "空闲",
        "discount": 1.0 if peak else 0.5,       # 相对高峰的倍率
        "switch_at": switch_at.strftime("%m-%d %H:%M") if switch_at else None,
        "remaining_min": remaining_min,
        "now_bj": now.strftime("%Y-%m-%d %H:%M %a"),
    }


# ---------------- 端点 ----------------
@router.get("/balance")
def get_balance() -> dict:
    now = time.time()
    if _cache["data"] is not None and now - _cache["at"] < CACHE_TTL_SECONDS:
        return _cache["data"]

    key = _api_key()
    if not key:
        payload = {"ok": False, "error": "DEEPSEEK_API_KEY not found"}
        _cache.update(at=now, data=payload)
        return payload

    try:
        req = urllib.request.Request(
            BALANCE_URL,
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        infos = raw.get("balance_infos") or []
        # 取 CNY 优先，否则第一项
        info = next((i for i in infos if i.get("currency") == "CNY"),
                    infos[0] if infos else {})
        balance = float(info.get("total_balance") or 0)
        payload = {
            "ok": bool(raw.get("is_available")),
            "balance": balance,
            "currency": info.get("currency") or "CNY",
            "granted": float(info.get("granted_balance") or 0),
            "topped_up": float(info.get("topped_up_balance") or 0),
            "checked_at": now,
        }
        _save_snapshot(balance, payload["currency"])
        # 消耗估算（当日 / 近 7 日）
        hist = _load_history()
        now_s = time.time()
        day_ago = now_s - 86400
        week_ago = now_s - 7 * 86400
        day_start = min((h for h in hist if h["t"] >= day_ago), key=lambda h: h["t"], default=None)
        week_start = min((h for h in hist if h["t"] >= week_ago), key=lambda h: h["t"], default=None)
        payload["spent_today"] = round(day_start["balance"] - balance, 2) if day_start else None
        payload["spent_week"] = round(week_start["balance"] - balance, 2) if week_start else None
        payload["snapshots"] = len(hist)
    except Exception as exc:
        payload = {"ok": False, "error": str(exc)[:200], "checked_at": now}

    _cache.update(at=now, data=payload)
    return payload


@router.get("/pricing")
def get_pricing() -> dict:
    st = _peak_state()
    mult = 2.0 if st["period"] == "peak" else 1.0
    table = {}
    for mid, p in PRICES.items():
        table[mid] = {
            "label": p["label"],
            "in": round(p["in"] * mult, 4),
            "out": round(p["out"] * mult, 4),
            "cache_read": round(p["cache_read"] * mult, 4),
            "in_idle": p["in"], "in_peak": round(p["in"] * 2, 4),
            "out_idle": p["out"], "out_peak": round(p["out"] * 2, 4),
        }
    return {"ok": True, "state": st, "multiplier": mult,
            "currency": "USD", "unit": "per 1M tokens",
            "snapshot": "2026-09-10", "table": table}


@router.get("/history")
def get_history() -> dict:
    hist = _load_history()
    return {"ok": True, "count": len(hist), "points": hist[-500:]}
