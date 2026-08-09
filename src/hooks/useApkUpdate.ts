import { useEffect, useState, useCallback } from 'react';
import { Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/client/supabase';

/**
 * 从 app.json version 字段（格式 "主.次.构建号"，如 "1.0.1337"）自动解析构建号。
 * EAS 每次打包时 app.json version 已同步更新，无需再手动改此文件。
 */
function parseVersionCode(version?: string | null): number {
  if (!version) return 0;
  const last = version.split('.').pop();
  const code = parseInt(last ?? '', 10);
  return isNaN(code) ? 0 : code;
}

export const CURRENT_VERSION_CODE = parseVersionCode(
  Constants.expoConfig?.version
);

export interface ApkVersionInfo {
  version_name: string;
  version_code: number;
  apk_url: string;
  release_notes: string;
  is_force: boolean;
}

export type ApkUpdateState =
  | { status: 'idle';      checkNow: () => void }
  | { status: 'available'; info: ApkVersionInfo; onDownload: () => void; onDismiss: () => void; checkNow: () => void };

/**
 * APK 版本检测 Hook（仅 Android，iOS 不适用）
 *
 * 从 app_versions 表读取最新版本号，与当前 CURRENT_VERSION_CODE 比较，
 * 若服务端版本更高，则返回下载信息和操作回调。
 * 点击下载后通过浏览器打开 APK 链接（系统接管下载 + 安装），无需 reloadAsync。
 * @param skipCheck 传 true 时跳过版本检测（如管理员账号）
 */
export function useApkUpdate(skipCheck = false): ApkUpdateState {
  const [state, setState] = useState<ApkUpdateState>(() => ({ status: 'idle', checkNow: () => {} }));

  const check = useCallback(async () => {
    // 管理员账号 / iOS 均不检测 APK 更新
    if (skipCheck || Platform.OS !== 'android') {
      console.log('[ApkUpdate] 跳过检测 skipCheck=' + skipCheck + ' platform=' + Platform.OS);
      return;
    }

    console.log('[ApkUpdate] 开始检测，当前版本:', CURRENT_VERSION_CODE);

    try {
      const { data, error } = await supabase
        .from('app_versions')
        .select('version_name, version_code, apk_url, release_notes, is_force')
        .order('version_code', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) { console.log('[ApkUpdate] DB 查询失败:', error.message); return; }
      if (!data)  { console.log('[ApkUpdate] DB 无版本记录'); return; }

      console.log('[ApkUpdate] 服务端版本:', data.version_code, '本地版本:', CURRENT_VERSION_CODE);

      if (data.version_code <= CURRENT_VERSION_CODE) {
        console.log('[ApkUpdate] 已是最新版，不弹窗');
        return;
      }

      console.log('[ApkUpdate] 发现新版本，弹窗！');
      const info = data as ApkVersionInfo;
      setState({
        status: 'available',
        info,
        checkNow: check,
        onDownload: () => {
          Linking.openURL(info.apk_url);
        },
        onDismiss: () => {
          if (!info.is_force) setState({ status: 'idle', checkNow: check });
        },
      });
    } catch (e) {
      console.log('[ApkUpdate] 异常:', e instanceof Error ? e.message : String(e));
    }
  }, [skipCheck]);

  useEffect(() => {
    // 启动时延迟 3 秒检测，确保网络就绪
    const t = setTimeout(check, 3000);
    return () => clearTimeout(t);
  }, [check]);

  // 把 checkNow 合并进 state，方便外部手动触发
  if (state.status === 'idle') return { status: 'idle', checkNow: check };
  return state;
}
