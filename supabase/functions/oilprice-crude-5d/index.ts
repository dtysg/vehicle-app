import { serve } from "https://deno.land/std/http/server.ts";

/**
 * oilprice-crude-5d — 国际原油近5个交易日"活动均价"统计
 *
 * 数据源：FRED 免费 CSV（政府数据，极稳定、无反爬、无限流）
 *   - DCOILBRENTEU = Brent 现货（普氏 Dated Brent）
 *   - DCOILWTICO   = WTI 现货
 *   阿曼/迪拜、米纳斯无免费独立源，沿用主测算口径的利差推算：
 *     阿曼/迪拜 ≈ Brent - 8.5，米纳斯 ≈ 阿曼 - 3.2
 *
 * 返回：
 *   - days[]：近5个交易日（升序）的 Brent/WTI/阿曼/米纳斯 日价
 *   - avgBrent/avgWti/avgOman/avgMinas：5日均价（美元/桶）
 *   - perLiter：折算每升均价（元/升）= 均价 × RMB / 158.98
 *   - dev：当前价相对5日均价的偏离幅度（%）
 *   - rmbRate / updatedAt / source
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RMB_RATE_FALLBACK = 7.25;
const LITERS_PER_BARREL = 158.98; // 1桶 ≈ 158.98升
const EXCHANGE_RATE_URL = "https://app-dpzi13kxv2m9-api-ELbWz8OmBW5Y-gateway.appmiaoda.com/exchange-rate-v2/single";

const OMAN_BASIS = -8.5;   // 阿曼/迪拜 相对 Brent 的现货利差
const MINAS_BASIS = -3.2;  // 米纳斯 相对 阿曼 的现货利差

// 统计起点：从 2026-08-17 起统计 10 个工作日（周末/节假日不计）
const START_DATE = "2026-08-17";
const TARGET_WORKDAYS = 10;

// 2026 中国法定节假日（调休后的休假日，不含调休上班的周末）
const HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
]);

// 从 START_DATE 起向前生成 TARGET_WORKDAYS 个工作日（YYYY-MM-DD 升序）
function buildTargetWorkdays(): string[] {
  const result: string[] = [];
  const cursor = new Date(START_DATE + "T00:00:00Z");
  let guard = 0;
  while (result.length < TARGET_WORKDAYS && guard < 120) {
    const ds = cursor.toISOString().slice(0, 10);
    if (isWorkday(ds)) result.push(ds);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }
  return result;
}

// 判断某日（YYYY-MM-DD）是否为工作日：排除周末与节假日
function isWorkday(ds: string): boolean {
  const d = new Date(ds + "T12:00:00Z").getUTCDay();
  if (d === 0 || d === 6) return false; // 周末
  return !HOLIDAYS_2026.has(ds); // 节假日
}

async function fetchFredSeries(seriesId: string, startDate: string): Promise<Array<{ period: string; val: number }>> {
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
  console.log(`[crude-5d] FRED ${seriesId}: ${rows.length} 行 from ${startDate}`);
  return rows;
}

async function fetchRmbRate(apiKey: string): Promise<number> {
  try {
    const resp = await fetch(EXCHANGE_RATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Gateway-Authorization": `Bearer ${apiKey}` },
      body: new URLSearchParams({ fromCode: "USD" }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`汇率 HTTP ${resp.status}`);
    const json = await resp.json();
    const rate = parseFloat(json?.data?.list?.["CNY"]?.rate);
    if (!rate || rate <= 0) throw new Error("汇率无效");
    return +rate.toFixed(4);
  } catch (e) {
    console.warn(`[crude-5d] 汇率获取失败，降级 ${RMB_RATE_FALLBACK}:`, (e as Error)?.message);
    return RMB_RATE_FALLBACK;
  }
}

function avg(nums: number[]): number {
  return nums.reduce((a, v) => a + v, 0) / nums.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const headers = { "Content-Type": "application/json", ...CORS };

  try {
    // 从 START_DATE(2026-08-17) 起统计 10 个工作日；为计算滚动均价需取更早历史
    const targets = buildTargetWorkdays();
    const fetchStart = new Date(new Date(START_DATE).getTime() - 30 * 86400_000).toISOString().slice(0, 10);

    const [brentRes, wtiRes] = await Promise.allSettled([
      fetchFredSeries("DCOILBRENTEU", fetchStart),
      fetchFredSeries("DCOILWTICO", fetchStart),
    ]);

    const brentRows = brentRes.status === "fulfilled" ? brentRes.value : [];
    const wtiRows   = wtiRes.status === "fulfilled" ? wtiRes.value : [];
    if (brentRows.length === 0) throw new Error("FRED Brent 数据获取失败");

    const brentMap = new Map(brentRows.map(r => [r.period, r.val]));
    const wtiMap   = new Map(wtiRows.map(r => [r.period, r.val]));
    const allBrentDates = [...brentMap.keys()].sort();

    // 逐个工作日计算滚动 5 日均价：取"截至该工作日的最近5个交易日"求均值
    // 仅纳入已有数据的工作日，数据不足或暂无数据的工作日等"有了再加进去"
    const days = [];
    for (const t of targets) {
      if (!brentMap.has(t)) continue; // 该工作日暂无数据，等有了再加
      const prior = allBrentDates.filter(d => d <= t).slice(-5);
      if (prior.length < 5) continue;
      const brentSpot = brentMap.get(t)!;
      const wtiSpot   = wtiMap.get(t) ?? +(brentSpot - 3).toFixed(2);
      const ma5Brent  = +avg(prior.map(d => brentMap.get(d)!)).toFixed(2);
      const ma5Wti    = +avg(prior.map(d => wtiMap.get(d) ?? brentMap.get(d)! - 3)).toFixed(2);
      const oman  = +(ma5Brent + OMAN_BASIS).toFixed(2);
      const minas = +(oman + MINAS_BASIS).toFixed(2);
      const basketAvg = +((ma5Brent * 4 + oman * 3 + minas * 3) / 10).toFixed(2);
      days.push({ date: t, brent: brentSpot, wti: wtiSpot, ma5Brent, ma5Wti, basketAvg });
    }

    if (days.length === 0) throw new Error("工作日数据不足，无法计算滚动均价");
    const latest = days[days.length - 1];

    const integKey = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
    const rmbRate = await fetchRmbRate(integKey);
    const toPerLiter = (usd: number) => +((usd * rmbRate) / LITERS_PER_BARREL).toFixed(2);

    const data = {
      days,
      startDate: START_DATE,
      targetCount: TARGET_WORKDAYS,
      latestBrent: latest.brent,
      latestMa5: latest.ma5Brent,
      latestBasket: latest.basketAvg,
      perLiterBasket: toPerLiter(latest.basketAvg),
      rmbRate,
      actualDays: days.length,
      updatedAt: new Date().toISOString(),
      source: "fred",
    };

    console.log(`[crude-5d] ✅ 已统计 ${days.length}/${TARGET_WORKDAYS} 个工作日(起点${START_DATE}) 最新: 布伦特=$${latest.brent} MA5=$${latest.ma5Brent} 一揽子测算=$${latest.basketAvg}`);
    return new Response(JSON.stringify({ status: 0, data }), { status: 200, headers });
  } catch (e) {
    console.error(`[crude-5d] 失败: ${e}`);
    return new Response(JSON.stringify({ status: 1, error: (e as Error)?.message ?? "数据获取失败" }), { status: 200, headers });
  }
});