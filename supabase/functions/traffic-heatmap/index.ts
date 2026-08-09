import { serve } from "https://deno.land/std/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CITY_BOUNDS: Record<string, { center: [number, number]; bounds: string }> = {
  "北京":   { center:[39.9042,116.4074], bounds:"39.860,116.360;39.955,116.470" },
  "天津":   { center:[39.0842,117.2010], bounds:"39.040,117.150;39.140,117.280" },
  "上海":   { center:[31.2304,121.4737], bounds:"31.185,121.420;31.285,121.540" },
  "广州":   { center:[23.1291,113.2644], bounds:"23.080,113.200;23.185,113.340" },
  "深圳":   { center:[22.5431,114.0579], bounds:"22.490,113.990;22.600,114.140" },
  "重庆":   { center:[29.5630,106.5516], bounds:"29.510,106.480;29.620,106.640" },
  "成都":   { center:[30.5728,104.0668], bounds:"30.520,104.000;30.630,104.140" },
  "武汉":   { center:[30.5928,114.3055], bounds:"30.540,114.230;30.650,114.390" },
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let city = "天津";
  try { city = (await req.json()).city ?? "天津"; } catch { /* default */ }

  const cityData = CITY_BOUNDS[city] ?? CITY_BOUNDS["天津"];
  return new Response(
    JSON.stringify({ status: 0, city, center: cityData.center, bounds: cityData.bounds, segments: [], note: "路况热力图暂不可用" }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
