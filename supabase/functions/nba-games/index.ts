// NBA 赛事查询 Edge Function
// 数据源：腾讯体育 matchweb NBA 赛程接口（columnId=100000）
// 输入：POST { days?: number }  查询天数（默认3：昨天+今天+明天，最大7）
// 输出：{ games: [{ matchId, matchDate, startTime, homeTeam, awayTeam, homeScore, awayScore, status, period, homeLogo, awayLogo }], count, dates }
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

// 日期格式化为 YYYYMMDD（基于本地时区，UTC+8）
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

type RawMatch = Record<string, any>;
type Game = {
  matchId: string;
  matchDate: string;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: string;
  awayScore: string;
  status: string;
  period: string;
  homeLogo: string;
  awayLogo: string;
};

function norm(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

// 腾讯体育 matchStatus 可能是数字：0=未开始 1=进行中 2/3=已结束
function normStatus(s: string): string {
  if (s === "0" || s === "") return "未开始";
  if (s === "1") return "进行中";
  if (s === "2" || s === "3") return "已结束";
  return s;
}

function parseMatch(m: RawMatch, dateKey: string): Game | null {
  const homeTeam = norm(m.leftName || m.homeName || m.leftTeam);
  const awayTeam = norm(m.rightName || m.awayName || m.rightTeam);
  if (!homeTeam && !awayTeam) return null;
  const homeScore = norm(m.leftGoal ?? m.leftScore ?? m.homeScore ?? m.homeGoal);
  const awayScore = norm(m.rightGoal ?? m.rightScore ?? m.awayScore ?? m.awayGoal);
  const homeLogo = norm(m.leftLogo || m.homeLogo);
  const awayLogo = norm(m.rightLogo || m.awayLogo);
  const rawStatus = norm(m.matchStatus || m.status || "");
  const status = normStatus(rawStatus);
  const period = norm(m.period || m.quarter || m.matchPeriod || "");
  return {
    matchId: norm(m.matchId) || `${dateKey}-${homeTeam}-${awayTeam}`,
    matchDate: dateKey,
    startTime: norm(m.startTime),
    homeTeam, awayTeam, homeScore, awayScore, status, period, homeLogo, awayLogo,
  };
}

async function fetchDay(dateKey: string): Promise<Game[]> {
  try {
    const url = `https://matchweb.sports.qq.com/matchList?columnId=100000&startTime=${dateKey}&endTime=${dateKey}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Referer": "https://nba.qq.com/", "Accept": "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const dayMatches: RawMatch[] = Array.isArray(data?.data?.[dateKey])
      ? data.data[dateKey]
      : Array.isArray(data?.data) ? data.data : [];
    return dayMatches.map(m => parseMatch(m, dateKey)).filter(Boolean) as Game[];
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    let days = 3;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.days && body.days > 0 && body.days <= 7) days = body.days;
    }
    const today = new Date();
    const dates: string[] = [];
    const half = Math.floor(days / 2);
    for (let i = -half; i <= half; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(ymd(d));
    }
    const results = await Promise.all(dates.map(d => fetchDay(d)));
    const games = results.flat();
    return json({ games, count: games.length, dates });
  } catch (e) {
    return json({ error: String(e?.message || e), games: [], count: 0 }, 500);
  }
});
