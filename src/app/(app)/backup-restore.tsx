import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Share,
  Platform,
  RefreshControl,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  documentDirectory,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import {
  ArrowLeft,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Database,
  Layers,
  RefreshCw,
  Shield,
  Bell,
  History,
  XCircle,
  Zap,
  CloudDownload,
  Trash2,
  Cloud,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';

// ── 备份包类型 ──────────────────────────────────────────────────────────────
interface BackupStats {
  gasoline: number;
  diesel: number;
  lng: number;
  employees: number;
  oil_prices?: number;
  total: number;
}
interface BackupPackage {
  version: number;
  created_at: string;
  storage_path?: string | null;
  tables: {
    gasoline_vehicles: unknown[];
    diesel_vehicles: unknown[];
    lng_vehicles: unknown[];
    employees: unknown[];
  };
  stats: BackupStats;
}

// 备份历史记录（自动备份 cron）
interface BackupRecord {
  id: number;
  created_at: string;
  triggered_by: string;
  stats: BackupStats;
  status: 'success' | 'failed';
}

// Storage 中的备份文件信息
interface StorageBackupItem {
  name: string;           // 文件名，如 vehicle_backup_2025-01-15T14-00-00Z.json
  created_at: string;     // ISO 时间字符串
  size: number;
  metadata?: { size?: number };
}

// ── 格式化备份时间 ──────────────────────────────────────────────────────────
function formatDate(iso: string) {
  // 2000-01-01 是占位符初始值，说明从未成功更新
  if (!iso || iso.startsWith('2000-01-01')) return '等待刷新';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function BackupRestorePage() {
  const router = useRouter();
  const { session } = useSession();
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

  // ── 状态 ───────────────────────────────────────────────────────────────────
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  // 清空成功后自动弹出恢复选择框
  const [showRestoreAfterReset, setShowRestoreAfterReset] = useState(false);
  const [lastBackup, setLastBackup] = useState<BackupPackage | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  // 云端备份列表
  const [cloudBackups, setCloudBackups] = useState<StorageBackupItem[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  // 待恢复的云端备份（确认弹窗用）
  const [pendingRestore, setPendingRestore] = useState<StorageBackupItem | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);

  // ── 通用请求头 ─────────────────────────────────────────────────────────────
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${supabaseKey}`,
    apikey: supabaseKey,
  };

  // ── 生成备份（调 EF → 上传 Storage → 可选本地下载）────────────────────────
  const handleBackup = useCallback(async () => {
    setBackupLoading(true);
    setStatus(null);
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/data-backup`, {
        method: 'POST',
        headers,
      });
      const data: BackupPackage & { error?: string } = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? '备份失败');

      setLastBackup(data);
      // 刷新云端备份列表
      await loadCloudBackups();

      const json = JSON.stringify(data, null, 2);
      const filename = `vehicle_backup_${new Date().toISOString().slice(0, 10)}.json`;

      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus({ type: 'success', msg: `备份成功！已保存至云端并下载到本地。车辆 ${data.stats.total} 辆，员工账号 ${data.stats.employees} 个，油价 ${data.stats.oil_prices ?? 0} 条` });
      } else {
        const path = `${documentDirectory}${filename}`;
        await writeAsStringAsync(path, json, { encoding: 'utf8' });
        await Share.share({ url: path, title: filename, message: `车辆信息备份文件 ${filename}` });
        setStatus({ type: 'success', msg: `备份成功！已保存至云端。车辆 ${data.stats.total} 辆，员工账号 ${data.stats.employees} 个，油价 ${data.stats.oil_prices ?? 0} 条` });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : '备份失败，请重试' });
    } finally {
      setBackupLoading(false);
    }
  }, [supabaseUrl, supabaseKey]);

  // ── 加载云端备份列表（最多显示2条：自动备份+手动备份各1条最新）────────────
  const loadCloudBackups = useCallback(async () => {
    setCloudLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('vehicle-backups')
        .list('', { limit: 50, offset: 0, sortBy: { column: 'updated_at', order: 'desc' } });
      if (error) throw error;
      const items = (data ?? [])
        .filter((f) => f.name.endsWith('.json'))
        .map((f) => ({
          name: f.name,
          // updated_at 在 upsert 覆盖后会更新，反映最新备份时间
          created_at: (f as { updated_at?: string }).updated_at ?? f.created_at ?? new Date().toISOString(),
          size: (f.metadata as { size?: number } | null)?.size ?? 0,
          metadata: f.metadata as { size?: number } | undefined,
        })) as StorageBackupItem[];
      // 只保留 auto_backup.json 和 manual_backup.json 各最新一条，按时间降序排列
      const autoItem = items.find((f) => f.name === 'auto_backup.json');
      const manualItem = items.find((f) => f.name === 'manual_backup.json');
      const result: StorageBackupItem[] = [];
      if (autoItem && manualItem) {
        // 两者都存在：最新的排第一
        result.push(
          new Date(autoItem.created_at) > new Date(manualItem.created_at) ? autoItem : manualItem,
          new Date(autoItem.created_at) > new Date(manualItem.created_at) ? manualItem : autoItem,
        );
      } else if (autoItem) {
        result.push(autoItem);
      } else if (manualItem) {
        result.push(manualItem);
      }
      setCloudBackups(result);
    } catch (err) {
      setStatus({ type: 'error', msg: `云端备份列表加载失败：${err instanceof Error ? err.message : '请重试'}` });
    } finally { setCloudLoading(false); }
  }, []);

  // ── 从云端恢复（调 EF 传 storage_path）────────────────────────────────────
  const handleRestoreFromCloud = useCallback(async (item: StorageBackupItem) => {
    setPendingRestore(item);
    setConfirmVisible(true);
  }, []);

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingRestore) return;
    setConfirmVisible(false);
    setRestoreLoading(true);
    setStatus(null);
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/data-restore`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ storage_path: pendingRestore.name }),
      });
      const data: { success?: boolean; restored?: BackupStats; error?: string } = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? '恢复失败');
      const { restored } = data;
      setStatus({
        type: 'success',
        msg: `恢复成功！车辆 ${restored?.total ?? 0} 辆（汽油 ${restored?.gasoline ?? 0} / 柴油 ${restored?.diesel ?? 0} / LNG ${restored?.lng ?? 0}），员工账号 ${restored?.employees ?? 0} 个，油价 ${restored?.oil_prices ?? 0} 条`,
      });
      await loadDbStats();
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : '恢复失败，请重试' });
    } finally {
      setRestoreLoading(false);
      setPendingRestore(null);
    }
  }, [pendingRestore, supabaseUrl, supabaseKey]);

  // ── 删除云端备份文件（二次确认） ───────────────────────────────────────────
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteName) return;
    try {
      await supabase.storage.from('vehicle-backups').remove([pendingDeleteName]);
      await loadCloudBackups();
    } catch { /* 静默 */ }
    finally { setPendingDeleteName(null); }
  }, [pendingDeleteName, loadCloudBackups]);

  // ── 下载云端备份文件到本地 ─────────────────────────────────────────────────
  const [downloadingName, setDownloadingName] = useState<string | null>(null);
  const handleDownloadCloudBackup = useCallback(async (name: string) => {
    setDownloadingName(name);
    try {
      // 从 Storage 拉取文件内容
      const { data: fileData, error } = await supabase.storage
        .from('vehicle-backups')
        .download(name);
      if (error || !fileData) throw new Error(error?.message ?? '下载失败');

      const text = await fileData.text();
      // 下载文件名去掉末尾 Z，避免 Windows 文件名非法字符（:）
      const filename = name;

      if (Platform.OS === 'web') {
        // Web：触发浏览器下载
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Native：写到临时目录后用系统分享
        const path = `${documentDirectory}${filename}`;
        await writeAsStringAsync(path, text, { encoding: 'utf8' });
        await Share.share({ url: path, title: filename, message: `车辆信息备份文件 ${filename}` });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: `下载失败：${err instanceof Error ? err.message : '请重试'}` });
    } finally {
      setDownloadingName(null);
    }
  }, []);

  // ── 当前数据库统计 ─────────────────────────────────────────────────────────
  const [dbStats, setDbStats] = useState<BackupStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const loadDbStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [g, d, l, e, o] = await Promise.all([
        supabase.from('gasoline_vehicles').select('id', { count: 'exact', head: true }),
        supabase.from('diesel_vehicles').select('id', { count: 'exact', head: true }),
        supabase.from('lng_vehicles').select('id', { count: 'exact', head: true }),
        supabase.from('employees').select('id', { count: 'exact', head: true }),
        supabase.from('oil_prices').select('city', { count: 'exact', head: true }),
      ]);
      const gasCount = g.count ?? 0;
      const dieselCount = d.count ?? 0;
      const lngCount = l.count ?? 0;
      const empCount = e.count ?? 0;
      const oilCount = o.count ?? 0;
      setDbStats({ gasoline: gasCount, diesel: dieselCount, lng: lngCount, employees: empCount, oil_prices: oilCount, total: gasCount + dieselCount + lngCount });
    } catch { /* 静默失败 */ }
    finally { setStatsLoading(false); }
  }, []);

  // ── 天气缓存统计 ──────────────────────────────────────────────────────
  interface CacheStats {
    weatherFetchedAt: string | null;
    weatherCity: string | null;
    weatherTemp: string | null;
    weatherWeather: string | null;
  }
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const loadCacheStats = useCallback(async () => {
    setCacheLoading(true);
    try {
      const wRes = await supabase.from('weather_cache').select('city_name, temp, weather, fetched_at').limit(1).maybeSingle();
      setCacheStats({
        weatherFetchedAt: wRes.data?.fetched_at ?? null,
        weatherCity: wRes.data?.city_name ?? null,
        weatherTemp: wRes.data?.temp ?? null,
        weatherWeather: wRes.data?.weather ?? null,
      });
    } catch { /* 静默失败 */ }
    finally { setCacheLoading(false); }
  }, []);

  // ── 清空天气缓存 ──────────────────────────────────────────────────────────
  const [clearWeatherConfirm, setClearWeatherConfirm] = useState(false);
  const [clearWeatherLoading, setClearWeatherLoading] = useState(false);
  const handleClearWeather = useCallback(async () => {
    setClearWeatherConfirm(false);
    setClearWeatherLoading(true);
    try {
      await supabase.from('weather_cache').delete().neq('city', '');
      setStatus({ type: 'success', msg: '天气缓存已清空，下次打开首页将自动重新拉取。' });
      await loadCacheStats();
    } catch (err) {
      setStatus({ type: 'error', msg: `清空失败：${err instanceof Error ? err.message : '请重试'}` });
    } finally { setClearWeatherLoading(false); }
  }, [loadCacheStats]);

  // ── 清空并重置数据库（调 reset-database EF）──────────────────────────────
  const handleReset = useCallback(async () => {
    setResetConfirm(false);
    setResetLoading(true);
    setStatus(null);
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/reset-database`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ employee_id: session?.id }),
      });
      const data: { success?: boolean; message?: string; error?: string } = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? '清空失败');
      setStatus({ type: 'success', msg: data.message ?? '数据库已清空，请立即使用备份恢复数据。' });
      await Promise.all([loadDbStats(), loadCloudBackups()]);
      // 清空成功后自动弹出恢复选择框
      setShowRestoreAfterReset(true);
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : '清空失败，请重试' });
    } finally {
      setResetLoading(false);
    }
  }, [supabaseUrl, session?.id, loadDbStats, loadCloudBackups]);

  // ── 备份历史记录（cron 自动备份） ─────────────────────────────────────────
  const [history, setHistory] = useState<BackupRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('backup_records')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      setHistory((data ?? []) as BackupRecord[]);
    } catch { /* 静默失败 */ }
    finally { setHistoryLoading(false); }
  }, []);

  const handleClearHistory = useCallback(async () => {
    setClearHistoryConfirm(false);
    try {
      const { error } = await supabase.from('backup_records').delete().neq('id', 0);
      if (error) throw error;
      setHistory([]);
      setHistoryExpanded(false);
    } catch (err) {
      setStatus({ type: 'error', msg: `清空失败：${err instanceof Error ? err.message : '请重试'}` });
    }
  }, []);

  // ── 推送通知状态 ───────────────────────────────────────────────────────────
  const [pushRegistered, setPushRegistered] = useState(false);
  const checkPushStatus = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const { status } = await (await import('expo-notifications')).getPermissionsAsync();
      setPushRegistered(status === 'granted');
    } catch { /* 静默 */ }
  }, []);

  // ── 立即触发自动备份 ────────────────────────────────────────────────────────
  const [triggerLoading, setTriggerLoading] = useState(false);
  const handleTriggerAutoBackup = useCallback(async () => {
    setTriggerLoading(true);
    setStatus(null);
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/auto-backup-notify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ time: new Date().toISOString() }),
      });
      const data: { success?: boolean; stats?: BackupStats; error?: string } = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? '触发失败');
      setStatus({
        type: 'success',
        msg: `自动备份已触发！车辆 ${data.stats?.total ?? 0} 辆，员工账号 ${data.stats?.employees ?? 0} 个，油价 ${data.stats?.oil_prices ?? 0} 条。推送通知已发送至管理员设备。`,
      });
      await Promise.all([loadHistory(), loadCloudBackups()]);
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : '触发失败，请重试' });
    } finally {
      setTriggerLoading(false);
    }
  }, [supabaseUrl, supabaseKey, loadHistory, loadCloudBackups]);

  useEffect(() => {
    loadDbStats();
    loadHistory();
    loadCloudBackups();
    checkPushStatus();
    loadCacheStats();
  }, [loadDbStats, loadHistory, loadCloudBackups, checkPushStatus, loadCacheStats]);

  return (
    <View style={{ flex: 1, backgroundColor: '#F0F4FF' }}>
      {/* ── 顶栏 ── */}
      <LinearGradient
        colors={['#050D1F', '#0A1E4A', '#0D2B6B']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 52, paddingBottom: 18, paddingHorizontal: 16 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>数据备份与恢复</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 1 }}>仅系统管理员可操作</Text>
          </View>
          <Shield size={18} color="rgba(255,255,255,0.35)" />
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: 14, gap: 14 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={cloudLoading}
            onRefresh={() => {
              loadCloudBackups();
              loadHistory();
              loadDbStats();
            }}
            colors={['#6366F1']}
            tintColor="#6366F1"
          />
        }
      >

        {/* ── 操作状态反馈（置顶，操作后第一眼看到） ── */}
        {status && (
          <View style={{
            backgroundColor: status.type === 'success' ? '#F0FDF4' : '#FFF1F2',
            borderRadius: 12, padding: 12,
            borderWidth: 1,
            borderColor: status.type === 'success' ? '#BBF7D0' : '#FECDD3',
            flexDirection: 'row', gap: 10, alignItems: 'flex-start',
          }}>
            {status.type === 'success'
              ? <CheckCircle2 size={16} color="#16A34A" />
              : <AlertTriangle size={16} color="#DC2626" />}
            <Text style={{ flex: 1, fontSize: 13, color: status.type === 'success' ? '#15803D' : '#B91C1C', lineHeight: 20 }}>
              {status.msg}
            </Text>
          </View>
        )}

        {/* ── 当前数据库 + 创建备份（两栏合一卡片） ── */}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' }}>
          {/* 标题行 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
            <Database size={16} color="#3B82F6" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B', flex: 1 }}>当前数据库</Text>
            <Pressable onPress={loadDbStats} style={{ padding: 4 }}>
              {statsLoading
                ? <ActivityIndicator size="small" color="#3B82F6" />
                : <RefreshCw size={14} color="#3B82F6" />}
            </Pressable>
          </View>

          {/* 统计数字 */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            {dbStats ? (
              <View style={{ gap: 8 }}>
                {/* 车辆统计 4 格 */}
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[
                    { label: '汽油', count: dbStats.gasoline, color: '#F59E0B', bg: '#FFFBEB' },
                    { label: '柴油', count: dbStats.diesel, color: '#6366F1', bg: '#EEF2FF' },
                    { label: 'LNG', count: dbStats.lng, color: '#10B981', bg: '#F0FDF4' },
                    { label: '合计', count: dbStats.total, color: '#2563EB', bg: '#EFF6FF' },
                  ].map((item) => (
                    <View key={item.label} style={{ flex: 1, backgroundColor: item.bg, borderRadius: 10, paddingVertical: 8, alignItems: 'center', gap: 2 }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: item.color }}>{item.count}</Text>
                      <Text style={{ fontSize: 10, color: item.color, opacity: 0.75 }}>{item.label}</Text>
                    </View>
                  ))}
                </View>
                {/* 员工一行 */}
                <View style={{ backgroundColor: '#F5F3FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: '#6D28D9', fontWeight: '600' }}>员工账号</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#7C3AED' }}>{dbStats.employees} 个</Text>
                </View>
                {/* 油价一行 */}
                <View style={{ backgroundColor: '#FFF7ED', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: '#C2410C', fontWeight: '600' }}>全国油价</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#EA580C' }}>{dbStats.oil_prices ?? 0} 条</Text>
                </View>
                {/* 天气缓存一行 */}
                <View style={{ backgroundColor: '#F0F9FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Cloud size={12} color="#0284C7" />
                    <Text style={{ fontSize: 13, color: '#0369A1', fontWeight: '600' }}>天气缓存</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#0284C7', fontWeight: '600' }}>
                    {cacheStats?.weatherCity
                      ? `${cacheStats.weatherCity} ${cacheStats.weatherTemp ? cacheStats.weatherTemp + '°' : ''} · ${formatDate(cacheStats.weatherFetchedAt ?? '')}`
                      : (cacheLoading ? '加载中…' : '暂无缓存')}
                  </Text>
                </View>
              </View>
            ) : (
              <ActivityIndicator color="#3B82F6" style={{ paddingVertical: 16 }} />
            )}
          </View>

          {/* 分隔 */}
          <View style={{ height: 1, backgroundColor: '#F1F5F9', marginHorizontal: 16 }} />

          {/* 重置数据库区 */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF7ED', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#FED7AA' }}>
              <AlertTriangle size={13} color="#D97706" />
              <Text style={{ flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 }}>
                重置将<Text style={{ fontWeight: '700' }}>清空全部车辆数据</Text>（员工账号保留），建议先创建备份再执行
              </Text>
            </View>
            <Pressable
              onPress={() => setResetConfirm(true)}
              disabled={resetLoading || restoreLoading}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                backgroundColor: resetLoading ? '#FCA5A5' : '#EF4444',
                borderRadius: 12, paddingVertical: 13,
                borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
                opacity: (resetLoading || restoreLoading) ? 0.7 : 1,
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            >
              {resetLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <XCircle size={15} color="#fff" />}
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                {resetLoading ? '正在清空数据库…' : '清空数据库并重置'}
              </Text>
            </Pressable>
          </View>

          {/* 分隔 */}
          <View style={{ height: 1, backgroundColor: '#F1F5F9', marginHorizontal: 16 }} />

          {/* 创建备份区 */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Download size={15} color="#10B981" />
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>创建手动备份</Text>
            </View>
            {lastBackup && (
              <View style={{ backgroundColor: '#F0FDF4', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#BBF7D0', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={12} color="#16A34A" />
                <Text style={{ flex: 1, fontSize: 12, color: '#15803D', fontWeight: '600' }}>
                  已备份：{formatDate(lastBackup.created_at)}（车辆 {lastBackup.stats.total} 辆 · 员工 {lastBackup.stats.employees} 个 · 油价 {lastBackup.stats.oil_prices ?? 0} 条）
                </Text>
              </View>
            )}
            <Pressable
              onPress={handleBackup}
              disabled={backupLoading}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 14, shadowColor: '#10B981', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
              android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            >
              {backupLoading ? <ActivityIndicator color="#fff" size="small" /> : <Download size={16} color="#fff" />}
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                {backupLoading ? '正在生成备份…' : '立即备份'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* ── 缓存数据管理 ── */}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' }}>
          {/* 标题行 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
            <Layers size={16} color="#8B5CF6" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B', flex: 1 }}>缓存数据管理</Text>
            <Pressable onPress={loadCacheStats} style={{ padding: 4 }}>
              {cacheLoading
                ? <ActivityIndicator size="small" color="#8B5CF6" />
                : <RefreshCw size={14} color="#8B5CF6" />}
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 10 }}>
            {/* 说明 */}
            <View style={{ backgroundColor: '#F5F3FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#DDD6FE' }}>
              <Text style={{ fontSize: 12, color: '#5B21B6', lineHeight: 18 }}>
                缓存数据由系统自动刷新，清空后打开首页将重新拉取，<Text style={{ fontWeight: '700' }}>不会影响车辆、员工及油价数据</Text>。
              </Text>
            </View>

            {/* 天气缓存 */}
            <View style={{ backgroundColor: '#F0F9FF', borderRadius: 12, borderWidth: 1, borderColor: '#BAE6FD', overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#E0F2FE', alignItems: 'center', justifyContent: 'center' }}>
                  <Cloud size={18} color="#0284C7" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0369A1' }}>天气缓存</Text>
                  <Text style={{ fontSize: 11, color: '#64748B' }}>
                    {cacheStats?.weatherCity
                      ? `${cacheStats.weatherCity} ${cacheStats.weatherWeather ?? ''} ${cacheStats.weatherTemp ? cacheStats.weatherTemp + '°C' : ''} · 更新于 ${formatDate(cacheStats.weatherFetchedAt ?? '')}`
                      : '暂无缓存数据'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setClearWeatherConfirm(true)}
                  disabled={clearWeatherLoading}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                  android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
                >
                  {clearWeatherLoading
                    ? <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.7 }] }} />
                    : <Trash2 size={13} color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>清空</Text>
                </Pressable>
              </View>
            </View>

          </View>
        </View>

        {/* ── 云端备份列表 ── */}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' }}>
          {/* 标题行 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
            <CloudDownload size={16} color="#6366F1" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B', flex: 1 }}>云端备份</Text>
            <Pressable onPress={loadCloudBackups} style={{ padding: 4 }}>
              {cloudLoading ? <ActivityIndicator size="small" color="#6366F1" /> : <RefreshCw size={14} color="#6366F1" />}
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
            {/* 警告提示 */}
            <View style={{ backgroundColor: '#FFFBEB', borderRadius: 8, padding: 9, borderWidth: 1, borderColor: '#FDE68A', flexDirection: 'row', gap: 7 }}>
              <AlertTriangle size={13} color="#D97706" style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 }}>
                恢复将清空当前车辆数据并替换为备份内容，不可撤销，请谨慎操作。
              </Text>
            </View>

            {restoreLoading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 }}>
                <ActivityIndicator color="#6366F1" />
                <Text style={{ fontSize: 13, color: '#6366F1' }}>正在恢复数据，请稍候…</Text>
              </View>
            )}

            {!cloudLoading && cloudBackups.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
                <CloudDownload size={32} color="#CBD5E1" />
                <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center' }}>
                  暂无云端备份{'\n'}点击上方「立即备份」生成第一份
                </Text>
              </View>
            ) : (
              cloudBackups.map((item, index) => {
                const isAuto = item.name === 'auto_backup.json';
                const dateStr = isAuto
                  ? `自动备份（${formatDate(item.created_at)}）`
                  : `手动备份（${formatDate(item.created_at)}）`;
                const fileSize = item.metadata?.size ?? item.size ?? 0;
                return (
                  <Animated.View key={item.name} entering={FadeInDown.delay(index * 80).duration(350)} style={{
                    backgroundColor: index === 0 ? '#EFF6FF' : '#F8FAFC',
                    borderRadius: 14, padding: 14,
                    borderWidth: 1.5,
                    borderColor: index === 0 ? '#BFDBFE' : '#E2E8F0',
                    gap: 9,
                    marginBottom: index < cloudBackups.length - 1 ? 10 : 0,
                    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
                  }}>
                    {/* 顶行：标签 + 时间 + 大小 + 删除 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      {index === 0 && (
                        <View style={{ backgroundColor: '#2563EB', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 10, color: '#fff', fontWeight: '700' }}>最新</Text>
                        </View>
                      )}
                      <View style={{ backgroundColor: isAuto ? '#EEF2FF' : '#F0FDF4', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, color: isAuto ? '#6366F1' : '#16A34A', fontWeight: '700' }}>{isAuto ? '自动' : '手动'}</Text>
                      </View>
                      <Text style={{ flex: 1, fontSize: 12, color: '#475569', fontWeight: '600' }} numberOfLines={1}>{dateStr}</Text>
                      {fileSize > 0 && (
                        <Text style={{ fontSize: 11, color: '#94A3B8' }}>{formatFileSize(fileSize)}</Text>
                      )}
                      <Pressable onPress={() => setPendingDeleteName(item.name)} hitSlop={8} style={{ padding: 4 }}>
                        <Trash2 size={13} color="#CBD5E1" />
                      </Pressable>
                    </View>
                    {/* 操作按钮行 */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable
                        onPress={() => handleRestoreFromCloud(item)}
                        disabled={restoreLoading || downloadingName === item.name}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                          backgroundColor: index === 0 ? '#2563EB' : 'rgba(99,102,241,0.1)',
                          borderRadius: 10, paddingVertical: 11,
                          borderWidth: index === 0 ? 0 : 1, borderColor: 'rgba(99,102,241,0.3)',
                        }}
                        android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
                      >
                        <Upload size={13} color={index === 0 ? '#fff' : '#6366F1'} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: index === 0 ? '#fff' : '#6366F1' }}>恢复</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDownloadCloudBackup(item.name)}
                        disabled={downloadingName === item.name || restoreLoading}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                          backgroundColor: 'rgba(16,185,129,0.1)',
                          borderRadius: 10, paddingVertical: 11,
                          borderWidth: 1, borderColor: 'rgba(16,185,129,0.35)',
                        }}
                        android_ripple={{ color: 'rgba(16,185,129,0.2)' }}
                      >
                        {downloadingName === item.name
                          ? <ActivityIndicator size="small" color="#10B981" />
                          : <Download size={13} color="#10B981" />}
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#10B981' }}>
                          {downloadingName === item.name ? '下载中…' : '下载'}
                        </Text>
                      </Pressable>
                    </View>
                  </Animated.View>
                );
              })
            )}
          </View>
        </View>

        {/* ── 每日自动备份 + 立即触发 + 备份记录（合并为一卡） ── */}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' }}>
          {/* 标题行 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
            <Bell size={16} color="#6366F1" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B', flex: 1 }}>自动备份</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EEF2FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#6366F1' }} />
              <Text style={{ fontSize: 11, color: '#4338CA', fontWeight: '600' }}>每天 22:00</Text>
            </View>
          </View>

          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 10 }}>
            {/* 推送状态 */}
            {Platform.OS !== 'web' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pushRegistered ? '#F0FDF4' : '#FFF7ED', borderRadius: 8, padding: 9, borderWidth: 1, borderColor: pushRegistered ? '#BBF7D0' : '#FED7AA' }}>
                {pushRegistered
                  ? <CheckCircle2 size={13} color="#16A34A" />
                  : <AlertTriangle size={13} color="#EA580C" />}
                <Text style={{ fontSize: 12, color: pushRegistered ? '#15803D' : '#9A3412' }}>
                  {pushRegistered ? '推送通知已开启，备份完成后将收到通知' : '推送通知未授权，请在系统设置中开启'}
                </Text>
              </View>
            )}

            {/* 立即触发按钮 */}
            <Pressable
              onPress={handleTriggerAutoBackup}
              disabled={triggerLoading}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: triggerLoading ? 'rgba(99,102,241,0.5)' : '#6366F1',
                borderRadius: 12, paddingVertical: 14,
                shadowColor: '#6366F1', shadowOpacity: triggerLoading ? 0 : 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            >
              {triggerLoading ? <ActivityIndicator color="#fff" size="small" /> : <Zap size={15} color="#fff" />}
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                {triggerLoading ? '正在执行备份…' : '立即触发自动备份'}
              </Text>
            </Pressable>

            {/* 分隔 */}
            <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />

            {/* 备份历史标题行 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <History size={14} color="#64748B" />
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569', flex: 1 }}>备份记录</Text>
              {history.length > 0 && (
                <Pressable
                  onPress={() => setClearHistoryConfirm(true)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFF1F2', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: '#FECDD3' }}
                >
                  <Trash2 size={10} color="#DC2626" />
                  <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '600' }}>清空</Text>
                </Pressable>
              )}
              <Pressable onPress={loadHistory} style={{ padding: 4 }}>
                {historyLoading ? <ActivityIndicator size="small" color="#64748B" /> : <RefreshCw size={13} color="#64748B" />}
              </Pressable>
            </View>

            {/* 记录列表 */}
            {history.length === 0 && !historyLoading ? (
              <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingVertical: 4 }}>暂无备份记录</Text>
            ) : (() => {
              const SHOW = 3;
              const visible = historyExpanded ? history : history.slice(0, SHOW);
              return (
                <>
                  <View style={{ gap: 6 }}>
                    {visible.map((item) => (
                      <View key={item.id} style={{
                        flexDirection: 'row', alignItems: 'center', gap: 8,
                        backgroundColor: item.status === 'success' ? '#F8FAFC' : '#FFF1F2',
                        borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
                        borderWidth: 1, borderColor: item.status === 'success' ? '#E2E8F0' : '#FECDD3',
                      }}>
                        {item.status === 'success'
                          ? <CheckCircle2 size={12} color="#16A34A" />
                          : <XCircle size={12} color="#DC2626" />}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, color: '#475569', fontWeight: '600' }}>
                            {formatDate(item.created_at)}
                          </Text>
                          {item.status === 'success' && item.stats?.total != null && (
                            <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                              车辆 {item.stats.total} 辆 · 员工 {item.stats.employees ?? 0} 个 · 油价 {item.stats.oil_prices ?? 0} 条
                            </Text>
                          )}
                        </View>
                        <View style={{
                          backgroundColor: item.triggered_by === 'auto' ? '#EEF2FF' : '#F0FDF4',
                          borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
                        }}>
                          <Text style={{ fontSize: 10, color: item.triggered_by === 'auto' ? '#6366F1' : '#16A34A', fontWeight: '600' }}>
                            {item.triggered_by === 'auto' ? '自动' : '手动'}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  {history.length > SHOW && (
                    <Pressable
                      onPress={() => setHistoryExpanded((v) => !v)}
                      style={{ alignItems: 'center', paddingVertical: 4 }}
                    >
                      <Text style={{ fontSize: 12, color: '#6366F1', fontWeight: '600' }}>
                        {historyExpanded ? '收起' : `查看更多（共 ${history.length} 条）`}
                      </Text>
                    </Pressable>
                  )}
                </>
              );
            })()}
          </View>
        </View>

        {/* ── 注意事项 ── */}
        <View style={{ backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', gap: 5 }}>
          <Text style={{ fontSize: 12, color: '#64748B', fontWeight: '700', marginBottom: 2 }}>注意事项</Text>
          {[
            '备份文件包含车辆数据（汽油/柴油/LNG）及员工账号，自动保存至云端',
            '建议在导入新 Excel 前先做备份，以便出错时快速从云端恢复',
            '恢复操作会重置车辆序号（seq_no），自动从 1 开始重新编号',
            '每日自动备份在北京时间 22:00 执行，同样保存至云端备份库',
          ].map((tip, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
              <Text style={{ color: '#CBD5E1', fontSize: 12 }}>•</Text>
              <Text style={{ flex: 1, fontSize: 12, color: '#64748B', lineHeight: 18 }}>{tip}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 28 }} />
      </ScrollView>

      {/* 恢复确认对话框 */}
      {confirmVisible && pendingRestore && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, gap: 16 }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={26} color="#D97706" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#1E293B' }}>确认恢复数据？</Text>
            </View>

            <View style={{ backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: '#64748B' }}>备份文件</Text>
                <Text style={{ fontSize: 11, color: '#1E293B', fontWeight: '600', flex: 1, textAlign: 'right' }} numberOfLines={1}>
                  {pendingRestore.name}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: '#64748B' }}>文件大小</Text>
                <Text style={{ fontSize: 12, color: '#1E293B', fontWeight: '600' }}>
                  {formatFileSize(pendingRestore.metadata?.size ?? pendingRestore.size ?? 0)}
                </Text>
              </View>
            </View>

            <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
              当前三张车辆表数据将被清空并替换为备份数据，此操作不可撤销
            </Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => { setConfirmVisible(false); setPendingRestore(null); }}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#64748B' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmRestore}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#EF4444' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>确认恢复</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
      {/* 清空后自动恢复选择弹窗 */}
      {showRestoreAfterReset && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 22, width: '100%', maxWidth: 400, overflow: 'hidden' }}>
            {/* 标题栏 */}
            <LinearGradient colors={['#0D2260', '#1040A0']} style={{ paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(99,163,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Upload size={16} color="#93C5FD" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>数据库已清空</Text>
                <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>请选择一个云端备份立即恢复</Text>
              </View>
              <Pressable onPress={() => setShowRestoreAfterReset(false)}
                style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                <XCircle size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </LinearGradient>

            {/* 备份列表 */}
            <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
              {cloudLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <ActivityIndicator color="#6366F1" />
                  <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 8 }}>正在加载云端备份…</Text>
                </View>
              ) : cloudBackups.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
                  <AlertTriangle size={28} color="#F59E0B" />
                  <Text style={{ color: '#92400E', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>暂无可用的云端备份</Text>
                  <Text style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>请通过 Excel 导入功能重新导入车辆数据</Text>
                </View>
              ) : (
                cloudBackups.map((item) => {
                  const isAuto = item.name === 'auto_backup.json';
                  const sizeMB = formatFileSize(item.size);
                  return (
                    <Pressable
                      key={item.name}
                      onPress={() => {
                        setShowRestoreAfterReset(false);
                        setPendingRestore(item);
                        setConfirmVisible(true);
                      }}
                      disabled={restoreLoading}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: isAuto ? '#F0FDF4' : '#EFF6FF', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: isAuto ? '#BBF7D0' : '#BFDBFE' }}
                      android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
                    >
                      <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: isAuto ? '#D1FAE5' : '#DBEAFE', alignItems: 'center', justifyContent: 'center' }}>
                        <CloudDownload size={20} color={isAuto ? '#059669' : '#2563EB'} />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>
                            {isAuto ? '自动备份' : '手动备份'}
                          </Text>
                          <View style={{ backgroundColor: isAuto ? '#D1FAE5' : '#DBEAFE', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 10, fontWeight: '600', color: isAuto ? '#065F46' : '#1D4ED8' }}>
                              {isAuto ? '定时' : '手动'}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 12, color: '#64748B' }}>{formatDate(item.created_at)} · {sizeMB}</Text>
                      </View>
                      <View style={{ backgroundColor: isAuto ? '#059669' : '#2563EB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>恢复</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

            {/* 底部关闭 */}
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <Pressable
                onPress={() => setShowRestoreAfterReset(false)}
                style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#64748B' }}>稍后手动恢复</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* 重置数据库二次确认弹窗 */}
      {resetConfirm && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 22, padding: 24, width: '100%', maxWidth: 380, gap: 16 }}>
            {/* 图标 + 标题 */}
            <View style={{ alignItems: 'center', gap: 10 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                <XCircle size={30} color="#EF4444" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#1E293B' }}>确认清空数据库？</Text>
            </View>
            {/* 警告内容 */}
            <View style={{ backgroundColor: '#FFF1F2', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FECDD3', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} color="#DC2626" />
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>此操作不可撤销！</Text>
              </View>
              <Text style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 20 }}>
                将清空数据库中全部 <Text style={{ fontWeight: '800' }}>{(dbStats?.total ?? 0)} 辆</Text> 车辆数据，员工账号不受影响。{'\n\n'}
                建议在清空前先<Text style={{ fontWeight: '700' }}>创建备份</Text>，清空后再通过云端备份恢复数据。
              </Text>
            </View>
            {/* 操作按钮 */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setResetConfirm(false)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#64748B' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleReset}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: '#EF4444', gap: 4 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>确认清空</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* 清空天气缓存确认弹窗 */}
      {clearWeatherConfirm && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, gap: 16 }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#E0F2FE', alignItems: 'center', justifyContent: 'center' }}>
                <Cloud size={26} color="#0284C7" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#1E293B' }}>清空天气缓存？</Text>
            </View>
            <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 }}>
              将清除本地天气缓存数据，{'\n'}打开首页后将自动重新拉取最新天气。
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setClearWeatherConfirm(false)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#64748B' }}>取消</Text>
              </Pressable>
              <Pressable onPress={handleClearWeather}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#EF4444' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>确认清空</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* 清空备份记录确认对话框 */}
      {clearHistoryConfirm && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, gap: 16 }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={24} color="#EF4444" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#1E293B' }}>确认清空所有记录？</Text>
            </View>
            <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 }}>
              将删除全部 {history.length} 条备份记录日志，{'\n'}云端备份文件不受影响，操作不可撤销。
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setClearHistoryConfirm(false)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#64748B' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleClearHistory}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#EF4444' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>确认清空</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* 删除确认对话框 */}
      {pendingDeleteName && (() => {
        const isLatest = cloudBackups.length > 0 && cloudBackups[0].name === pendingDeleteName;
        return (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, gap: 16 }}>
              <View style={{ alignItems: 'center', gap: 8 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={24} color="#EF4444" />
                </View>
                <Text style={{ fontSize: 17, fontWeight: '800', color: '#1E293B' }}>确认删除备份？</Text>
              </View>

              {/* 最新备份专属警告 */}
              {isLatest && (
                <View style={{ flexDirection: 'row', gap: 8, backgroundColor: '#FFF7ED', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FED7AA' }}>
                  <AlertTriangle size={15} color="#EA580C" style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, fontSize: 12, color: '#9A3412', lineHeight: 18, fontWeight: '600' }}>
                    这是当前最新的备份文件！删除后若数据丢失将无法从此备份恢复，请确认已有其他备份或不再需要此文件。
                  </Text>
                </View>
              )}

              <View style={{ backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12 }}>
                <Text style={{ fontSize: 11, color: '#475569', fontWeight: '600', textAlign: 'center' }} numberOfLines={2}>
                  {pendingDeleteName}
                </Text>
              </View>

              <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
                删除后无法恢复，请确认该备份文件不再需要
              </Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => setPendingDeleteName(null)}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#64748B' }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirmDelete}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#EF4444' }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                    {isLatest ? '仍然删除' : '确认删除'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })()}
    </View>
  );
}
