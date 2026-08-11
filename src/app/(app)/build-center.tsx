import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  TextInput, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, Hammer, RefreshCw, CheckCircle2, XCircle,
  Clock, Loader, Download, PackageOpen, AlertTriangle,
  GitCommit, ChevronRight, Ban,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { CURRENT_VERSION_CODE } from '@/hooks/useApkUpdate';

// ── 类型 ──────────────────────────────────────────────────────────
type BuildStatus = 'NEW' | 'IN_QUEUE' | 'IN_PROGRESS' | 'FINISHED' | 'ERRORED' | 'CANCELLED' | 'TIMED_OUT';

interface EasBuild {
  id: string;
  status: BuildStatus;
  platform: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  buildProfile: string;
  gitCommitMessage?: string;
  artifacts?: { buildUrl?: string; applicationArchiveUrl?: string };
  error?: { message: string; errorCode: string };
}

// ── 状态配置 ──────────────────────────────────────────────────────
const STATUS_CFG: Record<BuildStatus, { label: string; color: string; icon: React.ReactNode }> = {
  NEW:         { label: '排队中',   color: '#94A3B8', icon: <Clock size={13} color="#94A3B8" /> },
  IN_QUEUE:    { label: '排队中',   color: '#94A3B8', icon: <Clock size={13} color="#94A3B8" /> },
  IN_PROGRESS: { label: '构建中',   color: '#FBBF24', icon: <Loader size={13} color="#FBBF24" /> },
  FINISHED:    { label: '构建成功', color: '#34D399', icon: <CheckCircle2 size={13} color="#34D399" /> },
  ERRORED:     { label: '构建失败', color: '#F87171', icon: <XCircle size={13} color="#F87171" /> },
  CANCELLED:   { label: '已取消',   color: '#64748B', icon: <Ban size={13} color="#64748B" /> },
  TIMED_OUT:   { label: '超时',     color: '#F97316', icon: <AlertTriangle size={13} color="#F97316" /> },
};

// ── 时间格式化 ────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

function shortId(id: string) { return id.slice(0, 8); }

