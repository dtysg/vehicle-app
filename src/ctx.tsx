import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/client/supabase';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

const SESSION_KEY = 'emp_session';

export interface EmployeeSession {
  id: number;
  real_name: string;
  emp_code: string;
  role: 'user' | 'admin' | 'assistant';
  temp_admin_expires_at?: string | null; // ISO string，null=无临时权限
}

export type Profile = {
  id: string;
  phone: string | null;
  real_name: string | null;
  role: 'user' | 'admin' | 'assistant';
  avatar_url: string | null;
};

interface SessionCtx {
  session: EmployeeSession | null;
  profile: Profile | null;
  isAdmin: boolean;          // 永久管理员 OR assistant OR 有效临时管理员
  isPermanentAdmin: boolean; // 仅永久管理员（role === 'admin'）
  isAssistant: boolean;      // 管理员助理（role === 'assistant'）
  isLoading: boolean;
  needsProfile: false;
  forceOutReason: string | null; // 被动下线原因（停用/删除），登录页展示后清除
  clearForceOutReason: () => void;
  signIn: (empCode: string, password: string) => Promise<{ error: string | null; role?: string }>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

async function saveLocal(key: string, value: string) {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  }
}

async function loadLocal(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

async function removeLocal(key: string) {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  }
}

const Ctx = createContext<SessionCtx>({
  session: null,
  profile: null,
  isAdmin: false,
  isPermanentAdmin: false,
  isAssistant: false,
  isLoading: true,
  needsProfile: false,
  forceOutReason: null,
  clearForceOutReason: () => {},
  signIn: async () => ({ error: null, role: undefined }),
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EmployeeSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [forceOutReason, setForceOutReason] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 启动员工状态轮询：每 5 秒检查当前登录员工是否仍在职，同步临时管理员过期状态
  const startPolling = (emp: EmployeeSession) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('employees')
          .select('id, real_name, emp_code, role, is_active, temp_admin_expires_at')
          .eq('id', emp.id)
          .maybeSingle();
        // 网络瞬断或查询出错 → 跳过本次轮询，绝不因网络故障误判账号被删
        // maybeSingle() 的错误不会抛出，必须显式检查 error 字段
        if (error) return;
        // 管理员永远不踢出；普通员工/助理被删除或停用则强制退出
        if (!data || (data.role !== 'admin' && !data.is_active)) {
          if (timerRef.current) clearInterval(timerRef.current);
          await removeLocal(SESSION_KEY);
          // 区分删除和停用，给用户明确提示
          setForceOutReason(!data ? '您的账号已被删除，请联系管理员' : '您的账号已被停用，请联系管理员');
          setSession(null);
          return;
        }
        // 同步最新 temp_admin_expires_at（管理员授权/撤销会实时生效）
        const updated: EmployeeSession = {
          id: data.id,
          real_name: data.real_name,
          emp_code: data.emp_code,
          role: data.role as 'user' | 'admin' | 'assistant',
          temp_admin_expires_at: data.temp_admin_expires_at ?? null,
        };
        setSession((prev) => {
          if (!prev) return updated;
          // 仅当 temp_admin_expires_at 有变化时才更新，避免无意义重渲染
          if (prev.temp_admin_expires_at === updated.temp_admin_expires_at) return prev;
          return updated;
        });
        await saveLocal(SESSION_KEY, JSON.stringify(updated));
      } catch { /* 网络异常静默处理，不强制退出 */ }
    }, 5000);
  };

  const stopPolling = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  useEffect(() => {
    (async () => {
      try {
        // Android OTA reloadAsync() 后 SecureStore keychain 初始化需要 1~3 秒
        // 策略：3 次尝试，超时递增（1.5s / 2s / 2.5s），间隔递增（600ms / 1200ms）
        const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
          Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
        const TIMEOUTS = [1500, 2000, 2500];
        const DELAYS   = [600, 1200];

        let raw: string | null = null;
        for (let i = 0; i < 3; i++) {
          try {
            raw = await withTimeout(loadLocal(SESSION_KEY), TIMEOUTS[i]);
            if (raw !== null) break;
          } catch { /* 超时或抛错，继续下一次 */ }
          if (i < 2) await new Promise((r) => setTimeout(r, DELAYS[i]));
        }

        if (raw) {
          const emp = JSON.parse(raw) as EmployeeSession;
          setSession(emp);
          // 延迟 2 秒再启动轮询，让 OTA 重载后的网络连接充分稳定
          // 防止首次轮询因网络未就绪而误判账号被删
          setTimeout(() => startPolling(emp), 2000);
        }
      } catch { /* 解析失败则视为未登录 */ }
      finally { setIsLoading(false); }
    })();
    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 账号 + 密码登录
  const signIn = async (empCode: string, password: string): Promise<{ error: string | null; role?: string }> => {
    const code = empCode.trim().toUpperCase();
    const pwd = password.trim();
    if (!code) return { error: '请输入账号' };
    if (!pwd) return { error: '请输入密码' };

    let data: { id: number; real_name: string; emp_code: string; role: string; password: string; is_active: boolean; bound_device_id?: string | null; temp_admin_expires_at?: string | null } | null = null;
    try {
      const result = await supabase
        .from('employees')
        .select('id, real_name, emp_code, role, password, is_active, bound_device_id')
        .eq('emp_code', code)
        .maybeSingle();

      if (result.error) {
        // 区分超时/网络错误 vs 服务器异常，给出更准确提示
        const msg = result.error.message ?? '';
        if (msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('fetch')) {
          return { error: '网络连接超时，请检查网络后重试' };
        }
        return { error: '系统异常，请稍后重试' };
      }
      data = result.data;
    } catch (e) {
      // 未预期的抛出（如 AbortError 未被 supabase 捕获）
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      if (msg.includes('abort') || msg.includes('timeout') || msg.includes('network') || msg.includes('fetch')) {
        return { error: '网络连接超时，请检查网络后重试' };
      }
      return { error: '系统异常，请稍后重试' };
    }

    if (!data) return { error: '账号不存在' };
    // 管理员永远可登录；助理和普通员工需检查 is_active
    if (data.role !== 'admin' && !data.is_active) return { error: '账号已停用，请联系管理员' };
    if (data.password !== pwd) return { error: '密码错误' };

    // ── 设备识别 / 绑定校验 ──
    // admin：仅识别设备信息（可从任意设备登录），不做绑定限制
    // assistant / user：首次登录自动绑定，后续必须同一设备
    {
      // Web 端用 localStorage 存唯一设备标识；原生端用 expo-device 硬件信息
      let deviceId: string;
      if (Platform.OS === 'web') {
        const WEB_DEVICE_KEY = 'vehicle_device_id';
        let stored = localStorage.getItem(WEB_DEVICE_KEY);
        if (!stored) {
          stored = 'web|' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          localStorage.setItem(WEB_DEVICE_KEY, stored);
        }
        deviceId = stored;
      } else {
        deviceId = [
          Device.modelName ?? 'unknown',
          Device.osName ?? '',
          Device.osBuildId ?? Device.osVersion ?? '',
        ].join('|');
      }

      if (data.role === 'admin') {
        // 管理员：只记录本次登录设备（用于审计），不做绑定限制，任何设备均可登录
        await supabase
          .from('employees')
          .update({ bound_device_id: deviceId })
          .eq('id', data.id);
      } else {
        // 普通员工 / 助理：首次登录绑定，之后必须同一设备
        const bound = (data as { bound_device_id?: string | null }).bound_device_id;
        if (!bound) {
          await supabase
            .from('employees')
            .update({ bound_device_id: deviceId })
            .eq('id', data.id);
        } else if (bound !== deviceId) {
          return { error: '该账号已在其他设备绑定，如需更换设备请联系系统管理员解绑' };
        }
      }
    }

    const emp: EmployeeSession = {
      id: data.id,
      real_name: data.real_name,
      emp_code: data.emp_code,
      role: data.role as 'user' | 'admin' | 'assistant',
      temp_admin_expires_at: (data as { temp_admin_expires_at?: string | null }).temp_admin_expires_at ?? null,
    };
    await saveLocal(SESSION_KEY, JSON.stringify(emp));
    setSession(emp);
    startPolling(emp);

    // ── 注册 / 更新 Push Token（仅管理员，Web 不支持）──
    if (data.role === 'admin' && Platform.OS !== 'web') {
      (async () => {
        try {
          const { status: existing } = await Notifications.getPermissionsAsync();
          const finalStatus = existing === 'granted'
            ? existing
            : (await Notifications.requestPermissionsAsync()).status;
          if (finalStatus === 'granted') {
            const tokenData = await Notifications.getExpoPushTokenAsync();
            await supabase.from('push_tokens').upsert(
              { emp_code: data.emp_code, token: tokenData.data, updated_at: new Date().toISOString() },
              { onConflict: 'emp_code' },
            );
          }
        } catch { /* 推送权限获取失败不影响登录 */ }
      })();
    }

    return { error: null, role: data.role };
  };

  const signOut = async () => {
    stopPolling();
    await removeLocal(SESSION_KEY);
    setForceOutReason(null);
    // 写入主动退出标记，防止 sign-in 页自动登录
    if (Platform.OS === 'web') {
      localStorage.setItem('manual_sign_out', '1');
    } else {
      try {
        const SecureStore = await import('expo-secure-store');
        await SecureStore.setItemAsync('manual_sign_out', '1');
      } catch { /* 静默 */ }
    }
    setSession(null);
  };

  const [tick, setTick] = useState(0); // 每秒 +1，驱动 isAdmin/identityLabel 实时更新

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // isAdmin：永久管理员 OR assistant OR 临时管理员且未过期（tick 变化时重新计算）
  const isTempAdmin = !!(
    session?.temp_admin_expires_at &&
    new Date(session.temp_admin_expires_at) > new Date()
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _tick = tick; // 保留引用，确保 tick 驱动本组件重渲染
  const isPermanentAdmin = session?.role === 'admin';
  const isAssistant = session?.role === 'assistant';
  // assistant 角色 OR 临时管理员 = isAdmin（可增删改查，但不能管理员工）
  const isAdmin = isPermanentAdmin || isAssistant || isTempAdmin;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // 登录/会话恢复后，拉取最新 avatar_url
  useEffect(() => {
    if (!session) { setAvatarUrl(null); return; }
    (async () => {
      const { data } = await supabase
        .from('employees')
        .select('avatar_url')
        .eq('id', session.id)
        .maybeSingle();
      setAvatarUrl(data?.avatar_url ?? null);
    })();
  }, [session?.id]);

  const profile: Profile | null = session
    ? { id: String(session.id), phone: null, real_name: session.real_name, role: session.role, avatar_url: avatarUrl }
    : null;

  // refreshProfile 更新头像（其他页面上传后调用）
  const refreshProfile = async () => {
    if (!session) return;
    const { data } = await supabase
      .from('employees')
      .select('avatar_url')
      .eq('id', session.id)
      .maybeSingle();
    setAvatarUrl(data?.avatar_url ?? null);
  };

  return (
    <Ctx.Provider value={{ session, profile, isAdmin, isPermanentAdmin, isAssistant, isLoading, needsProfile: false, forceOutReason, clearForceOutReason: () => setForceOutReason(null), signIn, refreshProfile, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  return useContext(Ctx);
}
