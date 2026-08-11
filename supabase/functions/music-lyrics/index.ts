// 音乐歌词 Edge Function（多源：网易云 + QQ音乐）
// 输入：{ songId: string, source?: string }
// 输出：{ lines: [{ time: number, text: string }], hasLyric: boolean }
import { serve } from "https://deno.land/std/http/server.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// 解析 LRC 格式歌词
function parseLrc(lrc: string): { time: number; text: string }[] {
  const lines: { time: number; text: string }[] = [];
  const timeRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const rawLine of lrc.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    timeRe.lastIndex = 0;
    while ((match = timeRe.exec(line)) !== null) {
      const mm = parseInt(match[1], 10);
      const ss = parseInt(match[2], 10);
      const msStr = match[3] ?? "0";
      const ms = parseInt(msStr.padEnd(3, "0").slice(0, 3), 10);
      times.push(mm * 60 + ss + ms / 1000);
      lastIndex = timeRe.lastIndex;
    }
    if (times.length === 0) continue;
    const text = line.slice(lastIndex).trim();
    for (const t of times) lines.push({ time: t, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// ── 网易云歌词 ──
async function getNeteaseLyric(songId: string): Promise<string> {
  const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&tv=-1&kv=-1`;
  const resp = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://music.163.com" } });
  if (!resp.ok) return "";
  const data = await resp.json();
  return data?.lrc?.lyric ?? "";
}

// ── QQ音乐歌词 ──
async function getQQLyric(songId: string): Promise<string> {
  // songId 为 songmid
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songId}&format=json&nobase64=1&g_tk=5381`;
  const resp = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://y.qq.com" } });
  if (!resp.ok) return "";
  const data = await resp.json();
  // QQ歌词可能 base64 编码
  let lrc: string = data?.lyric ?? "";
  if (lrc && !lrc.includes("[")) {
    try { lrc = atob(lrc); } catch { /* not base64 */ }
  }
  return lrc;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    let songId = "";
    let source = "netease";
    try {
      const body = await req.json();
      songId = (body?.songId ?? "").toString().trim();
      source = (body?.source ?? "netease").toString().trim();
    } catch {
      const url = new URL(req.url);
      songId = (url.searchParams.get("songId") ?? "").trim();
      source = (url.searchParams.get("source") ?? "netease").trim();
    }

    if (!songId) return json({ lines: [], hasLyric: false, message: "缺少歌曲ID" });

    const lrcStr = source === "qq" ? await getQQLyric(songId) : await getNeteaseLyric(songId);
    const hasLyric = lrcStr.length > 0;
    const lines = parseLrc(lrcStr);

    return json({ lines, hasLyric });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ lines: [], hasLyric: false, message: `歌词获取异常：${msg}` });
  }
});
