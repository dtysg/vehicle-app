import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * oilprice-crude v9 — 正确发改委公式：本期均价 vs 上期均价
 *
 * 数据架构：
 *   ① 实时盘价：CNBC Quote API（无需 Key，实时 15min 延迟）
 *      - Brent: @LCO.1  WTI: @CL.1
 *   ② 10日均价（本期）：EIA 官方 API 三品种并行 → 缓存降级 → 盘价兜底
 *      - 布伦特: product=EPCBRENT（独立10日均价）
 *      - WTI:    product=EPCRWTI（独立10日均价，作为米纳斯替代）
 *      - 阿曼:   无 EIA 独立品种，布伦特均价 - 实时利差推算
 *   ③ 上期均价：oil_prices.crude_last_cycle_avg（发改委上一计价周期均值）
 *   ④ 实时汇率：集成平台 currency-exchange-rate（USD→CNY）
 *      - 失败时降级 RMB_RATE_FALLBACK = 7.25
 *
 * 测算逻辑（发改委税费联动公式）：
 *   ΔP   = 本期均价(avg10d) − 上期均价(lastCycleAvg)   ← 核心基准
 *   变化率 = ΔP ÷ 上期均价 × 100%
 *   ΔC(元/吨) = ΔP × R × 桶/吨 × (1 + T1 + T1×T2) + K
 *   每升调幅  = ΔC ÷ 折算系数(升/吨)
 *
 *   参数：
 *     R    = 人民币汇率（实时，失败降级 7.25）
 *     桶/吨 = 7.33（布伦特原油）
 *     T1   = 增值税 13%
 *     T2   = 附加税 12%（城建7%+教育5%）
 *     K    = 加工利润 60元/吨
 *
 *   折算系数（升/吨，各油品密度不同）：
 *     92#汽油 全国通用 1318，95#汽油 全国通用 1298，0#柴油 全国通用 1191
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CNBC_URL = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=@LCO.1|@CL.1|@MCO.1&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1";
// Yahoo Finance — WTI(CL=F) + Brent(BZ=F) 补充数据源，无需 Key
// 注：阿曼原油(OQD=F/CME)在沙盒网络不可达，降级用布伦特利差估算（历史均差约-2.0）
const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/spark?symbols=CL%3DF%2CBZ%3DF&range=1d&interval=1d&indicators=close&includeTimestamps=false";
const EIA_BASE = "https://api.eia.gov/v2/petroleum/pri/spt/data/";
const EIA_KEY  = Deno.env.get("EIA_API_KEY") || "DEMO_KEY"; // 免费申请：https://www.eia.gov/opendata/register.php
const AV_KEY   = Deno.env.get("ALPHAVANTAGE_API_KEY") ?? ""; // Alpha Vantage（EIA 同源，更新更快）

// ── 税费联动公式物理常量 ──────────────────────────────────────
const BARREL_PER_TON    = 7.33;   // 布伦特原油：桶/吨
const RMB_RATE_FALLBACK = 7.25;   // 降级汇率（实时获取失败时使用）
const T1                = 0.13;   // 增值税税率
const T2                = 0.12;   // 附加税率（城建7%+教育5%）
const K                 = 60;     // 加工利润（元/吨，行业估算值）
// 综合放大系数 = (1 + T1 + T1×T2) = 1 + 0.13 + 0.0156 = 1.1456
const TAX_MULTIPLIER = 1 + T1 + T1 * T2;

// 汇率 API（platform_managed，密钥由平台注入）
const EXCHANGE_RATE_URL = "https://app-d6jn0ph0piwx-api-ELbWz8OmBW5Y-gateway.appmiaoda.com/exchange-rate-v2/single";

