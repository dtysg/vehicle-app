import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Car, User, Lock, LogIn, Eye, EyeOff, Fingerprint, ShieldCheck, AlertCircle } from 'lucide-react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useSession } from '@/ctx';

// 跨平台存取（Native: SecureStore / Web: localStorage）
const SAVED_KEY = 'saved_credentials';
async function loadSaved(): Promise<{ account: string; password: string } | null> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SAVED_KEY) : null;
    } else {
      raw = await SecureStore.getItemAsync(SAVED_KEY);
    }
    if (!raw) return null;
    return JSON.parse(raw) as { account: string; password: string };
  } catch { return null; }
}
async function saveSaved(account: string, password: string) {
  const raw = JSON.stringify({ account, password });
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SAVED_KEY, raw);
    } else {
      await SecureStore.setItemAsync(SAVED_KEY, raw);
    }
  } catch { /* 静默 */ }
}

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, forceOutReason, clearForceOutReason, session } = useSession();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 被动下线提示（停用/删除），展示后用户点击或登录成功时清除
  const [kickBanner, setKickBanner] = useState<string | null>(null);

  // session 写入后自动跳转（Stack.Protected 不会自动导航，需手动触发）
  useEffect(() => {
    if (session) {
      router.replace('/(app)/home' as never);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 启动时：有保存凭据 → 先自动登录，成功则弹生物识别
  useEffect(() => {
    (async () => {
      // OTA reloadAsync() 后 SecureStore 可能挂起，所有读取均加 1s 超时保护
      // 超时则跳过自动登录，直接展示空登录表单，避免按钮转圈进不去
      const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);

      // 检测主动退出标记，有则跳过自动登录并清除标记
      let didManualSignOut = false;
      if (Platform.OS === 'web') {
        didManualSignOut = localStorage.getItem('manual_sign_out') === '1';
        if (didManualSignOut) localStorage.removeItem('manual_sign_out');
      } else {
        try {
          const val = await withTimeout(SecureStore.getItemAsync('manual_sign_out'), 1000, null);
          didManualSignOut = val === '1';
          if (didManualSignOut) SecureStore.deleteItemAsync('manual_sign_out').catch(() => {});
        } catch { /* 静默 */ }
      }
      if (didManualSignOut) return; // 主动退出，不自动重新登录

      const saved = await withTimeout(loadSaved(), 1000, null);
      if (!saved) return;
      setAccount(saved.account);
      setPassword(saved.password);

      // Web 不支持生物识别，跳过自动登录流程
      if (Platform.OS === 'web') return;

      // 尝试用保存的凭据静默登录
      setLoading(true);
      const { error: err, role } = await signIn(saved.account, saved.password) as { error: string | null; role?: string };
      setLoading(false);
      if (err) return; // 凭据失效，让用户手动登录

      setKickBanner(null);
      // 登录成功后，Stack.Protected 会自动跳转到 (app)
      // 管理员额外触发生物识别提示（在当前页面展示，不阻塞路由跳转）
      if (role === 'admin') {
        setPendingRole('admin');
        setBioState('prompt');
      }
      // 非管理员：session 已设置，路由器自动跳转，无需手动 navigate
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从 context 同步被踢出原因，展示在登录页
  useEffect(() => {
    if (forceOutReason) {
      setKickBanner(forceOutReason);
      clearForceOutReason();
    }
  }, [forceOutReason, clearForceOutReason]);

  // 指纹验证中间状态（管理员专用 + 自动登录后通用）
  const [bioState, setBioState] = useState<'idle' | 'prompt' | 'fail'>('idle');
  const [pendingNav, setPendingNav] = useState(false);
  // 自动登录后保存角色，供生物识别成功后导航用
  const [pendingRole, setPendingRole] = useState<string>('user');

  const handleLogin = async () => {
    if (!account.trim()) { setError('请输入登录账号'); return; }
    if (!password.trim()) { setError('请输入密码'); return; }
    setLoading(true);
    setError('');
    try {
      const { error: err, role } = await signIn(account, password) as { error: string | null; role?: string };
      if (err) { setError(err); return; }

      // 登录成功：保存账号密码供下次自动填充
      await saveSaved(account.trim(), password);

      // 登录成功，清除被踢出提示
      setKickBanner(null);

      // 管理员 (admin) 需要指纹验证（仅原生端）；session 已设置，useEffect 会自动跳转
      if (role === 'admin' && Platform.OS !== 'web') {
        setPendingRole('admin');
        setBioState('prompt');
        return;
      }
      // 非管理员或Web端：session useEffect 触发跳转，此处也显式 replace 作双保险
      router.replace('/(app)/home' as never);
    } catch {
      setError('网络异常，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometric = async () => {
    setBioState('prompt');
    setPendingNav(true);
    try {
      const hasHW = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHW || !enrolled) {
        // 设备不支持/未录入生物识别，直接放行
        setBioState('idle');
        router.replace('/(app)/home' as never);
        return;
      }
      const promptMsg = pendingRole === 'admin'
        ? '请验证指纹以进入管理员界面'
        : '请验证身份以快速登录';
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: promptMsg,
        cancelLabel: '取消',
        fallbackLabel: '使用密码',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setBioState('idle');
        router.replace('/(app)/home' as never);
      } else {
        // 管理员取消/失败指纹验证也直接放行（指纹仅为可选安全增强）
        setBioState('idle');
        router.replace('/(app)/home' as never);
      }
    } catch {
      setBioState('idle');
      router.replace('/(app)/home' as never);
    }
  };

  const canSubmit = account.trim().length > 0 && password.trim().length > 0;

  return (
    <LinearGradient
      colors={['#0A1628', '#0D2147', '#0A1E3D']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 被动下线横幅 */}
          {kickBanner && (
            <Pressable
              onPress={() => setKickBanner(null)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: 'rgba(239,68,68,0.12)',
                borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)',
                borderRadius: 12, marginHorizontal: 20, marginTop: 52,
                paddingHorizontal: 14, paddingVertical: 12,
              }}
            >
              <AlertCircle size={18} color="#F87171" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#F87171', fontSize: 13, fontWeight: '700', marginBottom: 2 }}>账号状态异常</Text>
                <Text style={{ color: '#FDA4AF', fontSize: 12, lineHeight: 18 }}>{kickBanner}</Text>
              </View>
              <Text style={{ color: '#F87171', fontSize: 16, fontWeight: '300' }}>×</Text>
            </Pressable>
          )}

          {/* ── Logo 区 ── */}
          <View style={{ alignItems: 'center', paddingTop: kickBanner ? 28 : 80, paddingBottom: 28, paddingHorizontal: 24 }}>
            {/* 装饰光晕 */}
            <View style={{ position: 'absolute', top: kickBanner ? 20 : 40, width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(59,130,246,0.06)', alignSelf: 'center' }} />

            {/* 图标双环 */}
            <View style={{
              width: 110, height: 110, borderRadius: 32,
              backgroundColor: 'rgba(30,58,95,0.6)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)',
              marginBottom: 18,
              shadowColor: '#3B82F6', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 6 },
            }}>
              <LinearGradient
                colors={['rgba(59,130,246,0.35)', 'rgba(30,64,175,0.5)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ width: 84, height: 84, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(147,197,253,0.4)' }}
              >
                <Car size={40} color="#93C5FD" />
              </LinearGradient>
            </View>

            {/* 系统名称 */}
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: 3, marginBottom: 6 }}>车辆信息系统</Text>
            {/* 英文副标题胶囊（与首页金价/油价胶囊风格统一） */}
            <View style={{
              backgroundColor: 'rgba(96,165,250,0.12)', borderRadius: 20,
              paddingHorizontal: 14, paddingVertical: 5,
              borderWidth: 1, borderColor: 'rgba(96,165,250,0.28)',
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#60A5FA' }} />
              <Text style={{ color: '#93C5FD', fontSize: 11, letterSpacing: 1.5, fontWeight: '600' }}>Vehicle Management System</Text>
            </View>
          </View>

          {/* ── 登录卡片（与首页卡片风格一致） ── */}
          <View style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingHorizontal: 24, paddingTop: 28, paddingBottom: 52,
            borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
            borderColor: 'rgba(96,165,250,0.18)',
          }}>
            {/* 卡片顶部光线（与首页 GradDivider 风格一致） */}
            <View style={{ height: 1, backgroundColor: 'transparent', marginBottom: 22, alignSelf: 'stretch',
              borderRadius: 1, overflow: 'hidden' }}>
              <LinearGradient
                colors={['transparent', 'rgba(96,165,250,0.6)', 'transparent']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ flex: 1 }}
              />
            </View>

            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600', letterSpacing: 2, marginBottom: 20, textAlign: 'center' }}>账号登录</Text>

            {/* 账号输入框 */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 7, marginLeft: 2, letterSpacing: 0.5, fontWeight: '600' }}>登录账号</Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 13,
                borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.22)',
              }}>
                <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(59,130,246,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)' }}>
                  <User size={15} color="#60A5FA" />
                </View>
                <TextInput
                  value={account}
                  onChangeText={(t) => { setAccount(t); setError(''); }}
                  placeholder="请输入账号"
                  placeholderTextColor="rgba(255,255,255,0.22)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="next"
                  style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 1 }}
                />
              </View>
            </View>

            {/* 密码输入框 */}
            <View style={{ marginBottom: 4 }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 7, marginLeft: 2, letterSpacing: 0.5, fontWeight: '600' }}>登录密码</Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 13,
                borderWidth: 1.5, borderColor: error ? 'rgba(239,68,68,0.6)' : 'rgba(96,165,250,0.22)',
              }}>
                <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(99,102,241,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)' }}>
                  <Lock size={15} color="#A78BFA" />
                </View>
                <TextInput
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(''); }}
                  placeholder="请输入密码"
                  placeholderTextColor="rgba(255,255,255,0.22)"
                  secureTextEntry={!showPwd}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' }}
                />
                <Pressable onPress={() => setShowPwd(!showPwd)} hitSlop={8}>
                  {showPwd
                    ? <EyeOff size={17} color="rgba(255,255,255,0.35)" />
                    : <Eye size={17} color="rgba(255,255,255,0.35)" />}
                </Pressable>
              </View>
            </View>

            {error
              ? <Text style={{ color: '#F87171', fontSize: 12, marginBottom: 14, marginLeft: 4, fontWeight: '600' }}>{error}</Text>
              : <View style={{ height: 18 }} />
            }

            {/* 登录按钮（与首页主色 #0052CC 统一） */}
            <Pressable
              onPress={handleLogin}
              disabled={loading || !canSubmit}
              style={{
                height: 52, borderRadius: 13,
                backgroundColor: canSubmit ? '#0052CC' : 'rgba(255,255,255,0.1)',
                alignItems: 'center', justifyContent: 'center',
                flexDirection: 'row', gap: 8,
                borderWidth: 1,
                borderColor: canSubmit ? 'rgba(96,165,250,0.5)' : 'rgba(255,255,255,0.1)',
                shadowColor: canSubmit ? '#0052CC' : 'transparent',
                shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.15)', borderless: false }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : (
                  <>
                    <LogIn size={17} color={canSubmit ? '#fff' : 'rgba(255,255,255,0.3)'} />
                    <Text style={{ color: canSubmit ? '#fff' : 'rgba(255,255,255,0.3)', fontWeight: '800', fontSize: 15, letterSpacing: 1.5 }}>
                      登　录
                    </Text>
                  </>
                )}
            </Pressable>

            {/* 底部分割线 + 提示 */}
            <View style={{ height: 1, marginVertical: 20, overflow: 'hidden', borderRadius: 1 }}>
              <LinearGradient
                colors={['transparent', 'rgba(96,165,250,0.3)', 'transparent']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ flex: 1 }}
              />
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.18)', fontSize: 11, textAlign: 'center', lineHeight: 18 }}>
              账号由管理员统一分配，如有问题请联系管理员
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 管理员指纹验证弹窗 */}
      <Modal transparent animationType="fade" visible={bioState !== 'idle'}>
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
        }}>
          <View style={{
            backgroundColor: '#0D2147', borderRadius: 22, padding: 28,
            width: '100%', alignItems: 'center', gap: 16,
            borderWidth: 1, borderColor: bioState === 'fail' ? 'rgba(239,68,68,0.4)' : 'rgba(96,165,250,0.3)',
          }}>
            {/* 图标 */}
            <View style={{
              width: 72, height: 72, borderRadius: 20,
              backgroundColor: bioState === 'fail' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: bioState === 'fail' ? 'rgba(239,68,68,0.4)' : 'rgba(96,165,250,0.4)',
              marginBottom: 4,
            }}>
              {bioState === 'fail'
                ? <Fingerprint size={36} color="#EF4444" />
                : <ShieldCheck size={36} color="#60A5FA" />}
            </View>
            <Text style={{ color: '#F1F5F9', fontSize: 17, fontWeight: '800' }}>管理员安全验证</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              {bioState === 'fail'
                ? '指纹验证失败，请重试或退出重新登录'
                : '检测到管理员账号，请通过指纹验证以进入系统'}
            </Text>
            {pendingNav && bioState === 'prompt' && (
              <ActivityIndicator size="small" color="#60A5FA" />
            )}
            <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 }}>
              <Pressable
                onPress={() => { setBioState('idle'); setPendingNav(false); setAccount(''); setPassword(''); }}
                style={{
                  flex: 1, backgroundColor: 'rgba(255,255,255,0.07)',
                  borderRadius: 12, paddingVertical: 13, alignItems: 'center',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '600' }}>退出重登</Text>
              </Pressable>
              <Pressable
                onPress={handleBiometric}
                style={{
                  flex: 2, backgroundColor: '#0052CC',
                  borderRadius: 12, paddingVertical: 13,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  borderWidth: 1, borderColor: 'rgba(96,165,250,0.45)',
                }}
              >
                <Fingerprint size={17} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                  {bioState === 'fail' ? '重新验证' : '指纹验证'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}
