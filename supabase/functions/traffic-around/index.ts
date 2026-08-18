import { serve } from "https://deno.land/std/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let center: string, radius: number;
  try {
    const body = await req.json();
    center = body.center ?? "";
    radius = body.radius ?? 2000;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  // 解析中心坐标，返回空路段结构（前端 fallback 显示静态地图）
  const parts = center.split(",").map(Number);
  const lat = parts[0] || 39.0842;
  const lon = parts[1] || 117.2010;

  return new Response(
    JSON.stringify({ status: 0, center: [lat, lon], radius, roads: [], note: "实时路况暂不可用" }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
