import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 使用 service_role 绕过 RLS，超级管理员模拟调价专用
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json() as {
      cities: string[];
      next_adjust_date?: string;
      next_trend?: number;
      next_trend_text?: string;
      trend?: number;
      update_date_override?: string;
      // delta 模式：EF 内部读当前价 + delta 计算新价，保证「读-算-写」原子，彻底消除竞态
      // per_city_prices 保留作兼容（若同时传入则优先用 delta）
      delta?: number;
      per_city_prices?: Record<string, { p92?: string; p95?: string; p98?: string; p0?: string }>;
    };

    const { cities, next_adjust_date, next_trend, next_trend_text, trend, update_date_override, delta, per_city_prices } = body;

    if (!cities || cities.length === 0) {
      return new Response(JSON.stringify({ error: "cities 不能为空" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    // update_date 写昨天：让 isWindowOpen 条件（updateDt < nextAdj）在调价日当天成立
    const yesterday = update_date_override ?? (() => {
      const d = new Date(Date.now() - 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    })();

    // ── 读取各城市当前价格（EF 内部读，保证与写入同源，消除前端竞态）
    const { data: existingRows } = await supabase
      .from("oil_prices")
      .select("city, p92, p95, p98, p0, is_simul")
      .in("city", cities);

    const existingMap: Record<string, { p92: string; p95: string; p98: string; p0: string; is_simul: boolean }> = {};
    for (const row of (existingRows ?? [])) {
      existingMap[row.city] = row;
    }

    // 辅助：对价格字符串施加 delta，保留 2 位小数，最低 0
    const applyDelta = (price: string, d: number): string => {
      const n = parseFloat(price);
      if (isNaN(n)) return price;
      return Math.max(0, n + d).toFixed(2);
    };

    // 构造批量 upsert rows（service_role 绕过 RLS）
    const rows = cities.map((city: string) => {
      const existing = existingMap[city];

      const row: Record<string, unknown> = {
        city,
        update_date: yesterday,
        trend: trend ?? 0,
        trend_date: today,
        next_trend: next_trend ?? 0,
        next_trend_text: next_trend_text ?? "预计持平",
        is_simul: true, // 标记为模拟数据，防止 oilprice-admin-update 覆盖
      };

      if (next_adjust_date) row.next_adjust_date = next_adjust_date;

      if (!existing) return row; // 城市不存在，跳过价格字段

      // ── delta 模式（推荐）：EF 内部用当前价 + delta 计算，prev_* = 当前价，p* = 新价
      // 这是关键：「读当前价→存 prev_*→写新价」在同一 EF 调用里完成，绝无竞态
      if (typeof delta === 'number' && delta !== 0) {
        row.prev_p92 = existing.p92 ?? '';
        row.prev_p95 = existing.p95 ?? '';
        row.prev_p98 = existing.p98 ?? '';
        row.prev_p0  = existing.p0  ?? '';
        row.p92 = applyDelta(existing.p92, delta);
        row.p95 = applyDelta(existing.p95, delta);
        row.p98 = applyDelta(existing.p98, delta);
        row.p0  = applyDelta(existing.p0,  delta);
        return row;
      }

      // ── 兼容模式：前端传 per_city_prices 绝对价格（delta=0 持平 或 旧调用方式）
      const cityPrices = per_city_prices?.[city] ?? {};
      const hasNewPrices = cityPrices.p92 || cityPrices.p95 || cityPrices.p98 || cityPrices.p0;
      if (hasNewPrices) {
        // 每次都用当前 DB 价备份到 prev_*，确保「永远与上次比」
        row.prev_p92 = existing.p92 ?? '';
        row.prev_p95 = existing.p95 ?? '';
        row.prev_p98 = existing.p98 ?? '';
        row.prev_p0  = existing.p0  ?? '';
        if (cityPrices.p92) row.p92 = cityPrices.p92;
        if (cityPrices.p95) row.p95 = cityPrices.p95;
        if (cityPrices.p98) row.p98 = cityPrices.p98;
        if (cityPrices.p0)  row.p0  = cityPrices.p0;
      }
      return row;
    });

    // 分批 upsert，每批 20 条
    const BATCH = 20;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from("oil_prices")
        .upsert(batch, { onConflict: "city", ignoreDuplicates: false });
      if (error) throw new Error(error.message || JSON.stringify(error));
      done += batch.length;
    }

    return new Response(
      JSON.stringify({ ok: true, updated: done }),
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
