/**
 * 版本管理中心 — 二合一：构建中心 / 已发布版本
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, FlatList,
  ActivityIndicator, TextInput, Linking, RefreshControl, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, Hammer, PackageOpen, ListChecks,
  CheckCircle2, XCircle,
  Download, GitCommit, ChevronRight, Ban,
  Trash2, ShieldAlert, Calendar, Hash, FileText, AlertCircle, RefreshCw,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { CURRENT_VERSION_CODE, useApkUpdate } from '@/hooks/useApkUpdate';

const HIDDEN_RUNS_KEY = '@version_hub:hidden_runs';

type Tab = 'builds' | 'versions';

interface AppVersion {
  id: string;
  version_name: string;
  version_code: number;
  apk_url: string;
  release_notes: string;
  is_force: boolean;
  published: boolean;
  created_at: string;
}

// GitHub Actions 实时构建记录（来自 github-builds Edge Function）
interface GithubRun {
  id: string;
  runNumber: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | null;
  createdAt: string;
  updatedAt: string;
  headCommit: string;
  htmlUrl: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

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


// ════════════════════════════════════════════════════════════════
// ── Tab 1: 构建中心 ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
function BuildsTab({ publishedMap, onPublished, onDeleteVersion }: {
  publishedMap: Map<string, string>; // apkUrl → versionId
  onPublished: (buildId: string, apkUrl: string, versionId: string) => void;
  onDeleteVersion: (versionId: string, label: string, cb: () => void) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [localPublished, setLocalPublished] = useState<Map<string, string>>(new Map());
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<string>>(new Set());
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // GitHub Actions DB 记录（已完成构建）
  const [ghBuilds, setGhBuilds]   = useState<AppVersion[]>([]);
  const [ghLoading, setGhLoading] = useState(false);
  // GitHub Actions 实时 runs（live 状态轮询）
  const [ghRuns, setGhRuns]       = useState<GithubRun[]>([]);
  const [ghRunsLoading, setGhRunsLoading] = useState(false);
  // 正在发布的版本 ID（防重复点击）
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // 加载已隐藏的 GitHub Actions run ID
  useEffect(() => {
    (async () => {
      try {
        const rawRuns = await AsyncStorage.getItem(HIDDEN_RUNS_KEY);
        if (rawRuns) setHiddenRunIds(new Set(JSON.parse(rawRuns)));
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchGhBuilds = useCallback(async () => {
    setGhLoading(true);
    // 同时支持 GitHub Release URL 和 Supabase Storage URL（新构建）
    const { data } = await supabase
      .from('app_versions')
      .select('*')
      .not('apk_url', 'is', null)
      .neq('apk_url', '')
      .order('version_code', { ascending: false })
      .limit(15);
    setGhBuilds(data ?? []);
    setGhLoading(false);
  }, []);

  const fetchGhRuns = useCallback(async () => {
    setGhRunsLoading(true);
    try {
      const { data } = await supabase.functions.invoke('github-builds');
      setGhRuns(data?.runs ?? []);
    } catch { /* 静默失败 */ }
    finally { setGhRunsLoading(false); }
  }, []);

  // 有进行中的 run 时每 30 秒自动轮询
  const hasActiveRun = ghRuns.some(r => r.status === 'in_progress' || r.status === 'queued');
  useEffect(() => {
    if (!hasActiveRun) return;
    const timer = setInterval(() => { void fetchGhRuns(); void fetchGhBuilds(); }, 30000);
    return () => clearInterval(timer);
  }, [hasActiveRun, fetchGhRuns, fetchGhBuilds]);

  // 一键发布：设 published=true，所有账号下次启动即弹更新弹窗
  const publishGhBuild = useCallback(async (versionId: string) => {
    setPublishingId(versionId);
    try {
      await supabase.from('app_versions').update({ published: true }).eq('id', versionId);
      await fetchGhBuilds();
    } finally { setPublishingId(null); }
  }, [fetchGhBuilds]);

  useFocusEffect(useCallback(() => { (async () => { await Promise.all([fetchGhBuilds(), fetchGhRuns()]); })(); }, [fetchGhBuilds, fetchGhRuns]));

  // 隐藏 GitHub Actions run（本地 + 可选删 DB 中对应记录）
  const hideRun = useCallback(async (runId: string, matchedDbId?: string) => {
    const next = new Set([...hiddenRunIds, runId]);
    setHiddenRunIds(next);
    await AsyncStorage.setItem(HIDDEN_RUNS_KEY, JSON.stringify([...next])).catch(() => {});
    if (matchedDbId) {
      try { await supabase.from('app_versions').delete().eq('id', matchedDbId); } catch { /* ignore */ }
      setGhBuilds(prev => prev.filter(b => String(b.id) !== matchedDbId));
    }
  }, [hiddenRunIds]);

  // 触发新 GitHub Actions 构建
  const triggerBuild = useCallback(async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('github-builds', {
        body: { action: 'trigger', ref: 'main' },
      });
      if (fnErr || data?.error) {
        setTriggerMsg({ ok: false, text: data?.error ?? fnErr?.message ?? '触发失败' });
      } else {
        setTriggerMsg({ ok: true, text: '已提交构建任务，约 1 分钟后出现在列表' });
        // 3 秒后刷新 runs
        setTimeout(() => { void fetchGhRuns(); }, 3000);
      }
    } catch (e: unknown) {
      setTriggerMsg({ ok: false, text: String(e) });
    } finally {
      setTriggering(false);
    }
  }, [fetchGhRuns]);

  const visibleRuns = ghRuns.filter(r => !hiddenRunIds.has(String(r.id)));

  return (
    <>
    <ScrollView contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={loading || ghLoading || ghRunsLoading} onRefresh={() => { void fetchGhBuilds(); void fetchGhRuns(); }} tintColor="#FBBF24" />}>

      {/* ── GitHub Actions 构建区 ───────────────────────── */}
      <View style={{ gap: 6 }}>
        {/* 标题行 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
          <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: '#34D399' }} />
          <Text style={{ color: '#34D399', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>
            GITHUB ACTIONS 构建
          </Text>
          {(ghRunsLoading || ghLoading) && (
            <ActivityIndicator size="small" color="#34D399" style={{ transform: [{ scale: 0.7 }] } as never} />
          )}
          {hasActiveRun && (
            <View style={{ backgroundColor: 'rgba(251,191,36,0.18)', borderRadius: 6,
              paddingHorizontal: 7, paddingVertical: 2, marginLeft: 'auto' as never,
              flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ActivityIndicator size="small" color="#FBBF24" style={{ transform: [{ scale: 0.55 }], width: 10, height: 10 }} />
              <Text style={{ color: '#FBBF24', fontSize: 9, fontWeight: '800' }}>构建中 · 30s 自动刷新</Text>
            </View>
          )}
        </View>

        {/* 触发新构建按钮 */}
        <Pressable
          onPress={triggerBuild}
          disabled={triggering || hasActiveRun}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
            backgroundColor: triggering || hasActiveRun ? 'rgba(52,211,153,0.07)' : 'rgba(52,211,153,0.18)',
            borderRadius: 11, paddingVertical: 11,
            borderWidth: 1.5, borderColor: triggering || hasActiveRun ? 'rgba(52,211,153,0.2)' : 'rgba(52,211,153,0.5)',
            opacity: triggering || hasActiveRun ? 0.6 : 1 }}>
          {triggering
            ? <ActivityIndicator size="small" color="#34D399" />
            : <Hammer size={14} color="#34D399" />}
          <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '800' }}>
            {triggering ? '提交中…' : hasActiveRun ? '构建中，请等待完成' : '触发新构建'}
          </Text>
        </Pressable>

        {/* 触发结果提示 */}
        {triggerMsg && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: triggerMsg.ok ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)',
            borderRadius: 10, padding: 10,
            borderWidth: 1, borderColor: triggerMsg.ok ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)' }}>
            {triggerMsg.ok
              ? <CheckCircle2 size={13} color="#34D399" />
              : <XCircle size={13} color="#F87171" />}
            <Text style={{ color: triggerMsg.ok ? '#6EE7B7' : '#FCA5A5', fontSize: 12, flex: 1 }}>
              {triggerMsg.text}
            </Text>
            <Pressable onPress={() => setTriggerMsg(null)} hitSlop={8}>
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>×</Text>
            </Pressable>
          </View>
        )}

        {/* ── 实时 runs（来自 GitHub API）── */}
        {visibleRuns.slice(0, 5).map((run) => {
          const isActive  = run.status === 'in_progress' || run.status === 'queued';
          const isSuccess = run.status === 'completed' && run.conclusion === 'success';
          const isFail    = run.status === 'completed' && (run.conclusion === 'failure' || run.conclusion === 'timed_out');
          const isCancelled = run.status === 'completed' && run.conclusion === 'cancelled';
          const statusColor = isActive ? '#FBBF24' : isSuccess ? '#34D399' : isFail ? '#F87171' : '#64748B';
          const statusLabel = isActive
            ? (run.status === 'queued' ? '排队中' : '构建中')
            : isSuccess ? '构建成功' : isFail ? '构建失败' : '已取消';

          // 匹配 DB 中对应记录（按时间最近的同状态 success）
          const matchedDb = isSuccess
            ? ghBuilds.find(b => {
                const diff = Math.abs(new Date(b.created_at).getTime() - new Date(run.updatedAt).getTime());
                return diff < 4 * 60 * 60 * 1000; // 4小时内创建的视为同次构建
              })
            : null;

          return (
            <View key={run.id} style={{ borderRadius: 13, overflow: 'hidden',
              borderWidth: 1,
              borderColor: isActive ? 'rgba(251,191,36,0.45)' : isSuccess ? 'rgba(52,211,153,0.32)' : 'rgba(255,255,255,0.07)' }}>
              <LinearGradient
                colors={isActive
                  ? ['rgba(120,85,8,0.40)', 'rgba(28,16,2,0.65)']
                  : isSuccess ? ['rgba(16,185,129,0.12)', 'rgba(5,46,22,0.50)']
                  : ['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.18)']}
                style={{ padding: 12, gap: 7 }}>
                {/* 顶行 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: `${statusColor}18`, borderRadius: 6,
                    paddingHorizontal: 7, paddingVertical: 2,
                    borderWidth: 1, borderColor: `${statusColor}38` }}>
                    {isActive
                      ? <ActivityIndicator size="small" color={statusColor} style={{ transform: [{ scale: 0.5 }], width: 12, height: 12 }} />
                      : isSuccess ? <CheckCircle2 size={11} color={statusColor} />
                      : isFail ? <XCircle size={11} color={statusColor} />
                      : <Ban size={11} color={statusColor} />}
                    <Text style={{ color: statusColor, fontSize: 10, fontWeight: '800' }}>{statusLabel}</Text>
                  </View>
                  {/* 已发布徽章 */}
                  {matchedDb?.published && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                      backgroundColor: 'rgba(52,211,153,0.12)', borderRadius: 5,
                      paddingHorizontal: 6, paddingVertical: 2,
                      borderWidth: 1, borderColor: 'rgba(52,211,153,0.28)' }}>
                      <PackageOpen size={10} color="#34D399" />
                      <Text style={{ color: '#34D399', fontSize: 9, fontWeight: '800' }}>已发布</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>
                    Run #{run.runNumber} · {timeAgo(run.createdAt)}
                  </Text>
                </View>
                {/* commit 消息 */}
                {!!run.headCommit && (
                  <View style={{ flexDirection: 'row', gap: 5, alignItems: 'flex-start' }}>
                    <GitCommit size={10} color="rgba(255,255,255,0.25)" style={{ marginTop: 1 } as never} />
                    <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 11, flex: 1 }} numberOfLines={2}>
                      {run.headCommit}
                    </Text>
                  </View>
                )}
                {/* 版本信息（若 DB 有匹配记录） */}
                {matchedDb && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text style={{ color: '#F1F5F9', fontSize: 14, fontWeight: '800' }}>v{matchedDb.version_name}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>·</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>#{matchedDb.version_code}</Text>
                    <View style={{ backgroundColor: 'rgba(52,211,153,0.12)', borderRadius: 4,
                      paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ color: '#6EE7B7', fontSize: 9, fontWeight: '700' }}>GitHub Actions</Text>
                    </View>
                  </View>
                )}
                {/* 按钮区 */}
                <View style={{ flexDirection: 'row', gap: 7, marginTop: 2 }}>
                  {/* 一键发布（成功且未发布时显示） */}
                  {isSuccess && matchedDb && !matchedDb.published && (
                    <Pressable
                      onPress={() => publishGhBuild(String(matchedDb.id))}
                      disabled={publishingId === String(matchedDb.id)}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                        backgroundColor: publishingId === String(matchedDb.id) ? 'rgba(52,211,153,0.08)' : 'rgba(52,211,153,0.22)',
                        borderRadius: 9, paddingVertical: 9,
                        borderWidth: 1.5, borderColor: 'rgba(52,211,153,0.55)' }}>
                      {publishingId === String(matchedDb.id)
                        ? <ActivityIndicator size="small" color="#34D399" />
                        : <><PackageOpen size={13} color="#34D399" /><Text style={{ color: '#34D399', fontSize: 12, fontWeight: '800' }}>一键发布</Text></>}
                    </Pressable>
                  )}
                  {/* 下载 */}
                  {isSuccess && matchedDb && (
                    <Pressable onPress={() => Linking.openURL(matchedDb.apk_url)}
                      style={{ flex: matchedDb.published ? 1 : 0, width: matchedDb.published ? undefined : 42,
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                        backgroundColor: 'rgba(52,211,153,0.10)', borderRadius: 9, paddingVertical: 9,
                        borderWidth: 1, borderColor: 'rgba(52,211,153,0.22)' }}>
                      <Download size={13} color="#34D399" />
                      {matchedDb.published && <Text style={{ color: '#34D399', fontSize: 12, fontWeight: '700' }}>下载 APK</Text>}
                    </Pressable>
                  )}
                  {/* 查看 GitHub */}
                  <Pressable onPress={() => Linking.openURL(run.htmlUrl)}
                    style={{ width: 42, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 9,
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}>
                    <ChevronRight size={14} color="rgba(255,255,255,0.35)" />
                  </Pressable>
                </View>
                {/* 删除按钮 — 全宽 */}
                <Pressable
                  onPress={() => hideRun(String(run.id), matchedDb ? String(matchedDb.id) : undefined)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, borderRadius: 9, paddingVertical: 9, marginTop: 2,
                    backgroundColor: 'rgba(239,68,68,0.08)',
                    borderWidth: 1, borderColor: 'rgba(239,68,68,0.22)' }}>
                  <Trash2 size={13} color="#F87171" />
                  <Text style={{ color: '#F87171', fontSize: 12, fontWeight: '700' }}>删除此构建记录</Text>
                </Pressable>
              </LinearGradient>
            </View>
          );
        })}

        {/* 无记录提示（runs 和 DB 都为空） */}
        {!ghRunsLoading && !ghLoading && ghRuns.length === 0 && ghBuilds.length === 0 && (
          <View style={{ backgroundColor: 'rgba(52,211,153,0.05)', borderRadius: 11, padding: 12,
            borderWidth: 1, borderColor: 'rgba(52,211,153,0.15)', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: 'rgba(52,211,153,0.4)', fontSize: 12 }}>暂无 GitHub Actions 构建记录</Text>
          </View>
        )}

        {/* DB 中有但 runs API 未涵盖的旧记录（仅补充显示，不重复） */}
        {ghBuilds
          .filter(item => {
            // 过滤掉已在 runs 中通过时间匹配展示过的记录
            return !ghRuns.some(r => {
              const diff = Math.abs(new Date(item.created_at).getTime() - new Date(r.updatedAt).getTime());
              return r.status === 'completed' && r.conclusion === 'success' && diff < 4 * 60 * 60 * 1000;
            });
          })
          .map((item) => (
            <View key={item.id} style={{ borderRadius: 13, overflow: 'hidden',
              borderWidth: 1, borderColor: item.published ? 'rgba(52,211,153,0.32)' : 'rgba(52,211,153,0.14)' }}>
              <LinearGradient
                colors={['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.18)']}
                style={{ padding: 12, gap: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: 'rgba(52,211,153,0.1)', borderRadius: 6,
                    paddingHorizontal: 7, paddingVertical: 2,
                    borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)' }}>
                    <CheckCircle2 size={11} color="#34D399" />
                    <Text style={{ color: '#34D399', fontSize: 10, fontWeight: '800' }}>构建成功</Text>
                  </View>
                  {item.published && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                      backgroundColor: 'rgba(52,211,153,0.12)', borderRadius: 5,
                      paddingHorizontal: 6, paddingVertical: 2,
                      borderWidth: 1, borderColor: 'rgba(52,211,153,0.28)' }}>
                      <PackageOpen size={10} color="#34D399" />
                      <Text style={{ color: '#34D399', fontSize: 9, fontWeight: '800' }}>已发布</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>{timeAgo(item.created_at)}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={{ color: '#F1F5F9', fontSize: 14, fontWeight: '800' }}>v{item.version_name}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>·</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>#{item.version_code}</Text>
                  <View style={{ backgroundColor: 'rgba(52,211,153,0.12)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: '#6EE7B7', fontSize: 9, fontWeight: '700' }}>GitHub Actions</Text>
                  </View>
                </View>
                {!!item.release_notes && (
                  <View style={{ flexDirection: 'row', gap: 5, alignItems: 'flex-start' }}>
                    <GitCommit size={10} color="rgba(255,255,255,0.25)" style={{ marginTop: 1 } as never} />
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, flex: 1 }} numberOfLines={1}>{item.release_notes}</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 7, marginTop: 2 }}>
                  {/* 未发布时显示一键发布 */}
                  {!item.published && (
                    <Pressable onPress={() => publishGhBuild(String(item.id))}
                      disabled={publishingId === String(item.id)}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                        backgroundColor: publishingId === String(item.id) ? 'rgba(52,211,153,0.08)' : 'rgba(52,211,153,0.22)',
                        borderRadius: 9, paddingVertical: 9,
                        borderWidth: 1.5, borderColor: 'rgba(52,211,153,0.55)' }}>
                      {publishingId === String(item.id)
                        ? <ActivityIndicator size="small" color="#34D399" />
                        : <><PackageOpen size={13} color="#34D399" /><Text style={{ color: '#34D399', fontSize: 12, fontWeight: '800' }}>一键发布</Text></>}
                    </Pressable>
                  )}
                  <Pressable onPress={() => Linking.openURL(item.apk_url)}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                      backgroundColor: 'rgba(52,211,153,0.10)', borderRadius: 9, paddingVertical: 9,
                      borderWidth: 1, borderColor: 'rgba(52,211,153,0.22)' }}>
                    <Download size={13} color="#34D399" />
                    <Text style={{ color: '#34D399', fontSize: 12, fontWeight: '700' }}>下载 APK</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteVersion(String(item.id), `v${item.version_name}`, () => setGhBuilds(prev => prev.filter(b => b.id !== item.id)))}
                    style={{ width: 38, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: 'rgba(239,68,68,0.07)', borderRadius: 9,
                      borderWidth: 1, borderColor: 'rgba(239,68,68,0.18)' }}>
                    <Trash2 size={14} color="#EF4444" />
                  </Pressable>
                </View>
              </LinearGradient>
            </View>
          ))}
      </View>

    </ScrollView>
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
  const update = useApkUpdate(false);
  const [checking, setChecking] = useState(false);

  const handleCheckNow = async () => {
    setChecking(true);
    await update.checkNow();
    setTimeout(() => setChecking(false), 1500);
  };

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

      {/* 当前版本 + 检查更新 */}
      <View style={{ marginHorizontal: 16, marginBottom: 10, flexDirection: 'row',
        alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Text style={{ color: '#475569', fontSize: 12, flex: 1 }}>
          当前版本：<Text style={{ color: '#94A3B8', fontWeight: '700' }}>
            {CURRENT_VERSION_CODE}
          </Text>
          {Platform.OS !== 'android' && (
            <Text style={{ color: '#475569' }}>（仅 Android 检测更新）</Text>
          )}
        </Text>
        <Pressable onPress={handleCheckNow} disabled={checking}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
            backgroundColor: 'rgba(59,130,246,0.12)', borderRadius: 7,
            paddingHorizontal: 10, paddingVertical: 5,
            borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)', opacity: checking ? 0.6 : 1 }}>
          <RefreshCw size={11} color="#60A5FA" />
          <Text style={{ color: '#60A5FA', fontSize: 11, fontWeight: '700' }}>
            {checking ? '检测中…' : '立即检查'}
          </Text>
        </Pressable>
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
