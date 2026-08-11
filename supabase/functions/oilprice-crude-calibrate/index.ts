import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * oilprice-crude-calibrate
 *
 * 调价后自动标定系数：
 *   ① 收到调价日 + 实际调价幅度（元/升）+ 当时原油价差
 *   ② 写入 crude_coeff_calibration 历史表
 *   ③ 取近 N 期（最多10期）倒推系数，算 [低15%分位 ~ 高85%分位] 区间
 *   ④ 更新 oil_prices.crude_coeff_low / crude_coeff_high / crude_coeff_n
 *
 * 调用方：oilprice-admin-update 调价成功后 fire-and-forget 调用
 * 请求体：{ adjust_date, city?, actual_delta, crude_brent, crude_base, change_rate?, note? }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 取数组的百分位值（线性插值）
function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = pct * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return +(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)).toFixed(5);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: {
    adjust_date:  string;
    city?:        string;
    actual_delta: number;   // 实际调价幅度（元/升，上调为正）
    crude_brent:  number;   // 调价时布伦特现价
    crude_base:   number;   // 计价周期基准均价
    change_rate?: number;
    note?:        string;
  };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "无效 JSON" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }); }

  const { adjust_date, actual_delta, crude_brent, crude_base } = body;
  if (!adjust_date || actual_delta === undefined || !crude_brent || !crude_base) {
    return new Response(JSON.stringify({ error: "缺少必要参数" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const city     = body.city ?? "天津";
  const raw_diff = +(crude_brent - crude_base).toFixed(4);

  // 价差太小时跳过（可能数据异常）
  if (Math.abs(raw_diff) < 0.5) {
    return new Response(JSON.stringify({ skipped: true, reason: `价差 ${raw_diff} 过小，跳过标定` }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const coeff = +(actual_delta / raw_diff).toFixed(5);

  // ① 写入标定记录（冲突则更新）
  const { error: insErr } = await db.from("crude_coeff_calibration").upsert({
    adjust_date,
    city,
    crude_brent,
    crude_base,
    raw_diff,
    actual_delta,
    coeff,
    change_rate: body.change_rate ?? null,
    note: body.note ?? null,
  }, { onConflict: "city,adjust_date" });

  if (insErr) {
    console.error("[calibrate] 写标定记录失败:", insErr.message);
    return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  console.log(`[calibrate] 写入 ${city} ${adjust_date} coeff=${coeff} (delta=${actual_delta} diff=${raw_diff})`);

  // ② 取近10期系数，计算 [P15 ~ P85] 区间
  const { data: rows, error: selErr } = await db
    .from("crude_coeff_calibration")
    .select("coeff")
    .eq("city", city)
    .order("adjust_date", { ascending: false })
    .limit(10);

  if (selErr || !rows || rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, coeff, warning: "读历史失败，跳过系数更新" }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const coeffs = rows.map(r => Number(r.coeff)).filter(v => v > 0).sort((a, b) => a - b);
  const n      = coeffs.length;

  // 1期：直接用倒推值±弹性；多期：P15~P85
  let newLow: number, newHigh: number;
  if (n === 1) {
    newLow  = +(coeffs[0] * 0.92).toFixed(4);   // 单期时给±8%弹性
    newHigh = +(coeffs[0] * 1.08).toFixed(4);
  } else {
    newLow  = +percentile(coeffs, 0.15).toFixed(4);
    newHigh = +percentile(coeffs, 0.85).toFixed(4);
  }

  // ③ 更新 oil_prices 所有城市的系数（全国用同一标定结果）
  const { error: updErr } = await db.from("oil_prices")
    .update({ crude_coeff_low: newLow, crude_coeff_high: newHigh, crude_coeff_n: n })
    .neq("city", "__placeholder__");

  if (updErr) console.error("[calibrate] 更新 oil_prices 系数失败:", updErr.message);

  console.log(`[calibrate] 系数区间更新: [${newLow} ~ ${newHigh}] n=${n}`);

  return new Response(JSON.stringify({
    ok: true,
    adjust_date, city, coeff,
    coeffLow: newLow, coeffHigh: newHigh, n,
    message: `标定成功，系数区间 [${newLow}~${newHigh}]，基于近 ${n} 期数据`,
  }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
});