// ── 各油品折算系数（升/吨）——来源：行业通用标准 + 各省官方文件 ──
// 折算系数表（升/吨）
// 来源：各省发改委/物价局官方文件 + 国标 GB 19147/18351 密度规格 + 行业实测汇总
// 公式：折算系数 = 1000 ÷ 密度(kg/L)；密度随高原/气温有约 ±1% 浮动
// 未列出城市自动降级"全国通用"
const CONV_MAP: Record<string, Record<string, number>> = {
  // ─── 92# 汽油（gov.cn 官方 + 价格反推，v923 更新）───────────────
  "92#": {
    "全国通用":   1318,  // ☆ 全国均值（v923 修订）
    // 华北
    "北京":       1320,  // ☆ 9582÷7.26（北京发改委2025-11-10）
    "天津":       1318,  // ★ 实测标定
    "河北":       1321,
    "石家庄":     1321,
    "山西":       1334,  // ☆ 9508÷7.13（山西发改委2025-07-01）
    "太原":       1334,
    "内蒙古":     1317,  // ★ 东西均值（内发改价费字〔2025〕1436号）
    "内蒙古东部": 1308,  // ★ 东部片区
    "内蒙古西部": 1317,  // ★ 西部片区
    "呼和浩特":   1317,
    "通辽":       1308,
    "赤峰":       1308,
    // 华东
    "上海":       1351,
    "江苏":       1351,
    "南京":       1351,
    "苏州":       1351,
    "浙江":       1351,
    "杭州":       1351,
    "宁波":       1351,
    "安徽":       1339,  // ☆ 9810÷7.33（安徽发改委2026-07-17）
    "合肥":       1339,
    "福建":       1338,  // ★ 闽发改〔2013〕93号
    "福州":       1338,
    "厦门":       1338,
    "江西":       1321,
    "南昌":       1321,
    "山东":       1321,
    "济南":       1321,
    "青岛":       1321,
    // 华南
    "广东":       1321,
    "广州":       1321,
    "深圳":       1321,
    "广西":       1326,  // ☆ 9837÷7.42（广西发改委2025-07-01）
    "南宁":       1326,
    "海南":       1182,
    "海口":       1182,
    // 华中
    "河南":       1317,  // ★ 2026官方精确折算系数表（乙醇汽油）
    "郑州":       1317,
    "湖北":       1317,  // ★ 2026官方精确折算系数表（乙醇汽油）
    "武汉":       1317,
    "湖南":       1321,
    "长沙":       1321,
    // 东北
    "辽宁":       1315,  // ★ 2026官方精确折算系数表（行业标准）
    "沈阳":       1315,
    "大连":       1315,
    "吉林":       1315,  // ★ 2026官方精确折算系数表（行业标准）
    "长春":       1315,
    "黑龙江":     1321,
    "黑龙江南区": 1321,  // ★ 2026/05-10（黑龙江发改委）
    "黑龙江北区": 1315,  // ★
    "哈尔滨":     1321,
    "齐齐哈尔":   1315,
    "黑河":       1315,
    // 西北
    "陕西":       1321,
    "西安":       1321,
    "甘肃":       1314,  // ★ 国ⅥA 1313.64（甘肃发改委2020年）
    "兰州":       1314,
    "青海":       1321,
    "西宁":       1321,
    "宁夏":       1321,
    "银川":       1321,
    "新疆":       1321,
    "乌鲁木齐":   1321,
    // 西南
    "重庆":       1321,
    "四川":       1329,  // ★ 2026官方精确折算系数表（全省纯汽油官方标准）
    "成都":       1329,
    "四川甘孜":   1308,
    "贵州":       1318,  // ★ 贵州发改委官网明确
    "贵阳":       1318,
    "云南":       1321,
    "昆明":       1321,
    "西藏":       1176,  // ★ 密度0.85（西藏发改委2026-03）
    "拉萨":       1176,
  },
  // ─── 98# 汽油（高标号，密度略高于95#，折算系数略低）─────────────
  // 原理：98#密度 ≈ 0.755~0.775 kg/L（略高于95#的0.745~0.765），系数 ≈ 95# − 5~15
  // 数据来源：各省发改委价格文件推算（98#=95#价+固定升差，密度接近）
  "98#": {
    "全国通用":   1288,  // ☆ 95#全国1303 − 15（密度修正）
    // 华北
    "北京":       1294,  // ☆ 95#1309 − 15
    "天津":       1288,
    "内蒙古东部": 1283,  // ☆ 95#1298 − 15
    "内蒙古西部": 1292,  // ☆ 95#1307 − 15
    "内蒙古":     1292,
    "呼和浩特":   1292,
    // 东北
    "黑龙江":     1289,
    "黑龙江南区": 1289,
    "黑龙江北区": 1282,
    "哈尔滨":     1289,
    "辽宁":       1288,
    "吉林":       1288,
    // 华东
    "上海":       1288,
    "江苏":       1288,
    "浙江":       1288,
    "安徽":       1314,  // ☆ 95#1329 − 15
    "福建":       1314,
    "江西":       1288,
    "山东":       1288,
    // 华南
    "广东":       1288,
    "广西":       1288,
    "海南":       1288,
    // 华中
    "河南":       1288,
    "湖北":       1288,
    "湖南":       1288,
    // 西北
    "陕西":       1288,
    "甘肃":       1285,  // ☆ 95#1300 − 15
    "青海":       1288,
    "宁夏":       1288,
    "新疆":       1288,
    // 西南
    "重庆":       1288,
    "四川":       1299,  // ☆ 95#1314 − 15
    "四川甘孜":   1282,
    "贵州":       1288,
    "云南":       1288,
    "西藏":       1161,  // ☆ 95#1176 − 15（高海拔）
    "拉萨":       1161,
  },
  // ─── 95# 汽油 ─────────────────────────────────────────────────
  "95#": {
    "全国通用":   1303,
    "北京":       1309,
    "天津":       1303,
    "内蒙古东部": 1298,  // ★ 内发改价费字〔2025〕1436号
    "内蒙古西部": 1307,  // ★
    "内蒙古":     1307,
    "呼和浩特":   1307,
    "黑龙江":     1304,
    "黑龙江南区": 1304,  // ★ E95南区=1303.53
    "黑龙江北区": 1297,  // ★ E95北区=1296.64
    "哈尔滨":     1304,
    "辽宁":       1303,
    "吉林":       1303,
    "上海":       1303,
    "江苏":       1303,
    "浙江":       1303,
    "安徽":       1329,
    "福建":       1329,  // ★ 闽发改〔2013〕93号 97#
    "江西":       1303,
    "山东":       1303,
    "河南":       1303,
    "湖北":       1303,
    "湖南":       1303,
    "广东":       1303,
    "广西":       1303,
    "海南":       1303,
    "重庆":       1303,
    "四川":       1314,  // ★ 2026官方精确折算系数表（四川95#=1314）
    "四川甘孜":   1297,
    "贵州":       1303,
    "云南":       1303,
    "西藏":       1176,
    "陕西":       1303,
    "甘肃":       1300,  // ★ 甘肃发改委国ⅥA 95#=1300.16
    "青海":       1303,
    "宁夏":       1303,
    "新疆":       1303,
  },
  // ─── 0# 柴油（v923 更新）─────────────────────────────────────
  "0#柴": {
    "全国通用":   1191,
    // 华北
    "北京":       1198,
    "天津":       1205,
    "河北":       1191,
    "石家庄":     1191,
    "山西":       1191,
    "太原":       1191,
    "内蒙古":     1181,  // ★ 东部1180.9
    "内蒙古东部": 1181,  // ★
    "内蒙古西部": 1186,  // ★
    "呼和浩特":   1186,
    "通辽":       1181,
    // 华东
    "上海":       1198,
    "江苏":       1198,
    "南京":       1198,
    "浙江":       1198,
    "杭州":       1198,
    "安徽":       1172,  // ☆ 价格反推
    "合肥":       1172,
    "福建":       1172,  // ★ 闽发改〔2013〕93号
    "福州":       1172,
    "厦门":       1172,
    "江西":       1191,
    "山东":       1191,
    // 华南
    "广东":       1191,
    "广州":       1191,
    "深圳":       1191,
    "广西":       1168,  // ☆ 8255÷7.07（广西发改委）
    "南宁":       1168,
    "海南":       1182,
    "海口":       1182,
    // 华中
    "河南":       1163,  // ★ 2026官方精确折算系数表（乙醇汽油 0#=1163）
    "湖北":       1163,  // ★ 2026官方精确折算系数表（乙醇汽油 0#=1163）
    "湖南":       1191,
    // 东北
    "辽宁":       1191,
    "沈阳":       1191,
    "大连":       1191,
    "吉林":       1191,
    "长春":       1191,
    "黑龙江":     1191,
    "黑龙江南区": 1191,  // ★ 0#柴南区=1190.55
    "黑龙江北区": 1187,  // ★ 0#柴北区=1186.60
    "哈尔滨":     1191,
    "齐齐哈尔":   1187,
    "黑河":       1187,
    // 西北
    "陕西":       1198,
    "西安":       1198,
    "甘肃":       1176,  // ★ 甘肃发改委国ⅥA 0#=1176.27
    "兰州":       1176,
    "青海":       1191,
    "宁夏":       1191,
    "新疆":       1191,
    "乌鲁木齐":   1191,
    // 西南
    "重庆":       1191,
    "四川":       1182,  // ★ 2026官方精确折算系数表（四川0#柴=1182）
    "成都":       1182,
    "四川甘孜":   1182,
    "贵州":       1168,  // ★ 贵州省发改委 柴油=1.168
    "贵阳":       1168,
    "云南":       1191,
    "昆明":       1191,
    "西藏":       1176,  // ★ 高海拔密度推算
    "拉萨":       1176,
  },
};

