import { serve } from "https://deno.land/std/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 静态支持限行的城市列表（无需外部 API）
const LIMIT_CITIES = [
  { city: "beijing",   name: "北京"  },
  { city: "tianjin",  name: "天津"  },
  { city: "hangzhou", name: "杭州"  },
  { city: "chengdu",  name: "成都"  },
  { city: "lanzhou",  name: "兰州"  },
  { city: "guiyang",  name: "贵阳"  },
  { city: "nanchang", name: "南昌"  },
  { city: "changchun",name: "长春"  },
  { city: "haerbin",  name: "哈尔滨"},
  { city: "wuhan",    name: "武汉"  },
  { city: "shanghai", name: "上海"  },
  { city: "shenzhen", name: "深圳"  },
];

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  return new Response(
    JSON.stringify({ status: 0, data: LIMIT_CITIES }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
