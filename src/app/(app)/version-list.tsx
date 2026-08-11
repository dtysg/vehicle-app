import { useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, PackageOpen, Trash2, Download, ShieldAlert, Calendar, Hash, FileText, AlertCircle } from 'lucide-react-native';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { supabase } from '@/client/supabase';
import { Linking } from 'react-native';

type AppVersion = {
  id: string;
  version_name: string;
  version_code: number;
  apk_url: string;
  release_notes: string;
  is_force: boolean;
  created_at: string;
};

export default function VersionListScreen() {
  const router = useRouter();
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AppVersion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('app_versions')
      .select('*')
      .order('version_code', { ascending: false });
    if (err) {
      setError('加载失败：' + err.message);
    } else {
      setVersions(data ?? []);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { fetchVersions(); }, [fetchVersions]));

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error: err } = await supabase
      .from('app_versions')
      .delete()
      .eq('id', deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (err) {
      setError('删除失败：' + err.message);
    } else {
      setVersions(prev => prev.filter(v => v.id !== deleteTarget.id));
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <LinearGradient colors={['#0A1628', '#0D2147', '#0A1E3D']} style={{ flex: 1 }}>
      {/* 顶部导航 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}
          style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          <ArrowLeft size={18} color="#94A3B8" />
        </Pressable>
        <Text style={{ color: '#F1F5F9', fontSize: 18, fontWeight: '800', flex: 1 }}>已发布版本</Text>
        <View style={{ backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: '#60A5FA', fontSize: 12, fontWeight: '700' }}>{versions.length} 个版本</Text>
        </View>
      </View>

      {/* 加载中 */}
      {loading && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color="#3B82F6" size="large" />
          <Text style={{ color: '#475569', fontSize: 14 }}>加载版本列表…</Text>
        </View>
      )}

      {/* 错误提示 */}
      {!loading && !!error && (
        <View style={{ margin: 20, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} color="#F87171" />
          <Text style={{ color: '#F87171', fontSize: 13, flex: 1 }}>{error}</Text>
        </View>
      )}

      {/* 空状态 */}
      {!loading && !error && versions.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <PackageOpen size={48} color="#1E3A5F" />
          <Text style={{ color: '#334155', fontSize: 16, fontWeight: '600' }}>暂无发布记录</Text>
          <Text style={{ color: '#1E3A5F', fontSize: 13 }}>前往「发布版本」页面发布第一个版本</Text>
          <Pressable onPress={() => router.push('/(app)/publish-version' as never)}
            style={{ backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)' }}>
            <Text style={{ color: '#60A5FA', fontSize: 14, fontWeight: '700' }}>去发布版本</Text>
          </Pressable>
        </View>
      )}

      {/* 版本列表 */}
      {!loading && versions.length > 0 && (
        <FlatList
          data={versions}
          keyExtractor={item => item.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
          renderItem={({ item, index }) => (
            <View style={{
              backgroundColor: index === 0 ? 'rgba(29,78,216,0.18)' : 'rgba(255,255,255,0.04)',
              borderRadius: 16, padding: 16,
              borderWidth: 1,
              borderColor: index === 0 ? 'rgba(96,165,250,0.35)' : 'rgba(255,255,255,0.07)',
            }}>
              {/* 版本头行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                {index === 0 && (
                  <View style={{ backgroundColor: '#1D4ED8', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>最新</Text>
                  </View>
                )}
                <Text style={{ color: '#F1F5F9', fontSize: 17, fontWeight: '800', flex: 1 }}>
                  v{item.version_name}
                </Text>
                {item.is_force && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <ShieldAlert size={11} color="#F87171" />
                    <Text style={{ color: '#F87171', fontSize: 10, fontWeight: '700' }}>强制</Text>
                  </View>
                )}
              </View>

              {/* 版本号 + 发布时间 */}
              <View style={{ flexDirection: 'row', gap: 16, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Hash size={11} color="#475569" />
                  <Text style={{ color: '#64748B', fontSize: 12 }}>版本号 {item.version_code}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Calendar size={11} color="#475569" />
                  <Text style={{ color: '#64748B', fontSize: 12 }}>{formatDate(item.created_at)}</Text>
                </View>
              </View>

              {/* 更新内容 */}
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14, alignItems: 'flex-start' }}>
                <FileText size={12} color="#475569" style={{ marginTop: 2 }} />
                <Text style={{ color: '#94A3B8', fontSize: 13, lineHeight: 20, flex: 1 }} numberOfLines={3}>
                  {item.release_notes}
                </Text>
              </View>

              {/* 操作按钮 */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() => Linking.openURL(item.apk_url)}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(59,130,246,0.12)', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)' }}>
                  <Download size={14} color="#60A5FA" />
                  <Text style={{ color: '#60A5FA', fontSize: 13, fontWeight: '700' }}>下载 APK</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDeleteTarget(item)}
                  style={{ width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)' }}>
                  <Trash2 size={15} color="#EF4444" />
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除版本 v{deleteTarget?.version_name}？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后版本记录将永久移除，用户不再收到该版本的更新提示。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onPress={() => setDeleteTarget(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onPress={handleDelete} disabled={deleting}>
              {deleting ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LinearGradient>
  );
}
