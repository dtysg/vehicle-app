import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 使用 service_role 绕过 RLS，从历史表读取最新真实价格恢复到主表
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ① 从历史表读最新一期各城市真实价格（按 update_date DESC + id DESC，每城市取最新一条）
    const { data: histRows, error: histErr } = await supabase
      .from("oil_price_history")
      .select("city, p92, p95, p98, p0, trend, update_date")
      .order("update_date", { ascending: false })
      .order("id",          { ascending: false })
      .limit(300); // 全国约 30 城 × 多期，足够覆盖最新一期

    if (histErr) throw new Error(histErr.message);
    if (!histRows || histRows.length === 0) {
      return new Response(
        JSON.stringify({ error: "历史表无数据，无法恢复" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // 每城市只保留 update_date 最大的那条
    const latestMap: Record<string, typeof histRows[0]> = {};
    for (const row of histRows) {
      if (!latestMap[row.city] || row.update_date > latestMap[row.city].update_date) {
        latestMap[row.city] = row;
      }
    }

    // ② 构造恢复行：重置 is_simul=false，清空 prev_*，恢复 next_adjust_date/update_date
    // ── 先读 oilprice-trend-update 维护的 next_adjust_date/next_trend/next_trend_text ──
    // 这些字段由 trend EF 独立维护，历史表里没有，需从主表直接读最新真实值
    const { data: trendRow } = await supabase
      .from("oil_prices")
      .select("next_adjust_date, next_trend, next_trend_text, trend_updated_at")
      .eq("city", "天津")
      .maybeSingle();
    // 用天津代表全国（next_adjust_date 全国一致）
    const realNextAdjustDate = trendRow?.next_adjust_date ?? null;
    const realNextTrend      = trendRow?.next_trend      ?? 0;
    const realNextTrendText  = trendRow?.next_trend_text ?? "";

    const restoreRows = Object.values(latestMap).map(r => ({
      city:             r.city,
      p92:              r.p92,
      p95:              r.p95,
      p98:              r.p98,
      p0:               r.p0,
      trend:            r.trend,
      update_date:      r.update_date,
      is_simul:         false,
      prev_p92:         "",
      prev_p95:         "",
      prev_p98:         "",
      prev_p0:          "",
      // 恢复真实调价日 + 走势（模拟期间被 oilprice-simul 覆盖）
      ...(realNextAdjustDate ? { next_adjust_date: realNextAdjustDate } : {}),
      next_trend:       realNextTrend,
      next_trend_text:  realNextTrendText,
    }));

    // ③ 分批 upsert 回 oil_prices（service_role 绕过 RLS）
    const BATCH = 20;
    let done = 0;
    for (let i = 0; i < restoreRows.length; i += BATCH) {
      const { error } = await supabase
        .from("oil_prices")
        .upsert(restoreRows.slice(i, i + BATCH), { onConflict: "city" });
      if (error) throw new Error(error.message);
      done += restoreRows.slice(i, i + BATCH).length;
    }

    return new Response(
      JSON.stringify({ ok: true, restored: done }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
