import { serve } from "https://deno.land/std/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 城市限行静态规则（基于2024-2025年各市官方公告）
// 格式：weekday(0=日,1=一...6=六) → 限行尾号数组
// 特殊城市采用单双号或轮换制，在 specialRule 中说明
const LIMIT_RULES: Record<string, {
  type: "tail" | "oddeven" | "none";
  // type=tail: weekMap[weekday] = 尾号字符串如 "1和6"
  weekMap?: Record<number, string>;
  time: string[];     // 限行时段
  area: string;       // 限行区域
}> = {
  // 北京：周一~周五按尾号，周六日不限
  beijing: {
    type: "tail",
    weekMap: { 1: "1和6", 2: "2和7", 3: "3和8", 4: "4和9", 5: "0和5" },
    time: ["7:00-9:00", "17:00-20:00"],
    area: "五环路（含）以内道路",
  },
  // 天津：周一~周五尾号，周六日不限
  tianjin: {
    type: "tail",
    weekMap: { 1: "1和6", 2: "2和7", 3: "3和8", 4: "4和9", 5: "0和5" },
    time: ["7:00-9:00", "17:00-19:00"],
    area: "外环线（含）以内道路",
  },
  // 杭州：周一~周五轮换限2尾号
  hangzhou: {
    type: "tail",
    weekMap: { 1: "5和0", 2: "1和6", 3: "2和7", 4: "3和8", 5: "4和9" },
    time: ["7:00-9:00", "17:00-19:00"],
    area: "绕城高速（含）以内区域主要道路",
  },
  // 成都：按尾号轮换
  chengdu: {
    type: "tail",
    weekMap: { 1: "1和6", 2: "2和7", 3: "3和8", 4: "4和9", 5: "0和5" },
    time: ["7:30-9:00", "17:30-19:00"],
    area: "三环路（含）以内道路",
  },
  // 兰州：按尾号限行
  lanzhou: {
    type: "tail",
    weekMap: { 1: "1和6", 2: "2和7", 3: "3和8", 4: "4和9", 5: "0和5" },
    time: ["7:30-9:00", "17:30-19:00"],
    area: "安宁区、七里河区、城关区、西固区主干道",
  },
  // 贵阳：按尾号
  guiyang: {
    type: "tail",
    weekMap: { 1: "1和6", 2: "2和7", 3: "3和8", 4: "4和9", 5: "0和5" },
    time: ["7:30-9:00", "17:30-19:00"],
    area: "绕城高速（含）以内区域主要道路",
  },
  // 南昌、长春、哈尔滨、武汉：按尾号
  nanchang:  { type: "tail", weekMap: { 1:"1和6",2:"2和7",3:"3和8",4:"4和9",5:"0和5" }, time:["7:30-9:00","17:00-19:00"], area:"中心城区主要道路" },
  changchun: { type: "tail", weekMap: { 1:"1和6",2:"2和7",3:"3和8",4:"4和9",5:"0和5" }, time:["7:00-9:00","17:00-19:00"], area:"二环路（含）以内主要道路" },
  haerbin:   { type: "tail", weekMap: { 1:"1和6",2:"2和7",3:"3和8",4:"4和9",5:"0和5" }, time:["7:00-9:00","16:30-19:00"], area:"三环路（含）以内道路" },
  wuhan:     { type: "tail", weekMap: { 1:"1和6",2:"2和7",3:"3和8",4:"4和9",5:"0和5" }, time:["7:00-9:00","17:00-19:00"], area:"三环线（含）以内主要道路" },
  // 上海、深圳：外牌限行（非本地车牌），本地尾号不限
  shanghai: { type: "none", time:[], area:"" },
  shenzhen: { type: "none", time:[], area:"" },
};

const WEEKDAYS = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let city: string, date: string;
  try {
    const body = await req.json();
    city = body.city;
    date = body.date;
    if (!city || !date) throw new Error("missing params");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  const rule = LIMIT_RULES[city];
  if (!rule) {
    // 未收录城市 → 不限行
    return new Response(
      JSON.stringify({ status: 0, result: { cityname: city, number: "", time: [], area: "", week: "", noRestriction: true, source: "static" } }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const d = new Date(date);
  const weekday = d.getDay(); // 0=日 1=一 ... 6=六
  const week = WEEKDAYS[weekday];

  if (rule.type === "none" || !rule.weekMap || !rule.weekMap[weekday]) {
    // 不限行日（周末或该城市无尾号限行）
    return new Response(
      JSON.stringify({ status: 0, result: { cityname: city, number: "", time: [], area: rule.area, week, noRestriction: true, source: "static" } }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const number = rule.weekMap[weekday];
  return new Response(
    JSON.stringify({ status: 0, result: { cityname: city, number, time: rule.time, area: rule.area, week, noRestriction: false, source: "static" } }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
