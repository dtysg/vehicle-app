import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 城市坐标映射（与 weather-1d/weather-7d EF 保持一致）
const CITY_COORDS: Record<string, { lat: number; lon: number; name: string }> = {
  "天津":  { lat: 39.0842, lon: 117.2010, name: "天津" },
  "北京":  { lat: 39.9042, lon: 116.4074, name: "北京" },
  "上海":  { lat: 31.2304, lon: 121.4737, name: "上海" },
  "广州":  { lat: 23.1291, lon: 113.2644, name: "广州" },
  "深圳":  { lat: 22.5431, lon: 114.0579, name: "深圳" },
  "杭州":  { lat: 30.2741, lon: 120.1551, name: "杭州" },
  "成都":  { lat: 30.5728, lon: 104.0668, name: "成都" },
  "武汉":  { lat: 30.5928, lon: 114.3055, name: "武汉" },
  "西安":  { lat: 34.3416, lon: 108.9398, name: "西安" },
  "重庆":  { lat: 29.5630, lon: 106.5516, name: "重庆" },
  "南京":  { lat: 32.0603, lon: 118.7969, name: "南京" },
  "沈阳":  { lat: 41.8057, lon: 123.4315, name: "沈阳" },
  "哈尔滨":{ lat: 45.8038, lon: 126.5340, name: "哈尔滨" },
  "济南":  { lat: 36.6512, lon: 117.1201, name: "济南" },
};

// WMO 天气代码 → 中文
function wmoToZh(code: number): string {
  if (code === 0) return "晴";
  if (code <= 2) return "多云";
  if (code === 3) return "阴";
  if (code <= 49) return "雾";
  if (code <= 59) return "毛毛雨";
  if (code <= 69) return "雨";
  if (code <= 79) return "雪";
  if (code <= 84) return "阵雨";
  if (code <= 94) return "雷阵雨";
  return "强雷暴";
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let city = "天津";
  try { city = (await req.json()).city ?? "天津"; } catch { /* default */ }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. 读缓存（30分钟内）
  const { data: cached } = await supabase
    .from("weather_cache").select("*").eq("city", city)
    .gte("fetched_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .maybeSingle();
  if (cached) {
    return new Response(JSON.stringify({ status: 0, data: cached, source: "cache" }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // 2. 解析坐标
  const coord = CITY_COORDS[city] ?? CITY_COORDS["天津"];

  // 3. 调用 Open-Meteo（完全免费，无需 Key）
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude",  String(coord.lat));
    url.searchParams.set("longitude", String(coord.lon));
    url.searchParams.set("current", [
      "temperature_2m","relative_humidity_2m","apparent_temperature",
      "weather_code","wind_speed_10m","wind_direction_10m","surface_pressure","visibility",
    ].join(","));
    url.searchParams.set("daily",   "sunrise,sunset");
    url.searchParams.set("timezone","Asia/Shanghai");
    url.searchParams.set("forecast_days","1");

    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
    const json = await resp.json();
    const cur = json.current ?? {};

    const weatherText = wmoToZh(cur.weather_code ?? 0);
    const windDir = (() => {
      const deg = cur.wind_direction_10m ?? 0;
      const dirs = ["北","东北","东","东南","南","西南","西","西北"];
      return dirs[Math.round(deg / 45) % 8];
    })();

    const row = {
      city,
      city_name:   coord.name,
      weather:     weatherText,
      temp:        String(Math.round(cur.temperature_2m ?? 0)),
      humidity:    String(Math.round(cur.relative_humidity_2m ?? 0)),
      wind_dir:    windDir + "风",
      wind_power:  String(Math.round((cur.wind_speed_10m ?? 0) / 3.6)) + "m/s",
      wind_speed:  String(Math.round(cur.wind_speed_10m ?? 0)),
      feels_like:  String(Math.round(cur.apparent_temperature ?? 0)),
      pressure:    String(Math.round(cur.surface_pressure ?? 0)),
      visibility:  String(Math.round((cur.visibility ?? 0) / 1000)),
      sunrise:     json.daily?.sunrise?.[0]?.slice(11,16) ?? "",
      sunset:      json.daily?.sunset?.[0]?.slice(11,16)  ?? "",
      fetched_at:  new Date().toISOString(),
    };

    await supabase.from("weather_cache").upsert(row, { onConflict: "city" });

    return new Response(JSON.stringify({ status: 0, data: row, source: "open-meteo" }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (e) {
    // 失败返回过期缓存
    const { data: stale } = await supabase.from("weather_cache").select("*").eq("city", city).maybeSingle();
    if (stale) {
      return new Response(JSON.stringify({ status: 0, data: stale, source: "stale_cache" }), {
        status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
});
