import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 15 * 60 * 1000; // 15分钟缓存

// 中国主要城市坐标表（Open-Meteo 需坐标定位）
const CITY_COORDS: Record<string, { lat: number; lon: number; name: string }> = {
  "天津":  { lat: 39.0842, lon: 117.2010, name: "天津" },
  "北京":  { lat: 39.9042, lon: 116.4074, name: "北京" },
  "上海":  { lat: 31.2304, lon: 121.4737, name: "上海" },
  "广州":  { lat: 23.1291, lon: 113.2644, name: "广州" },
  "深圳":  { lat: 22.5431, lon: 114.0579, name: "深圳" },
  "杭州":  { lat: 30.2741, lon: 120.1551, name: "杭州" },
  "成都":  { lat: 30.5728, lon: 104.0668, name: "成都" },
  "武汉":  { lat: 30.5928, lon: 114.3055, name: "武汉" },
  "西安":  { lat: 34.3416, lon: 108.9398, name: "西安" },
  "重庆":  { lat: 29.5630, lon: 106.5516, name: "重庆" },
  "南京":  { lat: 32.0603, lon: 118.7969, name: "南京" },
  "沈阳":  { lat: 41.8057, lon: 123.4315, name: "沈阳" },
  "哈尔滨":{ lat: 45.8038, lon: 126.5340, name: "哈尔滨" },
  "济南":  { lat: 36.6512, lon: 117.1201, name: "济南" },
  "青岛":  { lat: 36.0671, lon: 120.3826, name: "青岛" },
  "郑州":  { lat: 34.7466, lon: 113.6253, name: "郑州" },
  "长沙":  { lat: 28.2282, lon: 112.9388, name: "长沙" },
  "合肥":  { lat: 31.8206, lon: 117.2272, name: "合肥" },
  "石家庄":{ lat: 38.0428, lon: 114.5149, name: "石家庄" },
  "太原":  { lat: 37.8706, lon: 112.5489, name: "太原" },
  "长春":  { lat: 43.8868, lon: 125.3245, name: "长春" },
  "南昌":  { lat: 28.6820, lon: 115.8579, name: "南昌" },
  "福州":  { lat: 26.0745, lon: 119.2965, name: "福州" },
  "厦门":  { lat: 24.4798, lon: 118.0894, name: "厦门" },
  "昆明":  { lat: 24.8801, lon: 102.8329, name: "昆明" },
  "贵阳":  { lat: 26.6470, lon: 106.6302, name: "贵阳" },
  "南宁":  { lat: 22.8170, lon: 108.3665, name: "南宁" },
  "海口":  { lat: 20.0440, lon: 110.1999, name: "海口" },
  "兰州":  { lat: 36.0611, lon: 103.8343, name: "兰州" },
  "西宁":  { lat: 36.6171, lon: 101.7782, name: "西宁" },
  "银川":  { lat: 38.4872, lon: 106.2309, name: "银川" },
  "乌鲁木齐":{ lat: 43.8256, lon: 87.6168, name: "乌鲁木齐" },
  "拉萨":  { lat: 29.6520, lon: 91.1721, name: "拉萨" },
  "呼和浩特":{ lat: 40.8426, lon: 111.7497, name: "呼和浩特" },
  "大连":  { lat: 38.9140, lon: 121.6147, name: "大连" },
  "宁波":  { lat: 29.8683, lon: 121.5440, name: "宁波" },
  "无锡":  { lat: 31.4910, lon: 120.3119, name: "无锡" },
  "苏州":  { lat: 31.2990, lon: 120.5853, name: "苏州" },
  "温州":  { lat: 28.0000, lon: 120.6722, name: "温州" },
  "唐山":  { lat: 39.6309, lon: 118.1800, name: "唐山" },
};

// WMO 天气代码 → 中文描述（精确版，对照 WMO 4677 标准）
function wmoToText(code: number): string {
  switch (code) {
    case 0:  return "晴";
    case 1:  return "晴间多云";
    case 2:  return "多云";
    case 3:  return "阴";
    case 45: return "雾";
    case 48: return "冻雾";
    case 51: return "小毛毛雨";
    case 53: return "毛毛雨";
    case 55: return "大毛毛雨";
    case 56: return "冻毛毛雨";
    case 57: return "强冻毛毛雨";
    case 61: return "小雨";
    case 63: return "中雨";
    case 65: return "大雨";
    case 66: return "冻雨";
    case 67: return "强冻雨";
    case 71: return "小雪";
    case 73: return "中雪";
    case 75: return "大雪";
    case 77: return "冰粒";
    case 80: return "小阵雨";
    case 81: return "阵雨";
    case 82: return "强阵雨";
    case 85: return "小阵雪";
    case 86: return "阵雪";
    case 95: return "雷阵雨";
    case 96: return "雷阵雨伴小冰雹";
    case 99: return "雷阵雨伴大冰雹";
    default: return code <= 49 ? "雾" : code <= 69 ? "雨" : code <= 79 ? "雪" : code <= 84 ? "阵雨" : "雷阵雨";
  }
}

