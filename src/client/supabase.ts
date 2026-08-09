import { createClient } from '@supabase/supabase-js';
import { fetch as expoFetch } from 'expo/fetch';

const supabaseUrl: string = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey: string = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

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
