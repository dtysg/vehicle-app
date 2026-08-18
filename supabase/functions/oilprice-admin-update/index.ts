import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── 城市列表（31个省级行政区，与客户端 OIL_CITIES 完全对应）──────
const ALL_CITIES = [
  "北京","天津","上海","广东","重庆","四川","浙江","江苏",
  "湖北","湖南","河北","河南","山东","陕西","辽宁","吉林","黑龙江",
  "内蒙古","山西","安徽","福建","江西","广西","海南","贵州","云南",
  "西藏","甘肃","青海","宁夏","新疆",
];

// ── 省市中文名 → qiyoujiage.com slug ─────────────────────────────
const CITY_SLUGS: Record<string, string> = {
  "北京":"beijing","上海":"shanghai","天津":"tianjin","重庆":"chongqing",
  "河北":"hebei","山西":"shanxi","内蒙古":"neimenggu","辽宁":"liaoning",
  "吉林":"jilin","黑龙江":"heilongjiang","江苏":"jiangsu","浙江":"zhejiang",
  "安徽":"anhui","福建":"fujian","江西":"jiangxi","山东":"shandong",
  "河南":"henan","湖北":"hubei","湖南":"hunan","广东":"guangdong",
  "广西":"guangxi","海南":"hainan","四川":"sichuan",
  "贵州":"guizhou","云南":"yunnan","西藏":"xizang","陕西":"shanxi-3",
  "甘肃":"gansu","青海":"qinghai","宁夏":"ningxia","新疆":"xinjiang",
};

// ── 聚合数据城市名与 ALL_CITIES 完全一致，无需映射表 ─────────────

type PriceRow = { p92: string; p95: string; p98: string; p0: string };

// ══════════════════════════════════════════════════════════════════
// 数据源0（主力）：xxapi.cn — 免费无需 Key，一次返回全国31省市
// 接口：https://v2.xxapi.cn/api/oilPrice
// 字段：n92 / n95 / n98 / n0 / n89（89号汽油）/ n92Change 等
// ══════════════════════════════════════════════════════════════════

// xxapi regionName 带省/市后缀，去掉后映射到 ALL_CITIES
function normalizeXxapiCity(regionName: string): string {
  return regionName.replace(/[省市区]$/, "");
}

