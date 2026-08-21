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

function isWorkday(ds: string): boolean {
  const d = new Date(ds + "T12:00:00Z").getUTCDay();
  return d !== 0 && d !== 6;
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
    // 取近 12 个自然日，保证有足够工作日数据（FRED 滞后约1交易日）
    const startDate = new Date(Date.now() - 12 * 86400_000).toISOString().slice(0, 10);

    const [brentRes, wtiRes] = await Promise.allSettled([
      fetchFredSeries("DCOILBRENTEU", startDate),
      fetchFredSeries("DCOILWTICO", startDate),
    ]);

    const brentRows = brentRes.status === "fulfilled" ? brentRes.value : [];
    const wtiRows   = wtiRes.status === "fulfilled" ? wtiRes.value : [];
    if (brentRows.length === 0) throw new Error("FRED Brent 数据获取失败");

    // 取最近 5 个有数据的工作日（Brent 为主）
    const brentMap = new Map(brentRows.map(r => [r.period, r.val]));
    const wtiMap   = new Map(wtiRows.map(r => [r.period, r.val]));
    const dates = [...brentMap.keys()].sort().slice(-5);

    const days = dates.map((date) => {
      const brent = brentMap.get(date)!;
      const wti   = wtiMap.get(date) ?? +(brent - 3).toFixed(2); // WTI 缺失时用 Brent-3 兜底
      const oman  = +(brent + OMAN_BASIS).toFixed(2);
      const minas = +(oman + MINAS_BASIS).toFixed(2);
      return { date, brent, wti, oman, minas };
    });

    const avgBrent = +avg(days.map(d => d.brent)).toFixed(2);
    const avgWti   = +avg(days.map(d => d.wti)).toFixed(2);
    const avgOman  = +avg(days.map(d => d.oman)).toFixed(2);
    const avgMinas = +avg(days.map(d => d.minas)).toFixed(2);

    const integKey = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
    const rmbRate = await fetchRmbRate(integKey);
    const toPerLiter = (usd: number) => +((usd * rmbRate) / LITERS_PER_BARREL).toFixed(2);

    const cur = days[days.length - 1];
    const dev = (curVal: number, avgVal: number) => +(((curVal - avgVal) / avgVal) * 100).toFixed(2);

    const data = {
      days,
      avgBrent, avgWti, avgOman, avgMinas,
      perLiterBrent: toPerLiter(avgBrent),
      perLiterWti:   toPerLiter(avgWti),
      perLiterOman:  toPerLiter(avgOman),
      perLiterMinas: toPerLiter(avgMinas),
      devBrent: dev(cur.brent, avgBrent),
      devWti:   dev(cur.wti, avgWti),
      devOman:  dev(cur.oman, avgOman),
      devMinas: dev(cur.minas, avgMinas),
      rmbRate,
      actualDays: days.length,
      updatedAt: new Date().toISOString(),
      source: "fred",
    };

    console.log(`[crude-5d] ✅ ${days.length}天 布伦特均价=$${avgBrent} WTI=$${avgWti} 阿曼=$${avgOman} 米纳斯=$${avgMinas}`);
    return new Response(JSON.stringify({ status: 0, data }), { status: 200, headers });
  } catch (e) {
    console.error(`[crude-5d] 失败: ${e}`);
    return new Response(JSON.stringify({ status: 1, error: (e as Error)?.message ?? "数据获取失败" }), { status: 200, headers });
  }
});