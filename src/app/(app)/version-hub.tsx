/**
 * 版本管理中心 — 二合一：构建中心 / 已发布版本
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, FlatList,
  ActivityIndicator, TextInput, Linking, RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, Hammer, PackageOpen, ListChecks,
  CheckCircle2, XCircle,
  Download, AlertTriangle, GitCommit, ChevronRight, Ban,
  Trash2, ShieldAlert, Calendar, Hash, FileText, AlertCircle,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { CURRENT_VERSION_CODE } from '@/hooks/useApkUpdate';

const HIDDEN_BUILDS_KEY = '@version_hub:hidden_builds';

type Tab = 'builds' | 'versions';
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

interface AppVersion {
  id: string;
  version_name: string;
  version_code: number;
  apk_url: string;
  release_notes: string;
  is_force: boolean;
  created_at: string;
}

// ── 状态配置 ─────────────────────────────────────────────────────
const STATUS_CFG: Record<BuildStatus, { label: string; color: string }> = {
  NEW:         { label: '排队中',   color: '#94A3B8' },
  IN_QUEUE:    { label: '排队中',   color: '#94A3B8' },
  IN_PROGRESS: { label: '构建中',   color: '#FBBF24' },
  FINISHED:    { label: '构建成功', color: '#34D399' },
  ERRORED:     { label: '构建失败', color: '#F87171' },
  CANCELLED:   { label: '已取消',   color: '#64748B' },
  TIMED_OUT:   { label: '超时',     color: '#F97316' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

function shortId(id: string) { return id.slice(0, 8); }

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── Tab 标题栏 ────────────────────────────────────────────────────
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'builds',   label: '构建中心', icon: <Hammer     size={13} color="currentColor" /> },
  { key: 'versions', label: '已发布',   icon: <ListChecks size={13} color="currentColor" /> },
];

// ── 发布弹窗 ──────────────────────────────────────────────────────
function InputRow({ label, value, onChangeText, placeholder, keyboardType }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; keyboardType?: 'numeric';
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' }}>
        <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.22)" keyboardType={keyboardType}
          style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} />
      </View>
    </View>
  );
}

function PublishSheet({
  build, onClose, onPublished,
}: { build: EasBuild; onClose: () => void; onPublished: (versionId: string) => void }) {
  const apkUrl = build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl ?? '';
  const [versionName, setVersionName] = useState(build.appVersion ?? '');
  const [versionCode, setVersionCode] = useState(String(CURRENT_VERSION_CODE + 1));
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
      setError(`版本号必须大于 ${CURRENT_VERSION_CODE}`);
      return;
    }
    if (!releaseNotes.trim()) { setError('请填写更新内容'); return; }
    setLoading(true);
    setError('');
    try {
      const { data, error: dbErr } = await supabase.from('app_versions').insert({
        version_name: versionName.trim(),
        version_code: code,
        apk_url: apkUrl,
        release_notes: releaseNotes.trim(),
        is_force: isForce,
      }).select('id').single();
      if (dbErr) { setError('发布失败：' + dbErr.message); return; }
      onPublished(data.id);
    } catch {
      setError('网络异常，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Pressable
      style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'flex-end' } as never}
      onPress={onClose}
    >
      <Pressable onPress={e => e.stopPropagation()}>
        <LinearGradient colors={['#0D2147', '#0A1628']}
          style={{ borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 44, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '800' }}>📦 发布到版本列表</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: '#64748B', fontSize: 14 }}>取消</Text>
            </Pressable>
          </View>
          <View style={{ backgroundColor: 'rgba(52,211,153,0.08)', borderRadius: 10, padding: 10,
            borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={14} color="#34D399" />
            <Text style={{ color: '#6EE7B7', fontSize: 12, flex: 1 }} numberOfLines={1}>
              EAS {shortId(build.id)} · v{build.appVersion}
            </Text>
          </View>
          {/* 版本名 */}
          <InputRow label="版本名称 *" value={versionName} onChangeText={t => { setVersionName(t); setError(''); }} placeholder="如 1.0.7" />
          {/* 版本号 */}
          <InputRow label={`版本号 * (当前 ${CURRENT_VERSION_CODE})`} value={versionCode}
            onChangeText={t => { setVersionCode(t); setError(''); }} keyboardType="numeric" placeholder="数字" />
          {/* 更新内容 */}
          <View style={{ gap: 5 }}>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' }}>更新内容 *</Text>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)', minHeight: 64 }}>
              <TextInput value={releaseNotes} onChangeText={t => { setReleaseNotes(t); setError(''); }}
                placeholder="本次更新内容…" placeholderTextColor="rgba(255,255,255,0.22)"
                multiline textAlignVertical="top"
                style={{ color: '#CBD5E1', fontSize: 13, lineHeight: 20 }} />
            </View>
          </View>
          {/* 强制更新 */}
          <Pressable onPress={() => setIsForce(!isForce)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 11,
              borderWidth: 1, borderColor: isForce ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)' }}>
            <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
              borderColor: isForce ? '#EF4444' : 'rgba(255,255,255,0.3)',
              backgroundColor: isForce ? 'rgba(239,68,68,0.25)' : 'transparent',
              alignItems: 'center', justifyContent: 'center' }}>
              {isForce && <Text style={{ color: '#F87171', fontSize: 13, lineHeight: 17 }}>✓</Text>}
            </View>
            <Text style={{ color: isForce ? '#F87171' : '#94A3B8', fontSize: 13, fontWeight: '600', flex: 1 }}>
              强制更新（用户无法跳过）
            </Text>
            {isForce && <AlertTriangle size={14} color="#F87171" />}
          </Pressable>
          {!!error && <Text style={{ color: '#F87171', fontSize: 12 }}>{error}</Text>}
          <Pressable onPress={handlePublish} disabled={loading}
            style={{ backgroundColor: '#1D4ED8', borderRadius: 12, paddingVertical: 13,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
              borderWidth: 1, borderColor: 'rgba(96,165,250,0.4)', opacity: loading ? 0.7 : 1 }}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <><PackageOpen size={15} color="#fff" /><Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>确认发布</Text></>}
          </Pressable>
        </LinearGradient>
      </Pressable>
    </Pressable>
  );
}

