/**
 * Edge Function: push-ota-update
 * 验证 production 分支最新更新已就绪，返回更新摘要给管理员确认。
 * Expo Updates 是拉取模型——更新发布到分支后用户重启 App 即自动收到，
 * 无需也无法从服务器主动"推送"到设备，因此本函数只做查询+确认。
 * 所有响应均返回 HTTP 200 + { success, ... }，避免 SDK 吞掉错误体。
 */
import { serve } from 'https://deno.land/std/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EAS_API = 'https://api.expo.dev/graphql';
const APP_ID  = '81711c9a-522d-4ceb-842b-6d1e1642115a';
const BRANCH  = 'production';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ok = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    console.log('[push-ota-update] 开始验证最新更新状态');

    // ── 1. 读取 EXPO_TOKEN ────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: secret, error: dbErr } = await supabase
      .from('app_secrets')
      .select('value')
      .eq('key', 'expo_token')
      .single();

    if (dbErr || !secret?.value) {
      console.error('[push-ota-update] Token 未配置:', dbErr?.message);
      return ok({ success: false, error: '未配置 EXPO_TOKEN，请在系统设置中先保存 Token' });
    }

    const token = secret.value as string;
    console.log('[push-ota-update] Token 长度:', token.length);

    if (token.length <= 36 && /^[0-9a-f-]{36}$/.test(token)) {
      return ok({ success: false, error: '存储的是 App 项目 ID 而非 EXPO_TOKEN，请前往 expo.dev → Settings → Access Tokens 获取访问令牌' });
    }

    // ── 2. 查询 production 分支最新更新（只查基础字段，不含资产详情）──────
    const queryRes = await fetch(EAS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `
          query GetBranchUpdates($appId: String!) {
            app {
              byId(appId: $appId) {
                updateBranchByName(name: "${BRANCH}") {
                  id
                  name
                  updates(limit: 5, offset: 0) {
                    id
                    group
                    platform
                    runtimeVersion
                    message
                    createdAt
                    isRollBackToEmbedded
                  }
                }
              }
            }
          }
        `,
        variables: { appId: APP_ID },
      }),
    });

    const queryData = await queryRes.json();
    console.log('[push-ota-update] EAS query status:', queryRes.status);

    if (queryData.errors?.length) {
      const errMsg = queryData.errors[0].message as string;
      console.error('[push-ota-update] EAS query error:', errMsg);
      return ok({ success: false, error: `EAS 查询失败: ${errMsg}` });
    }

    const branch   = queryData.data?.app?.byId?.updateBranchByName;
    const updates: Record<string, unknown>[] = branch?.updates ?? [];

    console.log('[push-ota-update] 分支更新数:', updates.length);

    if (!updates.length) {
      return ok({ success: false, error: '暂无已发布的更新，请先让 AI 推送代码更新' });
    }

    // 取最新一个 group（第一条即最新）
    const latest = updates[0];
    const latestGroup = latest.group as string;
    const groupUpdates = updates.filter((u) => u.group === latestGroup);
    const platforms = groupUpdates.map((u) => (u.platform as string).toUpperCase());

    // 格式化时间
    const createdAt = latest.createdAt as string;
    const dateStr = new Date(createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    console.log('[push-ota-update] 最新 group:', latestGroup, '平台:', platforms);

    return ok({
      success: true,
      message: `✅ 最新更新已就绪！用户重启 App 后将自动收到更新`,
      updateGroup: latestGroup,
      platforms,
      updateMessage: (latest.message as string) || '（无备注）',
      createdAt: dateStr,
      runtimeVersion: latest.runtimeVersion,
    });

  } catch (e: unknown) {
    console.error('[push-ota-update] 未捕获异常:', String(e));
    return ok({ success: false, error: `服务器异常: ${String(e)}` });
  }
});
