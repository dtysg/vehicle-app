import { Stack, useRouter } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Text, Pressable, Modal } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { SessionProvider, useSession } from '@/ctx';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { useApkUpdate } from '@/hooks/useApkUpdate';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  Easing, interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system/legacy';
import "../global.css";

// ── 启动加载页（OTA 重载后最长显示约 6 秒）──────────────────────
function LoadingScreen() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const hint =
    seconds < 2 ? '正在启动…' :
    seconds < 4 ? '正在恢复登录状态，请稍候…' :
    '网络连接较慢，继续等待…';

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A', gap: 16 }}>
      <ActivityIndicator size="large" color="#3B82F6" />
      <Text style={{ color: '#64748B', fontSize: 13 }}>{hint}</Text>
    </View>
  );
}

// ── OTA 更新提示弹窗 ─────────────────────────────────────────
// 策略：不调用 reloadAsync()，改为提示用户"关闭重开生效"
// 彻底避免热重载导致 Android 网络层未就绪、Supabase 全部失连的问题
function UpdateBanner() {
  const update = useAppUpdate();
  const [visible, setVisible] = useState(true);

  if (update.status !== 'ready' || !visible) return null;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={{
        flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
      }}>
        <View style={{
          backgroundColor: '#1E293B', borderRadius: 16, padding: 24,
          width: '100%', gap: 16,
          borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)',
        }}>
          {/* 标题 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: 'rgba(59,130,246,0.2)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 18 }}>✅</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '700' }}>新版本已就绪</Text>
              <Text style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>车辆信息系统已下载最新版本</Text>
            </View>
          </View>

          <Text style={{ color: '#94A3B8', fontSize: 13, lineHeight: 20 }}>
            新版本已在后台下载完毕。{'\n'}
            <Text style={{ color: '#60A5FA', fontWeight: '600' }}>关闭 App 并重新打开</Text>，即可使用最新功能。
          </Text>

          <Pressable
            onPress={() => setVisible(false)}
            style={{
              backgroundColor: '#3B82F6',
              borderRadius: 10, paddingVertical: 13, alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>知道了</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── APK 版本更新弹窗（Android 专属，管理员跳过）──────────────────
// 应用内下载 + 进度条，不借助浏览器
function ApkUpdateBanner() {
  const { isAdmin, isPermanentAdmin } = useSession();
  // 管理员也参与版本检测（方便测试新版本），skipCheck 固定 false
  const update = useApkUpdate(false);

  type DlPhase = 'info' | 'downloading' | 'done' | 'error';
  const [phase, setPhase]               = useState<DlPhase>('info');
  const [progress, setProgress]         = useState(0);           // 0-1
  const [bytesWritten, setBytesWritten] = useState(0);
  const [bytesTotal, setBytesTotal]     = useState(0);
  const [speedBps, setSpeedBps]         = useState(0);
  const [errorMsg, setErrorMsg]         = useState('');
  const [barWidth, setBarWidth]         = useState(0);           // 进度条容器实测宽度

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const downloadRef  = useRef<any>(null);
  const lastBytesRef = useRef(0);
  const lastTimeRef  = useRef(Date.now());

  // ── 进度条闪光动画 ──
  const shimmerOffset = useSharedValue(0);
  const shimmerStyle  = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(shimmerOffset.value, [0, 1], [-70, barWidth + 70]) },
    ],
    opacity: 0.55,
  }));
  useEffect(() => {
    if (phase === 'downloading') {
      shimmerOffset.value = withRepeat(
        withTiming(1, { duration: 1300, easing: Easing.linear }),
        -1, false,
      );
    } else {
      shimmerOffset.value = 0;
    }
  }, [phase, shimmerOffset]);

  if (update.status !== 'available') return null;
  const { info, onDismiss } = update;
  const pct = Math.round(progress * 100);

  // ── 工具函数（guard 后，可安全访问 info）──
  const fmtBytes = (b: number) =>
    b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
  const fmtSpeed = (bps: number) =>
    bps < 1024 * 1024 ? `${(bps / 1024).toFixed(0)} KB/s` : `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  const etaSec = speedBps > 0 && bytesTotal > bytesWritten
    ? Math.ceil((bytesTotal - bytesWritten) / speedBps) : null;
  const etaStr = etaSec === null ? '' : etaSec > 60 ? `约 ${Math.ceil(etaSec / 60)} 分钟` : `约 ${etaSec} 秒`;

  // ── 下载逻辑 ──
  const startDownload = async () => {
    if (process.env.EXPO_OS !== 'android') return;
    setPhase('downloading');
    setProgress(0);
    setSpeedBps(0);
    lastBytesRef.current = 0;
    lastTimeRef.current  = Date.now();

    const destPath = (FileSystem.cacheDirectory ?? '') + 'vehicle_update.apk';
    const dl = FileSystem.createDownloadResumable(
      info.apk_url,
      destPath,
      {},
      ({ totalBytesWritten: w, totalBytesExpectedToWrite: t }) => {
        setProgress(t > 0 ? w / t : 0);
        setBytesWritten(w);
        setBytesTotal(t);
        const now = Date.now();
        const elapsed = (now - lastTimeRef.current) / 1000;
        if (elapsed >= 0.4) {
          setSpeedBps((w - lastBytesRef.current) / elapsed);
          lastBytesRef.current = w;
          lastTimeRef.current  = now;
        }
      },
    );
    downloadRef.current = dl;

    try {
      const result = await dl.downloadAsync();
      if (result?.uri) {
        setPhase('done');
        setProgress(1);
        setTimeout(async () => {
          try {
            const { startActivityAsync } = await import('expo-intent-launcher');
            const contentUri = await FileSystem.getContentUriAsync(result.uri);
            await startActivityAsync('android.intent.action.VIEW', {
              data: contentUri,
              flags: 1,
              type: 'application/vnd.android.package-archive',
            });
          } catch { /* 安装器关闭或取消 */ } finally {
            setPhase('info');
          }
        }, 900);
      } else {
        setPhase('error');
        setErrorMsg('下载失败，请稍后重试');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('abort')) {
        setPhase('info');
      } else {
        setPhase('error');
        setErrorMsg('下载出错，请检查网络连接后重试');
      }
    }
  };

  const cancelDownload = async () => {
    try { await downloadRef.current?.cancelAsync(); } catch { /* ignore */ }
    downloadRef.current = null;
    setPhase('info');
    setProgress(0);
  };

  return (
    <Modal transparent animationType="fade" visible>
      <View style={{
        flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22,
      }}>
        {/* ── 卡片容器 ── */}
        <View style={{
          width: '100%', borderRadius: 22, overflow: 'hidden',
          borderWidth: 1,
          borderColor: phase === 'done'
            ? 'rgba(34,197,94,0.50)'
            : phase === 'error'
            ? 'rgba(239,68,68,0.45)'
            : phase === 'downloading'
            ? 'rgba(59,130,246,0.55)'
            : 'rgba(59,130,246,0.38)',
        }}>
          <LinearGradient
            colors={['#0F1E3A', '#131B30', '#0D1525']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ padding: 22, gap: 18 }}
          >

            {/* ════════════════ 阶段：info ════════════════ */}
            {phase === 'info' && (<>
              {/* 标题行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
                <View style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: 'rgba(37,99,235,0.20)',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: 'rgba(96,165,250,0.30)',
                }}>
                  <Text style={{ fontSize: 24 }}>📦</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 }}>
                    发现新版本 v{info.version_name}
                  </Text>
                  <Text style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>
                    车辆信息系统
                  </Text>
                </View>
                {info.is_force && (
                  <View style={{
                    backgroundColor: 'rgba(239,68,68,0.18)', borderRadius: 8,
                    paddingHorizontal: 8, paddingVertical: 4,
                    borderWidth: 1, borderColor: 'rgba(239,68,68,0.38)',
                  }}>
                    <Text style={{ color: '#F87171', fontSize: 11, fontWeight: '800' }}>强制更新</Text>
                  </View>
                )}
              </View>

              {/* 更新内容 */}
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12,
                padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
              }}>
                <Text style={{ color: '#64748B', fontSize: 11, marginBottom: 7, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                  更新内容
                </Text>
                <Text style={{ color: '#CBD5E1', fontSize: 13, lineHeight: 21 }}>
                  {info.release_notes}
                </Text>
              </View>

              <Text style={{ color: '#334155', fontSize: 11, textAlign: 'center', letterSpacing: 0.3 }}>
                将在应用内直接下载，无需跳转浏览器
              </Text>

              {/* 操作按钮 */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {!info.is_force && (
                  <Pressable
                    onPress={onDismiss}
                    style={{
                      flex: 1, backgroundColor: 'rgba(255,255,255,0.06)',
                      borderRadius: 12, paddingVertical: 14, alignItems: 'center',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
                    }}
                  >
                    <Text style={{ color: '#64748B', fontSize: 14, fontWeight: '600' }}>稍后更新</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={startDownload}
                  style={{ flex: 2, borderRadius: 12, overflow: 'hidden' }}
                >
                  <LinearGradient
                    colors={['#1D4ED8', '#2563EB', '#3B82F6']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={{
                      paddingVertical: 14,
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>⬇️</Text>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 }}>
                      立即下载安装
                    </Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </>)}

            {/* ════════════════ 阶段：downloading ════════════════ */}
            {phase === 'downloading' && (<>
              {/* 顶部信息 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 12,
                  backgroundColor: 'rgba(37,99,235,0.18)',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: 'rgba(96,165,250,0.28)',
                }}>
                  <ActivityIndicator size="small" color="#60A5FA" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#F1F5F9', fontSize: 15, fontWeight: '800' }}>
                    正在下载  v{info.version_name}
                  </Text>
                  <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>
                    车辆信息系统
                  </Text>
                </View>
                <Text style={{ color: '#60A5FA', fontSize: 24, fontWeight: '900', letterSpacing: -1 }}>
                  {pct}%
                </Text>
              </View>

              {/* 进度条 */}
              <View
                onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
                style={{
                  height: 10, backgroundColor: 'rgba(255,255,255,0.07)',
                  borderRadius: 5, overflow: 'hidden',
                }}
              >
                {/* 填充 */}
                <View style={{
                  position: 'absolute', top: 0, bottom: 0, left: 0,
                  width: `${pct}%` as `${number}%`,
                  borderRadius: 5, overflow: 'hidden',
                }}>
                  <LinearGradient
                    colors={['#1D4ED8', '#3B82F6', '#60A5FA']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={{ flex: 1 }}
                  />
                  {/* 闪光条 */}
                  <Animated.View style={[shimmerStyle, {
                    position: 'absolute', top: 0, bottom: 0, width: 55,
                  }]}>
                    <LinearGradient
                      colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={{ flex: 1 }}
                    />
                  </Animated.View>
                </View>
              </View>

              {/* 速度 / 大小 / 预计时间 */}
              <View style={{ gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {/* 速度徽章 */}
                    {speedBps > 0 && (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 6,
                        paddingHorizontal: 8, paddingVertical: 3,
                        borderWidth: 1, borderColor: 'rgba(59,130,246,0.30)',
                      }}>
                        <Text style={{ color: '#93C5FD', fontSize: 10, fontWeight: '700' }}>▼</Text>
                        <Text style={{ color: '#93C5FD', fontSize: 12, fontWeight: '800' }}>
                          {fmtSpeed(speedBps)}
                        </Text>
                      </View>
                    )}
                    {/* 字节进度 */}
                    {bytesTotal > 0 && (
                      <Text style={{ color: '#64748B', fontSize: 12 }}>
                        {fmtBytes(bytesWritten)} / {fmtBytes(bytesTotal)}
                      </Text>
                    )}
                  </View>
                  {/* ETA */}
                  {!!etaStr && (
                    <Text style={{ color: '#475569', fontSize: 11 }}>预计 {etaStr}</Text>
                  )}
                </View>
              </View>

              {/* 取消按钮 */}
              <Pressable
                onPress={cancelDownload}
                style={{
                  alignSelf: 'center',
                  backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10,
                  paddingHorizontal: 28, paddingVertical: 11,
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
                }}
              >
                <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '600' }}>取消下载</Text>
              </Pressable>
            </>)}

            {/* ════════════════ 阶段：done ════════════════ */}
            {phase === 'done' && (
              <View style={{ alignItems: 'center', gap: 14, paddingVertical: 10 }}>
                <View style={{
                  width: 60, height: 60, borderRadius: 30,
                  backgroundColor: 'rgba(34,197,94,0.18)',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1.5, borderColor: 'rgba(34,197,94,0.45)',
                }}>
                  <Text style={{ fontSize: 30 }}>✅</Text>
                </View>
                <View style={{ alignItems: 'center', gap: 5 }}>
                  <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '800' }}>下载完成！</Text>
                  <Text style={{ color: '#64748B', fontSize: 13 }}>正在启动安装程序…</Text>
                </View>
                {/* 全条进度（100%）*/}
                <View style={{ width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <LinearGradient
                    colors={['#16A34A', '#22C55E', '#4ADE80']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={{ width: '100%', height: 6 }}
                  />
                </View>
              </View>
            )}

            {/* ════════════════ 阶段：error ════════════════ */}
            {phase === 'error' && (<>
              <View style={{ alignItems: 'center', gap: 12, paddingTop: 4 }}>
                <Text style={{ fontSize: 36 }}>⚠️</Text>
                <Text style={{ color: '#F87171', fontSize: 15, fontWeight: '700' }}>下载失败</Text>
                <Text style={{ color: '#64748B', fontSize: 13, textAlign: 'center' }}>{errorMsg}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {!info.is_force && (
                  <Pressable
                    onPress={onDismiss}
                    style={{
                      flex: 1, backgroundColor: 'rgba(255,255,255,0.06)',
                      borderRadius: 12, paddingVertical: 14, alignItems: 'center',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
                    }}
                  >
                    <Text style={{ color: '#64748B', fontSize: 14, fontWeight: '600' }}>取消</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={startDownload}
                  style={{ flex: 2, borderRadius: 12, overflow: 'hidden' }}
                >
                  <LinearGradient
                    colors={['#B91C1C', '#DC2626', '#EF4444']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={{ paddingVertical: 14, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>重新下载</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </>)}

          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

function RootLayoutNav() {
  const { session, isLoading } = useSession();
  const router = useRouter();

  // 兜底导航：当 session 已从 localStorage 恢复但 sign-in 页未挂载时
  // (auth) 路由被 Stack.Protected 封锁，sign-in 的 useEffect 不会触发，
  // 需在此处主动跳转，否则用户看到空白屏无法进入应用
  useEffect(() => {
    if (!isLoading && session) {
      router.replace('/(app)/home' as never);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, session]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* 未登录：只显示登录页（未登录时 guard=true 放行） */}
      <Stack.Protected guard={!session}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* 已登录：进入主业务（已登录时 guard=true 放行） */}
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <StatusBar style="light" backgroundColor="#0D1B4B" />
        <RootLayoutNav />
        <UpdateBanner />
        <ApkUpdateBanner />
        <PortalHost />
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
