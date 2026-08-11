/**
 * 系统设置页 — 超级管理员专用
 * 功能：保存 EXPO_TOKEN（热更新推送凭证）+ 一键推送热更新
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Key,
  Save,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  EyeOff,
  Info,
  Zap,
  Send,
  XCircle,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';

// ── Token 状态类型 ──────────────────────────────────────────────────────────
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type PushStatus = 'idle' | 'pushing' | 'success' | 'error';

export default function AdminSettings() {
  const router = useRouter();
  const { isPermanentAdmin } = useSession();

  const [tokenInput, setTokenInput] = useState('');
  const [savedMask, setSavedMask] = useState<string | null>(null); // 已存储的 token 掩码
  const [hasSaved, setHasSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [loading, setLoading] = useState(true);

  // ── 一键推送状态 ──────────────────────────────────────────────────────────
  const [pushMsg, setPushMsg] = useState('');
  const [pushStatus, setPushStatus] = useState<PushStatus>('idle');
  const [pushResult, setPushResult] = useState<{ success: boolean; message: string } | null>(null);

  // ── 加载已存储的 token（掩码展示）──────────────────────────────────────
  const loadSavedToken = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('app_secrets')
        .select('value, updated_at')
        .eq('key', 'expo_token')
        .single();
      if (data?.value) {
        const v = data.value as string;
        // 掩码：保留前4位和后4位，中间用 *** 替代
        const mask = v.length > 8
          ? `${v.slice(0, 4)}${'*'.repeat(Math.min(v.length - 8, 20))}${v.slice(-4)}`
          : '*'.repeat(v.length);
        setSavedMask(mask);
        setHasSaved(true);
      } else {
        setSavedMask(null);
        setHasSaved(false);
      }
    } catch {
      setSavedMask(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    (async () => { await loadSavedToken(); })();
  }, [loadSavedToken]));

  // ── 保存 Token ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setErrMsg('请输入 EXPO_TOKEN');
      return;
    }
    if (trimmed.length < 20) {
      setErrMsg('Token 格式不正确，请重新复制');
      return;
    }
    setStatus('saving');
    setErrMsg('');
    try {
      const { error } = await supabase
        .from('app_secrets')
        .upsert({
          key: 'expo_token',
          value: trimmed,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      if (error) throw error;
      setStatus('saved');
      setTokenInput('');
      await loadSavedToken();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (e: unknown) {
      setStatus('error');
      setErrMsg(e instanceof Error ? e.message : '保存失败，请重试');
    }
  };

  // ── 一键推送热更新 ────────────────────────────────────────────────────
  const handlePush = async () => {
    if (!hasSaved) {
      setPushResult({ success: false, message: '请先保存 EXPO_TOKEN 后再推送' });
      return;
    }
    setPushStatus('pushing');
    setPushResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('push-ota-update', {
        body: { message: pushMsg.trim() || undefined },
      });
      if (error) throw error;
      if (data?.success) {
        setPushStatus('success');
        // 拼接更新详情：平台 + 时间 + 备注
        const detail = [
          data.platforms?.length ? `平台：${(data.platforms as string[]).join(' / ')}` : '',
          data.createdAt ? `发布时间：${data.createdAt}` : '',
          data.updateMessage && data.updateMessage !== '（无备注）' ? `备注：${data.updateMessage}` : '',
        ].filter(Boolean).join('\n');
        setPushResult({ success: true, message: `${data.message ?? '✅ 最新更新已就绪！'}${detail ? '\n\n' + detail : ''}` });
        setPushMsg('');
        setTimeout(() => setPushStatus('idle'), 8000);
      } else {
        throw new Error(data?.error ?? '推送失败');
      }
    } catch (e: unknown) {
      setPushStatus('error');
      setPushResult({ success: false, message: e instanceof Error ? e.message : '推送失败，请重试' });
      setTimeout(() => setPushStatus('idle'), 6000);
    }
  };

  // ── 非超级管理员拦截 ──────────────────────────────────────────────────
  if (!isPermanentAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F4F5F7', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#64748B', fontSize: 16 }}>无权限访问</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#F4F5F7' }} behavior="padding">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 顶部导航栏 ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
        }}>
          <Pressable
            onPress={() => router.back()}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowLeft size={20} color="#374151" />
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#111827', marginRight: 40 }}>
            系统设置
          </Text>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 16 }}>

          {/* ── 标题卡片 ── */}
          <Animated.View entering={FadeInDown.duration(300)}>
            <LinearGradient
              colors={['#1E3A8A', '#2563EB', '#3B82F6']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 20, padding: 20, overflow: 'hidden' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' }}>
                  <Zap size={22} color="#fff" />
                </View>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>热更新管理</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.80)', fontSize: 13, lineHeight: 20 }}>
                保存 Expo Access Token 后，可在此平台一键推送 App 热更新，无需电脑。✓ 热更新弹窗验证测试 v2
              </Text>
            </LinearGradient>
          </Animated.View>

          {/* ── 当前 Token 状态 ── */}
          <Animated.View entering={FadeInDown.delay(60).duration(300)}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Key size={16} color="#6366F1" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>当前 Token 状态</Text>
              </View>
              {loading ? (
                <ActivityIndicator size="small" color="#6366F1" />
              ) : hasSaved ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F0FDF4', borderRadius: 10, padding: 12 }}>
                  <CheckCircle2 size={16} color="#16A34A" />
                  <Text style={{ flex: 1, color: '#15803D', fontSize: 13, fontWeight: '600' }}>已配置</Text>
                  <Text style={{ color: '#6B7280', fontSize: 12, fontFamily: 'monospace' }} numberOfLines={1}>{savedMask}</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF7ED', borderRadius: 10, padding: 12 }}>
                  <AlertTriangle size={16} color="#D97706" />
                  <Text style={{ color: '#B45309', fontSize: 13, fontWeight: '600' }}>尚未配置，热更新无法推送</Text>
                </View>
              )}
            </View>
          </Animated.View>

          {/* ── Token 输入区 ── */}
          <Animated.View entering={FadeInDown.delay(120).duration(300)}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <RefreshCw size={16} color="#6366F1" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>
                  {hasSaved ? '更新 Token' : '填入 Token'}
                </Text>
              </View>

              {/* 输入框 */}
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                borderWidth: 1.5, borderColor: tokenInput ? '#6366F1' : '#E5E7EB',
                borderRadius: 12, backgroundColor: '#F9FAFB',
                paddingHorizontal: 14, paddingVertical: 10, gap: 8,
              }}>
                <TextInput
                  style={{ flex: 1, fontSize: 14, color: '#111827', fontFamily: 'monospace' }}
                  placeholder="粘贴 expo_XXXXXX... 格式的 Token"
                  placeholderTextColor="#9CA3AF"
                  value={tokenInput}
                  onChangeText={setTokenInput}
                  secureTextEntry={!showToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline={false}
                />
                <Pressable onPress={() => setShowToken(v => !v)} style={{ padding: 4 }}>
                  {showToken ? <EyeOff size={18} color="#9CA3AF" /> : <Eye size={18} color="#9CA3AF" />}
                </Pressable>
              </View>

              {/* 错误提示 */}
              {errMsg ? (
                <Text style={{ color: '#DC2626', fontSize: 13 }}>{errMsg}</Text>
              ) : null}

              {/* 保存按钮 */}
              <Pressable onPress={handleSave} disabled={status === 'saving'} style={{ borderRadius: 12, overflow: 'hidden' }}>
                <LinearGradient
                  colors={status === 'saved' ? ['#065F46', '#059669'] : ['#312E81', '#4338CA', '#6366F1']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 }}
                >
                  {status === 'saving' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : status === 'saved' ? (
                    <CheckCircle2 size={18} color="#fff" />
                  ) : (
                    <Save size={18} color="#fff" />
                  )}
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                    {status === 'saving' ? '保存中...' : status === 'saved' ? '保存成功！' : '保存 Token'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          </Animated.View>

          {/* ── 一键推送热更新 ── */}
          <Animated.View entering={FadeInDown.delay(180).duration(300)}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Send size={16} color="#059669" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>一键推送热更新</Text>
                {!hasSaved && (
                  <View style={{ backgroundColor: '#FEF3C7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: '#D97706', fontSize: 11 }}>需先配置 Token</Text>
                  </View>
                )}
              </View>

              {/* 推送备注输入框 */}
              <TextInput
                style={{
                  borderWidth: 1.5,
                  borderColor: pushMsg ? '#059669' : '#E5E7EB',
                  borderRadius: 12,
                  backgroundColor: '#F9FAFB',
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  fontSize: 14,
                  color: '#111827',
                }}
                placeholder="推送备注（可选，如：修复登录问题）"
                placeholderTextColor="#9CA3AF"
                value={pushMsg}
                onChangeText={setPushMsg}
                editable={pushStatus !== 'pushing'}
              />

              {/* 推送结果提示 */}
              {pushResult && (
                <View style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 8,
                  backgroundColor: pushResult.success ? '#F0FDF4' : '#FEF2F2',
                  borderRadius: 10, padding: 12,
                }}>
                  {pushResult.success
                    ? <CheckCircle2 size={16} color="#16A34A" style={{ marginTop: 1 }} />
                    : <XCircle size={16} color="#DC2626" style={{ marginTop: 1 }} />}
                  <Text style={{
                    flex: 1, fontSize: 13,
                    color: pushResult.success ? '#15803D' : '#DC2626',
                    lineHeight: 20,
                  }}>{pushResult.message}</Text>
                </View>
              )}

              {/* 推送按钮 */}
              <Pressable
                onPress={handlePush}
                disabled={pushStatus === 'pushing' || !hasSaved}
                style={{ borderRadius: 12, overflow: 'hidden', opacity: !hasSaved ? 0.5 : 1 }}
              >
                <LinearGradient
                  colors={pushStatus === 'success' ? ['#065F46', '#059669'] : ['#064E3B', '#047857', '#10B981']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 }}
                >
                  {pushStatus === 'pushing'
                    ? <ActivityIndicator size="small" color="#fff" />
                    : pushStatus === 'success'
                      ? <CheckCircle2 size={18} color="#fff" />
                      : <Send size={18} color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                    {pushStatus === 'pushing' ? '推送中...' : pushStatus === 'success' ? '推送成功！' : '一键推送到所有用户'}
                  </Text>
                </LinearGradient>
              </Pressable>

              <Text style={{ color: '#6B7280', fontSize: 12, lineHeight: 18, textAlign: 'center' }}>
                推送后用户重启 App 将自动看到更新提示
              </Text>
            </View>
          </Animated.View>

          {/* ── 使用说明 ── */}
          <Animated.View entering={FadeInDown.delay(180).duration(300)}>
            <View style={{ backgroundColor: '#EEF2FF', borderRadius: 16, padding: 16, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Info size={16} color="#4338CA" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#3730A3' }}>如何使用</Text>
              </View>
              {[
                { step: '1', text: '打开 expo.dev → Settings → Access Tokens' },
                { step: '2', text: '点击 Create Token，填写任意名称' },
                { step: '3', text: '复制生成的 Token 粘贴到上方输入框并保存' },
                { step: '4', text: '让 AI 修改代码后，在此页面点「一键推送」' },
                { step: '5', text: '用户重启 App 后自动收到更新提示' },
              ].map(({ step, text }) => (
                <View key={step} style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#4338CA', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{step}</Text>
                  </View>
                  <Text style={{ flex: 1, color: '#3730A3', fontSize: 13, lineHeight: 20 }}>{text}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* ── 安全说明 ── */}
          <Animated.View entering={FadeInDown.delay(240).duration(300)}>
            <View style={{ backgroundColor: '#FEF9C3', borderRadius: 12, padding: 14, flexDirection: 'row', gap: 10 }}>
              <AlertTriangle size={16} color="#A16207" style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, color: '#A16207', fontSize: 12, lineHeight: 18 }}>
                Token 仅限超级管理员查看，通过 Supabase RLS 保护。请勿将 Token 发送至聊天对话框，避免泄露风险。
              </Text>
            </View>
          </Animated.View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
