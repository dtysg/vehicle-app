/**
 * github-builds Edge Function
 *
 * GET  → 返回最近 workflow runs 列表
 * POST { action: 'trigger', ref?: string } → 触发新构建
 * POST { action: 'cancel',  runId: string } → 取消运行中的构建
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const GITHUB_TOKEN    = Deno.env.get('GITHUB_TOKEN');
  const GITHUB_OWNER    = Deno.env.get('GITHUB_OWNER');
  const GITHUB_REPO     = Deno.env.get('GITHUB_REPO');
  const GITHUB_WORKFLOW = Deno.env.get('GITHUB_WORKFLOW') ?? 'build.yml';

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return json({ error: '未配置 GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO，请在 Supabase 密钥中添加' }, 500);
  }

  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const base = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

  try {
    // ── POST 操作 ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      let body: { action?: string; runId?: string; ref?: string } = {};
      try { body = await req.json(); } catch { /**/ }

      // 触发新构建
      if (body.action === 'trigger') {
        const ref = body.ref ?? 'main';
        const resp = await fetch(`${base}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ref }),
        });
        // 204 = 成功触发，无 body
        if (resp.status === 204) return json({ ok: true });
        const errText = await resp.text();
        return json({ error: `触发失败 (${resp.status}): ${errText}` }, resp.status);
      }

      // 取消构建
      if (body.action === 'cancel' && body.runId) {
        const resp = await fetch(`${base}/actions/runs/${body.runId}/cancel`, {
          method: 'POST',
          headers,
        });
        if (resp.status === 202) return json({ ok: true });
        const errText = await resp.text();
        return json({ error: `取消失败 (${resp.status}): ${errText}` }, resp.status);
      }

      return json({ error: '未知 action' }, 400);
    }

    // ── GET：获取最近 runs ──────────────────────────────────────────
    const resp = await fetch(
      `${base}/actions/workflows/${GITHUB_WORKFLOW}/runs?per_page=10&branch=main`,
      { headers }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: `GitHub API 错误 (${resp.status}): ${errText}` }, resp.status);
    }

    const data = await resp.json();
    const runs = (data.workflow_runs ?? []).map((r: GHRun) => ({
      id:          String(r.id),
      runNumber:   r.run_number,
      status:      r.status,        // queued | in_progress | completed
      conclusion:  r.conclusion,    // success | failure | cancelled | timed_out | null
      createdAt:   r.created_at,
      updatedAt:   r.updated_at,
      headCommit:  r.head_commit?.message ?? '',
      htmlUrl:     r.html_url,
    }));

    return json({ runs });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

interface GHRun {
  id: number;
  run_number: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  head_commit?: { message: string };
}
