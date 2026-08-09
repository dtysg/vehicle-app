// Edge Function: OCR 文字识别
// 免费方案：优先 OCR.space 免费 API（25000次/月）→ 失败时返回提示前端用相机扫描

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// OCR.space 免费 API Key（官网注册即可获得，25000次/月免费）
// 如未配置则使用公共 demo key（限制更严格）
const OCR_SPACE_URL = "https://api.ocr.space/parse/image";

/** 调用 OCR.space 免费 API */
async function ocrSpace(imageBase64: string, apiKey: string, language = "chs"): Promise<string[]> {
  const formData = new FormData();
  // base64 带前缀则去掉前缀
  const b64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
  formData.append("base64Image", `data:image/jpeg;base64,${b64}`);
  formData.append("language", language);      // chs=简体中文
  formData.append("isOverlayRequired", "false");
  formData.append("detectOrientation", "true");
  formData.append("scale", "true");
  formData.append("OCREngine", "2");          // Engine2 对中文更好

  const resp = await fetch(OCR_SPACE_URL, {
    method: "POST",
    headers: { "apikey": apiKey },
    body: formData,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`OCR.space HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.IsErroredOnProcessing) throw new Error(json.ErrorMessage?.[0] ?? "OCR error");

  // 提取所有识别文字行
  const lines: string[] = [];
  for (const result of json.ParsedResults ?? []) {
    const text: string = result.ParsedText ?? "";
    lines.push(...text.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean));
  }
  return lines;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  let image: string, languageType: string;
  try {
    const body = await req.json();
    image = body.image;
    if (!image) throw new Error("Missing image");
    languageType = body.language_type ?? "CHN_ENG";
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // OCR.space 语言映射
  const lang = /ENG/.test(languageType) && !/CHN/.test(languageType) ? "eng" : "chs";

  // 优先用用户配置的 key，否则用 demo key（helloworld 为官方 demo key）
  const apiKey = Deno.env.get("OCR_SPACE_API_KEY") ?? "helloworld";

  try {
    const lines = await ocrSpace(image, apiKey, lang);
    // 转换为百度 OCR 兼容格式（前端用 words_result）
    const wordsResult = lines.map(text => ({ words: text }));
    return new Response(
      JSON.stringify({ words_result: wordsResult, words_result_num: wordsResult.length, log_id: Date.now() }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  } catch (e) {
    console.error("[OCR] failed:", e);
    return new Response(
      JSON.stringify({ error: String(e), words_result: [], words_result_num: 0 }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
});
