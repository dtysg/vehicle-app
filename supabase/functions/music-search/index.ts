// 音乐搜索 Edge Function（多源聚合：网易云 + QQ音乐）
// 输入：{ keyword: string, limit?: number }
// 输出：{ tracks: [{ id, title, artist, album, artworkUrl, durationMs, source }] }
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

type Track = {
  id: string; title: string; artist: string; album: string;
  artworkUrl: string; durationMs: number; source: string;
};

// ── 网易云搜索 ──
async function searchNetease(keyword: string, limit: number): Promise<Track[]> {
  try {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=${limit}&offset=0`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Referer": "https://music.163.com", "Accept": "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const songs: any[] = Array.isArray(data?.result?.songs) ? data.result.songs : [];
    return songs.map((s) => ({
      id: String(s.id ?? ""),
      title: s.name ?? "未知曲目",
      artist: Array.isArray(s.artists) ? s.artists.map((a: any) => a.name).join(" / ") : "未知艺人",
      album: s.album?.name ?? "",
      artworkUrl: s.album?.picUrl ?? "",
      durationMs: Math.round(s.duration ?? 0),
      source: "netease",
    }));
  } catch { return []; }
}

// ── QQ音乐搜索 ──
async function searchQQ(keyword: string, limit: number): Promise<Track[]> {
  try {
    const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&format=json&p=1&n=${limit}&cr=1&g_tk=5381`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Referer": "https://y.qq.com", "Accept": "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const songs: any[] = Array.isArray(data?.data?.song?.list) ? data.data.song.list : [];
    return songs.map((s) => ({
      // QQ音乐用 songmid 作为唯一标识
      id: s.songmid ?? "",
      title: s.songname ?? "未知曲目",
      artist: Array.isArray(s.singer) ? s.singer.map((a: any) => a.name).join(" / ") : "未知艺人",
      album: s.albumname ?? "",
      // QQ音乐封面：albummid 拼接
      artworkUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : "",
      durationMs: (s.interval ?? 0) * 1000,
      source: "qq",
      // 保存 media_mid 供解析播放用
      _mediaMid: s.strMediaMid ?? s.media_mid ?? "",
    }));
  } catch { return []; }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    let keyword = "";
    let limit = 15;
    try {
      const body = await req.json();
      keyword = (body?.keyword ?? "").toString().trim();
      if (body?.limit) limit = Math.min(Math.max(Number(body.limit) || 15, 1), 30);
    } catch {
      const url = new URL(req.url);
      keyword = (url.searchParams.get("keyword") ?? "").trim();
    }

    if (!keyword) return json({ tracks: [], message: "请输入搜索关键词" });

    // 并行搜索两个源
    const [neteaseTracks, qqTracks] = await Promise.all([
      searchNetease(keyword, limit),
      searchQQ(keyword, limit),
    ]);

    // 聚合：网易云在前，QQ音乐在后
    const tracks = [...neteaseTracks, ...qqTracks];

    return json({ tracks, count: tracks.length, neteaseCount: neteaseTracks.length, qqCount: qqTracks.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ tracks: [], message: `搜索失败：${msg}` });
  }
});
