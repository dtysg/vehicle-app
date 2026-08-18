// Edge Function: data-restore
// 支持两种恢复方式：
//   1. 直接 POST body（包含完整备份 JSON）
//   2. POST { storage_path: "vehicle_backup_xxx.json" } → 从 Storage 下载后恢复
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

    const rawBody = await req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: '请求体不是有效的 JSON 格式' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── 判断恢复方式 ──────────────────────────────────────────────────────────
    // 方式 1：storage_path 模式 → 从 Storage 拉取文件
    if (body.storage_path && typeof body.storage_path === 'string') {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('vehicle-backups')
        .download(body.storage_path);
      if (dlErr || !fileData) {
        return new Response(
          JSON.stringify({ error: `从云端读取备份文件失败：${dlErr?.message ?? '文件不存在'}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const text = await fileData.text();
      try {
        body = JSON.parse(text);
      } catch {
        return new Response(
          JSON.stringify({ error: '云端备份文件内容损坏，无法解析' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // ── 校验备份包格式 ────────────────────────────────────────────────────────
    if (!body.version || !body.tables) {
      return new Response(
        JSON.stringify({ error: '备份文件格式无效，请选择正确的备份文件' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const tables = body.tables as Record<string, unknown[]>;
    const gasoline_vehicles = Array.isArray(tables.gasoline_vehicles) ? tables.gasoline_vehicles : [];
    const diesel_vehicles   = Array.isArray(tables.diesel_vehicles)   ? tables.diesel_vehicles   : [];
    const lng_vehicles      = Array.isArray(tables.lng_vehicles)      ? tables.lng_vehicles      : [];
    const employees         = Array.isArray(tables.employees)         ? tables.employees         : [];
    const oil_prices        = Array.isArray(tables.oil_prices)        ? tables.oil_prices        : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripId = (rows: any[]) => rows.map(({ id: _id, ...rest }) => rest);

    // ── 车辆表：清空后批量插入 ──────────────────────────────────────────────
    const vehicleTables: Array<{ name: string; rows: unknown[] }> = [
      { name: 'gasoline_vehicles', rows: stripId(gasoline_vehicles) },
      { name: 'diesel_vehicles',   rows: stripId(diesel_vehicles) },
      { name: 'lng_vehicles',      rows: stripId(lng_vehicles) },
    ];

    for (const { name, rows } of vehicleTables) {
      const { error: truncErr } = await supabase.rpc('truncate_vehicle_table', { tbl: name });
      if (truncErr) throw new Error(`清空 ${name} 失败: ${truncErr.message}`);

      const BATCH = 100;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        if (chunk.length === 0) continue;
        const { error: insErr } = await supabase.from(name).insert(chunk);
        if (insErr) throw new Error(`写入 ${name} 失败: ${insErr.message}`);
      }
    }

    // ── 员工表：upsert on emp_code ─────────────────────────────────────────
    let empRestored = 0;
    if (employees.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const empRows = employees.map(({ id: _id, ...rest }: any) => rest);
      const BATCH = 50;
      for (let i = 0; i < empRows.length; i += BATCH) {
        const chunk = empRows.slice(i, i + BATCH);
        const { error: upsertErr } = await supabase
          .from('employees')
          .upsert(chunk, { onConflict: 'emp_code', ignoreDuplicates: false });
        if (upsertErr) throw new Error(`恢复员工数据失败: ${upsertErr.message}`);
        empRestored += chunk.length;
      }
    }

    // ── 油价表：upsert on city（备份包含则恢复，不含则跳过）──────────────
    let oilRestored = 0;
    if (oil_prices.length > 0) {
      const BATCH = 50;
      for (let i = 0; i < oil_prices.length; i += BATCH) {
        const chunk = oil_prices.slice(i, i + BATCH);
        const { error: oilErr } = await supabase
          .from('oil_prices')
          .upsert(chunk, { onConflict: 'city', ignoreDuplicates: false });
        if (oilErr) throw new Error(`恢复油价数据失败: ${oilErr.message}`);
        oilRestored += chunk.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        restored: {
          gasoline:   gasoline_vehicles.length,
          diesel:     diesel_vehicles.length,
          lng:        lng_vehicles.length,
          employees:  empRestored,
          oil_prices: oilRestored,
          total:      gasoline_vehicles.length + diesel_vehicles.length + lng_vehicles.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
