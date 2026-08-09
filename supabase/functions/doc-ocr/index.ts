import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let image: string;
  let languageType = 'CHN_ENG';

  try {
    const body = await req.json();
    image = body.image;
    if (!image) throw new Error('Missing image');
    if (body.language_type) languageType = body.language_type;
  } catch {
    return new Response(JSON.stringify({ error: '请求参数无效' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: '服务器配置错误' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const params: Record<string, string> = {
    image,
    language_type: languageType,
    detect_direction: 'true',
    paragraph: 'false',
  };

  const upstream = await fetch(
    'https://app-d6jn0ph0piwx-api-eLMlJ2jB44g9-gateway.appmiaoda.com/rest/2.0/ocr/v1/accurate_basic',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Gateway-Authorization': `Bearer ${apiKey}`,
      },
      body: new URLSearchParams(params).toString(),
    },
  );

  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: `上游错误: ${upstream.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