// 风速(m/s) → 中文风力等级
function windSpeedToLevel(ms: number): string {
  if (ms < 0.3) return "0级";
  if (ms < 1.6) return "1级";
  if (ms < 3.4) return "2级";
  if (ms < 5.5) return "3级";
  if (ms < 8.0) return "4级";
  if (ms < 10.8) return "5级";
  if (ms < 13.9) return "6级";
  if (ms < 17.2) return "7级";
  if (ms < 20.8) return "8级";
  if (ms < 24.5) return "9级";
  if (ms < 28.5) return "10级";
  if (ms < 32.7) return "11级";
  return "12级以上";
}

// 风向角度 → 中文
function windDegToDir(deg: number): string {
  const dirs = ["北风","东北风","东风","东南风","南风","西南风","西风","西北风"];
  return dirs[Math.round(deg / 45) % 8];
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST")    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  let areaCn: string | undefined;
  let lng: string | undefined;
  let lat: string | undefined;
  let cityLabel: string | undefined;
  let force = false;

  try {
    const body = await req.json().catch(() => ({}));
    areaCn    = body.areaCn;
    cityLabel = body.cityLabel;
    force     = body.force === true;
    if (body.lng !== undefined) lng = String(body.lng);
    if (body.lat !== undefined) lat = String(body.lat);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, supabaseKey);

  const rawCity = (areaCn ?? cityLabel ?? "天津").replace(/[市区县省]$/, "");
  const cityKey = rawCity;

  // ── Step 1: 缓存命中 ──
  if (!force) {
    const { data: cached } = await supabase
      .from("weather_cache").select("*").eq("city", cityKey)
      .gte("fetched_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
      .maybeSingle();
    if (cached?.temp && cached.temp !== "--") {
      return new Response(JSON.stringify({ status: 0, data: dbRowToData(cached), source: "cache" }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
  }

  // ── Step 2: 解析坐标 ──
  let finalLat = lat ? parseFloat(lat) : NaN;
  let finalLon = lng ? parseFloat(lng) : NaN;
  let cityName = cityLabel ?? rawCity;

  if (isNaN(finalLat) || isNaN(finalLon)) {
    const coords = CITY_COORDS[rawCity];
    if (coords) { finalLat = coords.lat; finalLon = coords.lon; cityName = coords.name; }
    else { finalLat = 39.0842; finalLon = 117.2010; cityName = rawCity; } // 天津兜底
  }

  // ── Step 3: 调用 Open-Meteo ──
  console.log(`[weather-1d] Open-Meteo: city=${cityKey}(${cityName}) lat=${finalLat} lon=${finalLon}`);
  const omUrl = new URL("https://api.open-meteo.com/v1/forecast");
  omUrl.searchParams.set("latitude",  String(finalLat));
  omUrl.searchParams.set("longitude", String(finalLon));
  omUrl.searchParams.set("current",   "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,visibility,precipitation");
  omUrl.searchParams.set("hourly",    "temperature_2m,weather_code,precipitation_probability,wind_speed_10m");
  omUrl.searchParams.set("daily",     "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max");
  omUrl.searchParams.set("timezone",  "Asia/Shanghai");
  omUrl.searchParams.set("forecast_days", "7");

  try {
    const res = await fetch(omUrl.toString());
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const om = await res.json() as {
      current: {
        temperature_2m: number; relative_humidity_2m: number;
        apparent_temperature: number; weather_code: number;
        wind_speed_10m: number; wind_direction_10m: number;
        surface_pressure: number; visibility: number; precipitation: number;
        time: string;
      };
      hourly: {
        time: string[]; temperature_2m: number[];
        weather_code: number[]; precipitation_probability: number[];
        wind_speed_10m: number[];
      };
      daily: {
        time: string[]; weather_code: number[];
        temperature_2m_max: number[]; temperature_2m_min: number[];
        sunrise: string[]; sunset: string[];
        uv_index_max: number[]; precipitation_probability_max: number[];
      };
    };

    const cur = om.current;
    const todayWeather = wmoToText(cur.weather_code);

    // 逐小时（取未来12小时）
    const nowHour = new Date(cur.time).getHours();
    const hour1d = om.hourly.time
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => {
        const h = new Date(t).getHours();
        const d = new Date(t).toDateString();
        return d === new Date(cur.time).toDateString() && new Date(t) >= new Date(cur.time);
      })
      .slice(0, 12)
      .map(({ i }) => ({
        time:    om.hourly.time[i].slice(11, 16),
        weather: wmoToText(om.hourly.weather_code[i]),
        temp:    String(Math.round(om.hourly.temperature_2m[i])),
        pop:     String(om.hourly.precipitation_probability[i] ?? 0),
        windDir: "", windScale: windSpeedToLevel(om.hourly.wind_speed_10m[i]),
      }));

    // 7日预报
    const forecast7d = om.daily.time.map((date, i) => ({
      time:     date,
      weather:  wmoToText(om.daily.weather_code[i]),
      weatherN: wmoToText(om.daily.weather_code[i]),
      tempMax:  String(Math.round(om.daily.temperature_2m_max[i])),
      tempMin:  String(Math.round(om.daily.temperature_2m_min[i])),
      windDay: "", windNight: "", windPow: "", windGusts: "",
      pop:      String(om.daily.precipitation_probability_max[i] ?? 0),
      precip:   "",
      uvIndex:  String(Math.round(om.daily.uv_index_max[i] ?? 0)),
      radiation: "",
      sunrise:  om.daily.sunrise[i]?.slice(11, 16) ?? "",
      sunset:   om.daily.sunset[i]?.slice(11, 16)  ?? "",
      lifeIndex: null,
    }));

    const row = {
      city: cityKey, city_name: cityName,
      weather:     todayWeather,
      weather_day: todayWeather,
      temp:        String(Math.round(cur.temperature_2m)),
      humidity:    String(cur.relative_humidity_2m),
      humidity_txt: `${cur.relative_humidity_2m}%`,
      dew_point: "", cloud_cover: "",
      wind_dir:   windDegToDir(cur.wind_direction_10m),
      wind_power: windSpeedToLevel(cur.wind_speed_10m),
      wind_speed: String(Math.round(cur.wind_speed_10m * 10) / 10),
      wind_gusts: "", feels_like: String(Math.round(cur.apparent_temperature)),
      pressure:   String(Math.round(cur.surface_pressure)),
      visibility: String(Math.round(cur.visibility / 1000)),
      uv_index:   String(Math.round(om.daily.uv_index_max[0] ?? 0)),
      air_quality: "", pm25: "", pm10: "",
      sunrise:    om.daily.sunrise[0]?.slice(11, 16) ?? "",
      sunset:     om.daily.sunset[0]?.slice(11, 16)  ?? "",
      moon_phase: "",
      precip:     String(cur.precipitation),
      precip_prob: String(om.daily.precipitation_probability_max[0] ?? 0),
      alarm: "",
      hour1d: hour1d.length > 0 ? hour1d : null,
      life_index: null,
      forecast7d,
      fetched_at: new Date().toISOString(),
    };
    await supabase.from("weather_cache").upsert(row, { onConflict: "city" });
    console.log(`[weather-1d] ✅ Open-Meteo ${cityName} ${row.temp}°C ${todayWeather} 湿度${cur.relative_humidity_2m}%`);
    return new Response(JSON.stringify({ status: 0, data: dbRowToData(row), source: "open-meteo" }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

  } catch (e) {
    console.error(`[weather-1d] Open-Meteo 失败: ${e}`);
    const { data: stale } = await supabase.from("weather_cache").select("*").eq("city", cityKey).maybeSingle();
    if (stale?.temp) return new Response(JSON.stringify({ status: 0, data: dbRowToData(stale), source: "stale_cache" }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    return new Response(JSON.stringify({ error: "Weather service unavailable" }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }
});

function dbRowToData(row: Record<string, unknown>) {
  return {
    weather:      row.weather      as string,
    weatherDay:   row.weather_day  as string,
    temp:         row.temp         as string,
    humidity:     row.humidity     as string,
    humidityTxt:  row.humidity_txt as string,
    dewPoint:     row.dew_point    as string,
    cloudCover:   row.cloud_cover  as string,
    windDir:      row.wind_dir     as string,
    windPower:    row.wind_power   as string,
    windSpeed:    row.wind_speed   as string,
    windGusts:    row.wind_gusts   as string,
    feelsLike:    row.feels_like   as string,
    pressure:     row.pressure     as string,
    visibility:   row.visibility   as string,
    uvIndex:      row.uv_index     as string,
    airQuality:   row.air_quality  as string,
    pm25:         row.pm25         as string,
    pm10:         row.pm10         as string,
    sunrise:      row.sunrise      as string,
    sunset:       row.sunset       as string,
    moonPhase:    row.moon_phase   as string,
    precip:       row.precip       as string,
    precipProb:   row.precip_prob  as string,
    alarm:        row.alarm        as string,
    cityName:     (row.city_name ?? row.city) as string,
    hour1d:       row.hour1d       as unknown[],
    forecast7d:   row.forecast7d   as unknown[],
    lifeIndex:    row.life_index   as Record<string, unknown>,
    fetchedAt:    row.fetched_at   as string,
  };
}
