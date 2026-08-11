import { createClient } from '@supabase/supabase-js';
import { fetch as expoFetch } from 'expo/fetch';

// anon key 属于前端公开密钥，硬编码为默认值确保 APK 内始终可用
// env 变量优先，fallback 到构建时已知的正确地址
const supabaseUrl: string =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://backend.appmiaoda.com/projects/supabase338115453572395008';
const supabaseAnonKey: string =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTAwMDQwMjA2LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.SwwJLKjwtQlrh9dIEpee-3pKpMy22FahIV8uc0ZsalU';

// 全局请求超时封装：所有 Supabase 请求超过 12 秒自动中止
// 防止 OTA reload 后网络未就绪时请求无限挂起，导致数据不显示 + UI 转圈
function fetchWithTimeout(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  return expoFetch(url as string, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// 使用员工简码本地登录，不依赖 Supabase Auth，禁用 session 持久化
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
