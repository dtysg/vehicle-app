// Edge Function: auto-backup-notify
// 每天由 pg_cron 触发：执行全量备份 → 写入 backup_records → 向所有管理员推送 Expo Push 通知
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let backupStats = { gasoline: 0, diesel: 0, lng: 0, employees: 0, oil_prices: 0, total: 0 };
  let backupStatus = 'success';

  try {
    // ── 1. 执行备份：并行读取三张车辆表 + 员工表 + 油价表 ────────────────────
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

    backupStats = {
      gasoline:   (gas.data ?? []).length,
      diesel:     (diesel.data ?? []).length,
      lng:        (lng.data ?? []).length,
      employees:  (emp.data ?? []).length,
      oil_prices: (oil.data ?? []).length,
      total:      (gas.data ?? []).length + (diesel.data ?? []).length + (lng.data ?? []).length,
    };

    // ── 2. 序列化 JSON + 上传到 Storage ──────────────────────────────────────
    const json = JSON.stringify({
      version: 3,
      created_at: new Date().toISOString(),
      tables: {
        gasoline_vehicles: gas.data ?? [],
        diesel_vehicles:   diesel.data ?? [],
        lng_vehicles:      lng.data ?? [],
        employees:         emp.data ?? [],
        oil_prices:        oil.data ?? [],
      },
      stats: backupStats,
    });

    // ── 自动备份：固定文件名，每次覆盖（upsert），云端始终只保留最新一份 ──
    const filename = `auto_backup.json`;
    const { error: uploadErr } = await supabase.storage
      .from('vehicle-backups')
      .upload(filename, new Blob([json], { type: 'application/json' }), {
        contentType: 'application/json',
        upsert: true,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // ── 3. 写入备份记录 ────────────────────────────────────────────────────
    await supabase.from('backup_records').insert({
      triggered_by: 'auto',
      stats: backupStats,
      status: 'success',
    });

  } catch (err) {
    backupStatus = 'failed';
    // 即使备份失败也写一条失败记录，然后继续推送通知
    await supabase.from('backup_records').insert({
      triggered_by: 'auto',
      stats: backupStats,
      status: 'failed',
    }).catch(() => {/* 静默 */});

    // 推送失败通知
    await sendPushToAdmins(supabase, {
      title: '⚠️ 自动备份失败',
      body: `今日自动备份未能完成，请手动检查：${err instanceof Error ? err.message : String(err)}`,
    });

    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── 3. 推送成功通知给所有管理员 ────────────────────────────────────────
  const now = new Date();
  const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  await sendPushToAdmins(supabase, {
    title: '✅ 每日自动备份完成',
    body: `${dateStr} 备份成功：车辆 ${backupStats.total} 辆，员工账号 ${backupStats.employees} 个，油价 ${backupStats.oil_prices} 条`,
    data: { type: 'auto_backup', stats: backupStats, status: backupStatus },
  });

  return new Response(
    JSON.stringify({ success: true, stats: backupStats }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});

// ── 辅助：读取管理员 push tokens 并发送 Expo Push 通知 ───────────────────
async function sendPushToAdmins(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  notification: { title: string; body: string; data?: Record<string, unknown> },
) {
  try {
    // 读取所有管理员（role = 'admin'）的 push token
    const { data: admins } = await supabase
      .from('employees')
      .select('emp_code')
      .eq('role', 'admin')
      .eq('is_active', true);

    if (!admins || admins.length === 0) return;

    const empCodes = admins.map((a: { emp_code: string }) => a.emp_code);

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .in('emp_code', empCodes);

    if (!tokens || tokens.length === 0) return;

    // 构造 Expo Push 消息
    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: notification.data ?? {},
    }));

    // 调用 Expo Push API（每批最多 100 条）
    const BATCH = 100;
    for (let i = 0; i < messages.length; i += BATCH) {
      const chunk = messages.slice(i, i + BATCH);
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
    }
  } catch {
    // 推送失败不影响主流程，静默处理
  }
}
