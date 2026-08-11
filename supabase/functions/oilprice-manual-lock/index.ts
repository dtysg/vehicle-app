import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * oilprice-manual-lock — 均价手动锁定/解锁 + 调价走势保存 EF
 *
 * 用途：前端用 anon key 无法直接 UPDATE oil_prices（RLS 策略限制），
 *       本 EF 使用 service_role key 绕过 RLS，代理执行写入。
 *
 * 操作类型（action 字段）：
 *   "lock_avg10d"       — 锁定本期均价（crude_avg10d_locked=true）
 *   "unlock_avg10d"     — 解锁本期均价（crude_avg10d_locked=false）
 *   "lock_last_cycle"   — 锁定上期均价（crude_last_cycle_locked=true）
 *   "unlock_last_cycle" — 解锁上期均价（crude_last_cycle_locked=false）
 *   "save_trend"        — 保存调价走势（next_trend / next_trend_text / next_adjust_date）
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, supabaseKey);

  let action = "";
  let value  = 0;
  let trend: Record<string, unknown> = {};
  try {
    const body = await req.json();
    action = String(body.action ?? "");
    value  = Number(body.value  ?? 0);
    trend  = body.trend ?? {};
  } catch {
    return new Response(JSON.stringify({ status: 1, message: "无效请求体" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // 合法性校验
  const validActions = ["lock_avg10d", "unlock_avg10d", "lock_last_cycle", "unlock_last_cycle", "save_trend"];
  if (!validActions.includes(action)) {
    return new Response(JSON.stringify({ status: 1, message: `未知操作：${action}` }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
  if ((action === "lock_avg10d" || action === "lock_last_cycle") && (isNaN(value) || value < 30 || value > 200)) {
    return new Response(JSON.stringify({ status: 1, message: "均价值超出合理范围（30~200 $/桶）" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // 构建 patch
  let patch: Record<string, unknown> = {};
  switch (action) {
    case "lock_avg10d":
      patch = {
        crude_avg10d:          value,
        crude_avg10d_manual:   value,
        crude_avg10d_locked:   true,
        crude_avg10d_source:   "manual_locked",
        crude_avg10d_locked_at: new Date().toISOString(),
      };
      break;
    case "unlock_avg10d":
      patch = {
        crude_avg10d_locked:   false,
        crude_avg10d_source:   null,
        crude_avg10d_manual:   null,
      };
      break;
    case "lock_last_cycle":
      patch = {
        crude_last_cycle_avg:    value,
        crude_last_cycle_manual: value,
        crude_last_cycle_locked: true,
      };
      break;
    case "unlock_last_cycle":
      patch = {
        crude_last_cycle_locked: false,
        crude_last_cycle_manual: null,
      };
      break;
    case "save_trend": {
      // trend: { next_trend, next_trend_text, trend_updated_at, next_adjust_date? }
      if (typeof trend.next_trend !== "number") {
        return new Response(JSON.stringify({ status: 1, message: "save_trend 缺少 next_trend 字段" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      patch = {
        next_trend:        trend.next_trend,
        next_trend_text:   trend.next_trend_text ?? "",
        trend_updated_at:  trend.trend_updated_at ?? new Date().toISOString(),
      };
      if (trend.next_adjust_date) patch.next_adjust_date = trend.next_adjust_date;
      break;
    }
  }

  const { error } = await db
    .from("oil_prices")
    .update(patch)
    .neq("city", "__placeholder__");

  if (error) {
    console.error(`[均价锁定] 写库失败 action=${action}:`, error.message);
    return new Response(JSON.stringify({ status: 1, message: `写库失败：${error.message}` }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  console.log(`[均价锁定] 成功 action=${action} value=${value}`);
  return new Response(JSON.stringify({ status: 0, message: "ok", action, value }), {    status: 200, headers: { "Content-Type": "application/json", ...CORS },
  });
});
