import { serve } from "https://deno.land/std/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let bounds: string;
  try { bounds = (await req.json()).bounds ?? ""; } catch { bounds = ""; }

  return new Response(
    JSON.stringify({ status: 0, bounds, roads: [], note: "实时路况暂不可用" }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
