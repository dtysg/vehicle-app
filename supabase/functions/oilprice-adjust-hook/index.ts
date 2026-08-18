import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * oilprice-adjust-hook v2 — 调价日自动执行钩子
 *
 * 职责（每次国内成品油调价时调用一次）：
 *   1. 把当前油价（p92/p95/p98/p0）快照写入 prev_p92/prev_p95/prev_p98/prev_p0
 *   2. 把当前一揽子均价（crude_avg10d 三品种4:3:3加权）存为 crude_last_cycle_avg（下期预测基准）
 *      若 crude_avg10d 无效则兜底用 crude_brent
 *   3. 用官方算法从本次调价日推算下次调价日期，写入 next_adjust_date
 *   4. 重置走势预测（next_trend / next_trend_text），等待下期重新计算
 *
 * 触发方式：
 *   - pg_cron 在每次调价日（北京时间 10:00）自动调用
 *   - 管理员手动 POST { force: true } 也可触发
 *
 * 安全：需要 service_role key 或内部调用
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ══════════════════════════════════════════════════════════════════
// 官方算法：从本次调价日起推算下次调价日（10个工作日，跳过节假日）
// 与 oilprice-trend-update 中保持一致
// ══════════════════════════════════════════════════════════════════
function calcNextAdjustDate(fromDateStr: string): string {
  const HOLIDAYS = new Set<string>([
    // 2026 元旦
    "2026-01-01","2026-01-02","2026-01-03",
    // 2026 春节
    "2026-02-15","2026-02-16","2026-02-17","2026-02-18","2026-02-19",
    "2026-02-20","2026-02-21","2026-02-22","2026-02-23",
    // 2026 清明
    "2026-04-04","2026-04-05","2026-04-06",
    // 2026 劳动节
    "2026-05-01","2026-05-02","2026-05-03","2026-05-04","2026-05-05",
    // 2026 端午
    "2026-06-19","2026-06-20","2026-06-21",
    // 2026 中秋
    "2026-09-25","2026-09-26","2026-09-27",
    // 2026 国庆
    "2026-10-01","2026-10-02","2026-10-03","2026-10-04",
    "2026-10-05","2026-10-06","2026-10-07",
    // 2027 元旦（预估）
    "2027-01-01","2027-01-02","2027-01-03",
  ]);

  const fmt = (d: Date): string => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  const isWorkday = (d: Date): boolean => {
    const w = d.getUTCDay(); // 0=Sun, 6=Sat
    return w !== 0 && w !== 6 && !HOLIDAYS.has(fmt(d));
  };

  // 从调价日次日开始数，累计10个工作日
  const start = new Date(fromDateStr + "T00:00:00Z");
  let count = 0;
  let cur = new Date(start.getTime() + 86400000); // 次日起
  while (count < 10) {
    if (isWorkday(cur)) count++;
    if (count < 10) cur = new Date(cur.getTime() + 86400000);
  }
  return fmt(cur);
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

  // 解析参数
  let adjustDate = ""; // 本次调价日期（默认取今天北京时间）
  let force = false;
  try {
    const body = await req.json();
    adjustDate = body?.adjust_date ?? "";
    force = body?.force === true;
  } catch { /* 默认 */ }

  // 北京时间今日日期
  const bjNow = new Date(Date.now() + 8 * 3600_000);
  const todayBj = `${bjNow.getUTCFullYear()}-${String(bjNow.getUTCMonth()+1).padStart(2,"0")}-${String(bjNow.getUTCDate()).padStart(2,"0")}`;
  if (!adjustDate) adjustDate = todayBj;

  console.log(`[调价钩子] 本次调价日=${adjustDate} force=${force}`);

  // ── 幂等保护：同一天不重复执行（除非 force）──
  // 用 last_adjust_date 判断，避免 update_date 被原油刷新覆盖导致误跳过
  const { data: sample } = await db
    .from("oil_prices")
    .select("last_adjust_date, p92, crude_avg10d, crude_last_cycle_avg, crude_brent")
    .eq("city", "天津")
    .maybeSingle();

  if (!force && sample?.last_adjust_date === adjustDate) {
    console.log(`[调价钩子] 今日(${adjustDate})已执行过(last_adjust_date匹配)，跳过`);
    return new Response(JSON.stringify({
      status: 1, skipped: true,
      message: `${adjustDate} 已执行，传 force:true 可强制重跑`,
    }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
  }

  // ── 推算下次调价日期 ──
  const nextAdjustDate = calcNextAdjustDate(adjustDate);
  console.log(`[调价钩子] 下次调价日推算: ${adjustDate} → ${nextAdjustDate}`);

  // ── 推算本次新计价周期起始日（调价日后第一个工作日）──
  // 新周期一揽子均价从此日起统计，跳过周末（不含国内节假日，与 EIA 数据可用性对齐）
  function nextWorkday(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const newBasketStart = nextWorkday(adjustDate);
  console.log(`[调价钩子] 新计价周期起始日: ${newBasketStart}`);

  // ── 取所有城市当前数据，批量更新 ──
  const { data: allCities, error: fetchErr } = await db
    .from("oil_prices")
    .select("city, p92, p95, p98, p0, prev_p92, prev_p95, prev_p98, prev_p0, crude_avg10d, crude_brent, crude_wti, crude_dubai")
    .neq("city", "__placeholder__");

  if (fetchErr || !allCities?.length) {
    console.error("[调价钩子] 读取城市列表失败:", fetchErr);
    return new Response(JSON.stringify({ status: -1, error: "读取城市列表失败" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } });
  }

  // 分批更新，每批10个，避免并发超限
  const BATCH = 10;
  const results: { city: string; ok: boolean; newCycleAvg: number }[] = [];
  for (let i = 0; i < allCities.length; i += BATCH) {
    const batch = allCities.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async (row) => {
      const avg10d  = Number(row.crude_avg10d) > 0 ? Number(row.crude_avg10d) : 0;
      const brent   = Number(row.crude_brent)  > 0 ? Number(row.crude_brent)  : 0;
      const newCycleAvg = avg10d > 0 ? avg10d : (brent > 0 ? brent : 0);
      console.log(`[调价钩子] ${row.city}: 一揽子均价=$${avg10d} brent=$${brent} → 新上期均价=$${newCycleAvg}`);
      const { error } = await db.from("oil_prices").update({
        prev_p92: row.p92,
        prev_p95: row.p95,
        prev_p98: row.p98,
        prev_p0:  row.p0,
        crude_last_cycle_avg: newCycleAvg > 0 ? newCycleAvg : null,
        last_adjust_date:   adjustDate,       // ← 记录本次调价日，用于幂等判断
        next_adjust_date:   nextAdjustDate,
        crude_basket_start: newBasketStart,   // ← 新周期起始日（调价日后第一个工作日）
        crude_basket_days:  0,                // ← 新周期天数清零，EIA 下次拉取时重新累积
        next_trend:      0,
        next_trend_text: "预测计算中…",
        trend_updated_at: new Date().toISOString(),
      }).eq("city", row.city);
      if (error) console.error(`[调价钩子] ${row.city} 更新失败:`, error);

      // ── 写入调价日走势历史（以 city+update_date 为唯一键，覆盖旧记录）──
      // row.p92 = 调价后新价，row.prev_p92 = admin-update 备份的调价前旧价
      const newP92 = Number(row.p92);
      const oldP92 = Number(row.prev_p92 ?? 0);
      const trendVal = (newP92 > 0 && oldP92 > 0) ? +(newP92 - oldP92).toFixed(2) : 0;
      const { error: histErr } = await db.from("oil_price_history").upsert({
        city:        row.city,
        update_date: adjustDate,
        p92:  row.p92  != null ? String(row.p92)  : null,
        p95:  row.p95  != null ? String(row.p95)  : null,
        p98:  row.p98  != null ? String(row.p98)  : null,
        p0:   row.p0   != null ? String(row.p0)   : null,
        trend:       trendVal,
        crude_brent: row.crude_brent != null ? Number(row.crude_brent) : null,
        recorded_at: new Date().toISOString(),
      }, { onConflict: "city,update_date", ignoreDuplicates: false });
      if (histErr) console.error(`[调价钩子] ${row.city} 历史写入失败:`, histErr);

      return { city: row.city, ok: !error, newCycleAvg };
    }));
    results.push(...batchResults);
    // 批次间稍作等待，避免并发超限
    if (i + BATCH < allCities.length) await new Promise(r => setTimeout(r, 60));
  }

  const okCount   = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;

  console.log(`[调价钩子] 完成: ${okCount} 个城市更新成功，${failCount} 个失败`);
  console.log(`[调价钩子] 新基准(天津): crude_last_cycle_avg=${results.find(r => r.city === "天津")?.newCycleAvg}`);

  return new Response(JSON.stringify({
    status: 1,
    message: `调价钩子执行完成：${okCount}/${results.length} 个城市`,
    data: {
      adjustDate,
      nextAdjustDate,
      citiesUpdated: okCount,
      citiesFailed:  failCount,
      sampleNewCycleAvg: results.find(r => r.city === "天津")?.newCycleAvg ?? 0,
    },
  }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
});
