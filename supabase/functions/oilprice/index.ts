import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 兜底静态数据（2026-07-22 百度AI搜索核实，来源：国家发改委/各省发改委7月17日24时调价公告）
// pm10/pm20/pm35 = -10#/-20#/-35# 柴油，约比0#贵 0.10/0.20/0.35 元/升
const FALLBACK: Record<string, { p92: string; p95: string; p98: string; p0: string; pm10: string; pm20: string; pm35: string; updateDate: string; trend: number; trendDate: string; nextAdjustDate: string; nextTrend: number; nextTrendText: string }> = {
  "北京":   { p92:"7.42",p95:"7.90",p98:"8.60", p0:"7.12",pm10:"7.22",pm20:"7.32",pm35:"7.47",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "天津":   { p92:"7.41",p95:"7.88",p98:"9.38", p0:"7.07",pm10:"7.17",pm20:"7.27",pm35:"7.42",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "河北":   { p92:"7.41",p95:"7.88",p98:"9.38", p0:"7.07",pm10:"7.17",pm20:"7.27",pm35:"7.42",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "山西":   { p92:"7.37",p95:"7.96",p98:"9.46", p0:"7.14",pm10:"7.24",pm20:"7.34",pm35:"7.49",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "内蒙古": { p92:"7.32",p95:"7.80",p98:"9.30", p0:"6.95",pm10:"7.05",pm20:"7.15",pm35:"7.30",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "辽宁":   { p92:"7.48",p95:"8.00",p98:"9.50", p0:"6.98",pm10:"7.08",pm20:"7.18",pm35:"7.33",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "吉林":   { p92:"7.36",p95:"7.84",p98:"9.34", p0:"7.00",pm10:"7.10",pm20:"7.20",pm35:"7.35",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "黑龙江": { p92:"7.38",p95:"7.91",p98:"9.41", p0:"6.88",pm10:"6.98",pm20:"7.08",pm35:"7.23",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "上海":   { p92:"7.38",p95:"7.85",p98:"9.85", p0:"7.05",pm10:"7.15",pm20:"7.25",pm35:"7.40",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "江苏":   { p92:"7.38",p95:"7.85",p98:"9.85", p0:"7.05",pm10:"7.15",pm20:"7.25",pm35:"7.40",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "浙江":   { p92:"7.39",p95:"7.86",p98:"9.36", p0:"7.06",pm10:"7.16",pm20:"7.26",pm35:"7.41",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "安徽":   { p92:"7.38",p95:"7.86",p98:"9.36", p0:"7.04",pm10:"7.14",pm20:"7.24",pm35:"7.39",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "福建":   { p92:"7.40",p95:"7.88",p98:"9.38", p0:"7.06",pm10:"7.16",pm20:"7.26",pm35:"7.41",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "江西":   { p92:"7.40",p95:"7.92",p98:"9.42", p0:"7.14",pm10:"7.24",pm20:"7.34",pm35:"7.49",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "山东":   { p92:"7.38",p95:"7.86",p98:"9.36", p0:"7.02",pm10:"7.12",pm20:"7.22",pm35:"7.37",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "河南":   { p92:"7.43",p95:"7.93",p98:"9.43", p0:"7.06",pm10:"7.16",pm20:"7.26",pm35:"7.41",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "湖北":   { p92:"7.47",p95:"8.00",p98:"8.80", p0:"7.10",pm10:"7.20",pm20:"7.30",pm35:"7.45",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "湖南":   { p92:"7.44",p95:"7.90",p98:"8.70", p0:"7.10",pm10:"7.20",pm20:"7.30",pm35:"7.45",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "广东":   { p92:"7.46",p95:"8.08",p98:"9.20", p0:"7.11",pm10:"7.21",pm20:"7.31",pm35:"7.46",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "深圳":   { p92:"7.46",p95:"8.08",p98:"9.20", p0:"7.11",pm10:"7.21",pm20:"7.31",pm35:"7.46",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "广西":   { p92:"7.48",p95:"8.06",p98:"9.10", p0:"7.12",pm10:"7.22",pm20:"7.32",pm35:"7.47",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "海南":   { p92:"8.55",p95:"9.08",p98:"10.08",p0:"7.14",pm10:"7.24",pm20:"7.34",pm35:"7.49",updateDate:"2026-07-17",trend:+0.25,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "重庆":   { p92:"7.51",p95:"7.93",p98:"8.93", p0:"7.12",pm10:"7.22",pm20:"7.32",pm35:"7.47",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "四川":   { p92:"7.54",p95:"8.05",p98:"8.75", p0:"7.13",pm10:"7.23",pm20:"7.33",pm35:"7.48",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "贵州":   { p92:"7.55",p95:"8.01",p98:"8.91", p0:"7.15",pm10:"7.25",pm20:"7.35",pm35:"7.50",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "云南":   { p92:"7.58",p95:"8.14",p98:"8.82", p0:"7.17",pm10:"7.27",pm20:"7.37",pm35:"7.52",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "西藏":   { p92:"8.32",p95:"8.80",p98:"9.80", p0:"7.64",pm10:"7.74",pm20:"7.84",pm35:"7.99",updateDate:"2026-07-17",trend:+0.25,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "陕西":   { p92:"7.31",p95:"7.73",p98:"8.80", p0:"6.97",pm10:"7.07",pm20:"7.17",pm35:"7.32",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "甘肃":   { p92:"7.44",p95:"7.98",p98:"8.87", p0:"7.08",pm10:"7.18",pm20:"7.28",pm35:"7.43",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "青海":   { p92:"7.40",p95:"7.93",p98:"8.82", p0:"7.03",pm10:"7.13",pm20:"7.23",pm35:"7.38",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "宁夏":   { p92:"7.37",p95:"7.89",p98:"8.79", p0:"7.01",pm10:"7.11",pm20:"7.21",pm35:"7.36",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
  "新疆":   { p92:"7.27",p95:"7.82",p98:"8.70", p0:"6.94",pm10:"7.04",pm20:"7.14",pm35:"7.29",updateDate:"2026-07-17",trend:+0.24,trendDate:"2026-07-17",nextAdjustDate:"2026-07-31",nextTrend:+0.635,nextTrendText:"预计上调 +0.60~+0.67 元/升" },
};

// 从 AI 搜索回答文本中解析单省油价
// 目标格式如：| 天津 | 7.41 | 7.83 | 9.33 | 7.07 |
function parseOilPrices(text: string, city: string): { p92: string; p95: string; p98: string; p0: string; pm10: string; pm20: string; pm35: string; updateDate: string; trend: number; trendDate: string; nextAdjustDate: string; nextTrend: number; nextTrendText: string } | null {
  // 匹配表格行：城市名在该行，提取4个价格数字
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tableRow = new RegExp(
    `\\|\\s*${escapedCity}[^|]*\\|\\s*([\\d.]+)[^|]*\\|\\s*([\\d.]+)[^|]*\\|\\s*([\\d.]+)[^|]*\\|\\s*([\\d.]+)[^|]*\\|`,
  );
  const m = text.match(tableRow);
  if (m) {
    // 解析本次调价日期
    const dateMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?调价|调价.*?(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const updateDate = dateMatch
      ? `${dateMatch[1] || dateMatch[4]}-${String(dateMatch[2] || dateMatch[5]).padStart(2, "0")}-${String(dateMatch[3] || dateMatch[6]).padStart(2, "0")}`
      : new Date().toISOString().slice(0, 10);
    // 本次涨跌幅
    const trendMatch = text.match(/上调\s*[+＋]?\s*([\d.]+)\s*元\/升|每升.*?上调\s*([\d.]+)/);
    const downMatch = text.match(/下调\s*([\d.]+)\s*元\/升|每升.*?下调\s*([\d.]+)/);
    const trend = trendMatch
      ? parseFloat(trendMatch[1] || trendMatch[2])
      : downMatch
      ? -parseFloat(downMatch[1] || downMatch[2])
      : 0;
    // 上次调价日期（取第二个日期）
    const prevDates = [...text.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)];
    const trendDate = prevDates.length >= 2
      ? `${prevDates[1][1]}-${String(prevDates[1][2]).padStart(2, "0")}-${String(prevDates[1][3]).padStart(2, "0")}`
      : "";
    // 下次调价日期：匹配"下次调价"或"X月X日24时"紧跟"调价窗口"
    const nextDateMatch = text.match(/下次调价.*?(\d{4})年(\d{1,2})月(\d{1,2})日|(\d{4})年(\d{1,2})月(\d{1,2})日.*?调价窗口/);
    const nextAdjustDate = nextDateMatch
      ? `${nextDateMatch[1] || nextDateMatch[4]}-${String(nextDateMatch[2] || nextDateMatch[5]).padStart(2, "0")}-${String(nextDateMatch[3] || nextDateMatch[6]).padStart(2, "0")}`
      : "";
    // 下次涨跌预测：提取"预计上涨/下调 X.XX元/升"
    const nextUpMatch = text.match(/预计.*?上[涨调]\s*[+＋]?\s*([\d.]+)\s*元\/升/);
    const nextDownMatch = text.match(/预计.*?下[降调]\s*([\d.]+)\s*元\/升/);
    const nextTrend = nextUpMatch
      ? parseFloat(nextUpMatch[1])
      : nextDownMatch
      ? -parseFloat(nextDownMatch[1])
      : 0;
    // 下次走势文字描述（提取"预计XX"短句，最多20字）
    const nextTextMatch = text.match(/预计[^。\n]{5,30}(?:元\/升|持平)/);
    const nextTrendText = nextTextMatch ? nextTextMatch[0].replace(/[\s*]/g, "").slice(0, 25) : (
      nextTrend > 0 ? `预计上调 +${nextTrend.toFixed(2)} 元/升` :
      nextTrend < 0 ? `预计下调 ${nextTrend.toFixed(2)} 元/升` : ""
    );
    // 低标号柴油价：从专属柴油文本中提取（若未找到则按 0# 价格 +差价 估算）
    const p0Val = parseFloat(m[4]);
    const pm10 = m[4]; // 占位，由柴油专属搜索覆盖
    const pm20 = m[4];
    const pm35 = m[4];
    return { p92: m[1], p95: m[2], p98: m[3], p0: m[4], pm10, pm20, pm35, updateDate, trend, trendDate, nextAdjustDate, nextTrend, nextTrendText, _p0Val: p0Val } as ReturnType<typeof parseOilPrices>;
  }
  return null;
}

// 调用百度AI搜索，累积全部 SSE 内容
async function baiduAiSearch(query: string, apiKey: string): Promise<string> {
  const resp = await fetch(
    "https://app-dpzi13kxv2m9-api-DYJwo27V8Qya-gateway.appmiaoda.com/v2/ai_search/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gateway-Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        messages: [{ role: "user", content: query }],
        search_recency_filter: "month",
        enable_reasoning: false,
        max_completion_tokens: 2000,
        resource_type_filter: [{ type: "web", top_k: 8 }],
      }),
    },
  );
  if (!resp.ok) throw new Error(`AI search failed: ${resp.status}`);
  const reader = resp.body!.getReader();
  const dec = new TextDecoder("utf-8");
  let buf = "", full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const s = line.slice(6).trim();
      if (s === "[DONE]") continue;
      try { full += JSON.parse(s).choices?.[0]?.delta?.content ?? ""; } catch { /* skip */ }
    }
  }
  return full;
}

/** 专门解析"下次调价"文本，支持范围格式/元/吨换算 */
function parseNextAdjust(text: string): { nextAdjustDate: string; nextTrend: number; nextTrendText: string } {
  // 下次调价日期：多种表述（优先取未来日期）
  const ndPatterns = [
    /下次调价.*?(\d{4})年(\d{1,2})月(\d{1,2})日/,
    /下一次调价.*?(\d{4})年(\d{1,2})月(\d{1,2})日/,
    /(\d{4})年(\d{1,2})月(\d{1,2})日.*?(?:调价窗口|成品油调价)/,
    /(\d{4})年(\d{1,2})月(\d{1,2})日.*?24时.*?调价/,
    /第\d+次调价.*?(\d{4})年(\d{1,2})月(\d{1,2})日/,
    // 匹配 "X月X日" 格式（无年份时补当前年）
    /下次调价.*?(\d{1,2})月(\d{1,2})日/,
  ];
  let nextAdjustDate = "";
  const currentYear = new Date().getFullYear();
  const todayTs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  for (const p of ndPatterns) {
    const m = text.match(p);
    if (m) {
      if (m.length >= 4 && m[1] && m[2] && m[3]) {
        nextAdjustDate = `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
      } else if (m.length >= 3 && m[1] && m[2]) {
        // 无年份，补当前年
        nextAdjustDate = `${currentYear}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
      }
      // 验证日期合理性：必须在今日 -1天 ~ +21天窗口内（成品油固定10工作日=约14天，21天上限防错误解析）
      if (nextAdjustDate) {
        const parts = nextAdjustDate.split('-').map(Number);
        const targetTs = new Date(parts[0], parts[1]-1, parts[2]).getTime();
        if (targetTs >= todayTs - 86400000 && targetTs <= todayTs + 21 * 86400000) break;
        nextAdjustDate = ""; // 超窗口则继续找
      }
    }
  }

  // 涨跌幅：支持"元/升"、"元/吨"（÷7.48）、范围取均值
  let nextTrend = 0;
  // 优先"元/升"格式（含范围 0.49-0.58）
  const upLiters = text.match(/预计.*?上[涨调]\s*[+＋]?\s*([\d.]+)(?:\s*[-~～]\s*([\d.]+))?\s*元\/升/);
  const dnLiters = text.match(/预计.*?下[降调]\s*([\d.]+)(?:\s*[-~～]\s*([\d.]+))?\s*元\/升/);
  if (upLiters) {
    const lo = parseFloat(upLiters[1]);
    const hi = upLiters[2] ? parseFloat(upLiters[2]) : lo;
    // 合理性检查：单次调价幅度通常不超过2元/升
    const val = +((lo + hi) / 2).toFixed(2);
    if (val > 0 && val <= 2.0) nextTrend = val;
  } else if (dnLiters) {
    const lo = parseFloat(dnLiters[1]);
    const hi = dnLiters[2] ? parseFloat(dnLiters[2]) : lo;
    const val = +((lo + hi) / 2).toFixed(2);
    if (val > 0 && val <= 2.0) nextTrend = -val;
  } else {
    // "元/吨"格式：÷7.48 折升价
    const upTon = text.match(/预计.*?上[涨调]\s*[+＋]?\s*(\d+)(?:\s*[-~～]\s*(\d+))?\s*元\/吨/);
    const dnTon = text.match(/预计.*?下[降调]\s*(\d+)(?:\s*[-~～]\s*(\d+))?\s*元\/吨/);
    if (upTon) {
      const lo = parseInt(upTon[1]); const hi = upTon[2] ? parseInt(upTon[2]) : lo;
      const val = +((lo + hi) / 2 / 7.48).toFixed(2);
      if (val > 0 && val <= 2.0) nextTrend = val;
    } else if (dnTon) {
      const lo = parseInt(dnTon[1]); const hi = dnTon[2] ? parseInt(dnTon[2]) : lo;
      const val = +((lo + hi) / 2 / 7.48).toFixed(2);
      if (val > 0 && val <= 2.0) nextTrend = -val;
    }
  }

  // 走势文字：正则必须完整匹配到"元/升"或"元/吨"结尾，防止截断文本污染
  let nextTrendText = "";
  // 必须包含完整的数字+单位，长度合理（8~30字）
  const ntm = text.match(/预计[^。\n]{4,28}(?:元\/升|元\/吨|持平)[^）\)]/);
  if (ntm && ntm[0].length >= 8 && ntm[0].length <= 30) {
    nextTrendText = ntm[0].replace(/\s+/g, "").replace(/\*/g, "").slice(0, 28);
  } else if (nextTrend > 0) {
    nextTrendText = `预计上调 +${nextTrend.toFixed(2)} 元/升`;
  } else if (nextTrend < 0) {
    nextTrendText = `预计下调 ${nextTrend.toFixed(2)} 元/升`;
  } else if (/持平/.test(text)) {
    nextTrendText = "预计持平";
  }

  return { nextAdjustDate, nextTrend, nextTrendText };
}

/** 从低标号柴油专项搜索文本中提取 -10#/-20#/-35# 价格，失败则按 0# + 差价估算 */
function parseDieselGrades(text: string, p0Val: number): { pm10: string; pm20: string; pm35: string } {
  // 匹配形如 "-10# 7.17" 或 "负10号 7.17" 或 "10号 7.17 元/升"
  const extract = (patterns: RegExp[]): number | null => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return parseFloat(m[1]);
    }
    return null;
  };
  const raw10 = extract([/-10#\s*([\d.]+)/, /负\s*10\s*号.*?([\d.]+)\s*元\/升/, /\-10号.*?([\d.]+)\s*元\/升/]);
  const raw20 = extract([/-20#\s*([\d.]+)/, /负\s*20\s*号.*?([\d.]+)\s*元\/升/, /\-20号.*?([\d.]+)\s*元\/升/]);
  const raw35 = extract([/-35#\s*([\d.]+)/, /负\s*35\s*号.*?([\d.]+)\s*元\/升/, /\-35号.*?([\d.]+)\s*元\/升/]);
  // 未找到时按差价估算（行业惯例：-10# ≈ +0.10，-20# ≈ +0.20，-35# ≈ +0.35）
  const pm10 = raw10 ? raw10.toFixed(2) : (p0Val + 0.10).toFixed(2);
  const pm20 = raw20 ? raw20.toFixed(2) : (p0Val + 0.20).toFixed(2);
  const pm35 = raw35 ? raw35.toFixed(2) : (p0Val + 0.35).toFixed(2);
  return { pm10, pm20, pm35 };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let city = "天津";
  let force = false;
  try { const body = await req.json(); city = body.city ?? "天津"; force = body.force === true; } catch { /* use default */ }

  // 模糊匹配到城市键
  const CITY_KEYS = Object.keys(FALLBACK);
  let cityKey = CITY_KEYS.find((k) => k === city)
    ?? CITY_KEYS.find((k) => city.includes(k) || k.includes(city))
    ?? "天津";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── 优先级1：读 oil_prices 数据库（管理员用AI搜索更新的权威数据）──
  if (!force) {
    const { data: dbRow } = await supabase
      .from("oil_prices")
      .select("*")
      .eq("city", cityKey)
      .maybeSingle();

    if (dbRow) {
      const data = {
        p92: dbRow.p92, p95: dbRow.p95, p98: dbRow.p98, p0: dbRow.p0,
        pm10: dbRow.pm10, pm20: dbRow.pm20, pm35: dbRow.pm35,
        updateDate: dbRow.update_date,
        trend: dbRow.trend, trendDate: dbRow.trend_date,
        nextAdjustDate: dbRow.next_adjust_date,
        nextTrend: dbRow.next_trend,
        nextTrendText: dbRow.next_trend_text,
      };
      return new Response(
        JSON.stringify({ status: 0, city: cityKey, data, source: "database" }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }
  }

  // ── 优先级2：查旧缓存（2h 内）──
  if (!force) {
    const { data: cached } = await supabase
      .from("oil_price_cache")
      .select("*")
      .eq("city", cityKey)
      .gte("fetched_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .maybeSingle();

    if (cached) {
      return new Response(
        JSON.stringify({ status: 0, city: cityKey, data: { p92: cached.p92, p95: cached.p95, p98: cached.p98, p0: cached.p0, pm10: cached.pm10, pm20: cached.pm20, pm35: cached.pm35, updateDate: cached.update_date, trend: cached.trend, trendDate: cached.trend_date, nextAdjustDate: cached.next_adjust_date, nextTrend: cached.next_trend, nextTrendText: cached.next_trend_text }, source: "cache" }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }
  }

  // ── 优先级3：实时AI搜索（仅当DB和缓存都无数据时） ──
  const apiKey = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
  if (!apiKey) {
    const fb = FALLBACK[cityKey];
    return new Response(JSON.stringify({ status: 0, city: cityKey, data: fb, source: "fallback" }), { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  try {
    const today = new Date().toISOString().slice(0, 7);
    const [priceText, nextText, dieselText, prevCacheResult] = await Promise.all([
      baiduAiSearch(`${today} 全国各省最新92号95号98号0号柴油油价 ${cityKey} 元/升 最新调价 国家发改委 价格表`, apiKey),
      baiduAiSearch(`${today} 中国成品油下次调价窗口时间 具体日期是哪天 预计涨跌幅度元每升 92号汽油下次调价时间`, apiKey),
      baiduAiSearch(`${today} ${cityKey} 负10号 负20号 负35号 柴油价格 元/升 -10# -20# -35#`, apiKey),
      supabase.from("oil_price_cache").select("update_date,next_trend_text").eq("city", cityKey).maybeSingle(),
    ]);

    const parsed = parseOilPrices(priceText, cityKey);
    const p0Val = parsed ? parseFloat(parsed.p0) : parseFloat(FALLBACK[cityKey]?.p0 ?? "7.07");
    const dieselGrades = parseDieselGrades(dieselText, p0Val);

    const nextInfo = parseNextAdjust(nextText);
    const fbCity = FALLBACK[cityKey];
    const nextAdjustDate = nextInfo.nextAdjustDate || parsed?.nextAdjustDate || fbCity?.nextAdjustDate || (() => {
      const d = new Date(); d.setDate(d.getDate() + 14);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();
    const nextTrend = nextInfo.nextTrend !== 0 ? nextInfo.nextTrend : (fbCity?.nextTrend ?? 0);
    const nextTrendText = nextInfo.nextTrendText || fbCity?.nextTrendText || "";

    const result = parsed
      ? { ...parsed, ...dieselGrades, nextAdjustDate, nextTrend, nextTrendText }
      : { ...FALLBACK[cityKey], ...dieselGrades, nextAdjustDate, nextTrend, nextTrendText };

    const prevCache = prevCacheResult.data;
    const isUpdated = !prevCache || prevCache.update_date !== result.updateDate || prevCache.next_trend_text !== (result.nextTrendText ?? "");
    const source = parsed ? (isUpdated ? "updated" : "live") : "fallback";

    const responseBody = JSON.stringify({ status: 0, city: cityKey, data: result, source });
    const writeCache = supabase.from("oil_price_cache").upsert({
      city: cityKey, p92: result.p92, p95: result.p95, p98: result.p98, p0: result.p0,
      pm10: result.pm10 ?? "", pm20: result.pm20 ?? "", pm35: result.pm35 ?? "",
      update_date: result.updateDate, trend: result.trend, trend_date: result.trendDate,
      next_adjust_date: result.nextAdjustDate ?? "", next_trend: result.nextTrend ?? 0,
      next_trend_text: result.nextTrendText ?? "", fetched_at: new Date().toISOString(),
    }, { onConflict: "city" });
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined") { EdgeRuntime.waitUntil(writeCache); } else { await writeCache; }

    return new Response(responseBody, { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  } catch (e) {
    const fb = FALLBACK[cityKey];
    return new Response(
      JSON.stringify({ status: 0, city: cityKey, data: fb, source: "fallback", error: String(e) }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
