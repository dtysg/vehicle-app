import { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'ready' }          // 更新已就绪，下次启动生效
  | { status: 'error'; message: string };

/**
 * 使用 Updates.useUpdates() 监听 OTA 更新状态。
 *
 * 策略：**不调用 reloadAsync()**。
 * reloadAsync() 会触发 Android JS 运行时热重载，导致网络层未就绪，
 * 所有 Supabase 请求连接失败，表现为更新后什么都读取不到。
 *
 * 改为"下次冷启动生效"：更新包在后台静默下载完毕后，
 * 只提示用户"关闭重开即可"，不强制热重载，彻底避免网络断连问题。
 */
export function useAppUpdate(): UpdateState {
  const [dismissed, setDismissed] = useState(false);

  // 沙盘 / Web / 开发模式 —— 直接返回 idle，不执行任何更新逻辑
  const enabled = !__DEV__ && process.env.EXPO_OS !== 'web' && Updates.isEnabled;

  const { isUpdatePending } = Updates.useUpdates();

  // 不再调用 reloadAsync()，更新包已就绪即可，下次冷启动自动加载
  // 无需 useEffect 触发重载

  if (!enabled || dismissed) return { status: 'idle' };

  // isUpdatePending=true：包已下载完毕，等待下次启动
  if (isUpdatePending) {
    return { status: 'ready' };
  }

  return { status: 'idle' };
}