// ════════════════════════════════════════════════════════════════
// ── Tab 1: 构建中心 ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
function BuildsTab({ publishedMap, onPublished, onDeleteVersion }: {
  publishedMap: Map<string, string>; // apkUrl → versionId
  onPublished: (buildId: string, apkUrl: string, versionId: string) => void;
  onDeleteVersion: (versionId: string, label: string, cb: () => void) => void;
}) {
  const [builds, setBuilds] = useState<EasBuild[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [publishBuild, setPublishBuild] = useState<EasBuild | null>(null);
  const [localPublished, setLocalPublished] = useState<Map<string, string>>(new Map());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [deleteBuild, setDeleteBuild] = useState<EasBuild | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 加载已隐藏的构建 ID
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HIDDEN_BUILDS_KEY);
        if (raw) setHiddenIds(new Set(JSON.parse(raw)));
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchBuilds = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('eas-builds');
      if (fnErr) { setError('请求失败：' + fnErr.message); return; }
      if (data?.error) { setError(data.error); return; }
      setBuilds(data?.builds ?? []);
    } catch { setError('网络异常，请重试'); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { (async () => { await fetchBuilds(); })(); }, [fetchBuilds]));

  // 删除/取消构建
  const confirmDeleteBuild = useCallback(async () => {
    if (!deleteBuild) return;
    setDeleting(true);
    const isActive = ['IN_PROGRESS', 'IN_QUEUE', 'NEW'].includes(deleteBuild.status);
    try {
      if (isActive) {
        // 调用 Edge Function 取消进行中的构建
        await supabase.functions.invoke('eas-builds', {
          body: { action: 'cancel', buildId: deleteBuild.id },
        });
      }
    } catch { /* 即使失败也继续隐藏 */ }
    // 本地隐藏
    const next = new Set([...hiddenIds, deleteBuild.id]);
    setHiddenIds(next);
    await AsyncStorage.setItem(HIDDEN_BUILDS_KEY, JSON.stringify([...next])).catch(() => {});
    setBuilds(prev => prev.filter(b => b.id !== deleteBuild.id));
    setDeleting(false);
    setDeleteBuild(null);
  }, [deleteBuild, hiddenIds]);

  const visibleBuilds = builds.filter(b => !hiddenIds.has(b.id));
  const hasActive = visibleBuilds.some(b => ['IN_PROGRESS', 'IN_QUEUE', 'NEW'].includes(b.status));

  return (
    <>
    <ScrollView contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchBuilds} tintColor="#FBBF24" />}>

      {hasActive && (
        <View style={{ backgroundColor: 'rgba(251,191,36,0.12)', borderRadius: 12, padding: 11,
          borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)',
          flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator size="small" color="#FBBF24" />
          <Text style={{ color: '#FCD34D', fontSize: 12, fontWeight: '700', flex: 1 }}>
            构建进行中，约 15–25 分钟，下拉刷新
          </Text>
        </View>
      )}

      {!!error && (
        <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12,
          borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <XCircle size={14} color="#F87171" style={{ marginTop: 1 } as never} />
          <Text style={{ color: '#F87171', fontSize: 12, flex: 1 }}>{error}</Text>
        </View>
      )}

      {!loading && visibleBuilds.length === 0 && !error && (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 32 }}>
          <Hammer size={32} color="rgba(251,191,36,0.2)" />
          <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>暂无构建记录</Text>
        </View>
      )}

      {visibleBuilds.map((build, idx) => {
        const cfg = STATUS_CFG[build.status] ?? STATUS_CFG.ERRORED;
        const isFinished = build.status === 'FINISHED';
        const isActive = ['IN_PROGRESS', 'IN_QUEUE', 'NEW'].includes(build.status);
        const apkUrl = build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl ?? '';
        // 已发布：先看父级传来的 publishedMap（按 apkUrl），再看本地记录（按 buildId）
        const publishedVersionId = publishedMap.get(apkUrl) ?? localPublished.get(build.id);
        const isPublished = !!publishedVersionId;

        return (
          <View key={build.id} style={{ borderRadius: 15, overflow: 'hidden',
            borderWidth: 1,
            borderColor: isFinished ? 'rgba(52,211,153,0.28)' : isActive ? 'rgba(251,191,36,0.32)' : 'rgba(255,255,255,0.07)' }}>
            <LinearGradient
              colors={isFinished ? ['rgba(16,185,129,0.10)','rgba(5,46,22,0.50)'] :
                isActive ? ['rgba(120,85,8,0.35)','rgba(28,16,2,0.60)'] :
                ['rgba(255,255,255,0.04)','rgba(0,0,0,0.20)']}
              style={{ padding: 13, gap: 8 }}>
              {/* 顶行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 5,
                  paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: '700' }}>
                    #{builds.length - idx}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: `${cfg.color}18`, borderRadius: 6,
                  paddingHorizontal: 7, paddingVertical: 2,
                  borderWidth: 1, borderColor: `${cfg.color}35` }}>
                  {isActive
                    ? <ActivityIndicator size="small" color={cfg.color} style={{ transform: [{ scale: 0.5 }], width: 12, height: 12 }} />
                    : isFinished ? <CheckCircle2 size={11} color={cfg.color} />
                      : build.status === 'ERRORED' ? <XCircle size={11} color={cfg.color} />
                        : <Ban size={11} color={cfg.color} />}
                  <Text style={{ color: cfg.color, fontSize: 10, fontWeight: '800' }}>{cfg.label}</Text>
                </View>
                {isPublished && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                    backgroundColor: 'rgba(52,211,153,0.12)', borderRadius: 5,
                    paddingHorizontal: 6, paddingVertical: 2,
                    borderWidth: 1, borderColor: 'rgba(52,211,153,0.28)' }}>
                    <PackageOpen size={10} color="#34D399" />
                    <Text style={{ color: '#34D399', fontSize: 9, fontWeight: '800' }}>已发布</Text>
                  </View>
                )}
                <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, marginLeft: 'auto' as never }}>
                  {timeAgo(build.createdAt)}
                </Text>
              </View>
              {/* 版本号 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text style={{ color: '#F1F5F9', fontSize: 15, fontWeight: '800' }}>v{build.appVersion}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>·</Text>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' }}>
                  {shortId(build.id)}
                </Text>
                <View style={{ backgroundColor: 'rgba(99,102,241,0.18)', borderRadius: 4,
                  paddingHorizontal: 5, paddingVertical: 1 }}>
                  <Text style={{ color: '#A5B4FC', fontSize: 9, fontWeight: '700' }}>{build.buildProfile}</Text>
                </View>
              </View>
              {/* commit */}
              {!!build.gitCommitMessage && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5 }}>
                  <GitCommit size={10} color="rgba(255,255,255,0.25)" style={{ marginTop: 1 } as never} />
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, flex: 1 }} numberOfLines={1}>
                    {build.gitCommitMessage}
                  </Text>
                </View>
              )}
              {/* 错误 */}
              {!!build.error && (
                <View style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 7, padding: 7,
                  flexDirection: 'row', gap: 5 }}>
                  <XCircle size={11} color="#F87171" style={{ marginTop: 1 } as never} />
                  <Text style={{ color: '#FCA5A5', fontSize: 11, flex: 1 }} numberOfLines={2}>{build.error.message}</Text>
                </View>
              )}
              {/* 按钮区 */}
              <View style={{ flexDirection: 'row', gap: 7, marginTop: 2 }}>
                {isFinished && !isPublished && (
                  <Pressable onPress={() => setPublishBuild(build)}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                      backgroundColor: '#1D4ED8', borderRadius: 9, paddingVertical: 9,
                      borderWidth: 1, borderColor: 'rgba(96,165,250,0.4)' }}>
                    <PackageOpen size={13} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>一键发布</Text>
                    <ChevronRight size={11} color="rgba(255,255,255,0.5)" />
                  </Pressable>
                )}
                {isFinished && isPublished && (
                  <Pressable
                    onPress={() => onDeleteVersion(publishedVersionId!, `v${build.appVersion}`,
                      () => setLocalPublished(prev => { const m = new Map(prev); m.delete(build.id); return m; }))}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 9, paddingVertical: 9,
                      borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
                    <Trash2 size={13} color="#F87171" />
                    <Text style={{ color: '#F87171', fontSize: 12, fontWeight: '700' }}>撤销发布</Text>
                  </Pressable>
                )}
                {isActive && (
                  <Pressable onPress={() => setDeleteBuild(build)}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 9, paddingVertical: 9,
                      borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
                    <Trash2 size={13} color="#F87171" />
                    <Text style={{ color: '#F87171', fontSize: 12, fontWeight: '700' }}>取消构建</Text>
                  </Pressable>
                )}
                {!!apkUrl && isFinished && (
                  <Pressable
                    onPress={async () => { const { openBrowserAsync } = await import('expo-web-browser'); await openBrowserAsync(apkUrl); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 9, paddingHorizontal: 10,
                      paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <Download size={13} color="#94A3B8" />
                  </Pressable>
                )}
                {/* 删除按钮（完成/失败/取消状态） */}
                {!isActive && (
                  <Pressable onPress={() => setDeleteBuild(build)}
                    style={{ width: 38, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: 'rgba(239,68,68,0.07)', borderRadius: 9,
                      borderWidth: 1, borderColor: 'rgba(239,68,68,0.18)' }}>
                    <Trash2 size={14} color="#EF4444" />
                  </Pressable>
                )}
              </View>
            </LinearGradient>
          </View>
        );
      })}

      {/* 发布弹窗 */}
      {publishBuild && (
        <PublishSheet
          build={publishBuild}
          onClose={() => setPublishBuild(null)}
          onPublished={(versionId) => {
            const apk = publishBuild.artifacts?.buildUrl ?? publishBuild.artifacts?.applicationArchiveUrl ?? '';
            setLocalPublished(prev => new Map(prev).set(publishBuild.id, versionId));
            onPublished(publishBuild.id, apk, versionId);
            setPublishBuild(null);
          }}
        />
      )}
    </ScrollView>

    {/* 删除/取消构建确认弹窗 */}
    <ConfirmModal
      visible={!!deleteBuild}
      title={['IN_PROGRESS','IN_QUEUE','NEW'].includes(deleteBuild?.status ?? '') ? `取消构建 v${deleteBuild?.appVersion}？` : `删除构建记录 v${deleteBuild?.appVersion}？`}
      message={['IN_PROGRESS','IN_QUEUE','NEW'].includes(deleteBuild?.status ?? '')
        ? '构建将被中止，EAS 上的构建任务也会取消。确认继续？'
        : '将从本地记录中移除此构建条目。EAS 上的构建产物不受影响。'}
      confirmText={deleting ? '处理中…' : (['IN_PROGRESS','IN_QUEUE','NEW'].includes(deleteBuild?.status ?? '') ? '取消构建' : '删除记录')}
      confirmDanger
      disabled={deleting}
      onCancel={() => setDeleteBuild(null)}
      onConfirm={confirmDeleteBuild}
    />
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// ── 通用确认弹窗（内联实现，避免AlertDialog Text渲染问题）
// ════════════════════════════════════════════════════════════════
function ConfirmModal({ visible, title, message, confirmText, confirmDanger, disabled, onCancel, onConfirm }: {
  visible: boolean; title: string; message: string;
  confirmText: string; confirmDanger?: boolean; disabled?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  if (!visible) return null;
  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'center', alignItems: 'center', padding: 20 } as never}>
      <LinearGradient colors={['#1E293B', '#0F172A']}
        style={{ borderRadius: 18, padding: 22, width: '100%', maxWidth: 340, gap: 12,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
        <Text style={{ color: '#94A3B8', fontSize: 13, lineHeight: 20, textAlign: 'center' }}>{message}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <Pressable onPress={onCancel}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 11,
              backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 11,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
            <Text style={{ color: '#94A3B8', fontSize: 14, fontWeight: '700' }}>取消</Text>
          </Pressable>
          <Pressable onPress={onConfirm} disabled={disabled}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 11,
              backgroundColor: confirmDanger ? 'rgba(239,68,68,0.85)' : '#1D4ED8', borderRadius: 11,
              opacity: disabled ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{confirmText}</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// ── Tab 2: 已发布版本 ──────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
function VersionsTab({ versions, loading, error, onDelete }: {
  versions: AppVersion[];
  loading: boolean;
  error: string;
  onDelete: (item: AppVersion) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      {loading && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ActivityIndicator color="#3B82F6" size="large" />
          <Text style={{ color: '#475569', fontSize: 13 }}>加载中…</Text>
        </View>
      )}
      {!loading && !!error && (
        <View style={{ margin: 16, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12,
          borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <AlertCircle size={14} color="#F87171" />
          <Text style={{ color: '#F87171', fontSize: 13, flex: 1 }}>{error}</Text>
        </View>
      )}
      {!loading && !error && versions.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <PackageOpen size={40} color="#1E3A5F" />
          <Text style={{ color: '#334155', fontSize: 15, fontWeight: '600' }}>暂无发布记录</Text>
          <Text style={{ color: '#1E3A5F', fontSize: 12 }}>在「构建中心」一键发布版本</Text>
        </View>
      )}
      {!loading && versions.length > 0 && (
        <FlatList
          data={versions}
          keyExtractor={item => item.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 60, gap: 10 }}
          renderItem={({ item, index }) => (
            <View style={{
              backgroundColor: index === 0 ? 'rgba(29,78,216,0.15)' : 'rgba(255,255,255,0.04)',
              borderRadius: 14, padding: 14,
              borderWidth: 1,
              borderColor: index === 0 ? 'rgba(96,165,250,0.32)' : 'rgba(255,255,255,0.07)',
            }}>
              {/* 头行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                {index === 0 && (
                  <View style={{ backgroundColor: '#1D4ED8', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>最新</Text>
                  </View>
                )}
                <Text style={{ color: '#F1F5F9', fontSize: 16, fontWeight: '800', flex: 1 }}>
                  v{item.version_name}
                </Text>
                {item.is_force && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                    backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                    <ShieldAlert size={10} color="#F87171" />
                    <Text style={{ color: '#F87171', fontSize: 9, fontWeight: '700' }}>强制</Text>
                  </View>
                )}
              </View>
              {/* 元信息 */}
              <View style={{ flexDirection: 'row', gap: 14, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Hash size={10} color="#475569" />
                  <Text style={{ color: '#64748B', fontSize: 11 }}>#{item.version_code}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Calendar size={10} color="#475569" />
                  <Text style={{ color: '#64748B', fontSize: 11 }}>{formatDate(item.created_at)}</Text>
                </View>
              </View>
              {/* 更新内容 */}
              <View style={{ flexDirection: 'row', gap: 5, marginBottom: 12, alignItems: 'flex-start' }}>
                <FileText size={11} color="#475569" style={{ marginTop: 2 } as never} />
                <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 19, flex: 1 }} numberOfLines={3}>
                  {item.release_notes}
                </Text>
              </View>
              {/* 操作 */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => Linking.openURL(item.apk_url)}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                    backgroundColor: 'rgba(59,130,246,0.10)', borderRadius: 9, paddingVertical: 9,
                    borderWidth: 1, borderColor: 'rgba(96,165,250,0.22)' }}>
                  <Download size={13} color="#60A5FA" />
                  <Text style={{ color: '#60A5FA', fontSize: 12, fontWeight: '700' }}>下载 APK</Text>
                </Pressable>
                <Pressable onPress={() => onDelete(item)}
                  style={{ width: 42, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(239,68,68,0.07)', borderRadius: 9,
                    borderWidth: 1, borderColor: 'rgba(239,68,68,0.18)' }}>
                  <Trash2 size={14} color="#EF4444" />
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// ── 根组件 ────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
export default function VersionHubScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('builds');

  // 已发布版本（Tab2 + Tab1 共享）
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string; cb?: () => void } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // apkUrl → versionId 映射（供构建中心判断已发布）
  const publishedMap = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const v of versions) m.set(v.apk_url, v.id);
    return m;
  }, [versions]);

  const fetchVersions = useCallback(async () => {
    setVersionsLoading(true); setVersionsError('');
    const { data, error } = await supabase.from('app_versions').select('*').order('version_code', { ascending: false });
    if (error) setVersionsError('加载失败：' + error.message);
    else setVersions(data ?? []);
    setVersionsLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { (async () => { await fetchVersions(); })(); }, [fetchVersions]));

  const handleDeleteVersion = async (id: string, label: string, cb?: () => void) => {
    setDeleteTarget({ id, label, cb });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('app_versions').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (!error) {
      setVersions(prev => prev.filter(v => v.id !== deleteTarget.id));
      deleteTarget.cb?.();
    }
    setDeleteTarget(null);
  };

  const TAB_ICONS: Record<Tab, React.ReactNode> = {
    builds:   <Hammer size={13} color="currentColor" />,
    versions: <ListChecks size={13} color="currentColor" />,
  };
  const TAB_LABELS: Record<Tab, string> = {
    builds: '构建中心', versions: '已发布',
  };

  return (
    <LinearGradient colors={['#0A1628', '#0D2147', '#0A1E3D']} style={{ flex: 1 }}>
      {/* 顶部栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}
          style={{ width: 34, height: 34, borderRadius: 9,
            backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          <ArrowLeft size={16} color="#94A3B8" />
        </Pressable>
        <Text style={{ color: '#F1F5F9', fontSize: 17, fontWeight: '800', flex: 1 }}>版本管理中心</Text>
        {tab === 'versions' && (
          <View style={{ backgroundColor: 'rgba(59,130,246,0.14)', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#60A5FA', fontSize: 11, fontWeight: '700' }}>{versions.length} 个版本</Text>
          </View>
        )}
      </View>

      {/* Tab 切换器 */}
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 10,
        backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        {(['builds', 'versions'] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <Pressable key={t} onPress={() => setTab(t)}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 5, paddingVertical: 10,
                backgroundColor: active ? 'rgba(29,78,216,0.55)' : 'transparent',
                borderRadius: active ? 11 : 0,
              }}>
              {TAB_ICONS[t]}
              <Text style={{ color: active ? '#fff' : '#475569', fontSize: 12, fontWeight: active ? '800' : '500' }}>
                {TAB_LABELS[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab 内容 */}
      <View style={{ flex: 1 }}>
        {tab === 'builds' && (
          <BuildsTab
            publishedMap={publishedMap}
            onPublished={(_buildId, _apkUrl, _versionId) => { void fetchVersions(); }}
            onDeleteVersion={(versionId, label, cb) => handleDeleteVersion(versionId, label, cb)}
          />
        )}
        {tab === 'versions' && (
          <VersionsTab
            versions={versions} loading={versionsLoading} error={versionsError}
            onDelete={(item) => handleDeleteVersion(item.id, `v${item.version_name}`)}
          />
        )}
      </View>

      {/* 删除已发布版本确认弹窗 */}
      <ConfirmModal
        visible={!!deleteTarget}
        title={`删除版本 ${deleteTarget?.label}？`}
        message="删除后版本记录将永久移除，用户不再收到该版本更新提示。此操作不可撤销。"
        confirmText={deleting ? '删除中…' : '确认删除'}
        confirmDanger
        disabled={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </LinearGradient>
  );
}
