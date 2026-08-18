import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 从请求体获取操作员工 ID
    const body: { employee_id?: number | string } = await req.json().catch(() => ({}));
    const employeeId = body.employee_id;
    if (!employeeId) {
      return new Response(JSON.stringify({ error: '缺少操作员身份信息' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 用 service_role 查 employees 表确认 admin 角色
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('role, is_active')
      .eq('id', employeeId)
      .single();

    if (empErr || !emp) {
      return new Response(JSON.stringify({ error: '未找到该员工信息' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (emp.role !== 'admin') {
      return new Response(JSON.stringify({ error: '仅管理员可执行此操作' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!emp.is_active) {
      return new Response(JSON.stringify({ error: '账号已被停用，无法执行此操作' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 清空三张车辆表（员工表不清空）
    const { error: truncErr } = await supabase.rpc('truncate_vehicle_tables');
    if (truncErr) throw truncErr;

    return new Response(
      JSON.stringify({ success: true, message: '数据库车辆数据已全部清空，请使用备份恢复功能重新导入数据。' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : '未知错误' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
