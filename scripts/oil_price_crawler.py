#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
油价爬虫脚本 — oil_price_crawler.py
=====================================
爬取全国 32 省市最新成品油零售价，写入 Supabase oil_prices 表。

架构说明
--------
本脚本与 supabase/functions/oilprice-admin-update/ Edge Function 实现完全相同的业务逻辑：
  - Edge Function（云端）：部署在 Supabase，由 pg_cron 每次调价窗口自动触发
  - Python 脚本（本地/服务器）：在任何有 Python + 公网的机器上运行，结果直接写入同一个数据库

两者互为备份：EF 在 Supabase 云端无缝运行；Python 脚本可在有外网的 Linux/Mac/Windows 服务器
上通过 crontab 定时执行，也可手动触发强制更新。

数据源（双源互备）
------------------
  主源：qiyoujiage.com — 国内知名油价信息站（HTTP，实测稳定可访问）
  备用：aoyou oil — 结构相似的备用站（主源失败时自动切换）
  兜底：静态 FALLBACK 字典（两源均失败时使用历史数据）

运行方式
--------
  python3 scripts/oil_price_crawler.py              # 自动判断调价窗口，窗口开启才更新
  python3 scripts/oil_price_crawler.py --force      # 强制全量更新所有城市
  python3 scripts/oil_price_crawler.py --city 天津  # 只更新单个城市（测试用）
  python3 scripts/oil_price_crawler.py --dry-run    # 只爬取不写库，打印结果
  python3 scripts/oil_price_crawler.py --verbose    # 输出 DEBUG 级别日志

crontab 示例（每天北京时间 10:10 检查并更新）
  10 2 * * * /usr/bin/python3 /path/to/scripts/oil_price_crawler.py >> /var/log/oil_crawler.log 2>&1

环境变量（或直接修改脚本中的默认值）
  SUPABASE_URL          项目 URL，如 https://xxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role 密钥（拥有写库权限）

依赖安装
  pip install requests beautifulsoup4 lxml