// ── 低温柴油折算系数（-10#/-20#/-35#，东北/西北/华北寒冷温区）──────
// 原理：降凝剂使低温柴密度略低于0#，升/吨系数相应升高
// 数据来源：★黑龙江官方(-35#=1189.05/1187.02) ★甘肃官方 ★内蒙古官方，其余☆邻省推算
const COLD_CONV_MAP: Record<string, Record<string, number>> = {
  "-10#柴": {
    "全国通用":   1195,
    // 东北
    "黑龙江":     1193, "黑龙江南区": 1193, "黑龙江北区": 1188,
    "哈尔滨":     1193, "齐齐哈尔":   1188, "黑河":       1188,
    "吉林":       1193, "长春":       1193,
    "辽宁":       1194, "沈阳":       1194, "大连":       1195,
    // 华北
    "内蒙古":     1188, "内蒙古东部": 1185, "内蒙古西部": 1188,
    "呼和浩特":   1188, "通辽":       1185, "赤峰":       1185,
    "河北":       1191, "石家庄":     1191, "张家口":     1191,
    "山西":       1191, "太原":       1191,
    // 西北
    "陕西":       1195, "西安":       1195,
    "甘肃":       1178, "兰州":       1178,  // ★ 甘肃官方
    "青海":       1193, "西宁":       1193,
    "宁夏":       1193, "银川":       1193,
    "新疆":       1193, "乌鲁木齐":   1193,
    // 西南高原
    "西藏":       1179, "拉萨":       1179,
    "四川甘孜":   1185,
  },
  "-20#柴": {
    "全国通用":   1196,
    // 东北
    "黑龙江":     1194, "黑龙江南区": 1194, "黑龙江北区": 1189,
    "哈尔滨":     1194, "齐齐哈尔":   1189, "黑河":       1189,
    "吉林":       1194, "长春":       1194,
    "辽宁":       1195, "沈阳":       1195, "大连":       1196,
    // 华北
    "内蒙古":     1189, "内蒙古东部": 1186, "内蒙古西部": 1189,
    "呼和浩特":   1189, "通辽":       1186, "赤峰":       1186,
    "河北":       1192, "石家庄":     1192, "张家口":     1192,
    "山西":       1192, "太原":       1192,
    // 西北
    "陕西":       1196, "西安":       1196,
    "甘肃":       1179, "兰州":       1179,
    "青海":       1194, "西宁":       1194,
    "宁夏":       1194, "银川":       1194,
    "新疆":       1194, "乌鲁木齐":   1194,
    // 西南高原
    "西藏":       1180, "拉萨":       1180,
    "四川甘孜":   1186,
  },
  "-35#柴": {
    "全国通用":   1192,
    // 东北
    "黑龙江":     1189, "黑龙江南区": 1189, // ★ 官方2026/05-10 -35#=1189.05
    "黑龙江北区": 1187,                      // ★ 官方北区=1187.02
    "哈尔滨":     1189, "齐齐哈尔":   1187, "黑河":       1187,
    "吉林":       1191, "长春":       1191,
    "辽宁":       1192, "沈阳":       1192, "大连":       1193,
    // 华北
    "内蒙古":     1188, "内蒙古东部": 1185, // ★ 内蒙古官方≈1187.5
    "内蒙古西部": 1188,
    "呼和浩特":   1188, "通辽":       1185, "赤峰":       1185,
    "河北":       1190, "石家庄":     1190, "张家口":     1190,
    "山西":       1190, "太原":       1190,
    // 西北
    "陕西":       1192, "西安":       1192,
    "甘肃":       1178, "兰州":       1178,
    "青海":       1191, "西宁":       1191,
    "宁夏":       1191, "银川":       1191,
    "新疆":       1191, "乌鲁木齐":   1191,
    // 西南高原
    "西藏":       1178, "拉萨":       1178,
    "四川甘孜":   1184,
  },
};

// 温区城市集合（仅这些城市在低温时才切换柴油品号）
const COLD_ZONE = new Set([
  "黑龙江","黑龙江南区","黑龙江北区","哈尔滨","齐齐哈尔","牡丹江","绥化","伊春","黑河",
  "吉林","长春","四平","白城","延边",
  "辽宁","沈阳","大连","鞍山","本溪","铁岭","朝阳",
  "内蒙古","内蒙古东部","内蒙古西部","呼和浩特","包头","通辽","赤峰","呼伦贝尔",
  "河北","石家庄","张家口","承德","唐山",
  "山西","太原","大同","朔州","忻州",
  "陕西","西安","延安","榆林",
  "甘肃","兰州","张掖","酒泉","嘉峪关","武威",
  "青海","西宁","海西","海北",
  "宁夏","银川","固原",
  "新疆","乌鲁木齐","哈密","吐鲁番","喀什","伊犁",
  "西藏","拉萨","日喀则","昌都",
  "四川甘孜",
]);

/** 根据城市+温度自动选择柴油品号键名 */
function getDieselGradeKey(city: string, tempC: number | null): string {
  if (tempC === null || !COLD_ZONE.has(city)) return "0#柴";
  if (tempC <= -15) return "-35#柴";
  if (tempC <=  -5) return "-20#柴";
  if (tempC <=   0) return "-10#柴";
  return "0#柴";
}
// 默认城市（天津有实测系数，其余降级全国通用）
const DEFAULT_CITY = "天津";

const TRIGGER_PCT  = 4.0;
const COOLDOWN_MS  = 3_600_000; // 1h

// ══════════════════════════════════════════════════════════════════
// CNBC 实时价格（主源）+ Yahoo Finance 补充（WTI/Brent 兜底）
// ══════════════════════════════════════════════════════════════════
interface CnbcQuote { symbol: string; name?: string; last?: string; last_time?: string; }

