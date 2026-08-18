import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * oilprice-trend-update — 油价走势独立更新 EF（v5: DB均价算法主力版）
 *
 * 数据源优先级：
 *   ① DB均价算法（最高优先级）— 直接从 crude_avg10d/crude_last_cycle_avg/crude_rmb_rate 套
 *      发改委公式算出涨跌方向和预估幅度，结果确定、不受AI幻觉影响
 *      触发条件：crude_last_cycle_avg > 0 且 avg10d > 0（即 oilprice-crude 已运行过）
 *   ② 百度AI搜索（备用）— ①不可用时降级，补充文字描述
 *   ③ qiyoujiage.com HTML爬虫（备用2）— AI失败时再降级
 *
 * 职责：只更新 next_adjust_date / next_trend / next_trend_text 字段
 *       不触碰 p92/p95/p98/p0 等实际价格字段
 *
 * 调价公式（与 oilprice-crude EF 保持一致）：
 *   ΔC(元/吨) = (avg10d - lastCycleAvg) × R × 7.33 × (1+T1+T1×T2) + K
 *   每升调幅  = ΔC ÷ 折算系数(升/吨，取92#全国通用 1316)
 *
 * 触发方式：
 *  1. pg_cron 每天北京时间 10:00 自动调用
 *  2. 客户端每天首次进入App时调用（24h冷却，按北京日期判断）
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 冷却：24h（按北京日期，同一天不重复抓取）
const TREND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ── 调价公式常量（与 oilprice-crude EF 保持一致）──────────────────
const BARREL_PER_TON    = 7.33;   // 布伦特原油：桶/吨
const RMB_RATE_FALLBACK = 7.25;   // 降级汇率
const T1                = 0.17;   // 消费税（增值税）
const T2                = 0.06;   // 城建税及附加
const K                 = 60;     // 加工利润估算（元/吨）
const TAX_MULTIPLIER    = 1 + T1 + T1 * T2;
const CONV_92_NATIONAL  = 1316;   // 92#汽油全国通用折算系数（升/吨），用于元/升估算
const THRESHOLD_PCT     = 4.0;    // 发改委调价触发阈值（±4%）

// ══════════════════════════════════════════════════════════════════
// 工具：解析调价走势文本（AI输出 / HTML 共用）
// ══════════════════════════════════════════════════════════════════
interface TrendResult {
  nextAdjustDate: string;
  nextTrend: number;
  nextTrendText: string;
  source: string;
}

function parseTrendText(text: string, sourceLabel: string): TrendResult | null {
  const bjNow = new Date(Date.now() + 8 * 3600 * 1000); // 统一北京时间
  const currentYear = bjNow.getUTCFullYear();
  const currentMonth = bjNow.getUTCMonth() + 1; // 北京月份（1-12）

  // 预处理：去掉 markdown 粗体/斜体标记，避免干扰正则
  const cleanText = text.replace(/\*{1,3}/g, "");

  // ── 下次调价日期 ──
  let nextAdjustDate = "";
  const datePatterns = [
    /下次油价\s*(\d{1,2})月(\d{1,2})日/,
    /下次调价\s*(\d{1,2})月(\d{1,2})日/,
    /下次.*?调价.*?(\d{1,2})月(\d{1,2})日/,
    /成品油.*?(\d{1,2})月(\d{1,2})日.*?调价/,
    /(\d{1,2})月(\d{1,2})日.*?(?:调价|窗口|开启)/,
    /预计.*?(\d{1,2})月(\d{1,2})日/,
    /调价窗口.*?(\d{1,2})月(\d{1,2})日/,
    /(\d{1,2})月(\d{1,2})日.*?24时/,
  ];
  for (const p of datePatterns) {
    const m = cleanText.match(p);
    if (m) {
      const mo = parseInt(m[1]), d = parseInt(m[2]);
      const yr = mo < currentMonth ? currentYear + 1 : currentYear;
      const ts = new Date(yr, mo - 1, d).getTime();
      const todayTs = bjNow.getTime();
      if (ts >= todayTs - 86400000 && ts <= todayTs + 60 * 86400000) {
        nextAdjustDate = `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        break;
      }
    }
  }

  // ── 涨跌幅（整句扫描策略，覆盖所有AI输出格式）──

  // ══════════════════════════════════════════════════════════════════
  // 正则解析策略：整句扫描（不依赖方向词与数字必须相邻）
  // ══════════════════════════════════════════════════════════════════
  const SEP = /\s*[~～\-－至到]\s*/;
  const NUM = /([\d.]+)/;

  // ── 步骤1：从整句提取数字范围（覆盖所有 AI 输出格式）──
  // 格式A2（最常见）: X元至Y元/升  X元至Y元每升  X元~Y元/升（每个数字后都有"元"）
  const rangeA2 = cleanText.match(new RegExp(`${NUM.source}\\s*元${SEP.source}${NUM.source}\\s*元[\\/每]?升?`));
  // 格式A: X至Y元/升  X至Y元每升  X~Y元/升（第一个数字后无"元"）
  const rangeA = !rangeA2
    ? cleanText.match(new RegExp(`${NUM.source}${SEP.source}${NUM.source}\\s*元[\\/每]升?`))
    : null;
  // 每升在前：每升X元至Y元
  const rangeC = cleanText.match(/每升\s*([\d.]+)\s*元\s*[~～\-－至到]\s*([\d.]+)\s*元/);
  // 格式B: X至Y元（单位在括号/句末，无"/升"）兜底
  const rangeB = (!rangeA2 && !rangeA && !rangeC)
    ? cleanText.match(new RegExp(`${NUM.source}${SEP.source}${NUM.source}\\s*元(?!\\d)`))
    : null;
  // 每吨：X至Y元/吨（后续换算）
  const rangeTon = (!rangeA2 && !rangeA && !rangeC && !rangeB)
    ? cleanText.match(new RegExp(`${NUM.source}${SEP.source}${NUM.source}\\s*元[\\/]?(?:每吨|吨)`))
    : null;

  // 取最先匹配到的范围（优先级: A2 > A > C > B > Ton）
  let loVal = 0, hiVal = 0;
  if (rangeA2) {
    loVal = parseFloat(rangeA2[1]); hiVal = parseFloat(rangeA2[2]);
  } else if (rangeA) {
    loVal = parseFloat(rangeA[1]); hiVal = parseFloat(rangeA[2]);
  } else if (rangeC) {
    loVal = parseFloat(rangeC[1]); hiVal = parseFloat(rangeC[2]);
  } else if (rangeB) {
    loVal = parseFloat(rangeB[1]); hiVal = parseFloat(rangeB[2]);
  } else if (rangeTon) {
    loVal = +(parseFloat(rangeTon[1]) / 1270).toFixed(2);
    hiVal = +(parseFloat(rangeTon[2]) / 1270).toFixed(2);
  }

  // ── 步骤2：单值兜底（无范围时）──
  const singleUpM = cleanText.match(/(上调|涨价|上涨)[^。\n]{0,60}?([\d.]+)\s*元[\\/每]?升?/);
  const singleDnM = cleanText.match(/(下调|降价|下跌)[^。\n]{0,60}?([\d.]+)\s*元[\\/每]?升?/);

  // ── 步骤3：在整句里找方向词（不限距离）──
  const hasUp  = /上调|涨价|上涨|涨幅|上涨|price.*up/i.test(cleanText);
  const hasDn  = /下调|降价|下跌|降幅|price.*down/i.test(cleanText);
  const pingHe = /预计持平|暂无调价|持平不变|不作调整|维持不变|不予调整/;

  // ── 步骤4：组合判定 ──
  let nextTrend = 0;
  let nextTrendText = "";

  if (loVal > 0 && hiVal > 0 && loVal <= 2.5 && hiVal <= 2.5) {
    const avg = +((loVal + hiVal) / 2).toFixed(2);
    if (hasUp && !hasDn) {
      nextTrend = avg;
      nextTrendText = `预计上调 +${loVal}~${hiVal} 元/升`;
    } else if (hasDn && !hasUp) {
      nextTrend = -avg;
      nextTrendText = `预计下调 -${loVal}~${hiVal} 元/升`;
    }
    // 两者都有或都无→方向不明确，不设走势（避免误判）
  } else if (singleUpM) {
    const val = parseFloat(singleUpM[2]);
    if (val > 0 && val <= 2.5) { nextTrend = val; nextTrendText = `预计上调 +${val.toFixed(2)} 元/升`; }
  } else if (singleDnM) {
    const val = parseFloat(singleDnM[2]);
    if (val > 0 && val <= 2.5) { nextTrend = -val; nextTrendText = `预计下调 -${val.toFixed(2)} 元/升`; }
  } else if (pingHe.test(cleanText)) {
    nextTrend = 0; nextTrendText = "预计持平";
  }

  // 至少需要日期或走势之一才算有效
  if (!nextAdjustDate && nextTrend === 0 && !nextTrendText) return null;

  console.log(`[油价走势][${sourceLabel}] 解析结果：date=${nextAdjustDate} trend=${nextTrend} text=${nextTrendText}`);
  return { nextAdjustDate, nextTrend, nextTrendText, source: sourceLabel };
}

// ══════════════════════════════════════════════════════════════════
// 数据源①：百度AI搜索（主力）— 开启 reasoning，收集 references，安全检查
// ══════════════════════════════════════════════════════════════════

// 将AI结构化JSON解析为TrendResult（不依赖任何正则）
function parseAIJson(json: Record<string, unknown>, todayStr: string): TrendResult | null {
  const bjNow = new Date(Date.now() + 8 * 3600 * 1000);

  // ── 调价日期验证 ──
  let nextAdjustDate = "";
  const rawDate = String(json.next_adjust_date ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const ts  = new Date(rawDate).getTime();
    const now = bjNow.getTime();
    // 合理性窗口：今天前1天 ~ 今天后60天
    if (ts >= now - 86400000 && ts <= now + 60 * 86400000) {
      nextAdjustDate = rawDate;
    } else {
      console.warn(`[油价走势][AI-JSON] 日期 ${rawDate} 超出合理窗口，丢弃`);
    }
  }

  // ── 走势解析 ──
  const dir  = String(json.direction ?? "").toLowerCase();
  const lo   = parseFloat(String(json.amount_low  ?? 0)) || 0;
  const hi   = parseFloat(String(json.amount_high ?? 0)) || 0;
  const avg  = lo > 0 && hi > 0 ? +((lo + hi) / 2).toFixed(2) : lo > 0 ? lo : hi;
  const conf = String(json.confidence ?? "low");

  let nextTrend = 0, nextTrendText = "";
  if (dir === "up" && avg > 0 && avg <= 2.5) {
    nextTrend = avg;
    nextTrendText = lo !== hi && lo > 0 && hi > 0
      ? `预计上调 +${lo}~${hi} 元/升`
      : `预计上调 +${avg.toFixed(2)} 元/升`;
  } else if (dir === "down" && avg > 0 && avg <= 2.5) {
    nextTrend = -avg;
    nextTrendText = lo !== hi && lo > 0 && hi > 0
      ? `预计下调 -${lo}~${hi} 元/升`
      : `预计下调 -${avg.toFixed(2)} 元/升`;
  } else if (dir === "flat") {
    nextTrend = 0; nextTrendText = "预计持平";
  }

  if (!nextAdjustDate && nextTrend === 0 && !nextTrendText) return null;

  const label = `baidu_ai_json(${conf})`;
  console.log(`[油价走势][AI-JSON] 解析成功：date=${nextAdjustDate} trend=${nextTrend} text=${nextTrendText} conf=${conf}`);
  return { nextAdjustDate, nextTrend, nextTrendText, source: label };
}

// 从SSE流中提取完整文本 + references（新版，替代旧 readSSEContent）
async function readSSEFull(resp: Response): Promise<{ content: string; references: Array<{title:string;url:string;date?:string}> }> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder("utf8");
  let buffer = "", fullContent = "";
  let references: Array<{title:string;url:string;date?:string}> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const js = line.slice(6).trim();
      if (js === "[DONE]") continue;
      try {
        const parsed = JSON.parse(js);
        // 安全检查：is_safe=false 时停止收集
        if (parsed.is_safe === false) {
          console.warn("[油价走势][百度AI] is_safe=false，丢弃此chunk");
          continue;
        }
        fullContent += parsed.choices?.[0]?.delta?.content ?? "";
        if (parsed.references?.length) {
          references = parsed.references; // 保留最后一批（通常是最完整的）
        }
      } catch { /* 跳过不完整chunk */ }
    }
  }
  return { content: fullContent, references };
}

async function fetchTrendFromBaiduAI(apiKey: string, todayStr: string): Promise<TrendResult | null> {
  // instruction 设定专业角色，提升油价解读准确性
  const instruction = "你是中国成品油价格分析专家，熟悉国家发改委10工作日调价机制。请优先引用发改委官网、新华社、人民日报等权威媒体的最新报道。";
  // 自然语言查询：不强制JSON，让AI搜索后自由组织，再用正则+JSON双路解析
  const userQuery =
    `今天是${todayStr}。请搜索并回答：` +
    `①中国国内成品油（92号汽油、95号汽油、0号柴油）下次调价窗口具体是几月几日？` +
    `②预计上调还是下调？幅度大概多少元每升？` +
    `请给出具体日期和数字，不要模糊表述，引用权威媒体来源。`;

  try {
    const resp = await fetch(
      "https://app-dpzi13kxv2m9-api-DYJwo27V8Qya-gateway.appmiaoda.com/v2/ai_search/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: userQuery }],
          instruction,
          enable_deep_search: false,      // 普通搜索足够，深搜耗时长
          enable_reasoning: true,         // 开启推理提升判断质量
          search_recency_filter: "week",  // 只看近一周新闻，避免旧调价信息干扰
          max_completion_tokens: 600,     // 适当增加 token 避免截断
          resource_type_filter: [{ type: "web", top_k: 8 }],
          enable_followup_queries: false,
        }),
        signal: AbortSignal.timeout(45000), // 45s（开启 reasoning 后响应略慢）
      }
    );

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      // 429/402 单独提示，方便排查额度问题
      if (resp.status === 429 || resp.status === 402) {
        console.warn(`[油价走势][百度AI] 额度不足 HTTP${resp.status}:`, errBody.slice(0, 200));
      } else {
        console.warn("[油价走势][百度AI] HTTP错误：", resp.status, errBody.slice(0, 200));
      }
      return null;
    }

    const { content: fullContent, references } = await readSSEFull(resp);
    console.log("[油价走势][百度AI] 原始输出：", fullContent.slice(0, 600));
    if (references.length) {
      console.log("[油价走势][百度AI] 引用来源：", references.slice(0, 3).map(r => `${r.title}(${r.url})`).join(" | "));
    }

    if (!fullContent.trim()) {
      console.warn("[油价走势][百度AI] 响应内容为空");
      return null;
    }

    // ── 尝试1：提取 {...} 块解析结构化JSON（AI偶尔自行输出）──
    const jsonMatch = fullContent.match(/\{[\s\S]*?"direction"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const aiJson = JSON.parse(jsonMatch[0]);
        // 只接受 confidence != low 的JSON结果，low说明AI没搜到有效信息
        if (aiJson.confidence !== "low") {
          const result = parseAIJson(aiJson, todayStr);
          if (result) return result;
        }
      } catch { /* 继续正则路径 */ }
    }

    // ── 尝试2：正则解析自然语言（主路径）──
    return parseTrendText(fullContent, "baidu_ai");

  } catch (e) {
    console.error("[油价走势][百度AI] 请求失败：", e);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 数据源②：qiyoujiage.com HTML爬虫（备用）
// ══════════════════════════════════════════════════════════════════
// 数据源②：HTML爬虫（备用）— 多个源依次尝试，qiyoujiage证书已失效跳过
// ══════════════════════════════════════════════════════════════════
async function fetchTrendFromScraper(): Promise<TrendResult | null> {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
  // 备用爬虫源列表（依次尝试）
  const sources = [
    "https://www.yoojia.com/oil/",              // 易车油价
    "https://oil.autohome.com.cn/",             // 汽车之家油价
    "https://www.d1ev.com/news/yujia",          // 第一电动
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) { console.warn(`[油价走势][爬虫] ${url} HTTP${res.status}`); continue; }
      const html = await res.text();
      const snippet = html.slice(0, 2000);
      console.log(`[油价走势][爬虫] ${url} 片段:`, snippet.slice(0, 200));
      const result = parseTrendText(snippet, "html_scrape");
      if (result) return result;
    } catch (e) {
      console.warn(`[油价走势][爬虫] ${url} 失败:`, String(e).slice(0, 120));
    }
  }
  console.error("[油价走势][爬虫] 全部源均失败");
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 官方算法推算：从本期调价日起推算下一期（10个工作日，跳过法定节假日）
// 规则：国家发改委每10个工作日调整一次，遇节假日顺延
// ══════════════════════════════════════════════════════════════════
function calcNextAdjustDate(fromDateStr: string): string {
  // 2026-2027 年国家法定节假日（数据来源：timor.tech 官方节假日API，与国务院通知一致）
  // 2026年数据已精确核实；2027年数据待官方公告后更新
  const HOLIDAYS = new Set<string>([
    // 2026 元旦（1月1-3日）
    "2026-01-01","2026-01-02","2026-01-03",
    // 2026 春节（2月15-23日，含除夕）
    "2026-02-15","2026-02-16","2026-02-17","2026-02-18","2026-02-19",
    "2026-02-20","2026-02-21","2026-02-22","2026-02-23",
    // 2026 清明节（4月4-6日）
    "2026-04-04","2026-04-05","2026-04-06",
    // 2026 劳动节（5月1-5日）
    "2026-05-01","2026-05-02","2026-05-03","2026-05-04","2026-05-05",
    // 2026 端午节（6月19-21日）
    "2026-06-19","2026-06-20","2026-06-21",
    // 2026 中秋节（9月25-27日）
    "2026-09-25","2026-09-26","2026-09-27",
    // 2026 国庆节（10月1-7日）
    "2026-10-01","2026-10-02","2026-10-03","2026-10-04",
    "2026-10-05","2026-10-06","2026-10-07",
    // 2027 元旦（预估，官方公告后更新）
    "2027-01-01","2027-01-02","2027-01-03",
    // 2027 春节（预估：1月26日除夕，1月27日-2月2日，官方公告后更新）
    "2027-01-26","2027-01-27","2027-01-28","2027-01-29",
    "2027-01-30","2027-01-31","2027-02-01","2027-02-02",
  ]);

  // 调休补班（周末变工作日，数据来源：timor.tech 官方节假日API）
  const WORKDAYS = new Set<string>([
    "2026-01-04",  // 元旦后补班
    "2026-02-14",  // 春节前补班
    "2026-02-28",  // 春节后补班
    "2026-05-09",  // 劳动节后补班
    "2026-09-20",  // 中秋节前补班
    "2026-10-10",  // 国庆节后补班
    // 2027 补班日待官方公告后更新
  ]);

  const isWorkday = (d: Date): boolean => {
    const yyyy = d.getUTCFullYear();
    const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd   = String(d.getUTCDate()).padStart(2, "0");
    const key  = `${yyyy}-${mm}-${dd}`;
    if (HOLIDAYS.has(key)) return false; // 法定节假日
    if (WORKDAYS.has(key)) return true;  // 调休补班
    const dow = d.getUTCDay();           // 0=日, 6=六
    return dow !== 0 && dow !== 6;
  };

  // 从 fromDate 起，往后数 10 个工作日
  const cur = new Date(fromDateStr + "T00:00:00Z");
  let workdays = 0;
  while (workdays < 10) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isWorkday(cur)) workdays++;
  }

  const yr  = cur.getUTCFullYear();
  const mon = String(cur.getUTCMonth() + 1).padStart(2, "0");
  const day = String(cur.getUTCDate()).padStart(2, "0");
  return `${yr}-${mon}-${day}`;
}
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const integKey    = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  let force = false;
  let isAdjustDay = false; // 调价日当天传 true，强制绕过冷却锁获取下一期日期
  let algoOnly = false;    // 模拟测试传 true，跳过AI/爬虫，直接用算法推算下一期
  try {
    const body = await req.json();
    force = body.force === true;
    isAdjustDay = body.is_adjust_day === true;
    algoOnly = body.algo_only === true;
  } catch { /* 默认 */ }

  // ── 冷却检测：24h内不重复抓取（调价日当天/算法模式强制绕过）──
  if (!force && !isAdjustDay && !algoOnly) {
    const { data: sample } = await supabase
      .from("oil_prices")
      .select("trend_updated_at")
      .eq("city", "天津")
      .maybeSingle();
    if (sample?.trend_updated_at) {
      const age = Date.now() - new Date(sample.trend_updated_at).getTime();
      if (age < TREND_COOLDOWN_MS) {
        return new Response(
          JSON.stringify({
            status: 0, skipped: true,
            message: `走势数据距上次更新仅 ${Math.round(age / 60000)} 分钟，无需重复抓取`,
            next_update_in_min: Math.round((TREND_COOLDOWN_MS - age) / 60000),
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
        );
      }
    }
  }

  // 今日日期字符串（北京时间）
  const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
  const todayStr = `${bjNow.getUTCFullYear()}-${String(bjNow.getUTCMonth()+1).padStart(2,"0")}-${String(bjNow.getUTCDate()).padStart(2,"0")}`;

  // ── ① DB均价算法（最高优先级，确定性计算，无AI幻觉）──────────────
  // 从 oil_prices 天津行读取本期/上期均价 + 汇率，套发改委公式直接算涨跌
  // 触发条件：crude_last_cycle_avg > 0 且 crude_avg10d > 0
  const { data: crudeRow } = await supabase
    .from("oil_prices")
    .select("crude_avg10d, crude_last_cycle_avg, crude_rmb_rate, crude_avg10d_locked, crude_avg10d_manual")
    .eq("city", "天津")
    .maybeSingle();

  const isManualLocked  = crudeRow?.crude_avg10d_locked === true && Number(crudeRow?.crude_avg10d_manual) > 0;
  const avg10d          = isManualLocked ? Number(crudeRow!.crude_avg10d_manual) : Number(crudeRow?.crude_avg10d ?? 0);
  const lastCycleAvg    = Number(crudeRow?.crude_last_cycle_avg ?? 0);
  const rmbRate         = Number(crudeRow?.crude_rmb_rate ?? 0) > 0
    ? Number(crudeRow!.crude_rmb_rate) : RMB_RATE_FALLBACK;

  let trend: TrendResult | null = null;

  if (avg10d > 0 && lastCycleAvg > 0) {
    const rawDiff  = avg10d - lastCycleAvg;
    const rate     = +((rawDiff / lastCycleAvg) * 100).toFixed(2);
    const deltaTon = +(rawDiff * rmbRate * BARREL_PER_TON * TAX_MULTIPLIER + K).toFixed(0);
    const deltaLtr = +(deltaTon / CONV_92_NATIONAL).toFixed(3);

    let nextTrend: number;
    let trendDesc: string;

    if (rate >= THRESHOLD_PCT) {
      nextTrend = 1;
      trendDesc = `涨价`;
    } else if (rate <= -THRESHOLD_PCT) {
      nextTrend = -1;
      trendDesc = `降价`;
    } else {
      nextTrend = 0;
      trendDesc = `持平`;
    }

    // 生成与前端测算卡统一风格的文字描述
    const absDeltaTon = Math.abs(deltaTon);
    const absDeltaLtr = Math.abs(deltaLtr);
    const absRate     = Math.abs(rate);
    const rateStr     = absRate.toFixed(2);
    let   nextTrendText: string;

    if (nextTrend === 0) {
      nextTrendText = `预计本期成品油价格持平，变动幅度仅 ${rateStr}%，未达调价触发线（±4%），维持不变。`;
    } else {
      const dirLabel = nextTrend === 1 ? "上调" : "下调";
      nextTrendText =
        `本期原油均价 ${avg10d.toFixed(2)} 美元/桶，上期 ${lastCycleAvg.toFixed(2)} 美元/桶，` +
        `变化率 ${nextTrend === 1 ? "+" : "-"}${rateStr}%，预计成品油价格${dirLabel}约 ` +
        `${absDeltaTon} 元/吨（折合约 ${absDeltaLtr.toFixed(3)} 元/升）。`;
    }

    trend = { nextAdjustDate: "", nextTrend, nextTrendText, source: "db_crude_algo" };
    console.log(`[油价走势][DB均价算法] avg10d=${avg10d} lastCycle=${lastCycleAvg} rate=${rate}% → ${trendDesc} deltaTon=${deltaTon}`);
  } else {
    console.warn(`[油价走势][DB均价算法] 数据不足（avg10d=${avg10d} lastCycle=${lastCycleAvg}），降级到AI搜索`);
  }

  // ── ② 百度AI搜索 & ③ HTML爬虫 —— 均价算法不可用时降级，只用涨跌文本 ──
  // v962: next_adjust_date 始终由官方算法 calcNextAdjustDate() 决定，AI/爬虫日期忽略
  if (!trend && !algoOnly && integKey) {
    trend = await fetchTrendFromBaiduAI(integKey, todayStr);
    if (trend) console.log("[油价走势] 降级源百度AI搜索成功（仅取涨跌文本）");
    else        console.warn("[油价走势] 降级源百度AI搜索失败，继续降级到爬虫");
  } else if (!trend && algoOnly) {
    console.log("[油价走势] algo_only=true，跳过AI搜索，直接使用算法推算");
  } else if (!trend) {
    console.warn("[油价走势] INTEGRATIONS_API_KEY 未配置，跳过百度AI搜索");
  }

  if (!trend && !algoOnly) {
    trend = await fetchTrendFromScraper();
    if (trend) console.log("[油价走势] 降级源爬虫成功（仅取涨跌文本）");
    else        console.warn("[油价走势] 全部降级源均失败，走势文本保留数据库现有值");
  }

  // ── ③ 官方算法推算 next_adjust_date（始终执行，权威来源）──
  // 规则：从数据库当前 next_adjust_date 起，往后数 10 个工作日，跳过法定节假日（含调休）
  // AI/爬虫提供的日期全部丢弃，只用其涨跌文本
  const { data: dbSample } = await supabase
    .from("oil_prices")
    .select("next_adjust_date, next_trend, next_trend_text")
    .eq("city", "天津")
    .maybeSingle();

  const baseDate = dbSample?.next_adjust_date
    ? String(dbSample.next_adjust_date).slice(0, 10)
    : todayStr;

  // 若数据库现有日期已过期（≤ 今天），推算下一期；否则保留现有日期
  let calcDate: string;
  if (baseDate <= todayStr) {
    calcDate = calcNextAdjustDate(baseDate);
    console.log(`[油价走势] 算法推算：基准=${baseDate} → 下期=${calcDate}`);
  } else {
    calcDate = baseDate; // 现有日期仍是未来，无需推算
    console.log(`[油价走势] 算法维持：当前日期 ${calcDate} 仍是未来`);
  }

  if (!trend) {
    // AI 和爬虫均失败，用算法日期 + 保留数据库现有走势文本
    trend = {
      nextAdjustDate: calcDate,
      nextTrend: Number(dbSample?.next_trend ?? 0),
      nextTrendText: String(dbSample?.next_trend_text ?? ""),
      source: "calc_10workdays",
    };
  } else {
    // AI/爬虫提供了涨跌文本，日期统一替换为算法推算结果
    trend = { ...trend, nextAdjustDate: calcDate, source: trend.source + "+calc_date" };
  }

  // ── 写入数据库（不动价格字段）──
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, string | number> = {
    next_trend: trend.nextTrend,
    next_trend_text: trend.nextTrendText,
    trend_updated_at: nowIso,
  };
  if (trend.nextAdjustDate) updatePayload.next_adjust_date = trend.nextAdjustDate;

  const { error } = await supabase
    .from("oil_prices")
    .update(updatePayload)
    .neq("city", "");

  if (error) {
    return new Response(
      JSON.stringify({ status: 1, message: `写入失败: ${error.message}` }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  console.log("[油价走势] 更新成功，来源：", trend.source, trend);
  return new Response(
    JSON.stringify({
      status: 0,
      message: `走势数据已更新（来源：${trend.source}）`,
      data: trend,
      updated_at: nowIso,
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
  );
});
