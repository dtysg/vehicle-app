import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1小时缓存

// ── 免费 RSS 新闻数据源 ──
// 优先级：新华社 → 人民网 → 中国日报 → BBC中文
const RSS_SOURCES = [
  { name: "新华社", url: "https://feeds.feedburner.com/xinhuanet/FQHP" },
  { name: "新华社-国际", url: "https://www.xinhuanet.com/silkroad/news_feed.xml" },
  { name: "人民网", url: "https://rss.people.com.cn/rss/politics.do" },
  { name: "中国新闻网", url: "https://www.chinanews.com.cn/rss/china.xml" },
  { name: "BBC中文", url: "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml" },
];

/** 解析 RSS XML，返回新闻列表（最多8条）*/
function parseRSS(xml: string, sourceName: string): { title: string; summary: string; url: string; date: string }[] {
  const items: { title: string; summary: string; url: string; date: string }[] = [];
  // 匹配 <item> 块
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  for (const im of itemMatches.slice(0, 8)) {
    const block = im[1];
    const titleM = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkM  = block.match(/<link>(?:<!\[CDATA\[)?(https?:\/\/[^\s<]+?)(?:\]\]>)?<\/link>/)
                || block.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^\s<]+?)(?:\]\]>)?<\/guid>/);
    const descM  = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const dateM  = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)
                || block.match(/<dc:date>([\s\S]*?)<\/dc:date>/);
    const title   = titleM?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const url     = linkM?.[1]?.trim() ?? "";
    const summary = descM?.[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 120) ?? "";
    const dateRaw = dateM?.[1]?.trim() ?? "";
    let date = "";
    try { date = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : ""; } catch { date = ""; }
    if (title && url) items.push({ title, summary, url, date });
  }
  return items;
}

/** 依次尝试 RSS 源，返回第一个成功的列表 */
async function fetchRSSHeadlines(): Promise<{ title: string; summary: string; url: string; date: string }[]> {
  for (const src of RSS_SOURCES) {
    try {
      const resp = await fetch(src.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = parseRSS(xml, src.name);
      if (items.length >= 3) {
        console.log(`[news] RSS ${src.name} → ${items.length} items`);
        return items;
      }
    } catch (e) {
      console.warn(`[news] RSS ${src.name} failed:`, e);
    }
  }
  return [];
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. 查缓存（1h内复用）
  const { data: cached } = await supabase
    .from("news_cache").select("*").eq("id", 1)
    .gte("fetched_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
    .maybeSingle();

  if (cached?.headlines) {
    return new Response(JSON.stringify({ status: 0, headlines: cached.headlines, source: "cache" }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  // 2. 从免费 RSS 抓取
  try {
    const headlines = await fetchRSSHeadlines();
    if (headlines.length === 0) {
      return new Response(JSON.stringify({ status: 1, error: "暂无新闻数据", headlines: [] }), {
        status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    const responseData = { status: 0, headlines, source: "rss" };
    const writeCache = supabase.from("news_cache").upsert(
      { id: 1, headlines, fetched_at: new Date().toISOString() }, { onConflict: "id" }
    );
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(writeCache);
    else await writeCache;

    return new Response(JSON.stringify(responseData), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
});
