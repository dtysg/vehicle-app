import { serve } from "https://deno.land/std/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 语音识别说明：
// 由于高质量服务端语音识别需要付费 API，
// 本 EF 返回 501，前端应使用设备原生 Speech Recognition（免费、离线）。
// iOS/Android 均内置语音识别，无需任何 API Key。
// 前端处理方式：使用 expo-speech 或 @react-native-voice/voice

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  // 返回降级提示，让前端切换为设备原生语音识别
  return new Response(
    JSON.stringify({
      err_no: 501,
      err_msg: "请使用设备原生语音识别（免费、离线、更准确）",
      result: [],
      use_native: true,  // 前端检测此字段，切换到原生语音
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
