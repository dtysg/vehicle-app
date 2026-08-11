import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_ID = '81711c9a-522d-4ceb-842b-6d1e1642115a';

const BUILDS_QUERY = `
  query AppBuildsQuery($appId: String!, $limit: Int!, $offset: Int!) {
    app {
      byId(appId: $appId) {
        builds(limit: $limit, offset: $offset, filter: { platform: ANDROID }) {
          id
          status
          platform
          createdAt
          updatedAt
          appVersion
          buildProfile
          gitCommitMessage
          artifacts {
            buildUrl
            applicationArchiveUrl
          }
          error {
            message
            errorCode
          }
        }
      }
    }
  }
`;

const CANCEL_BUILD_MUTATION = `
  mutation CancelBuild($buildId: ID!) {
    cancelBuild(buildId: $buildId) {
      id
      status
    }
  }
`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const EXPO_TOKEN = Deno.env.get('EXPO_TOKEN');
    if (!EXPO_TOKEN) {
      return new Response(JSON.stringify({ error: '未配置 EXPO_TOKEN，请在 Supabase 密钥中添加' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // 检查是否是取消构建请求
    let body: { action?: string; buildId?: string } = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { /**/ }
    }

    if (body.action === 'cancel' && body.buildId) {
      // 取消/删除构建
      const resp = await fetch('https://api.expo.dev/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${EXPO_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: CANCEL_BUILD_MUTATION,
          variables: { buildId: body.buildId },
        }),
      });
      const json = await resp.json();
      if (json.errors?.length) {
        // 如果是已完成构建无法取消，返回 ok（客户端会本地隐藏）
        return new Response(JSON.stringify({ ok: true, note: json.errors[0].message }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // 默认：获取构建列表
    const resp = await fetch('https://api.expo.dev/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${EXPO_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: BUILDS_QUERY,
        variables: { appId: APP_ID, limit: 8, offset: 0 },
      }),
    });

    const json = await resp.json();

    if (json.errors?.length) {
      return new Response(JSON.stringify({ error: json.errors[0].message }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const builds: EasBuild[] = json?.data?.app?.byId?.builds ?? [];

    return new Response(JSON.stringify({ builds }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

interface EasBuild {
  id: string;
  status: 'NEW' | 'IN_QUEUE' | 'IN_PROGRESS' | 'FINISHED' | 'ERRORED' | 'CANCELLED' | 'TIMED_OUT';
  platform: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  buildProfile: string;
  gitCommitMessage?: string;
  artifacts?: { buildUrl?: string; applicationArchiveUrl?: string };
  error?: { message: string; errorCode: string };
}
