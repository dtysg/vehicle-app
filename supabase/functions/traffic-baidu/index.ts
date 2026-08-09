import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30分钟缓存（静态来源更新频率低）

// 路况基准数据：基于时段的拥堵规律（高峰/平峰/夜间）
function estimateTraffic(city: string): {
  summary: string; congestionLevel: number; congestionLabel: string;
  roads: { name: string; status: string; level: number }[];
} {
  const hour = new Date().getHours();
  // 工作日早高峰7-9、晚高峰17-19为拥堵，其余畅通
  const weekday = new Date().getDay();
  const isWorkday = weekday >= 1 && weekday <= 5;
  const isMorningPeak = hour >= 7 && hour < 9;
  const isEveningPeak = hour >= 17 && hour < 19;

  let level = 0, label = "畅通";
  if (isWorkday && (isMorningPeak || isEveningPeak)) { level = 2; label = "中度拥堵"; }
  else if (isWorkday && ((hour >= 6 && hour < 7) || (hour >= 9 && hour < 10) || (hour >= 16 && hour < 17) || (hour >= 19 && hour < 20))) { level = 1; label = "轻度拥堵"; }

  const summary = `${city}当前路况${label}，${isWorkday ? (isMorningPeak ? "早高峰" : isEveningPeak ? "晚高峰" : "平峰时段") : "周末"}。`;

  return { summary, congestionLevel: level, congestionLabel: label, roads: [] };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let city = "天津";
  try { city = (await req.json()).city ?? "天津"; } catch { /* default */ }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 查缓存（30分钟内）
  const { data: cached } = await supabase
    .from("traffic_cache").select("*").eq("city", city)
    .gte("fetched_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
    .maybeSingle();

  if (cached) {
    return new Response(
      JSON.stringify({ status: 0, city, data: { summary: cached.summary, congestionLevel: cached.congestion_level, congestionLabel: cached.congestion_label, roads: cached.roads ?? [], fetchedAt: cached.fetched_at }, source: "cache" }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // 基于时段估算路况
  const parsed = estimateTraffic(city);
  const fetchedAt = new Date().toISOString();

  await supabase.from("traffic_cache").upsert({
    city, summary: parsed.summary,
    congestion_level: parsed.congestionLevel, congestion_label: parsed.congestionLabel,
    roads: parsed.roads, fetched_at: fetchedAt,
  }, { onConflict: "city" });

  return new Response(
    JSON.stringify({ status: 0, city, data: { summary: parsed.summary, congestionLevel: parsed.congestionLevel, congestionLabel: parsed.congestionLabel, roads: [], fetchedAt }, source: "estimated" }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
