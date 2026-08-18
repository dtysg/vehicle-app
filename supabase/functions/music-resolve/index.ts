// 音乐播放地址解析 Edge Function（多源：网易云 + QQ音乐）
// 输入：{ songId: string, source?: string }
// 输出：{ url: string } 或 { url: null, message: string }
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

// ── 网易云解析 ──
async function resolveNetease(songId: string): Promise<string | null> {
  // 方案一：外链接口（302 跳转到真实 mp3）
  const outerUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
  try {
    const resp = await fetch(outerUrl, {
      headers: { "User-Agent": UA, "Referer": "https://music.163.com" },
      redirect: "manual",
    });
    if (resp.status === 302 || resp.status === 301) {
      const realUrl = resp.headers.get("location");
      if (realUrl) return realUrl;
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (resp.status === 200 && ct.includes("audio")) return outerUrl;
  } catch { /* 忽略 */ }

  // 方案二：player URL 接口
  try {
    const playerResp = await fetch(
      `https://music.163.com/api/song/enhance/player/url?ids=[${songId}]&br=320000`,
      { headers: { "User-Agent": UA, "Referer": "https://music.163.com" } },
    );
    const pData = await playerResp.json();
    const d = Array.isArray(pData?.data) ? pData.data[0] : null;
    if (d?.url) return d.url;
  } catch { /* 忽略 */ }
  return null;
}

// ── QQ音乐解析（通过 vkey 接口）──
async function resolveQQ(songMid: string): Promise<string | null> {
  const guid = "10000";
  // 播放文件名格式：C400{mediaMid}.m4a，这里用 songmid 构造（QQ音乐 filename = C400 + mediaMid）
  const filename = `C400${songMid}.m4a`;
  const reqData = {
    req_0: {
      module: "vkey.GetVkeyServer",
      method: "CgiGetVkey",
      param: {
        guid, songmid: [songMid], songtype: [0], uin: "0",
        loginflag: 1, platform: "20",
      },
    },
  };
  try {
    const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(reqData))}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Referer": "https://y.qq.com" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const midurlinfo = data?.req_0?.data?.midurlinfo;
    const sip = data?.req_0?.data?.sip;
    if (Array.isArray(midurlinfo) && midurlinfo.length > 0) {
      const purl: string = midurlinfo[0].purl ?? "";
      if (purl) {
        const base = Array.isArray(sip) && sip.length > 0 ? sip[0] : "http://dl.stream.qqmusic.qq.com/";
        return `${base}${purl}`;
      }
    }
  } catch { /* 忽略 */ }
  return null;
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

    if (!songId) return json({ url: null, message: "缺少歌曲ID" });

    let url: string | null = null;
    if (source === "qq") {
      url = await resolveQQ(songId);
    } else {
      url = await resolveNetease(songId);
    }

    if (url) return json({ url: url.replace(/^http:\/\//i, 'https://') });
    return json({ url: null, message: source === "qq" ? "该QQ音乐曲目暂无法播放（可能需VIP）" : "该曲目暂无法播放（可能需VIP或版权限制）" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ url: null, message: `解析失败：${msg}` });
  }
});
