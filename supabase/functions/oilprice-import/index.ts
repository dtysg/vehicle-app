import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OilPriceRow {
  city: string;
  p92: string;
  p95: string;
  p98: string;
  p0: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { rows } = await req.json() as { rows: OilPriceRow[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: '无有效数据' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 使用 service_role key 绕过 RLS
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const today = new Date().toISOString().slice(0, 10);
    const payload = rows.map((r) => ({
      city:        r.city,
      p92:         r.p92,
      p95:         r.p95,
      p98:         r.p98,
      p0:          r.p0,
      update_date: today,
      fetched_at:  new Date().toISOString(),
      source:      'excel_import',
    }));

    const { error } = await supabase
      .from('oil_prices')
      .upsert(payload, { onConflict: 'city' });

    if (error) throw new Error(error.message);

    return new Response(
      JSON.stringify({ success: true, count: payload.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