"""

import os
import re
import sys
import time
import json
import logging
import argparse
import urllib3
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import requests
from bs4 import BeautifulSoup

# 禁用 SSL 警告（部分站点证书主机名不匹配，统一走 HTTP 或 verify=False）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── 日志配置 ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("oil_crawler")

# ── Supabase 连接（优先读环境变量，也可直接在此填写）──────────────────────
SUPABASE_URL = os.environ.get(
    "SUPABASE_URL",
    "https://jwnxfwrdpcdwbcxlbpjf.supabase.co"  # 从 supabase_init 获取的项目 URL
)
SUPABASE_KEY = os.environ.get(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTAwMDQwMjA2LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJzdWIiOiJzZXJ2aWNlX3JvbGUifQ.V9eFvkkQsRPfP6Q8PAQ1M1PTGsmohWrweBrkyVvdsN0"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

TIMEOUT = 15  # 每个城市请求超时（秒）
MAX_WORKERS = 3  # 并发线程数（控制并发避免被限速封禁）
BATCH_DELAY = 1.0  # 批次间隔（秒）

# ── 城市 slug 映射 ────────────────────────────────────────────────────────────
CITY_SLUGS: dict[str, str] = {
    "北京": "beijing",   "上海": "shanghai",  "天津": "tianjin",
    "重庆": "chongqing", "河北": "hebei",      "山西": "shanxi",
    "内蒙古": "neimenggu","辽宁": "liaoning",  "吉林": "jilin",
    "黑龙江": "heilongjiang","江苏": "jiangsu","浙江": "zhejiang",
    "安徽": "anhui",     "福建": "fujian",     "江西": "jiangxi",
    "山东": "shandong",  "河南": "henan",      "湖北": "hubei",
    "湖南": "hunan",     "广东": "guangdong",  "深圳": "shenzhen",
    "广西": "guangxi",   "海南": "hainan",     "四川": "sichuan",
    "贵州": "guizhou",   "云南": "yunnan",     "西藏": "xizang",
    "陕西": "shanxi-3",  "甘肃": "gansu",      "青海": "qinghai",
    "宁夏": "ningxia",   "新疆": "xinjiang",
}

ALL_CITIES = list(CITY_SLUGS.keys())

# ── 静态 FALLBACK（网络完全失败时兜底）─────────────────────────────────────
FALLBACK: dict[str, dict[str, str]] = {
    "北京":  {"p92": "7.42", "p95": "7.90", "p98": "8.60", "p0": "7.12"},
    "天津":  {"p92": "7.41", "p95": "7.88", "p98": "9.38", "p0": "7.07"},
    "河北":  {"p92": "7.41", "p95": "7.88", "p98": "9.38", "p0": "7.07"},
    "山西":  {"p92": "7.37", "p95": "7.96", "p98": "9.46", "p0": "7.14"},
    "内蒙古":{"p92": "7.32", "p95": "7.80", "p98": "9.30", "p0": "6.95"},
    "辽宁":  {"p92": "7.48", "p95": "8.00", "p98": "9.50", "p0": "6.98"},
    "吉林":  {"p92": "7.36", "p95": "7.84", "p98": "9.34", "p0": "7.00"},
    "黑龙江":{"p92": "7.38", "p95": "7.91", "p98": "9.41", "p0": "6.88"},
    "上海":  {"p92": "7.38", "p95": "7.85", "p98": "9.85", "p0": "7.05"},
    "江苏":  {"p92": "7.38", "p95": "7.85", "p98": "9.85", "p0": "7.05"},
    "浙江":  {"p92": "7.39", "p95": "7.86", "p98": "9.36", "p0": "7.06"},
    "安徽":  {"p92": "7.38", "p95": "7.86", "p98": "9.36", "p0": "7.04"},
    "福建":  {"p92": "7.40", "p95": "7.88", "p98": "9.38", "p0": "7.06"},
    "江西":  {"p92": "7.40", "p95": "7.92", "p98": "9.42", "p0": "7.14"},
    "山东":  {"p92": "7.38", "p95": "7.86", "p98": "9.36", "p0": "7.02"},
    "河南":  {"p92": "7.43", "p95": "7.93", "p98": "9.43", "p0": "7.06"},
    "湖北":  {"p92": "7.47", "p95": "8.00", "p98": "8.80", "p0": "7.10"},
    "湖南":  {"p92": "7.44", "p95": "7.90", "p98": "8.70", "p0": "7.10"},
    "广东":  {"p92": "7.46", "p95": "8.08", "p98": "9.20", "p0": "7.11"},
    "深圳":  {"p92": "7.46", "p95": "8.08", "p98": "9.20", "p0": "7.11"},
    "广西":  {"p92": "7.48", "p95": "8.06", "p98": "9.10", "p0": "7.12"},
    "海南":  {"p92": "8.55", "p95": "9.08", "p98": "10.08","p0": "7.14"},
    "重庆":  {"p92": "7.51", "p95": "7.93", "p98": "8.93", "p0": "7.12"},
    "四川":  {"p92": "7.54", "p95": "8.05", "p98": "8.75", "p0": "7.13"},
    "贵州":  {"p92": "7.55", "p95": "8.01", "p98": "8.91", "p0": "7.15"},
    "云南":  {"p92": "7.58", "p95": "8.14", "p98": "8.82", "p0": "7.17"},
    "西藏":  {"p92": "8.32", "p95": "8.80", "p98": "9.80", "p0": "7.64"},
    "陕西":  {"p92": "7.31", "p95": "7.73", "p98": "8.80", "p0": "6.97"},
    "甘肃":  {"p92": "7.44", "p95": "7.98", "p98": "8.87", "p0": "7.08"},
    "青海":  {"p92": "7.40", "p95": "7.93", "p98": "8.82", "p0": "7.03"},
    "宁夏":  {"p92": "7.37", "p95": "7.89", "p98": "8.79", "p0": "7.01"},
    "新疆":  {"p92": "7.27", "p95": "7.82", "p98": "8.70", "p0": "6.94"},
}


# ── 数据源1：qiyoujiage.com（主源，HTTP，国内访问稳定）──────────────────────
def fetch_from_qiyoujiage(city: str) -> Optional[dict]:
    """
    爬取 qiyoujiage.com/{slug}.shtml
    解析 <dt>城市92#汽油</dt><dd>7.41</dd> 结构
    同时解析下次调价日期和涨跌预测
    """
    slug = CITY_SLUGS.get(city)
    if not slug:
        return None
    # 使用 HTTP（证书主机名不匹配，verify=False 绕过）
    url = f"http://www.qiyoujiage.com/{slug}.shtml"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, verify=False)
        resp.raise_for_status()
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "lxml")

        def extract_price(label: str) -> str:
            """从 <dt>...label...</dt><dd>数字</dd> 中提取价格"""
            for dt in soup.find_all("dt"):
                if label in (dt.get_text() or ""):
                    dd = dt.find_next_sibling("dd")
                    if dd:
                        val = (dd.get_text() or "").strip()
                        if re.match(r"^\d+\.\d+$", val):
                            return val
            return ""

        p92 = extract_price("92#汽油") or extract_price("92号汽油")
        p95 = extract_price("95#汽油") or extract_price("95号汽油")
        p98 = extract_price("98#汽油") or extract_price("98号汽油")
        p0  = extract_price("0#柴油")  or extract_price("0号柴油")

        if not p92 and not p95:
            log.warning(f"[{city}] qiyoujiage 解析失败，未找到价格字段")
            return None

        # 解析调价预测（全国统一，只在代表城市解析）
        html_text = resp.text
        next_adjust_date, next_trend, next_trend_text = parse_adjust_forecast(html_text)

        log.info(f"[{city}] qiyoujiage ✓ 92#{p92} 95#{p95} 98#{p98} 柴{p0}")
        return {
            "p92": p92, "p95": p95, "p98": p98, "p0": p0,
            "next_adjust_date": next_adjust_date,
            "next_trend": next_trend,
            "next_trend_text": next_trend_text,
            "source": "qiyoujiage",
        }
    except Exception as e:
        log.warning(f"[{city}] qiyoujiage 请求失败: {e}")
        return None


# ── 数据源2：oil.aoyoucar.com（备用，汽车之家油价，结构简洁）──────────────
def fetch_from_aoyou(city: str) -> Optional[dict]:
    """备用源：爱游车油价，解析表格结构"""
    slug = CITY_SLUGS.get(city)
    if not slug:
        return None
    url = f"http://oil.aoyoucar.com/{slug}/"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, verify=False)
        resp.raise_for_status()
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "lxml")

        prices: dict[str, str] = {}
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) >= 2:
                label = tds[0].get_text(strip=True)
                val   = tds[1].get_text(strip=True)
                if re.match(r"^\d+\.\d+$", val):
                    if "92" in label: prices["p92"] = val
                    elif "95" in label: prices["p95"] = val
                    elif "98" in label: prices["p98"] = val
                    elif "柴" in label or "0号" in label: prices["p0"] = val

        if not prices.get("p92") and not prices.get("p95"):
            return None

        log.info(f"[{city}] aoyou ✓ 92#{prices.get('p92')} 95#{prices.get('p95')}")
        return {**prices, "source": "aoyou"}
    except Exception as e:
        log.debug(f"[{city}] aoyou 失败: {e}")
        return None


# ── 调价预测解析（全国统一，从任意城市页面提取）─────────────────────────────
def parse_adjust_forecast(html: str) -> tuple[str, float, str]:
    """解析下次调价日期和涨跌预测，返回 (next_adjust_date, next_trend, next_trend_text)"""
    next_adjust_date = ""
    next_trend = 0.0
    next_trend_text = ""

    # 调价日期：下次油价N月N日24时调整
    date_m = re.search(r"下次油价\s*(\d+)月(\d+)日", html)
    if date_m:
        mo, d = int(date_m.group(1)), int(date_m.group(2))
        now = datetime.now(tz=timezone(timedelta(hours=8)))
        yr = now.year
        candidate = datetime(yr, mo, d, tzinfo=timezone(timedelta(hours=8)))
        today = datetime(now.year, now.month, now.day, tzinfo=timezone(timedelta(hours=8)))
        if candidate < today:
            yr += 1
        next_adjust_date = f"{yr}-{mo:02d}-{d:02d}"

    # 涨跌范围格式：(上调|下调)油价...(\d+)元/升~(\d+)元/升
    range_m = re.search(
        r"(上调|下调)油价.*?\(([\d.]+)元\/升[~－\-]([\d.]+)元\/升\)", html
    )
    single_m = re.search(r"(上调|下调).*?([\d.]+)元\/升", html)

    if range_m:
        is_down = range_m.group(1) == "下调"
        lo, hi = float(range_m.group(2)), float(range_m.group(3))
        avg = round((lo + hi) / 2, 3)
        next_trend = -avg if is_down else avg
        sign = "-" if is_down else "+"
        next_trend_text = f"预计{range_m.group(1)} {sign}{range_m.group(2)}~{range_m.group(3)} 元/升"
    elif single_m:
        is_down = single_m.group(1) == "下调"
        val = float(single_m.group(2))
        if 0 < val <= 2.0:
            next_trend = -val if is_down else val
            sign = "-" if is_down else "+"
            next_trend_text = f"预计{single_m.group(1)} {sign}{single_m.group(2)} 元/升"

    if not next_trend_text and "持平" in html:
        next_trend_text = "预计持平"
        next_trend = 0.0

    return next_adjust_date, next_trend, next_trend_text


# ── 单城市爬取（主备源 + 重试 + FALLBACK 兜底）──────────────────────────────
def fetch_city(city: str) -> dict:
    """
    尝试主源（最多2次重试）→ 备源 → FALLBACK 兜底
    返回完整的城市数据行
    """
    # 主源：qiyoujiage，最多重试2次
    result = None
    for attempt in range(2):
        result = fetch_from_qiyoujiage(city)
        if result and result.get("p92"):
            break
        if attempt == 0:
            time.sleep(1.5)  # 重试前稍等，避免限速

    # 备源：aoyou
    if not result or not result.get("p92"):
        log.info(f"[{city}] 主源失败，切换备源 aoyou")
        aoyou = fetch_from_aoyou(city)
        if aoyou and aoyou.get("p92"):
            # 合并：价格来自 aoyou，预测保留（主源可能有部分预测）
            result = {**(result or {}), **aoyou}

    # 最终兜底
    if not result or not result.get("p92"):
        fb = FALLBACK.get(city, {})
        log.warning(f"[{city}] 所有源失败，使用静态 FALLBACK 数据")
        result = {
            "p92": fb.get("p92", ""), "p95": fb.get("p95", ""),
            "p98": fb.get("p98", ""), "p0": fb.get("p0", ""),
            "next_adjust_date": "", "next_trend": 0.0, "next_trend_text": "",
            "source": "fallback",
        }

    # 补全缺失字段
    result.setdefault("next_adjust_date", "")
    result.setdefault("next_trend", 0.0)
    result.setdefault("next_trend_text", "")
    result.setdefault("source", "unknown")
    return result


# ── 多线程批量爬取 ───────────────────────────────────────────────────────────
def fetch_all(cities: list[str]) -> dict[str, dict]:
    """并发爬取所有城市，返回 {城市: 数据} 字典"""
    results: dict[str, dict] = {}
    total = len(cities)

    # 分批处理，每批 MAX_WORKERS 个，批次间延迟
    for batch_start in range(0, total, MAX_WORKERS):
        batch = cities[batch_start:batch_start + MAX_WORKERS]
        log.info(f"爬取批次 {batch_start//MAX_WORKERS + 1}：{batch}")

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(fetch_city, city): city for city in batch}
            for future in as_completed(futures):
                city = futures[future]
                try:
                    results[city] = future.result()
                except Exception as e:
                    log.error(f"[{city}] 线程异常: {e}")
                    results[city] = {**FALLBACK.get(city, {}), "source": "fallback"}

        if batch_start + MAX_WORKERS < total:
            time.sleep(BATCH_DELAY)

    return results


# ── Supabase REST 写库 ───────────────────────────────────────────────────────
def build_db_row(city: str, data: dict, today: str) -> dict:
    """构建写入 oil_prices 表的数据行"""
    p0_val = float(data.get("p0") or 7.07)
    return {
        "city":            city,
        "p92":             data.get("p92", ""),
        "p95":             data.get("p95", ""),
        "p98":             data.get("p98", ""),
        "p0":              data.get("p0", ""),
        "pm10":            str(round(p0_val + 0.10, 2)),
        "pm20":            str(round(p0_val + 0.20, 2)),
        "pm35":            str(round(p0_val + 0.35, 2)),
        "update_date":     today,
        "trend":           0.24,      # 本次调价幅度（由 EF 判断后填写）
        "trend_date":      today,
        "next_adjust_date": data.get("next_adjust_date", ""),
        "next_trend":      data.get("next_trend", 0.0),
        "next_trend_text": data.get("next_trend_text", ""),
        "fetched_at":      datetime.now(timezone.utc).isoformat(),
        "source":          data.get("source", "python_crawler"),
    }


def upsert_to_supabase(rows: list[dict], dry_run: bool = False) -> bool:
    """通过 Supabase REST API upsert 写入 oil_prices 表"""
    if dry_run:
        log.info(f"[DRY-RUN] 共 {len(rows)} 条数据，不写入数据库")
        for r in rows[:3]:
            log.info(f"  样本: {json.dumps(r, ensure_ascii=False)}")
        return True

    url = f"{SUPABASE_URL}/rest/v1/oil_prices"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",  # upsert 语义
    }

    # 分批写入，每批 20 条
    batch_size = 20
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        try:
            resp = requests.post(url, headers=headers, json=batch, timeout=30)
            if resp.status_code not in (200, 201):
                log.error(f"写库失败（批次{i//batch_size+1}）: {resp.status_code} {resp.text[:200]}")
                return False
            log.info(f"写库成功：批次 {i//batch_size+1}，{len(batch)} 条")
        except Exception as e:
            log.error(f"写库异常: {e}")
            return False

    return True


def write_history_to_supabase(rows: list[dict], dry_run: bool = False) -> None:
    """同步写入 oil_price_history 表（幂等，已存在则跳过）"""
    if dry_run:
        return

    history_rows = [
        {
            "city":        r["city"],
            "p92":         r["p92"],
            "p95":         r["p95"],
            "p98":         r["p98"],
            "p0":          r["p0"],
            "trend":       r.get("trend", 0),
            "update_date": r["update_date"],
        }
        for r in rows
    ]

    url = f"{SUPABASE_URL}/rest/v1/oil_price_history"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",  # 已存在则跳过
    }
    try:
        resp = requests.post(url, headers=headers, json=history_rows, timeout=30)
        if resp.status_code in (200, 201):
            log.info(f"历史记录写入成功：{len(history_rows)} 条")
        else:
            log.warning(f"历史记录写入: {resp.status_code}")
    except Exception as e:
        log.warning(f"历史记录写入异常: {e}")


# ── 调价窗口检测（Python 端本地判断，避免无谓爬取）──────────────────────────
def check_adjust_window() -> tuple[bool, str, str]:
    """
    查询数据库当前 next_adjust_date 和 update_date，
    判断调价窗口是否已开启。
    返回 (should_update, next_adjust_date, update_date)
    """
    url = f"{SUPABASE_URL}/rest/v1/oil_prices"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    params = {
        "city": "eq.天津",
        "select": "update_date,next_adjust_date",
        "limit": "1",
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        data = resp.json()
        if not data:
            log.info("数据库无天津数据，直接执行全量更新")
            return True, "", ""

        row = data[0]
        next_adj  = (row.get("next_adjust_date") or "")[:10]
        stored_dt = (row.get("update_date") or "")[:10]
        today = datetime.now(tz=timezone(timedelta(hours=8))).strftime("%Y-%m-%d")

        log.info(f"窗口检测 → 今日={today} 调价日={next_adj} 已存数据期={stored_dt}")

        if next_adj and today >= next_adj and stored_dt < next_adj:
            log.info("✅ 调价窗口已开启，需要更新价格")
            return True, next_adj, stored_dt
        else:
            log.info("⏳ 调价窗口未开启，本次跳过")
            return False, next_adj, stored_dt
    except Exception as e:
        log.warning(f"窗口检测失败，默认执行更新: {e}")
        return True, "", ""


# ── 打印爬取结果汇总 ─────────────────────────────────────────────────────────
def print_summary(results: dict[str, dict]) -> None:
    ok = sum(1 for v in results.values() if v.get("source") != "fallback")
    fb = sum(1 for v in results.values() if v.get("source") == "fallback")
    print("\n" + "=" * 60)
    print(f"  爬取完成：共 {len(results)} 个城市")
    print(f"  ✅ 网络抓取成功：{ok} 个")
    print(f"  ⚠️  FALLBACK 兜底：{fb} 个")
    print("=" * 60)

    # 抽查天津、北京、广东
    for city in ["天津", "北京", "广东"]:
        r = results.get(city, {})
        print(
            f"  {city}：92#{r.get('p92','-')} 95#{r.get('p95','-')} "
            f"98#{r.get('p98','-')} 柴{r.get('p0','-')} "
            f"[{r.get('source','-')}]"
        )

    # 调价预测（取天津）
    tj = results.get("天津", {})
    if tj.get("next_adjust_date"):
        print(f"\n  下次调价：{tj['next_adjust_date']}  {tj.get('next_trend_text','')}")
    print("=" * 60 + "\n")


# ── 主入口 ───────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="全国油价爬虫 → Supabase")
    parser.add_argument("--force",    action="store_true", help="忽略调价窗口，强制全量更新")
    parser.add_argument("--dry-run",  action="store_true", help="只爬取不写库，打印结果")
    parser.add_argument("--city",     type=str, default="",  help="只更新单个城市（测试）")
    parser.add_argument("--verbose",  action="store_true", help="输出 DEBUG 日志")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    log.info("=" * 50)
    log.info("全国油价爬虫启动")
    log.info(f"force={args.force}  dry_run={args.dry_run}  city={args.city or '全部'}")
    log.info("=" * 50)

    # 单城市测试模式
    if args.city:
        cities = [args.city]
    else:
        # 调价窗口检测（非 force 模式）
        if not args.force and not args.dry_run:
            should_update, _, _ = check_adjust_window()
            if not should_update:
                log.info("无需更新，退出。如需强制更新请加 --force 参数")
                sys.exit(0)
        cities = ALL_CITIES

    # 开始爬取
    t0 = time.time()
    results = fetch_all(cities)
    elapsed = time.time() - t0
    log.info(f"爬取完成，耗时 {elapsed:.1f}s")

    print_summary(results)

    # 构建写库数据
    today = datetime.now(tz=timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
    rows = [build_db_row(city, data, today) for city, data in results.items()]

    # 写入 Supabase
    success = upsert_to_supabase(rows, dry_run=args.dry_run)
    if success and not args.dry_run:
        write_history_to_supabase(rows, dry_run=args.dry_run)
        log.info("✅ 全部写入完成")
    elif args.dry_run:
        log.info("✅ DRY-RUN 完成（未写库）")
    else:
        log.error("❌ 写库失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
