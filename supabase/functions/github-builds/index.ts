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
  const GITHUB_WORKFLOW = Deno.env.get('GITHUB_WORKFLOW') ?? 'build-android.yml';

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

      // 将仓库改为公开（解除 Actions 分钟限制）
      if (body.action === 'make_public') {
        const resp = await fetch(base, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ private: false, visibility: 'public' }),
        });
        if (!resp.ok) {
          const txt = await resp.text();
          return json({ error: `改公开失败(${resp.status}): ${txt}` }, resp.status);
        }
        const d = await resp.json() as Record<string, unknown>;
        return json({ ok: true, private: d.private, visibility: d.visibility, full_name: d.full_name });
      }

      // 获取 run 完整详情（含错误信息）
      if (body.action === 'get_run_detail' && body.runId) {
        const resp = await fetch(`${base}/actions/runs/${body.runId}`, { headers });
        if (!resp.ok) return json({ error: `获取run失败(${resp.status})` }, resp.status);
        const d = await resp.json();
        return json({
          runNumber: d.run_number, status: d.status, conclusion: d.conclusion,
          event: d.event, head_commit: d.head_commit?.message,
          created_at: d.created_at, updated_at: d.updated_at,
          html_url: d.html_url, jobs_url: d.jobs_url,
          check_suite_url: d.check_suite_url,
          message: (d as Record<string, unknown>).message,
        });
      }

      // 获取 job 日志文本（重定向 URL）
      if (body.action === 'get_job_logs' && body.jobId) {
        const resp = await fetch(`${base}/actions/jobs/${body.jobId}/logs`, { headers, redirect: 'follow' });
        if (!resp.ok) return json({ error: `获取日志失败(${resp.status})` }, resp.status);
        const text = await resp.text();
        // 只返回后500行
        const lines = text.split('\n');
        return json({ logs: lines.slice(-500).join('\n'), total_lines: lines.length });
      }

      // 列出仓库所有 workflow 最近运行（跨 workflow 文件，不过滤 branch）
      if (body.action === 'list_all_runs') {
        const resp = await fetch(`${base}/actions/runs?per_page=20`, { headers });
        if (!resp.ok) return json({ error: `列出失败(${resp.status})` }, resp.status);
        const data = await resp.json();
        const runs = (data.workflow_runs ?? []).map((r: GHRun & { path?: string; name?: string }) => ({
          id: String(r.id), runNumber: r.run_number,
          workflow: r.path ?? r.name ?? '', status: r.status, conclusion: r.conclusion,
          createdAt: r.created_at, headCommit: r.head_commit?.message ?? '', htmlUrl: r.html_url,
        }));
        return json({ runs });
      }

      // 获取指定 run 的 jobs 详情 + 各 job 的 steps（用于调试失败原因）
      if (body.action === 'get_jobs' && body.runId) {
        const resp = await fetch(`${base}/actions/runs/${body.runId}/jobs`, { headers });
        if (!resp.ok) return json({ error: `获取jobs失败(${resp.status})` }, resp.status);
        const data = await resp.json();
        // 并发获取每个 job 的详细 steps
        const jobs = await Promise.all((data.jobs ?? []).map(async (j: Record<string, unknown>) => {
          const jr = await fetch(`${base}/actions/jobs/${j.id}`, { headers });
          const jd = jr.ok ? await jr.json() : {};
          return {
            id: j.id, name: j.name, status: j.status, conclusion: j.conclusion,
            steps: ((jd.steps ?? []) as Record<string, unknown>[]).map(s => ({
              name: s.name, status: s.status, conclusion: s.conclusion, number: s.number,
            })),
          };
        }));
        return json({ jobs });
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
    const branchFilter = new URL(req.url).searchParams.get('all') === '1' ? '' : '&branch=main';
    const resp = await fetch(
      `${base}/actions/workflows/${GITHUB_WORKFLOW}/runs?per_page=15${branchFilter}`,
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
