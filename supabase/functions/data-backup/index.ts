// Edge Function: data-backup
// 导出三张车辆表 + 员工表全量数据，同时上传到 Supabase Storage vehicle-backups bucket
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 并行读取三张车辆表 + 员工表 + 油价表全量数据
    const [gas, diesel, lng, emp, oil] = await Promise.all([
      supabase.from('gasoline_vehicles').select('*').order('seq_no'),
      supabase.from('diesel_vehicles').select('*').order('seq_no'),
      supabase.from('lng_vehicles').select('*').order('seq_no'),
      supabase.from('employees').select('*').order('id'),
      supabase.from('oil_prices').select('*').order('city'),
    ]);

    if (gas.error) throw new Error(`gasoline: ${gas.error.message}`);
    if (diesel.error) throw new Error(`diesel: ${diesel.error.message}`);
    if (lng.error) throw new Error(`lng: ${lng.error.message}`);
    if (emp.error) throw new Error(`employees: ${emp.error.message}`);
    // oil_prices 失败不阻塞备份，仅记录空数组

    const now = new Date();
    const backup = {
      version: 3,
      created_at: now.toISOString(),
      tables: {
        gasoline_vehicles: gas.data ?? [],
        diesel_vehicles:   diesel.data ?? [],
        lng_vehicles:      lng.data ?? [],
        employees:         emp.data ?? [],
        oil_prices:        oil.data ?? [],
      },
      stats: {
        gasoline:   (gas.data ?? []).length,
        diesel:     (diesel.data ?? []).length,
        lng:        (lng.data ?? []).length,
        employees:  (emp.data ?? []).length,
        oil_prices: (oil.data ?? []).length,
        total:      (gas.data ?? []).length + (diesel.data ?? []).length + (lng.data ?? []).length,
      },
    };

    const json = JSON.stringify(backup);

    // ── 上传到 Storage（手动备份：固定文件名，每次覆盖，始终只保留最新一份）──
    const filename = 'manual_backup.json';
    const { error: uploadErr } = await supabase.storage
      .from('vehicle-backups')
      .upload(filename, new Blob([json], { type: 'application/json' }), {
        contentType: 'application/json',
        upsert: true,
      });
    if (uploadErr) {
      // 上传失败作为错误抛出，确保云端备份始终与记录一致
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

    return new Response(JSON.stringify({ ...backup, storage_path: uploadErr ? null : filename }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