async function fetchAllCitiesFromXxapi(): Promise<Record<string, PriceRow>> {
  const result: Record<string, PriceRow> = {};
  try {
    const res = await fetch("https://v2.xxapi.cn/api/oilPrice", {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/124" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 200 || !Array.isArray(json.data)) {
      throw new Error(`xxapi返回异常: code=${json.code} msg=${json.msg}`);
    }
    const ok = (v: number | null, lo: number, hi: number) =>
      v !== null && v !== undefined && !isNaN(v) && v >= lo && v <= hi;
    for (const item of json.data) {
      const cityRaw = normalizeXxapiCity(item.regionName ?? "");
      const city = ALL_CITIES.find(c => c === cityRaw);
      if (!city) continue;
      const n92 = item.n92 as number, n95 = item.n95 as number;
      const n98 = item.n98 as number, n0  = item.n0  as number;
      if (!ok(n92, 5, 12) || !ok(n95, 5, 13)) continue;
      result[city] = {
        p92: String(n92),
        p95: String(n95),
        p98: ok(n98, 5, 16) ? String(n98) : "",
        p0:  ok(n0,  4, 12) ? String(n0)  : "",
      };
    }
    console.log(`[xxapi油价] 获取 ${Object.keys(result).length} 城市:`, Object.keys(result).join(" "));
  } catch (e) {
    console.warn("[xxapi油价] 请求失败:", String(e));
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// 数据源0B（备用A）：oil.pcp.com.cn — 中国石化官方，无需Key，全国省市
// 接口：https://www.sinopecchina.com 或 moli.com 聚合
// 实际用 oilapi.com.cn JSONP（免费，无需Key）
// ══════════════════════════════════════════════════════════════════
async function fetchAllCitiesFromMoli(): Promise<Record<string, PriceRow>> {
  const result: Record<string, PriceRow> = {};
  try {
    // moli 油价 API：https://api.moli.com/oilprice/all（免费，返回全国）
    const res = await fetch("https://api.moli.com/oilprice/all", {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/124", "Referer": "https://www.moli.com/" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = json?.data ?? json?.result ?? json ?? [];
    if (!Array.isArray(list) || list.length < 5) throw new Error(`moli返回数据异常: ${JSON.stringify(list).slice(0,100)}`);
    const ok = (v: number | string | null, lo: number, hi: number) => {
      const n = parseFloat(String(v ?? "")); return !isNaN(n) && n >= lo && n <= hi;
    };
    for (const item of list) {
      // 字段名兼容 name/region/city + p92/oil92/price92 等
      const cityRaw = String(item.name ?? item.region ?? item.city ?? item.province ?? "")
        .replace(/[省市区自治区特别行政区].*$/, "").trim();
      const city = ALL_CITIES.find(c => c === cityRaw || cityRaw.includes(c) || c.includes(cityRaw));
      if (!city || result[city]) continue;
      const n92 = item.p92 ?? item.oil92 ?? item.price92 ?? item["92"];
      const n95 = item.p95 ?? item.oil95 ?? item.price95 ?? item["95"];
      const n98 = item.p98 ?? item.oil98 ?? item.price98 ?? item["98"];
      const n0  = item.p0  ?? item.oil0  ?? item.diesel   ?? item["0"];
      if (!ok(n92,5,12) || !ok(n95,5,13)) continue;
      result[city] = {
        p92: String(parseFloat(String(n92)).toFixed(2)),
        p95: String(parseFloat(String(n95)).toFixed(2)),
        p98: ok(n98,5,16) ? String(parseFloat(String(n98)).toFixed(2)) : "",
        p0:  ok(n0,4,12)  ? String(parseFloat(String(n0)).toFixed(2))  : "",
      };
    }
    console.log(`[moli油价] 获取 ${Object.keys(result).length} 城市`);
  } catch (e) {
    console.warn("[moli油价] 请求失败:", String(e));
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// 数据源0C（备用B）：oilprice.7ec.cn — 七彩云API，免费无需Key，省市全量
// ══════════════════════════════════════════════════════════════════
async function fetchAllCitiesFrom7ec(): Promise<Record<string, PriceRow>> {
  const result: Record<string, PriceRow> = {};
  try {
    const res = await fetch("https://oilprice.7ec.cn/api/price/all", {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/124" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = json?.data ?? json?.list ?? json ?? [];
    if (!Array.isArray(list) || list.length < 5) throw new Error(`7ec返回异常: ${JSON.stringify(list).slice(0,100)}`);
    const ok = (v: number | string | null, lo: number, hi: number) => {
      const n = parseFloat(String(v ?? "")); return !isNaN(n) && n >= lo && n <= hi;
    };
    for (const item of list) {
      const cityRaw = String(item.province ?? item.region ?? item.name ?? "")
        .replace(/[省市区自治区].*$/, "").trim();
      const city = ALL_CITIES.find(c => c === cityRaw || cityRaw.includes(c));
      if (!city || result[city]) continue;
      const n92 = item.n92 ?? item.price92 ?? item["92号"];
      const n95 = item.n95 ?? item.price95 ?? item["95号"];
      const n98 = item.n98 ?? item.price98 ?? item["98号"];
      const n0  = item.n0  ?? item.diesel0  ?? item["0号"];
      if (!ok(n92,5,12) || !ok(n95,5,13)) continue;
      result[city] = {
        p92: String(parseFloat(String(n92)).toFixed(2)),
        p95: String(parseFloat(String(n95)).toFixed(2)),
        p98: ok(n98,5,16) ? String(parseFloat(String(n98)).toFixed(2)) : "",
        p0:  ok(n0,4,12)  ? String(parseFloat(String(n0)).toFixed(2))  : "",
      };
    }
    console.log(`[7ec油价] 获取 ${Object.keys(result).length} 城市`);
  } catch (e) {
    console.warn("[7ec油价] 请求失败:", String(e));
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// 多源交叉验证：对同一城市取2票相同的值，减少单源错误
// ══════════════════════════════════════════════════════════════════
function mergeWithVoting(
  sources: Array<Record<string, PriceRow>>,
  cities: string[]
): Record<string, PriceRow & { src: string }> {
  const result: Record<string, PriceRow & { src: string }> = {};
  for (const city of cities) {
    const votes = sources.map((s, i) => ({ row: s[city], idx: i })).filter(v => v.row);
    if (votes.length === 0) continue;
    if (votes.length === 1) {
      result[city] = { ...votes[0].row, src: String(votes[0].idx) };
      continue;
    }
    // 对 p92 取多数票（容差 0.05 元视为相同）
    const near = (a: string, b: string) => Math.abs(parseFloat(a) - parseFloat(b)) <= 0.05;
    for (let i = 0; i < votes.length; i++) {
      let matches = 1;
      for (let j = 0; j < votes.length; j++) {
        if (i !== j && near(votes[i].row.p92, votes[j].row.p92)) matches++;
      }
      if (matches >= 2) {
        result[city] = { ...votes[i].row, src: `vote${matches}` };
        break;
      }
    }
    // 没有2票一致则取第一个（xxapi优先级最高）
    if (!result[city]) result[city] = { ...votes[0].row, src: "first" };
  }
  return result;
}


async function baiduAiSearch(query: string, apiKey: string): Promise<string> {
  const resp = await fetch(
    "https://app-dpzi13kxv2m9-api-DYJwo27V8Qya-gateway.appmiaoda.com/v2/ai_search/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: query }],
        search_recency_filter: "week",
        enable_reasoning: false,
        max_completion_tokens: 3000,
        resource_type_filter: [{ type: "web", top_k: 8 }],
      }),
      signal: AbortSignal.timeout(35000),
    },
  );
  if (!resp.ok) throw new Error(`AI search HTTP ${resp.status}`);
  const reader = resp.body!.getReader();
  const dec = new TextDecoder("utf-8");
  let buf = "", full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const s = line.slice(6).trim();
      if (s === "[DONE]") continue;
      try { full += JSON.parse(s).choices?.[0]?.delta?.content ?? ""; } catch { /* skip */ }
    }
  }
  return full;
}

function parseAiPriceTable(text: string): Record<string, PriceRow> {
  const result: Record<string, PriceRow> = {};
  const okPrice = (v: string, lo: number, hi: number) => {
    const n = parseFloat(v); return !isNaN(n) && n >= lo && n <= hi;
  };
  for (const line of text.split(/[\n\r]+/)) {
    const m = line.match(/([^\s\d|｜\-]+?)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (!m) continue;
    const raw = m[1].replace(/[省市\*\*|｜「」【】:：]/g, "").trim();
    const p92 = m[2], p95 = m[3], p98 = m[4], p0 = m[5];
    if (!okPrice(p92,5,12)||!okPrice(p95,5,13)||!okPrice(p98,5,15)||!okPrice(p0,4,12)) continue;
    const city = ALL_CITIES.find(c => raw.includes(c) || c.includes(raw));
    if (city && !result[city]) result[city] = { p92, p95, p98, p0 };
  }
  for (const city of ALL_CITIES) {
    if (result[city]) continue;
    const pattern = new RegExp(
      `${city}[^\\d\\n]{0,30}(\\d+\\.\\d+)[^\\d\\n]{0,15}(\\d+\\.\\d+)[^\\d\\n]{0,15}(\\d+\\.\\d+)[^\\d\\n]{0,15}(\\d+\\.\\d+)`
    );
    const m2 = text.match(pattern);
    if (m2) {
      const [, p92, p95, p98, p0] = m2;
      if (okPrice(p92,5,12)&&okPrice(p95,5,13)&&okPrice(p98,5,15)&&okPrice(p0,4,12))
        result[city] = { p92, p95, p98, p0 };
    }
  }
  return result;
}

async function fetchAllCitiesFromBaiduAI(apiKey: string, todayStr: string): Promise<Record<string, PriceRow>> {
  const qNorth = `${todayStr}全国最新成品油价格，请用表格列出每升价格（元/升），格式：省市 92号 95号 98号 0号柴油。需要：北京 天津 河北 山西 内蒙古 辽宁 吉林 黑龙江 山东 河南 陕西 甘肃 青海 宁夏 新疆 西藏`;
  const qSouth = `${todayStr}全国最新成品油价格，请用表格列出每升价格（元/升），格式：省市 92号 95号 98号 0号柴油。需要：上海 江苏 浙江 安徽 福建 江西 湖北 湖南 广东 广西 海南 重庆 四川 贵州 云南`;
  const [northText, southText] = await Promise.all([
    baiduAiSearch(qNorth, apiKey).catch(e => { console.log("[AI北方失败]", String(e)); return ""; }),
    baiduAiSearch(qSouth, apiKey).catch(e => { console.log("[AI南方失败]", String(e)); return ""; }),
  ]);
  console.log("[油价AI北方]", northText.slice(0, 600));
  console.log("[油价AI南方]", southText.slice(0, 600));
  const merged = parseAiPriceTable(northText + "\n" + southText);
  console.log("[油价AI解析城市数]", Object.keys(merged).length);
  return merged;
}

// ══════════════════════════════════════════════════════════════════
// 数据源2（兜底）：qiyoujiage.com HTML爬虫 + 调价预测
// ══════════════════════════════════════════════════════════════════
async function fetchFromQiyou(city: string): Promise<(PriceRow & {
  nextAdjustDate: string; nextTrend: number; nextTrendText: string;
}) | null> {
  const slug = CITY_SLUGS[city];
  if (!slug) return null;
  try {
    const res = await fetch(`https://www.qiyoujiage.com/${slug}.shtml`, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/124" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const okV = (v: string, lo: number, hi: number) => { const n = parseFloat(v); return !isNaN(n) && n >= lo && n <= hi; };
    const ext = (labels: string[]) => {
      for (const lbl of labels) {
        const m1 = html.match(new RegExp(`<dt>[^<]*${lbl}[^<]*</dt>\\s*<dd>([\\d.]+)</dd>`, "i"));
        if (m1) return m1[1];
        const m2 = html.match(new RegExp(`${lbl}[^\\d]{0,10}([6-9]\\.\\d{2})\\s*元`, "i"));
        if (m2) return m2[1];
      }
      return "";
    };
    const rp92 = ext(["92#汽油","92号汽油"]); const rp95 = ext(["95#汽油","95号汽油"]);
    const rp98 = ext(["98#汽油","98号汽油"]); const rp0  = ext(["0#柴油","0号柴油"]);
    if (!rp92 && !rp95) return null;
    const p92 = okV(rp92,5,12)?rp92:"", p95 = okV(rp95,5,13)?rp95:"";
    const p98 = okV(rp98,5,15)?rp98:"", p0  = okV(rp0,4,12)?rp0:"";
    let nextAdjustDate = "", nextTrend = 0, nextTrendText = "";
    const dm = html.match(/下次(?:油价|调价)\s*(\d{1,2})月(\d{1,2})日/);
    if (dm) {
      const now = new Date(), mo = +dm[1], d = +dm[2];
      const yr = mo < now.getMonth()+1 ? now.getFullYear()+1 : now.getFullYear();
      nextAdjustDate = `${yr}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    }
    const tm  = html.match(/(上调|下调)油价.*?\(([\d.]+)元\/升[~－\-]([\d.]+)元\/升\)/);
    const tm2 = html.match(/(上调|下调).*?([\d.]+)元\/升/);
    if (tm) {
      const dn = tm[1]==="下调", avg = (+tm[2]+ +tm[3])/2;
      if (avg>0&&avg<=2) { nextTrend=dn?-avg:avg; nextTrendText=`预计${tm[1]} ${dn?"-":"+"}${tm[2]}~${tm[3]} 元/升`; }
    } else if (tm2) {
      const dn = tm2[1]==="下调", val = +tm2[2];
      if (val>0&&val<=2) { nextTrend=dn?-val:val; nextTrendText=`预计${tm2[1]} ${dn?"-":"+"}${tm2[2]} 元/升`; }
    }
    if (!nextTrendText && html.includes("持平")) { nextTrendText="预计持平"; nextTrend=0; }
    return { p92, p95, p98, p0, nextAdjustDate, nextTrend, nextTrendText };
  } catch { return null; }
}

// ── 经济日报 data.ce.cn JSONP（辅助兜底）────────────────────────
async function fetchFromEpaper(city: string): Promise<PriceRow | null> {
  try {
    const url = `https://data.ce.cn/oil/price/area?area=${encodeURIComponent(city)}&callback=_`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/124", "Referer": "https://data.ce.cn/" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const json = JSON.parse(text.replace(/^_\(/, "").replace(/\)$/, "").trim());
    const find = (lbl: string) => {
      if (!Array.isArray(json?.data)) return "";
      const item = json.data.find((d: Record<string,string>) => d.name?.includes(lbl));
      return item?.price ? String(item.price) : "";
    };
    const p92 = find("92")||find("92#"), p95 = find("95")||find("95#");
    const p98 = find("98")||find("98#"), p0  = find("0号柴")||find("0#柴");
    if (!p92 && !p95) return null;
    return { p92, p95, p98, p0 };
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════
// FALLBACK（所有源失败时兜底，2026-07-18 xxapi 数据）
// ══════════════════════════════════════════════════════════════════
const FALLBACK: Record<string, PriceRow> = {
  "北京":  {p92:"7.42",p95:"7.90",p98:"9.40",p0:"7.12"},
  "天津":  {p92:"7.41",p95:"7.83",p98:"9.33",p0:"7.07"},
  "上海":  {p92:"7.38",p95:"7.85",p98:"9.85",p0:"7.05"},
  "重庆":  {p92:"7.49",p95:"7.91",p98:"9.55",p0:"7.14"},
  "河北":  {p92:"7.41",p95:"7.83",p98:"8.65",p0:"7.07"},
  "山西":  {p92:"7.37",p95:"7.96",p98:"9.14",p0:"7.14"},
  "内蒙古":{p92:"7.42",p95:"7.88",p98:"8.61",p0:"6.93"},
  "辽宁":  {p92:"7.48",p95:"8.00",p98:"8.76",p0:"6.98"},
  "吉林":  {p92:"7.38",p95:"7.96",p98:"8.68",p0:"6.99"},
  "黑龙江":{p92:"7.38",p95:"7.91",p98:"8.97",p0:"6.88"},
  "江苏":  {p92:"7.39",p95:"7.86",p98:"9.93",p0:"7.04"},
  "浙江":  {p92:"7.39",p95:"7.86",p98:"9.36",p0:"7.06"},
  "安徽":  {p92:"7.38",p95:"7.90",p98:"9.40",p0:"7.11"},
  "福建":  {p92:"7.38",p95:"7.89",p98:"9.39",p0:"7.07"},
  "江西":  {p92:"7.38",p95:"7.92",p98:"9.42",p0:"7.12"},
  "山东":  {p92:"7.38",p95:"7.92",p98:"8.92",p0:"6.99"},
  "河南":  {p92:"7.43",p95:"7.93",p98:"8.58",p0:"7.06"},
  "湖北":  {p92:"7.43",p95:"7.95",p98:"9.95",p0:"7.06"},
  "湖南":  {p92:"7.37",p95:"7.84",p98:"9.04",p0:"7.14"},
  "广东":  {p92:"7.44",p95:"8.06",p98:"10.06",p0:"7.08"},
  "广西":  {p92:"7.48",p95:"8.08",p98:"9.36",p0:"7.13"},
  "海南":  {p92:"8.53",p95:"9.06",p98:"10.06",p0:"7.16"},
  "四川":  {p92:"7.52",p95:"8.03",p98:"9.17",p0:"7.13"},
  "贵州":  {p92:"7.55",p95:"7.98",p98:"8.98",p0:"7.18"},
  "云南":  {p92:"7.56",p95:"8.12",p98:"8.80",p0:"7.15"},
  "西藏":  {p92:"8.30",p95:"8.78",p98:"9.79",p0:"7.62"},
  "陕西":  {p92:"7.31",p95:"7.72",p98:"8.82",p0:"6.97"},
  "甘肃":  {p92:"7.42",p95:"7.92",p98:"8.49",p0:"6.98"},
  "青海":  {p92:"7.37",p95:"7.91",p98:"8.61",p0:"7.00"},
  "宁夏":  {p92:"7.32",p95:"7.74",p98:"8.84",p0:"6.96"},
  "新疆":  {p92:"7.22",p95:"7.72",p98:"8.62",p0:"6.85"},
};

// ══════════════════════════════════════════════════════════════════
// 主服务
// ══════════════════════════════════════════════════════════════════
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const integKey    = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
  const juheKey     = Deno.env.get("JUHE_OIL_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  let force = false;
  try { const body = await req.json(); force = body.force === true; } catch { /* 默认 */ }

  // 北京时间今日日期
  const bjDate    = new Date(Date.now() + 8 * 3600 * 1000);
  const todayDate = bjDate.toISOString().slice(0, 10);

  // 调价窗口检测
  // 用 last_adjust_date（调价钩子写入）做窗口判断，避免 next_adjust_date 被钩子提前更新后导致窗口永远不触发
  const { data: existing } = await supabase
    .from("oil_prices").select("update_date,next_adjust_date,last_adjust_date").eq("city","天津").maybeSingle();

  if (!force && existing) {
    const lastAdjDate = (existing.last_adjust_date ?? "").slice(0, 10);
    const storedDate  = (existing.update_date ?? "").slice(0, 10);
    // 已在本次调价周期内更新过（update_date >= last_adjust_date），无需重复抓取
    if (lastAdjDate && storedDate >= lastAdjDate) {
      console.log(`[油价] 本期已更新 last_adjust_date=${lastAdjDate} update_date=${storedDate}，跳过`);
      return new Response(JSON.stringify({
        status:0, skipped:true,
        message:`本期(${lastAdjDate})价格已是最新，无需更新`,
        last_update:storedDate, last_adjust_date:lastAdjDate,
      }), { status:200, headers:{"Content-Type":"application/json",...CORS} });
    }
    console.log(`[油价] 调价窗口开启 last_adjust_date=${lastAdjDate} update_date=${storedDate}`);
    force = true;
  }

  // 读取现有DB作为兜底（含 is_simul 标记）
  const { data: existingRows } = await supabase
    .from("oil_prices")
    .select("city,p92,p95,p98,p0,trend,trend_date,next_adjust_date,next_trend,next_trend_text,is_simul");
  const dbMap: Record<string, Record<string,string|number|boolean>> = {};
  // is_simul=true 的城市集合：跳过真实价格覆盖
  const simulCitiesSet = new Set<string>();
  for (const r of (existingRows ?? [])) {
    dbMap[r.city] = r;
    if (r.is_simul) simulCitiesSet.add(r.city);
  }

  // ── 步骤1：xxapi + moli + 7ec 三源并行抓取 + 投票合并 ──────────
  let juhePrices: Record<string, PriceRow> = {};
  try {
    console.log("[油价] 三源并行抓取开始...");
    const [xxapiRes, moliRes, ec7Res] = await Promise.all([
      fetchAllCitiesFromXxapi().catch(e => { console.warn("[xxapi失败]", String(e)); return {}; }),
      fetchAllCitiesFromMoli().catch(e  => { console.warn("[moli失败]",  String(e)); return {}; }),
      fetchAllCitiesFrom7ec().catch(e   => { console.warn("[7ec失败]",   String(e)); return {}; }),
    ]);
    const xxCount = Object.keys(xxapiRes).length;
    const moCount = Object.keys(moliRes).length;
    const ecCount = Object.keys(ec7Res).length;
    console.log(`[油价] 三源结果: xxapi=${xxCount} moli=${moCount} 7ec=${ecCount}`);
    // 投票合并：优先用多票一致值；xxapi放首位（最高优先级）
    const voted = mergeWithVoting([xxapiRes, moliRes, ec7Res], ALL_CITIES);
    for (const city of ALL_CITIES) {
      if (voted[city]) juhePrices[city] = voted[city];
    }
    console.log(`[油价] 投票合并后覆盖 ${Object.keys(juhePrices).length} 城市`);
  } catch (e) {
    console.warn("[油价] 多源抓取失败，降级AI搜索:", String(e));
  }

  // ── 步骤2：百度AI搜索补全juhe未覆盖城市（备用）─────────────────
  const juheHit = Object.keys(juhePrices).length;
  let aiPrices: Record<string, PriceRow> = {};
  if (juheHit < 20 && integKey) {
    // juhe覆盖不足20个城市时才触发AI搜索补全
    try {
      console.log(`[油价] juhe仅覆盖${juheHit}城市，触发AI搜索补全...`);
      aiPrices = await fetchAllCitiesFromBaiduAI(integKey, todayDate);
      console.log(`[油价] AI补充解析 ${Object.keys(aiPrices).length} 城市`);
    } catch (e) {
      console.warn("[油价] AI搜索也失败:", String(e));
    }
  }

  // ── 步骤3：HTML爬虫补全剩余城市 + 获取调价预测（兜底）──────────
  const coveredCities = new Set([...Object.keys(juhePrices), ...Object.keys(aiPrices)]);
  const missingCities = ALL_CITIES.filter(c => !coveredCities.has(c));
  // 天津必爬（用于获取调价预测 nextAdjustDate/nextTrend）
  const citiesToScrape = [...new Set([...missingCities, "天津"])];
  const scrapeResults: Record<string, (PriceRow & {nextAdjustDate:string;nextTrend:number;nextTrendText:string}) | null> = {};

  for (let i = 0; i < citiesToScrape.length; i += 6) {
    const batch = citiesToScrape.slice(i, i + 6);
    await Promise.all(batch.map(async city => {
      const [ep, qy] = await Promise.all([fetchFromEpaper(city), fetchFromQiyou(city)]);
      if (!ep && !qy) { scrapeResults[city] = null; return; }
      const pick = (...vs: string[]) => vs.find(v => v && parseFloat(v) > 0) ?? "";
      scrapeResults[city] = {
        p92: pick(ep?.p92??"", qy?.p92??""),
        p95: pick(ep?.p95??"", qy?.p95??""),
        p98: pick(ep?.p98??"", qy?.p98??""),
        p0:  pick(ep?.p0??"",  qy?.p0??""),
        nextAdjustDate: qy?.nextAdjustDate ?? "",
        nextTrend:      qy?.nextTrend      ?? 0,
        nextTrendText:  qy?.nextTrendText  ?? "",
      };
    }));
    if (i + 6 < citiesToScrape.length) await new Promise(r => setTimeout(r, 300));
  }

  // 调价预测（天津代表全国）
  const dbTj = dbMap["天津"];
  const tjSc = scrapeResults["天津"];
  const sharedNextAdjustDate = tjSc?.nextAdjustDate || String(dbTj?.next_adjust_date||"");
  const sharedNextTrend      = tjSc?.nextTrend      ?? Number(dbTj?.next_trend??0);
  const sharedNextTrendText  = tjSc?.nextTrendText  || String(dbTj?.next_trend_text||"");

  // ── 步骤4：合并写库（juhe > AI > HTML爬虫 > DB保留 > FALLBACK）──
  // is_simul=true 的城市跳过真实价格写入（保留模拟价格），但更新走势/调价日等元数据
  const rows: object[] = [];
  const skipped: string[] = [];
  const simulSkipped: string[] = [];
  for (const city of ALL_CITIES) {
    const jh = juhePrices[city];
    const ai = aiPrices[city];
    const sc = scrapeResults[city];
    const db = dbMap[city];
    const fb = FALLBACK[city];

    // 该城市处于模拟状态：只更新走势/调价日，不覆盖价格
    if (simulCitiesSet.has(city)) {
      simulSkipped.push(city);
      // 仅更新调价预测字段，价格保持 DB 中的模拟价不变
      await supabase.from("oil_prices").update({
        next_adjust_date: sharedNextAdjustDate,
        next_trend: sharedNextTrend,
        next_trend_text: sharedNextTrendText,
        fetched_at: new Date().toISOString(),
      }).eq("city", city);
      continue;
    }

    const pick = (...vs: string[]) => vs.find(v => v && parseFloat(v) > 0) ?? "";
    const p92 = pick(jh?.p92??"", ai?.p92??"", sc?.p92??"", String(db?.p92??""), fb?.p92??"");
    const p95 = pick(jh?.p95??"", ai?.p95??"", sc?.p95??"", String(db?.p95??""), fb?.p95??"");
    const p98 = pick(jh?.p98??"", ai?.p98??"", sc?.p98??"", String(db?.p98??""), fb?.p98??"");
    const p0  = pick(jh?.p0??"",  ai?.p0??"",  sc?.p0??"",  String(db?.p0??""),  fb?.p0??"");
    if (!p92) { skipped.push(city); continue; }
    const p0v = parseFloat(p0)||7.07;
    const src = jh?.p92 ? ((jh as PriceRow & {src?:string}).src?.startsWith("vote") ? `multi_vote(${(jh as PriceRow & {src?:string}).src})` : "xxapi")
              : ai?.p92  ? "baidu_ai"
              : sc?.p92  ? "html_scrape"
              : db?.p92  ? "db_preserved" : "fallback";
    rows.push({
      city, p92, p95, p98, p0,
      pm10: (p0v+0.10).toFixed(2), pm20: (p0v+0.20).toFixed(2), pm35: (p0v+0.35).toFixed(2),
      update_date: todayDate,
      trend: Number(db?.trend??0.24),
      trend_date: String(db?.trend_date||todayDate),
      next_adjust_date: sharedNextAdjustDate,
      next_trend: sharedNextTrend,
      next_trend_text: sharedNextTrendText,
      fetched_at: new Date().toISOString(),
      source: src,
      is_simul: false, // 真实数据，重置模拟标记
      // 每次真实调价也备份旧价到 prev_*，保持「永远与上次对比」的一致逻辑
      prev_p92: String(db?.p92 ?? ''),
      prev_p95: String(db?.p95 ?? ''),
      prev_p98: String(db?.p98 ?? ''),
      prev_p0:  String(db?.p0  ?? ''),
    });
  }

  const { error } = await supabase.from("oil_prices").upsert(rows, { onConflict:"city" });
  await supabase.from("oil_price_cache").delete().neq("city","");

  // 历史记录：所有有效城市都写，ignoreDuplicates:false 确保调价后新价格覆盖同日旧记录
  if (!error) {
    const hist = (rows as Array<Record<string,string|number>>)
      .filter(r => !!r.p92 && r.p92 !== '' && r.p92 !== '--')
      .map(r => {
        // trend = 新p92 - 旧p92（prev_p92 由调价时备份）
        const newP = parseFloat(String(r.p92));
        const oldP = parseFloat(String(r.prev_p92 ?? ''));
        const trendVal = (!isNaN(newP) && !isNaN(oldP) && oldP > 0)
          ? +(newP - oldP).toFixed(2)
          : Number(r.trend ?? 0);
        return { city: r.city, p92: r.p92, p95: r.p95, p98: r.p98, p0: r.p0,
                 trend: trendVal, update_date: r.update_date };
      });
    if (hist.length > 0)
      await supabase.from("oil_price_history").upsert(hist, { onConflict: "city,update_date", ignoreDuplicates: false });
  }

  // ── 调价完成后：触发 adjust-hook（快照本期均价→上期均价，推算下次调价日）──
  // fire-and-forget，不阻塞当前响应
  if (!error) {
    const hookUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "") + "/functions/v1/oilprice-adjust-hook";
    fetch(hookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
      },
      body: JSON.stringify({ adjust_date: todayDate, force: false }),
    }).catch(e => console.warn("[油价] 触发adjust-hook失败:", String(e).slice(0, 80)));
    console.log(`[油价] 触发 adjust-hook: 快照本期均价→上期均价(crude_last_cycle_avg)`);
  }

  // ── 调价完成后：触发系数标定（fire-and-forget）──
  // 读取天津当前原油基准和变化率，连同实际调价幅度一起传给 calibrate EF
  if (!error) {
    const { data: tjOil } = await supabase
      .from("oil_prices")
      .select("crude_brent,crude_last_cycle_avg,crude_avg10d,crude_change_rate,trend")
      .eq("city", "天津").maybeSingle();
    const tjRow = (rows as Array<Record<string,string|number>>).find(r => r.city === "天津");
    const actualDelta = Number(tjRow?.trend ?? 0);   // 本次调价幅度（元/升）
    const brent       = Number(tjOil?.crude_brent ?? 0);
    const base        = Number(tjOil?.crude_last_cycle_avg ?? 0) || Number(tjOil?.crude_avg10d ?? 0);
    if (actualDelta !== 0 && brent > 0 && base > 0) {
      const calibUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "") + "/functions/v1/oilprice-crude-calibrate";
      fetch(calibUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
        },
        body: JSON.stringify({
          adjust_date:  todayDate,
          city:         "天津",
          actual_delta: actualDelta,
          crude_brent:  brent,
          crude_base:   base,
          change_rate:  Number(tjOil?.crude_change_rate ?? 0),
          note:         `oilprice-admin-update 自动标定，来源: xxapi/AI/爬虫`,
        }),
      }).catch(e => console.warn("[油价] 触发标定EF失败:", String(e).slice(0, 80)));
      console.log(`[油价] 触发系数标定: delta=${actualDelta} brent=${brent} base=${base}`);
    } else {
      console.log(`[油价] 跳过标定: actualDelta=${actualDelta} brent=${brent} base=${base}`);
    }
  }

  // ── 调价完成后：若 sharedNextAdjustDate ≤ 今天，说明爬虫未能获取下一期日期 ──
  // 强制触发 oilprice-trend-update（is_adjust_day=true 绕过24h冷却锁），获取下一期调价日
  if (!error && (!sharedNextAdjustDate || sharedNextAdjustDate <= todayDate)) {
    console.log(`[油价] 调价完成但下一期日期未获取(sharedNextAdjustDate=${sharedNextAdjustDate})，触发走势EF获取下一期`);
    const trendEfUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "") + "/functions/v1/oilprice-trend-update";
    fetch(trendEfUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
      },
      body: JSON.stringify({ force: true, is_adjust_day: true }),
    }).catch(e => console.warn("[油价] 触发走势EF失败:", String(e).slice(0, 80)));
    // fire-and-forget，不阻塞当前响应
  }

  const juheCnt = (rows as Array<Record<string,string>>).filter(r=>r.source==="xxapi"||r.source?.startsWith("vote")||r.source==="first").length;
  const aiCnt   = (rows as Array<Record<string,string>>).filter(r=>r.source==="baidu_ai").length;
  const scCnt   = (rows as Array<Record<string,string>>).filter(r=>r.source==="html_scrape").length;
  const dbCnt   = (rows as Array<Record<string,string>>).filter(r=>r.source==="db_preserved").length;
  const fbCnt   = (rows as Array<Record<string,string>>).filter(r=>r.source==="fallback").length;

  // 调价通知（每日一次）
  if (!error) {
    const tjRow = (rows as Array<Record<string,string|number>>).find(r=>r.city==="天津");
    const { count:nc } = await supabase.from("notifications")
      .select("id",{count:"exact",head:true}).eq("type","oil_adjust")
      .gte("created_at",`${todayDate}T00:00:00+08:00`).lte("created_at",`${todayDate}T23:59:59+08:00`);
    if ((nc??0)===0 && tjRow) {
      const tAbs = Math.abs(sharedNextTrend);
      const tDir = sharedNextTrend>0?"上调":sharedNextTrend<0?"下调":"持平";
      await supabase.from("notifications").insert({
        type:"oil_adjust", title:`🔔 成品油调价通知 · ${todayDate}`,
        body:`国家发改委今日调整成品油价格，${tDir} ${tAbs.toFixed(2)} 元/升。天津参考：92# ${tjRow.p92}元 95# ${tjRow.p95}元 柴油 ${tjRow.p0}元`,
        meta:{adjust_date:todayDate,trend_dir:tDir,trend_val:tAbs,trend_text:sharedNextTrendText,
              tianjin:{p92:tjRow.p92,p95:tjRow.p95,p0:tjRow.p0},juhe_count:juheCnt,ai_count:aiCnt,scrape_count:scCnt},
      });
    }
  }

  return new Response(JSON.stringify({
    status: error?1:0,
    message: error ? `写入失败: ${error.message}`
      : `聚合数据 ${juheCnt}城市 | AI搜索 ${aiCnt}城市 | HTML爬虫 ${scCnt}城市 | DB保留 ${dbCnt}城市 | FALLBACK ${fbCnt}城市`,
    total:rows.length, juhe_count:juheCnt, ai_count:aiCnt, scrape_count:scCnt, db_count:dbCnt, fallback_count:fbCnt,
    skipped, simul_skipped: simulSkipped, next_adjust_date:sharedNextAdjustDate, next_trend_text:sharedNextTrendText,
    sample:{
      天津:(rows as Array<Record<string,string>>).find(r=>r.city==="天津"),
      北京:(rows as Array<Record<string,string>>).find(r=>r.city==="北京"),
    },
    error: error?.message,
  }), {status:200, headers:{"Content-Type":"application/json",...CORS}});
});
