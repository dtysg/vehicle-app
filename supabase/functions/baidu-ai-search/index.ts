// Edge Function: baidu-ai-search
// 保留通用 AI 搜索能力（供 oilprice 等按需调用）
import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let messages: Array<{ role: string; content: string }>;
  let instruction: string | undefined;
  let enableDeepSearch: boolean | undefined;
  let resourceTypeFilter: Array<{ type: string; top_k: number }> | undefined;
  let searchRecencyFilter: string | undefined;
  let enableReasoning: boolean | undefined;
  let maxCompletionTokens: number | undefined;
  let responseFormat: string | undefined;
  let enableFollowupQueries: boolean | undefined;

  try {
    const body = await req.json();
    messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error("Missing or invalid messages");
    }
    instruction = body.instruction;
    enableDeepSearch = body.enable_deep_search;
    resourceTypeFilter = body.resource_type_filter;
    searchRecencyFilter = body.search_recency_filter;
    enableReasoning = body.enable_reasoning;
    maxCompletionTokens = body.max_completion_tokens;
    responseFormat = body.response_format;
    enableFollowupQueries = body.enable_followup_queries;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("INTEGRATIONS_API_KEY");
  if (!apiKey) {
    // 无 key 时优雅降级，返回空结果而不是 500
    return new Response(
      JSON.stringify({ choices: [{ delta: { content: "" } }], references: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const upstreamBody: Record<string, unknown> = { messages };
  if (instruction !== undefined) upstreamBody.instruction = instruction;
  if (enableDeepSearch !== undefined) upstreamBody.enable_deep_search = enableDeepSearch;
  if (resourceTypeFilter !== undefined) upstreamBody.resource_type_filter = resourceTypeFilter;
  if (searchRecencyFilter !== undefined) upstreamBody.search_recency_filter = searchRecencyFilter;
  if (enableReasoning !== undefined) upstreamBody.enable_reasoning = enableReasoning;
  if (maxCompletionTokens !== undefined) upstreamBody.max_completion_tokens = maxCompletionTokens;
  if (responseFormat !== undefined) upstreamBody.response_format = responseFormat;
  if (enableFollowupQueries !== undefined) upstreamBody.enable_followup_queries = enableFollowupQueries;

  const upstream = await fetch(
    "https://app-dpzi13kxv2m9-api-DYJwo27V8Qya-gateway.appmiaoda.com/v2/ai_search/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    }
  );

  if (upstream.status === 429 || upstream.status === 402) {
    // 积分耗尽时优雅降级，返回空而不是透传 402
    return new Response(
      JSON.stringify({ choices: [{ delta: { content: "（搜索服务暂不可用）" } }], references: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 直接 proxy SSE 流
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