// ── 发布弹窗（简易） ──────────────────────────────────────────────
function PublishSheet({
  build, onClose, onPublished,
}: { build: EasBuild; onClose: () => void; onPublished: () => void }) {
  const apkUrl = build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl ?? '';
  const suggestedCode = CURRENT_VERSION_CODE + 1;
  const [versionName, setVersionName] = useState(build.appVersion ?? '');
  const [versionCode, setVersionCode] = useState(String(suggestedCode));
  const [releaseNotes, setReleaseNotes] = useState(
    build.gitCommitMessage ? `• ${build.gitCommitMessage}` : ''
  );
  const [isForce, setIsForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePublish = async () => {
    if (!versionName.trim()) { setError('请输入版本名称'); return; }
    const code = parseInt(versionCode, 10);
    if (isNaN(code) || code <= CURRENT_VERSION_CODE) {
      setError(`版本号必须大于当前版本 ${CURRENT_VERSION_CODE}`);
      return;
    }
    if (!releaseNotes.trim()) { setError('请填写更新内容'); return; }

    setLoading(true);
    setError('');
    try {
      const { error: dbErr } = await supabase.from('app_versions').insert({
        version_name: versionName.trim(),
        version_code: code,
        apk_url: apkUrl,
        release_notes: releaseNotes.trim(),
        is_force: isForce,
      });
      if (dbErr) { setError('发布失败：' + dbErr.message); return; }
      onPublished();
    } catch {
      setError('网络异常，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Pressable
      style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end' } as never}
      onPress={onClose}
    >
      <Pressable onPress={e => e.stopPropagation()}>
        <LinearGradient
          colors={['#0D2147', '#0A1628']}
          style={{ borderTopLeftRadius: 20, borderTopRightRadius: 20,
            padding: 20, paddingBottom: 40, gap: 14 }}
        >
          {/* 标题 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '800' }}>📦 发布版本</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: '#64748B', fontSize: 14 }}>取消</Text>
            </Pressable>
          </View>

          {/* APK 来源 */}
          <View style={{ backgroundColor: 'rgba(52,211,153,0.08)', borderRadius: 10, padding: 10,
            borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={14} color="#34D399" />
            <Text style={{ color: '#6EE7B7', fontSize: 12, flex: 1 }} numberOfLines={1}>
              EAS 构建 {shortId(build.id)} · {build.appVersion}
            </Text>
          </View>

          {/* 版本名称 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' }}>版本名称 *</Text>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' }}>
              <TextInput
                value={versionName} onChangeText={t => { setVersionName(t); setError(''); }}
                placeholder='如 1.0.7' placeholderTextColor="rgba(255,255,255,0.22)"
                style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}
              />
            </View>
          </View>

          {/* 版本号 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' }}>版本号（数字）* 当前：{CURRENT_VERSION_CODE}</Text>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' }}>
              <TextInput
                value={versionCode} onChangeText={t => { setVersionCode(t); setError(''); }}
                keyboardType="numeric"
                style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}
              />
            </View>
          </View>

          {/* 更新内容 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' }}>更新内容 *</Text>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)', minHeight: 72 }}>
              <TextInput
                value={releaseNotes} onChangeText={t => { setReleaseNotes(t); setError(''); }}
                placeholder="描述本次更新内容…" placeholderTextColor="rgba(255,255,255,0.22)"
                multiline numberOfLines={3} textAlignVertical="top"
                style={{ color: '#CBD5E1', fontSize: 13, lineHeight: 20 }}
              />
            </View>
          </View>

          {/* 强制更新 */}
          <Pressable onPress={() => setIsForce(!isForce)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 12,
              borderWidth: 1, borderColor: isForce ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)' }}>
            <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
              borderColor: isForce ? '#EF4444' : 'rgba(255,255,255,0.3)',
              backgroundColor: isForce ? 'rgba(239,68,68,0.25)' : 'transparent',
              alignItems: 'center', justifyContent: 'center' }}>
              {isForce && <Text style={{ color: '#F87171', fontSize: 13, lineHeight: 17 }}>✓</Text>}
            </View>
            <Text style={{ color: isForce ? '#F87171' : '#94A3B8', fontSize: 13, fontWeight: '600' }}>
              强制更新（用户无法跳过）
            </Text>
            {isForce && <AlertTriangle size={14} color="#F87171" style={{ marginLeft: 'auto' } as never} />}
          </Pressable>

          {/* 错误 */}
          {!!error && (
            <Text style={{ color: '#F87171', fontSize: 12 }}>{error}</Text>
          )}

          {/* 发布按钮 */}
          <Pressable onPress={handlePublish} disabled={loading}
            style={{ backgroundColor: '#1D4ED8', borderRadius: 12, paddingVertical: 14,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
              borderWidth: 1, borderColor: 'rgba(96,165,250,0.4)', opacity: loading ? 0.7 : 1 }}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <PackageOpen size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>确认发布</Text>
                </>
            }
          </Pressable>
        </LinearGradient>
      </Pressable>
    </Pressable>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────
export default function BuildCenterScreen() {
  const router = useRouter();
  const [builds, setBuilds] = useState<EasBuild[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [publishBuild, setPublishBuild] = useState<EasBuild | null>(null);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());

  const fetchBuilds = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('eas-builds');
      if (fnErr) { setError('请求失败：' + fnErr.message); return; }
      if (data?.error) { setError(data.error); return; }
      setBuilds(data?.builds ?? []);
    } catch (e) {
      setError('网络异常，请检查连接后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    (async () => { await fetchBuilds(); })();
  }, [fetchBuilds]));

  const hasActive = builds.some(b => b.status === 'IN_PROGRESS' || b.status === 'IN_QUEUE' || b.status === 'NEW');

  return (
    <LinearGradient colors={['#0A1628', '#0D2147', '#0A1E3D']} style={{ flex: 1 }}>
      {/* 顶部栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}
          style={{ width: 36, height: 36, borderRadius: 10,
            backgroundColor: 'rgba(255,255,255,0.08)',
            alignItems: 'center', justifyContent: 'center' }}>
          <ArrowLeft size={18} color="#94A3B8" />
        </Pressable>
        <Text style={{ color: '#F1F5F9', fontSize: 18, fontWeight: '800', flex: 1 }}>构建中心</Text>
        <Pressable onPress={fetchBuilds} hitSlop={8} disabled={loading}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
            backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 8,
            paddingHorizontal: 10, paddingVertical: 6,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          {loading
            ? <ActivityIndicator size="small" color="#60A5FA" style={{ transform: [{ scale: 0.7 }] }} />
            : <RefreshCw size={13} color="#60A5FA" />}
          <Text style={{ color: '#60A5FA', fontSize: 12, fontWeight: '700' }}>
            {loading ? '刷新中' : '刷新'}
          </Text>
        </Pressable>
        <Hammer size={20} color="#FBBF24" />
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchBuilds} tintColor="#FBBF24" />}
      >
        {/* 说明卡 */}
        <View style={{ backgroundColor: 'rgba(251,191,36,0.08)', borderRadius: 12, padding: 14,
          borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)', gap: 6 }}>
          <Text style={{ color: '#FCD34D', fontSize: 13, fontWeight: '700' }}>💡 使用说明</Text>
          <Text style={{ color: '#FDE68A', fontSize: 12, lineHeight: 19 }}>
            {`构建由开发者在后台触发（运行 eas build），构建完成后在此页面点击「一键发布」，APK 下载链接将自动写入版本列表，用户重启 App 即可收到更新提示。`}
          </Text>
        </View>

        {/* 实时构建进行中提示 */}
        {hasActive && (
          <View style={{ backgroundColor: 'rgba(251,191,36,0.12)', borderRadius: 12, padding: 12,
            borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)',
            flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ActivityIndicator size="small" color="#FBBF24" />
            <Text style={{ color: '#FCD34D', fontSize: 13, fontWeight: '700', flex: 1 }}>
              构建进行中，通常需要 15–25 分钟
            </Text>
            <Text style={{ color: 'rgba(251,191,36,0.5)', fontSize: 10 }}>下拉刷新</Text>
          </View>
        )}

        {/* 错误提示 */}
        {!!error && (
          <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12,
            borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <XCircle size={14} color="#F87171" style={{ marginTop: 1 } as never} />
            <Text style={{ color: '#F87171', fontSize: 12, flex: 1 }}>{error}</Text>
          </View>
        )}

        {/* 构建列表 */}
        {!loading && builds.length === 0 && !error && (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
            <Hammer size={36} color="rgba(251,191,36,0.25)" />
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无构建记录</Text>
          </View>
        )}

        {builds.map((build, idx) => {
          const cfg = STATUS_CFG[build.status] ?? STATUS_CFG.ERRORED;
          const isFinished = build.status === 'FINISHED';
          const isActive = build.status === 'IN_PROGRESS' || build.status === 'IN_QUEUE' || build.status === 'NEW';
          const hasApk = !!(build.artifacts?.buildUrl || build.artifacts?.applicationArchiveUrl);
          const isPublished = publishedIds.has(build.id);
          const apkUrl = build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl;

          return (
            <View key={build.id}
              style={{ borderRadius: 16, overflow: 'hidden',
                borderWidth: 1,
                borderColor: isFinished
                  ? 'rgba(52,211,153,0.30)'
                  : isActive
                    ? 'rgba(251,191,36,0.35)'
                    : 'rgba(255,255,255,0.08)' }}>
              <LinearGradient
                colors={
                  isFinished
                    ? ['rgba(16,185,129,0.10)', 'rgba(5,46,22,0.50)']
                    : isActive
                      ? ['rgba(120,85,8,0.35)', 'rgba(28,16,2,0.60)']
                      : ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.20)']
                }
                style={{ padding: 14, gap: 10 }}
              >
                {/* 顶行：构建序号 + 状态 + 时间 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {/* 序号徽章 */}
                  <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 6,
                    paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700' }}>
                      #{builds.length - idx}
                    </Text>
                  </View>

                  {/* 状态标签 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: `${cfg.color}18`, borderRadius: 6,
                    paddingHorizontal: 7, paddingVertical: 3,
                    borderWidth: 1, borderColor: `${cfg.color}35` }}>
                    {isActive
                      ? <ActivityIndicator size="small" color={cfg.color} style={{ transform: [{ scale: 0.55 }], width: 13, height: 13 }} />
                      : cfg.icon}
                    <Text style={{ color: cfg.color, fontSize: 10, fontWeight: '800' }}>{cfg.label}</Text>
                  </View>

                  <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginLeft: 'auto' as never }}>
                    {timeAgo(build.createdAt)}
                  </Text>
                </View>

                {/* 版本 + ID */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '800' }}>
                    v{build.appVersion}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>·</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontFamily: 'monospace' }}>
                    {shortId(build.id)}
                  </Text>
                  <View style={{ backgroundColor: 'rgba(99,102,241,0.2)', borderRadius: 5,
                    paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: '#A5B4FC', fontSize: 9, fontWeight: '700' }}>
                      {build.buildProfile}
                    </Text>
                  </View>
                </View>

                {/* commit 信息 */}
                {!!build.gitCommitMessage && (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                    <GitCommit size={11} color="rgba(255,255,255,0.3)" style={{ marginTop: 1 } as never} />
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, flex: 1 }} numberOfLines={2}>
                      {build.gitCommitMessage}
                    </Text>
                  </View>
                )}

                {/* 错误信息 */}
                {!!build.error && (
                  <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 8,
                    padding: 8, flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                    <XCircle size={12} color="#F87171" style={{ marginTop: 1 } as never} />
                    <Text style={{ color: '#FCA5A5', fontSize: 11, flex: 1 }} numberOfLines={3}>
                      {build.error.message}
                    </Text>
                  </View>
                )}

                {/* 操作按钮区 */}
                {isFinished && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                    {/* 一键发布 */}
                    {!isPublished ? (
                      <Pressable
                        onPress={() => setPublishBuild(build)}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center',
                          justifyContent: 'center', gap: 6,
                          backgroundColor: '#1D4ED8', borderRadius: 10, paddingVertical: 10,
                          borderWidth: 1, borderColor: 'rgba(96,165,250,0.4)' }}>
                        <PackageOpen size={14} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>一键发布</Text>
                        <ChevronRight size={12} color="rgba(255,255,255,0.6)" />
                      </Pressable>
                    ) : (
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center',
                        justifyContent: 'center', gap: 6,
                        backgroundColor: 'rgba(52,211,153,0.12)', borderRadius: 10, paddingVertical: 10,
                        borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)' }}>
                        <CheckCircle2 size={14} color="#34D399" />
                        <Text style={{ color: '#34D399', fontSize: 12, fontWeight: '800' }}>已发布到版本列表</Text>
                      </View>
                    )}

                    {/* 下载APK */}
                    {hasApk && apkUrl && (
                      <Pressable
                        onPress={async () => {
                          const { openBrowserAsync } = await import('expo-web-browser');
                          await openBrowserAsync(apkUrl);
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 5,
                          backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingHorizontal: 12,
                          paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                        <Download size={14} color="#94A3B8" />
                        <Text style={{ color: '#94A3B8', fontSize: 12, fontWeight: '700' }}>下载</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </LinearGradient>
            </View>
          );
        })}
      </ScrollView>

      {/* 发布弹窗 */}
      {publishBuild && (
        <PublishSheet
          build={publishBuild}
          onClose={() => setPublishBuild(null)}
          onPublished={() => {
            setPublishedIds(prev => new Set([...prev, publishBuild!.id]));
            setPublishBuild(null);
          }}
        />
      )}
    </LinearGradient>
  );
}