/** Yahoo Finance spark API — 返回 WTI(CL=F) 和 Brent(BZ=F) 实时收盘价（用于 CNBC 兜底） */
async function fetchYahooOil(): Promise<{ wti: number; brent: number }> {
  const resp = await fetch(YAHOO_URL, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Yahoo HTTP ${resp.status}`);
  const json = await resp.json();
  const spark = json?.spark?.result ?? [];
  let wti = 0, brent = 0;
  for (const item of spark) {
    const symbol: string = item?.symbol ?? "";
    const closes: number[] = item?.response?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const last = [...closes].reverse().find((v: number) => v > 0) ?? 0;
    if (symbol === "CL=F")  wti   = last;
    if (symbol === "BZ=F")  brent = last;
  }
  return { wti, brent };
}

/**
 * Yahoo Finance chart API — 近 N 天 BZ=F / CL=F 每日收盘价
 * 仅滞后 1 个交易日，解决 EIA/FRED 8 天滞后问题
 */
async function fetchYahooHistory(
  symbol: string,
  startDate: string,
): Promise<Array<{ period: string; val: number }>> {
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includeTimestamps=true`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includeTimestamps=true`,
  ];
  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) { lastErr = new Error(`Yahoo chart ${symbol} HTTP ${resp.status}`); continue; }
      const json = await resp.json();
      const result = json?.chart?.result?.[0];
      if (!result) { lastErr = new Error(`Yahoo chart ${symbol} 无数据`); continue; }
      const timestamps: number[] = result.timestamp ?? [];
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
      const rows: Array<{ period: string; val: number }> = [];
      for (let i = 0; i < timestamps.length; i++) {
        const dt = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        const v  = closes[i];
        if (dt >= startDate && v > 0) rows.push({ period: dt, val: +v.toFixed(2) });
      }
      rows.sort((a, b) => a.period.localeCompare(b.period));
      console.log(`[Yahoo] ${symbol} history: ${rows.length} 行 from ${startDate}`);
      return rows;
    } catch (e) { lastErr = e as Error; }
  }
  throw lastErr ?? new Error(`Yahoo ${symbol} 历史数据获取失败`);
}

async function fetchCnbcRealtime(): Promise<{ brent: number; wti: number; dubai: number; brentTime: string }> {
  // CNBC 主源 + Yahoo 补充并行抓取
  const [cnbcRes, yahooRes] = await Promise.allSettled([
    fetch(CNBC_URL, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.cnbc.com" },
      signal: AbortSignal.timeout(10000),
    }).then(r => { if (!r.ok) throw new Error(`CNBC HTTP ${r.status}`); return r.json(); }),
    fetchYahooOil(),
  ]);

  // 解析 CNBC
  let brent = 0, wti = 0, dubai = 0, brentTime = "";
  if (cnbcRes.status === "fulfilled") {
    const quotes: CnbcQuote[] = cnbcRes.value?.FormattedQuoteResult?.FormattedQuote ?? [];
    for (const q of quotes) {
      const price = parseFloat(q.last ?? "0");
      if (!price || price <= 0) continue;
      if (q.symbol === "@LCO.1") { brent = price; brentTime = q.last_time ?? ""; }
      if (q.symbol === "@CL.1")  { wti   = price; }
      if (q.symbol === "@MCO.1") { dubai = price; }
    }
  } else {
    console.warn("[原油] CNBC失败:", cnbcRes.reason);
  }

  // Yahoo 补充：CNBC 缺失时用 Yahoo 值
  if (yahooRes.status === "fulfilled") {
    const y = yahooRes.value;
    if (brent <= 0 && y.brent > 0) { brent = y.brent; console.log(`[原油] Yahoo Brent兜底=$${brent}`); }
    if (wti   <= 0 && y.wti   > 0) { wti   = y.wti;   console.log(`[原油] Yahoo WTI兜底=$${wti}`); }
    // CNBC WTI 有时偏差较大，Yahoo 为更准确的合约价格，优先用 Yahoo WTI
    if (y.wti > 0 && Math.abs(y.wti - wti) < 5) { wti = y.wti; }
    console.log(`[原油] Yahoo CL=F=$${y.wti} BZ=F=$${y.brent}`);
  } else {
    console.warn("[原油] Yahoo失败:", yahooRes.reason);
  }

  if (brent <= 0) throw new Error("CNBC+Yahoo Brent 均无效");
  // WTI 仍无效则固定利差降级
  if (wti <= 0) { wti = +(brent - 2.5).toFixed(2); console.warn(`[原油] WTI全源失败，降级brent-2.5=$${wti}`); }
  // 阿曼：CNBC @MCO.1 长期不返回，用 brent-2.0（历史 Brent/Oman 利差约 1.5-2.5，均值约2.0）
  if (dubai <= 0) { dubai = +(brent - 2.0).toFixed(2); console.log(`[原油] 阿曼降级brent-2.0=$${dubai}`); }
  return { brent, wti, dubai, brentTime };
}

// ══════════════════════════════════════════════════════════════════
// 多源原油历史窗口均价
//   优先级：FRED（Platts Dated Brent 同源，免费）→ Alpha Vantage → EIA 直连
//   缺失工作日用 CNBC 实时价填充，避免旧价外推造成均价偏高
//   Dubai/阿曼：改用 WTI - 4.0（中质含硫品质折扣，远比 Brent-2.0 准确）
// ══════════════════════════════════════════════════════════════════

/** FRED 免费 CSV — DCOILBRENTEU = Platts Dated Brent spot，与发改委口径一致 */
async function fetchFredSeries(
  seriesId: string,
  startDate: string,
): Promise<Array<{ period: string; val: number }>> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/csv" },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`FRED ${seriesId} HTTP ${resp.status}`);
  const text = await resp.text();
  const rows: Array<{ period: string; val: number }> = [];
  for (const line of text.split("\n").slice(1)) {
    const parts = line.split(",");
    const d = parts[0]?.trim();
    const v = parseFloat(parts[1]?.trim() ?? "");
    if (d && d >= startDate && v > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d)) rows.push({ period: d, val: v });
  }
  console.log(`[FRED] ${seriesId}: ${rows.length} 行 from ${startDate}`);
  return rows.slice(-15);
}

/** Alpha Vantage commodity daily — EIA 同源但更新更快（500次/天免费） */
async function fetchAvDaily(
  commodity: "BRENT" | "WTI",
  startDate: string,
): Promise<Array<{ period: string; val: number }>> {
  if (!AV_KEY) throw new Error("AV_KEY 未配置");
  const url = `https://www.alphavantage.co/query?function=${commodity}&interval=daily&apikey=${AV_KEY}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`AV ${commodity} HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.Information) throw new Error(`AV 限流: ${json.Information}`);
  const raw: Array<{ date: string; value: string }> = json.data ?? [];
  // AV 返回最新在前，reverse 转升序
  const rows = raw
    .filter(r => r.date >= startDate && parseFloat(r.value) > 0)
    .map(r => ({ period: r.date, val: parseFloat(r.value) }))
    .reverse()
    .slice(0, 12);
  console.log(`[AV] ${commodity}: ${rows.length} 行 from ${startDate}`);
  return rows;
}

/**
 * 三品种窗口均价
 * 数据源优先级：Yahoo 日K（主，仅滞后1天）→ FRED（权威验证）→ AV → EIA → 实时盘价填充
 */
async function fetchWindowAvg(
  lastAdjustDate?: string,
  realtimeBrent = 0,
  realtimeWti   = 0,
): Promise<{
  avg10d: number; dataDate: string; days: number; startDate: string;
  avgBrent: number; avgWti: number; avgDubai: number;
}> {
  function nextWorkday(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function isWorkday(ds: string): boolean {
    const day = new Date(ds + "T12:00:00Z").getUTCDay();
    return day !== 0 && day !== 6;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let windowStart = "";
  if (lastAdjustDate && /^\d{4}-\d{2}-\d{2}$/.test(lastAdjustDate)) {
    windowStart = nextWorkday(lastAdjustDate);
  } else {
    windowStart = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    console.log(`[窗口] 无调价日，降级近14天 start=${windowStart}`);
  }
  // Yahoo 多取5天，保证窗口起始日有数据
  const yahooStart = new Date(Date.parse(windowStart) - 5 * 86400_000).toISOString().slice(0, 10);
  console.log(`[窗口] start=${windowStart} end=${todayStr} (Yahoo从${yahooStart}拉取)`);

  // ── 1. 并行拉：Yahoo(主) + FRED(验证) + AV(补充) ──────────────────────
  const [yahooBreRes, yahooWtiRes, fredBrentRes, fredWtiRes, avBrentRes, avWtiRes] =
    await Promise.allSettled([
      fetchYahooHistory("BZ=F", yahooStart),
      fetchYahooHistory("CL=F", yahooStart),
      fetchFredSeries("DCOILBRENTEU", windowStart),
      fetchFredSeries("DCOILWTICO",   windowStart),
      fetchAvDaily("BRENT", windowStart),
      fetchAvDaily("WTI",   windowStart),
    ]);

  const brentMap = new Map<string, number>();
  const wtiMap   = new Map<string, number>();

  // ① Yahoo 日K — 主源（无 EIA 滞后，先填入）
  if (yahooBreRes.status === "fulfilled") {
    for (const r of yahooBreRes.value) if (r.period >= windowStart) brentMap.set(r.period, r.val);
    console.log(`[窗口] Yahoo Brent 覆盖 ${brentMap.size} 天`);
  } else console.warn("[窗口] Yahoo Brent 失败:", (yahooBreRes.reason as Error)?.message);
  if (yahooWtiRes.status === "fulfilled") {
    for (const r of yahooWtiRes.value) if (r.period >= windowStart) wtiMap.set(r.period, r.val);
  } else console.warn("[窗口] Yahoo WTI 失败:", (yahooWtiRes.reason as Error)?.message);

  // ② FRED — Platts Dated Brent，覆盖 Yahoo（权威口径，有数据时优先）
  if (fredBrentRes.status === "fulfilled") {
    for (const r of fredBrentRes.value) brentMap.set(r.period, r.val);
  } else console.warn("[窗口] FRED Brent 失败:", (fredBrentRes.reason as Error)?.message);
  if (fredWtiRes.status === "fulfilled") {
    for (const r of fredWtiRes.value) wtiMap.set(r.period, r.val);
  } else console.warn("[窗口] FRED WTI 失败:", (fredWtiRes.reason as Error)?.message);

  // ③ AV 补充（FRED 未覆盖的日期）
  if (avBrentRes.status === "fulfilled") {
    for (const r of avBrentRes.value) if (!brentMap.has(r.period)) brentMap.set(r.period, r.val);
  } else console.warn("[窗口] AV Brent 失败:", (avBrentRes.reason as Error)?.message);
  if (avWtiRes.status === "fulfilled") {
    for (const r of avWtiRes.value) if (!wtiMap.has(r.period)) wtiMap.set(r.period, r.val);
  } else console.warn("[窗口] AV WTI 失败:", (avWtiRes.reason as Error)?.message);

  // ④ EIA 直连兜底（仅 Yahoo+FRED+AV 均失败时）
  if (brentMap.size === 0) {
    console.warn("[窗口] Yahoo+FRED+AV 均失败，降级 EIA 直连");
    const makeEiaParams = (product: string) => new URLSearchParams({
      api_key: EIA_KEY, frequency: "daily",
      "data[0]": "value", "sort[0][column]": "period", "sort[0][direction]": "asc", length: "15",
      "facets[product][]": product, start: windowStart, end: todayStr,
    }).toString();
    const [eiaB, eiaW] = await Promise.allSettled([
      fetch(`${EIA_BASE}?${makeEiaParams("EPCBRENT")}`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      fetch(`${EIA_BASE}?${makeEiaParams("EPCRWTI")}`,  { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
    ]);
    if (eiaB.status === "fulfilled")
      for (const r of eiaB.value?.response?.data ?? []) { const v = parseFloat(r.value); if (v > 0) brentMap.set(r.period, v); }
    if (eiaW.status === "fulfilled")
      for (const r of eiaW.value?.response?.data ?? []) { const v = parseFloat(r.value); if (v > 0) wtiMap.set(r.period, v); }
  }
  if (brentMap.size === 0) throw new Error("所有数据源均失败，无法获取 Brent 窗口数据");

  // ── 2. 枚举窗口工作日，用实时盘价填充当日缺失 ──────────────────────────
  const windowDays: string[] = [];
  const cur = new Date(windowStart + "T12:00:00Z");
  const yest = new Date(todayStr + "T12:00:00Z");
  yest.setUTCDate(yest.getUTCDate() - 1);
  while (cur <= yest) {
    const ds = cur.toISOString().slice(0, 10);
    if (isWorkday(ds)) windowDays.push(ds);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  const effectiveDays = windowDays.slice(0, 10);

  let fillCount = 0;
  for (const day of effectiveDays) {
    if (!brentMap.has(day) && realtimeBrent > 0) { brentMap.set(day, realtimeBrent); fillCount++; }
    if (!wtiMap.has(day)   && realtimeWti   > 0)   wtiMap.set(day, realtimeWti);
  }
  if (fillCount > 0) console.log(`[窗口] 实时盘价填充 ${fillCount} 个缺失工作日（Brent=$${realtimeBrent} WTI=$${realtimeWti}）`);

  // ── 3. 计算各品种窗口均价 ────────────────────────────────────────────────
  const brentRows = effectiveDays.filter(d => brentMap.has(d)).map(d => brentMap.get(d)!);
  const wtiRows   = effectiveDays.filter(d => wtiMap.has(d)).map(d => wtiMap.get(d)!);
  if (brentRows.length === 0) throw new Error("窗口内无有效 Brent 数据");

  const avgBrent = +(brentRows.reduce((a, v) => a + v, 0) / brentRows.length).toFixed(2);
  const avgWti   = wtiRows.length > 0
    ? +(wtiRows.reduce((a, v) => a + v, 0) / wtiRows.length).toFixed(2)
    : +(avgBrent - 3.5).toFixed(2);
  const avgDubai = +(avgWti - 4.0).toFixed(2);
  const avg10d   = +((avgBrent * 4 + avgDubai * 3 + avgWti * 3) / 10).toFixed(2);
  const startDate = effectiveDays.find(d => brentMap.has(d)) ?? windowStart;
  const dataDate  = [...effectiveDays].reverse().find(d => brentMap.has(d)) ?? todayStr;
  const days      = brentRows.length;

  const detail = effectiveDays.map(d => `${d}=\$${brentMap.get(d)?.toFixed(1) ?? "?"}`).join(" ");
  console.log(`[窗口] Brent 明细: ${detail}`);
  console.log(`[窗口] 三品种均价: 布伦特=$${avgBrent}(${days}天) 阿曼≈$${avgDubai}(WTI-4.0) WTI=$${avgWti}(${wtiRows.length}天) 一揽子=$${avg10d} ${startDate}→${dataDate} 实时填充=${fillCount}天`);
  return { avg10d, dataDate, days, startDate, avgBrent, avgWti, avgDubai };
}

// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// 实时汇率：USD → CNY（集成平台 currency-exchange-rate）
// 失败时降级 RMB_RATE_FALLBACK
// ══════════════════════════════════════════════════════════════════
async function fetchRmbRate(apiKey: string): Promise<{ rate: number; updatetime: string; source: string }> {
  const resp = await fetch(EXCHANGE_RATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Gateway-Authorization": `Bearer ${apiKey}`,
    },
    body: new URLSearchParams({ fromCode: "USD" }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`汇率 API HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.code !== 200) throw new Error(`汇率 API 错误 ${json.code}: ${json.msg}`);
  const cnyItem = json.data?.list?.["CNY"];
  if (!cnyItem) throw new Error("汇率响应无 CNY 字段");
  const rate = parseFloat(cnyItem.rate);
  if (!rate || rate <= 0) throw new Error(`汇率无效: ${cnyItem.rate}`);
  return { rate: +rate.toFixed(4), updatetime: cnyItem.updatetime ?? "", source: "realtime" };
}

// ══════════════════════════════════════════════════════════════════
// 税费联动公式测算（发改委规则 v8）
//
// ΔP   = 本期均价(avg10d) − 上期均价(lastCycleAvg)
// 变化率 = ΔP ÷ 上期均价 × 100%
// ΔC(元/吨) = ΔP × R × 桶/吨 × (1 + T1 + T1×T2) + K
// 每升调幅  = ΔC ÷ 折算系数(升/吨)
//
// 降级策略（数据不完整时）：
//   avg10d 无数据    → 用 brent 当日盘价代替本期均价
//   lastCycleAvg 无  → 用 avg10d 作为上期均价（变化率≈0）
// ══════════════════════════════════════════════════════════════════
interface GradeResult {
  grade: string;
  convFactor: number;    // 升/吨
  deltaPerLiter: number; // 元/升
}

function calcChange(
  brent: number,
  lastCycleAvg: number,
  eia10dAvg: number,
  rmbRate: number,
  city = DEFAULT_CITY,
  tempC: number | null = null,
  dbCoeff?: { c92?: number; c95?: number; c0?: number; c98?: number },   // ★ DB折算系数（优先级最高）
  basketAvg = 0,   // 一揽子加权均价（布伦特×40%+阿曼×30%+米纳斯×30%），>0 时替换本期均价基准
) {
  // ── 本期均价：一揽子均价 > EIA 10日均价 > 当日布伦特盘价 ──
  const curAvg  = basketAvg > 0 ? basketAvg : (eia10dAvg > 0 ? eia10dAvg : brent);
  // ── 上期均价：优先 crude_last_cycle_avg，无则用本期均价（变化率趋近0）──
  const prevAvg = lastCycleAvg > 0 ? lastCycleAvg : curAvg;

  // ── ΔP = 本期均价 − 上期均价 ──
  const rawDiff = curAvg - prevAvg;
  const rate    = prevAvg > 0 ? +((rawDiff / prevAvg) * 100).toFixed(2) : 0;
  const trigger = Math.abs(rate) >= TRIGGER_PCT;

  const curLabel  = basketAvg > 0 ? `一揽子$${curAvg.toFixed(1)}`
    : eia10dAvg > 0 ? `本期均$${curAvg.toFixed(1)}` : `盘价$${curAvg.toFixed(1)}`;
  const prevLabel = lastCycleAvg > 0 ? `上期均$${prevAvg.toFixed(1)}` : `参考$${prevAvg.toFixed(1)}`;
  const label = `${curLabel} vs ${prevLabel}`;

  // ── 税费联动公式：ΔC(元/吨)，使用实时汇率 ──
  const deltaTon = +(rawDiff * rmbRate * BARREL_PER_TON * TAX_MULTIPLIER + K).toFixed(2);

  // ── 城市标准化（去掉市/省/区/县后缀）──
  const cityKey = city.replace(/[市省区县]$/, "");

  // ── 柴油品号（温度修正）──
  const dieselGrade = getDieselGradeKey(cityKey, tempC);

  // ── 各油品折算：① DB官方精确值 ② 低温COLD_CONV_MAP ③ 硬编码CONV_MAP ────
  function getConv(grade: string): number {
    // ① DB 官方精确值最优先（来自 Excel 导入的官方折算系数表）
    if (dbCoeff) {
      if ((grade === "92#") && dbCoeff.c92 && dbCoeff.c92 > 0) return dbCoeff.c92;
      if ((grade === "95#") && dbCoeff.c95 && dbCoeff.c95 > 0) return dbCoeff.c95;
      if ((grade === "98#") && dbCoeff.c98 && dbCoeff.c98 > 0) return dbCoeff.c98;
      if ((grade === "0#柴" || grade === "-10#柴" || grade === "-20#柴" || grade === "-35#柴")
          && dbCoeff.c0 && dbCoeff.c0 > 0) return dbCoeff.c0;
    }
    // ② 低温柴油查 COLD_CONV_MAP
    const coldSrc = COLD_CONV_MAP[grade];
    if (coldSrc) {
      return coldSrc[cityKey] ?? coldSrc[city] ?? coldSrc["全国通用"]
        ?? CONV_MAP["0#柴"]?.[cityKey]
        ?? CONV_MAP["0#柴"]?.["全国通用"] ?? 1191;
    }
    // ③ 硬编码 CONV_MAP 兜底
    const src = CONV_MAP[grade];
    return src?.[cityKey] ?? src?.[city] ?? src?.["全国通用"] ?? 1318;
  }

  const grades: GradeResult[] = ["92#", "95#", "98#", dieselGrade].map(g => {
    const conv = getConv(g);
    const dpl  = +(deltaTon / conv).toFixed(3);
    return { grade: g, convFactor: conv, deltaPerLiter: dpl };
  });

  // 主展示取 92# 系数（兼容旧字段 delta/deltaLow/deltaHigh）
  const mainDelta = grades[0].deltaPerLiter;

  let text: string;
  if (!trigger) {
    text = `${label}，变化率${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%，距门槛差${(TRIGGER_PCT - Math.abs(rate)).toFixed(1)}%`;
  } else {
    const dir = rawDiff > 0 ? "上调" : "下调";
    const g = grades.map(r => `${r.grade}${mainDelta >= 0 ? "+" : ""}${r.deltaPerLiter.toFixed(2)}`).join(" / ");
    text = `${label}，变化率${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%，预计${dir} ${g} 元/升`;
  }

  return {
    rate, trigger, base: curAvg, label,
    deltaTon,
    delta:       mainDelta,
    deltaLow:    mainDelta,
    deltaHigh:   mainDelta,
    grades,
    dieselGrade,
    text,
    formulaParams: { deltaP: +rawDiff.toFixed(2), R: rmbRate, barrelPerTon: BARREL_PER_TON, T1, T2, K, deltaTon },
  };
}

// ══════════════════════════════════════════════════════════════════
// 主服务
// ══════════════════════════════════════════════════════════════════
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  let force = false;
  let reqLastAdjustDateOverride = ""; // 允许请求体直接传入覆盖 DB 的 lastAdjustDate
  try {
    const b = await req.json();
    force = b?.force === true;
    if (b?.lastAdjustDate && /^\d{4}-\d{2}-\d{2}$/.test(b.lastAdjustDate)) {
      reqLastAdjustDateOverride = b.lastAdjustDate;
    }
  } catch { /* default */ }

  // ── 解析请求参数：city + temp（供柴油温区切换使用）──
  let reqCity  = DEFAULT_CITY;
  let reqTempC: number | null = null;
  try {
    const b = await req.clone().json().catch(() => ({}));
    if (b?.city  && typeof b.city  === "string") reqCity  = b.city;
    if (b?.tempC != null && !isNaN(Number(b.tempC))) reqTempC = Number(b.tempC);
  } catch { /* ignore */ }

  // ── 冷却检查（同时读取 lastCycleAvg + 动态系数 + 手动锁定）──
  const { data: cached } = await db
    .from("oil_prices")
    .select("crude_brent,crude_wti,crude_dubai,crude_avg10d,crude_last_cycle_avg,crude_last_cycle_locked,crude_last_cycle_manual,crude_change_rate,crude_calc_text,crude_updated_at,crude_coeff_low,crude_coeff_high,crude_coeff_n,crude_avg10d_source,crude_rmb_rate,crude_avg10d_locked,crude_avg10d_manual,conv_coeff_92,conv_coeff_95,conv_coeff_98,conv_coeff_0,last_adjust_date,crude_basket_days,crude_basket_start")
    .eq("city", "天津").maybeSingle();

  // 上次调价日：请求体覆盖 > DB值
  const lastAdjustDate: string = reqLastAdjustDateOverride || cached?.last_adjust_date || "";

  // 若请求体传入了 lastAdjustDate 覆盖值，同步写回所有城市 DB（幂等）
  if (reqLastAdjustDateOverride) {
    await db.from("oil_prices").update({ last_adjust_date: reqLastAdjustDateOverride }).neq("city", "");
    console.log(`[原油] lastAdjustDate 已覆盖并写库: ${reqLastAdjustDateOverride}`);
  }

  // 管理员手动锁定本期均价：锁定时不走 EIA/AI 抓取，直接用手动值
  const isManualLocked = cached?.crude_avg10d_locked === true && Number(cached?.crude_avg10d_manual) > 0;
  const manualAvg10d   = isManualLocked ? Number(cached!.crude_avg10d_manual) : 0;
  if (isManualLocked) {
    console.log(`[原油] 本期均价已手动锁定=$${manualAvg10d}，跳过EIA/AI抓取`);
  }

  // 管理员手动锁定上期均价：锁定时 EF 写库不覆盖 crude_last_cycle_avg
  const isLastCycleLocked = cached?.crude_last_cycle_locked === true && Number(cached?.crude_last_cycle_manual ?? cached?.crude_last_cycle_avg) > 0;
  if (isLastCycleLocked) {
    console.log(`[原油] 上期均价已手动锁定=$${cached!.crude_last_cycle_manual ?? cached!.crude_last_cycle_avg}，本次不覆盖`);
  }

  // ── 读取请求城市的官方折算系数（DB优先；天津城市直接复用cached）──
  let dbCoeff: { c92?: number; c95?: number; c0?: number; c98?: number } | undefined;
  const reqCityKey = reqCity.replace(/[市省区县]$/, "");
  if (reqCityKey === "天津" || reqCity === "天津") {
    dbCoeff = {
      c92: Number(cached?.conv_coeff_92) > 0 ? Number(cached!.conv_coeff_92) : undefined,
      c95: Number(cached?.conv_coeff_95) > 0 ? Number(cached!.conv_coeff_95) : undefined,
      c98: Number((cached as any)?.conv_coeff_98) > 0 ? Number((cached as any).conv_coeff_98) : undefined,
      c0:  Number(cached?.conv_coeff_0)  > 0 ? Number(cached!.conv_coeff_0)  : undefined,
    };
  } else {
    const { data: cityRow } = await db.from("oil_prices")
      .select("conv_coeff_92,conv_coeff_95,conv_coeff_98,conv_coeff_0")
      .eq("city", reqCityKey).maybeSingle();
    if (cityRow) {
      dbCoeff = {
        c92: Number(cityRow.conv_coeff_92) > 0 ? Number(cityRow.conv_coeff_92) : undefined,
        c95: Number(cityRow.conv_coeff_95) > 0 ? Number(cityRow.conv_coeff_95) : undefined,
        c98: Number((cityRow as any).conv_coeff_98) > 0 ? Number((cityRow as any).conv_coeff_98) : undefined,
        c0:  Number(cityRow.conv_coeff_0)  > 0 ? Number(cityRow.conv_coeff_0)  : undefined,
      };
    }
  }
  if (dbCoeff?.c92) console.log(`[折算] DB系数 city=${reqCityKey} 92#=${dbCoeff.c92} 95#=${dbCoeff.c95} 98#=${dbCoeff.c98} 0#=${dbCoeff.c0}`);

    if (!force && Number(cached?.crude_brent) > 0 && cached?.crude_updated_at) {
      if (Date.now() - new Date(cached.crude_updated_at).getTime() < COOLDOWN_MS) {
        // skipped 分支：用降级汇率重算（冷却期内不消耗汇率 API 额度）
        const sBrent     = Number(cached.crude_brent);
        const sWti       = Number(cached.crude_wti ?? 0) > 0 ? Number(cached.crude_wti) : +(sBrent - 2.5).toFixed(1);
        const sDubai     = Number(cached.crude_dubai ?? 0) > 0 ? Number(cached.crude_dubai) : +(sBrent - 2.0).toFixed(1);
        const sLastCycle = Number(cached.crude_last_cycle_avg ?? 0);
        const sAvg10d    = isManualLocked ? manualAvg10d : Number(cached.crude_avg10d ?? 0);
        const sRmbRate   = Number(cached.crude_rmb_rate ?? 0) > 0 ? Number(cached.crude_rmb_rate) : RMB_RATE_FALLBACK;
        // 一揽子加权均价（缓存命中时本地重算）
        // 用 DB 缓存的 basket_days 推断利差，或直接用固定利差兜底
        const sCachedDays  = Number(cached.crude_basket_days ?? 0);
        // basketStart：优先用 nextWorkday(lastAdjustDate) 确保调价后自动更新至新周期起始日
        // 不能直接用缓存的 crude_basket_start，否则调价后起始日不会跟着滚动
        const sBasketStart = lastAdjustDate
          ? nextWorkday(lastAdjustDate)
          : (cached.crude_basket_start || undefined);
        const sCachedBasketBrent = sBrent;
        const sCachedBasketDubai = +(sBrent - 8.5).toFixed(2);
        const sCachedBasketMinas = +(sBrent - 11.7).toFixed(2);
        const sBasketAvg = sAvg10d > 0
          ? sAvg10d
          : +((sCachedBasketBrent * 4 + sCachedBasketDubai * 3 + sCachedBasketMinas * 3) / 10).toFixed(2);
        const sCalc      = calcChange(sBrent, sLastCycle, sAvg10d, sRmbRate, reqCity, reqTempC, dbCoeff, sBasketAvg);
        // rmbSource：DB缓存值有效则标 'realtime'（来自上次真实 API），否则标 'fallback'
        const sRmbSource = Number(cached.crude_rmb_rate ?? 0) > 0 ? "realtime" : "fallback";
        return new Response(JSON.stringify({
          status: 1, skipped: true, message: "1h内已更新",
          data: {
            brent: cached.crude_brent, wti: cached.crude_wti, dubai: cached.crude_dubai,
            basketAvg: sBasketAvg,
            basketBrent: sCachedBasketBrent,
            basketDubai: sCachedBasketDubai,
            basketMinas: sCachedBasketMinas,
            basketDays: sCachedDays || undefined,
            basketStart: sBasketStart,
            avg10d: sAvg10d,
            lastCycleAvg: cached.crude_last_cycle_avg,
            changeRate: cached.crude_change_rate,
            calcText: cached.crude_calc_text, updatedAt: cached.crude_updated_at,
            rmbRate: sRmbRate, rmbSource: sRmbSource,
            estimatedDelta: sCalc.delta,
            deltaLow: sCalc.deltaLow, deltaHigh: sCalc.deltaHigh,
            deltaTon: sCalc.deltaTon,
            grades: sCalc.grades,
            dieselGrade: sCalc.dieselGrade,
            formulaParams: sCalc.formulaParams,
            willTrigger: sCalc.trigger,
            avg10dSource: isManualLocked ? "manual_locked" : (cached.crude_avg10d_source ?? "cache"),
          },
        }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
      }
    }

  // ── 三路并行：CNBC实时价 + EIA三品种窗口均价 + 实时汇率 ──
  const integKey = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
  // 先拿 CNBC 实时盘价，用实时利差传给 EIA（阿曼用布伦特-利差推算）
  const [cnbcRes, rmbRes] = await Promise.allSettled([
    fetchCnbcRealtime(),
    fetchRmbRate(integKey),
  ]);

  // CNBC 实时价（主数据源，失败则整体中止）
  if (cnbcRes.status === "rejected") {
    console.error("[原油] CNBC失败:", cnbcRes.reason);
    return new Response(JSON.stringify({ status: -1, error: `实时价获取失败: ${cnbcRes.reason}` }),
      { status: 503, headers: { "Content-Type": "application/json", ...CORS } });
  }
  const { brent, wti, dubai, brentTime } = cnbcRes.value;
  console.log(`[原油] CNBC Brent=$${brent} WTI=$${wti} 阿曼=$${dubai} time=${brentTime}`);

  // 实时 Brent/阿曼 利差（用于 EIA 窗口三品种推算）
  const brentDiff = brent > 0 && dubai > 0 ? +(brent - dubai).toFixed(2) : 2.0;

  // EIA 三品种窗口均价（锁定时直接用手动值）
  let avg10d = 0, dataDate = "", avg10dSource = "eia";
  let eiaBasketDays = 0, eiaBasketStart = "";
  let basketBrent = 0, basketDubai = 0, basketMinas = 0;

  if (isManualLocked) {
    avg10d         = manualAvg10d;
    avg10dSource   = "manual_locked";
    eiaBasketDays  = Number(cached?.crude_basket_days ?? 0);
    eiaBasketStart = cached?.crude_basket_start ?? "";
    // 手动锁定时三品种均价用正确利差推算（迪拜≈Brent-8.5，米纳斯≈Brent-11.7）
    basketBrent = avg10d;
    basketDubai = +(avg10d - 8.5).toFixed(2);
    basketMinas = +(avg10d - 11.7).toFixed(2);
  } else {
    const eiaRes = await fetchWindowAvg(lastAdjustDate, brent, wti).catch(e => e);
    if (!(eiaRes instanceof Error)) {
      avg10d         = eiaRes.avg10d;
      dataDate       = eiaRes.dataDate;
      eiaBasketDays  = eiaRes.days;
      eiaBasketStart = eiaRes.startDate;
      basketBrent    = eiaRes.avgBrent;
      basketDubai    = eiaRes.avgDubai;
      basketMinas    = eiaRes.avgWti;   // WTI 作为米纳斯替代
      console.log(`[原油] EIA三品种窗口: 布伦特=$${basketBrent} 阿曼≈$${basketDubai} WTI=$${basketMinas} 一揽子=$${avg10d} ${eiaBasketDays}天`);
    } else {
      console.warn("[原油] EIA失败，降级实时盘价推算一揽子：", eiaRes.message);
      // EIA失败时，一揽子三品种直接用实时盘价（而非旧的avg10d缓存）
      // 这样 basketAvg 仍然反映当前市场价，不会因历史缓存拉偏测算结果
      basketBrent = brent;
      basketDubai = +(brent - 8.5).toFixed(2);   // 迪拜现货约 Brent-8.5
      basketMinas = +(brent - 11.7).toFixed(2);  // 米纳斯约 Brent-11.7（迪拜-3.2）
      // avg10d 降级：优先DB缓存（若合理），否则用实时brent
      const cachedVal = Number(cached?.crude_avg10d ?? 0);
      // 缓存值与实时盘价偏差超过15%时视为过期，直接用实时盘价
      const cacheStale = cachedVal <= 0 || Math.abs(cachedVal - brent) / brent > 0.15;
      if (!cacheStale) {
        avg10d         = cachedVal;
        avg10dSource   = "cache";
        eiaBasketDays  = Number(cached?.crude_basket_days ?? 0);
        eiaBasketStart = cached?.crude_basket_start ?? "";
        console.log(`[原油] 降级EIA缓存均价=$${avg10d} 窗口${eiaBasketDays}天`);
      } else {
        avg10d         = brent;
        avg10dSource   = "brent_fallback";
        console.log(`[原油] EIA缓存过期($${cachedVal} vs 实时$${brent})，用实时盘价代替`);
      }
    }
  }
  if (avg10d <= 0) {
    avg10d       = brent;
    avg10dSource = "brent_fallback";
    basketBrent  = brent;
    basketDubai  = +(brent - brentDiff).toFixed(2);
    basketMinas  = +(brent - 2.5).toFixed(2);
    console.warn(`[原油] 均价全部失败，终极兜底盘价=$${avg10d}`);
  }

  // 实时汇率（失败降级固定值 7.25）
  let rmbRate = RMB_RATE_FALLBACK;
  let rmbRateTime = "";
  let rmbSource = "fallback";
  if (rmbRes.status === "fulfilled") {
    rmbRate = rmbRes.value.rate;
    rmbRateTime = rmbRes.value.updatetime;
    rmbSource = rmbRes.value.source;
    console.log(`[原油] 实时汇率 USD/CNY=${rmbRate} (${rmbRateTime})`);
  } else {
    console.warn(`[原油] 汇率API失败，降级 ${RMB_RATE_FALLBACK}:`, rmbRes.reason);
  }

  // ── 发改委基准（上期均价锁定时优先取手动值）──
  const lastCycleAvg = isLastCycleLocked
    ? (Number(cached!.crude_last_cycle_manual) > 0 ? Number(cached!.crude_last_cycle_manual) : Number(cached!.crude_last_cycle_avg))
    : (Number(cached?.crude_last_cycle_avg) > 0 ? Number(cached!.crude_last_cycle_avg) : 0);
  console.log(`[原油] 基准: lastCycleAvg=$${lastCycleAvg}${isLastCycleLocked ? "(已锁定)" : ""} EIA一揽子=$${avg10d}`);
  console.log(`[原油] 公式: ΔP×${rmbRate}(${rmbSource})×${BARREL_PER_TON}×${TAX_MULTIPLIER.toFixed(4)}+${K}`);

  // ── 一揽子加权均价（布伦特:阿曼:WTI = 4:3:3，各自独立10日窗口均价）──
  const basketAvg   = +((basketBrent * 4 + basketDubai * 3 + basketMinas * 3) / 10).toFixed(2);
  const basketDays  = eiaBasketDays > 0 ? eiaBasketDays : 0;
  const basketStart = eiaBasketStart || lastAdjustDate;
  console.log(`[原油] 一揽子均价=$${basketAvg} 布伦特10d=$${basketBrent} 阿曼≈$${basketDubai}(利差${brentDiff}) WTI10d=$${basketMinas} ${basketDays}天 from=${basketStart}`);

  const calc = calcChange(brent, lastCycleAvg, avg10d, rmbRate, reqCity, reqTempC, dbCoeff, basketAvg);
  console.log(`[原油] 变化率=${calc.rate}% ΔC=${calc.deltaTon}元/吨 柴油品号=${calc.dieselGrade} city=${reqCity} temp=${reqTempC ?? 'N/A'} → "${calc.text}"`);

  // ── 写入所有城市（含实时汇率字段）──
  const now = new Date().toISOString();
  // basketAvg > 0 时直接用一揽子均价替代 EIA avg10d（实时性更高，adjust-hook 轮换时也读此字段）
  const effectiveAvg10d = !isManualLocked && basketAvg > 0 ? basketAvg : avg10d;
  const effectiveSource = !isManualLocked && basketAvg > 0 ? "basket_realtime" : avg10dSource;
  const avg10dPatch: Record<string, unknown> = isManualLocked
    ? {}
    : { crude_avg10d: effectiveAvg10d, crude_avg10d_source: effectiveSource };
  const lastCyclePatch: Record<string, unknown> = isLastCycleLocked
    ? {}
    : {};  // 上期均价由 adjust-hook 轮换写入，EF 本身不主动覆盖
  const { error: upErr } = await db.from("oil_prices").update({
    crude_brent:        brent,
    crude_wti:          wti > 0 ? wti : +(brent - 2.5).toFixed(1),
    crude_dubai:        dubai,
    crude_change_rate:  calc.rate,
    crude_calc_text:    calc.text,
    crude_updated_at:   now,
    crude_rmb_rate:     rmbRate,
    crude_basket_days:  basketDays > 0 ? basketDays : null,
    crude_basket_start: basketStart || null,
    ...avg10dPatch,
    ...lastCyclePatch,
  }).neq("city", "__placeholder__");
  if (upErr) console.error("[原油] 写库失败:", upErr);

  // ── 超门槛联动走势预测 ──
  let trendUpdated = false;
  if (calc.trigger && calc.delta !== 0) {
    const dir = calc.delta > 0 ? "上调" : "下调";
    const g92 = calc.grades[0];
    const trendText = `预计${dir} 92#${calc.delta >= 0 ? "+" : ""}${g92.deltaPerLiter.toFixed(2)}元/升（税费联动+汇率${rmbRate}）`;
    const { error: te } = await db.from("oil_prices")
      .update({ next_trend: calc.delta, next_trend_text: trendText, trend_updated_at: now })
      .neq("city", "__placeholder__");
    if (!te) { trendUpdated = true; console.log("[原油] 联动走势:", trendText); }
  }

  return new Response(JSON.stringify({
    status: 1,
    message: `原油更新成功（税费联动+实时汇率${rmbSource === "realtime" ? rmbRate : "降级" + RMB_RATE_FALLBACK}）${trendUpdated ? "，联动走势预测" : ""}${isManualLocked ? "，均价已手动锁定" : ""}`,
    data: {
      brent, wti, dubai, basketAvg, basketDays, basketStart,
      basketBrent, basketDubai, basketMinas,
      avg10d: effectiveAvg10d, lastCycleAvg,
      base: calc.base, baseLabel: calc.label,
      changeRate: calc.rate, calcText: calc.text,
      estimatedDelta: calc.delta,
      deltaLow: calc.deltaLow, deltaHigh: calc.deltaHigh,
      deltaTon: calc.deltaTon,
      grades: calc.grades,
      dieselGrade: calc.dieselGrade,
      formulaParams: calc.formulaParams,
      rmbRate, rmbRateTime, rmbSource,
      willTrigger: calc.trigger,
      brentTime, eiaDataDate: dataDate,
      source: `cnbc_realtime + ${effectiveSource} + ndrc_tax_formula + live_forex`,
      avg10dSource: effectiveSource,
      isManualLocked,
      updatedAt: now, trendUpdated,
    },
  }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
});
