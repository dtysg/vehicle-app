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
  | { status: 'idle' }
  | { status: 'available'; info: ApkVersionInfo; onDownload: () => void; onDismiss: () => void };

/**
 * APK 版本检测 Hook（仅 Android，iOS 不适用）
 *
 * 从 app_versions 表读取最新版本号，与当前 CURRENT_VERSION_CODE 比较，
 * 若服务端版本更高，则返回下载信息和操作回调。
 * 点击下载后通过浏览器打开 APK 链接（系统接管下载 + 安装），无需 reloadAsync。
 * @param skipCheck 传 true 时跳过版本检测（如管理员账号）
 */
export function useApkUpdate(skipCheck = false): ApkUpdateState {
  const [state, setState] = useState<ApkUpdateState>({ status: 'idle' });

  const check = useCallback(async () => {
    // 管理员账号 / iOS 均不检测 APK 更新
    if (skipCheck || Platform.OS !== 'android') return;

    try {
      const { data, error } = await supabase
        .from('app_versions')
        .select('version_name, version_code, apk_url, release_notes, is_force')
        .order('version_code', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return;
      if (data.version_code <= CURRENT_VERSION_CODE) return;

      const info = data as ApkVersionInfo;
      setState({
        status: 'available',
        info,
        onDownload: () => {
          // 用系统浏览器打开 APK 链接，由系统负责下载和安装引导
          // 无需 REQUEST_INSTALL_PACKAGES 权限，浏览器下载后系统自动提示安装
          Linking.openURL(info.apk_url);
        },
        onDismiss: () => {
          if (!info.is_force) setState({ status: 'idle' });
        },
      });
    } catch {
      // 网络异常静默处理，不影响正常使用
    }
  }, [skipCheck]);

  useEffect(() => {
    // 启动时延迟 3 秒检测，确保网络就绪
    const t = setTimeout(check, 3000);
    return () => clearTimeout(t);
  }, [check]);

  return state;
}
