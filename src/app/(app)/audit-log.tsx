import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, ActivityIndicator, TextInput, Modal, RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, RefreshCw, Search, ClipboardList,
  Car, Users, ShieldCheck, Filter, Trash2, AlertTriangle,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';
import { LogCardSkeleton } from '@/components/Skeleton';

type AuditLog = {
  id: number;
  created_at: string;
  operator_name: string;
  operator_role: string;
  action: string;
  target_type: string;
  target_desc: string;
  detail: string;
};

const TARGET_TYPES = [
  { key: 'all', label: '全部', icon: Filter, color: '#6B8BC3' },
  { key: 'vehicle', label: '车辆', icon: Car, color: '#10B981' },
  { key: 'employee', label: '员工', icon: Users, color: '#8B5CF6' },
  { key: 'auth', label: '授权', icon: ShieldCheck, color: '#F59E0B' },
];

const ACTION_COLOR: Record<string, string> = {
  '新增': '#10B981',
  '修改': '#3B82F6',
  '删除': '#EF4444',
  '导入': '#8B5CF6',
  '授权': '#F59E0B',
  '撤销': '#F97316',
  '启用': '#06B6D4',
  '停用': '#94A3B8',
  '角色变更': '#EC4899',
};

function actionColor(action: string): string {
  for (const [k, c] of Object.entries(ACTION_COLOR)) {
    if (action.includes(k)) return c;
  }
  return '#6B8BC3';
}

function roleLabel(role: string): { label: string; color: string; bg: string } {
  if (role === 'admin') return { label: '管理员', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' };
  if (role === 'assistant') return { label: '助理', color: '#06B6D4', bg: 'rgba(6,182,212,0.12)' };
  return { label: '员工', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function LogCard({ item, isAdmin, onDelete }: { item: AuditLog; isAdmin: boolean; onDelete: (id: number) => void }) {
  const [confirmVisible, setConfirmVisible] = useState(false);
  const rl = roleLabel(item.operator_role);
  const ac = actionColor(item.action);
  return (
    <>
      <Pressable
        onPress={isAdmin ? () => setConfirmVisible(true) : undefined}
        onLongPress={isAdmin ? () => setConfirmVisible(true) : undefined}
        delayLongPress={400}
        style={{
          backgroundColor: '#fff',
          marginHorizontal: 14,
          marginBottom: 10,
          borderRadius: 14,
          borderLeftWidth: 3,
          borderLeftColor: ac,
          borderWidth: 1,
          borderColor: '#EEF2F7',
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        {/* 顶行：操作人 + 角色 badge + 时间 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, gap: 6 }}>
          <Text style={{ color: '#1A2332', fontSize: 13, fontWeight: '700' }}>{item.operator_name}</Text>
          <View style={{ backgroundColor: rl.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: rl.color, fontSize: 10, fontWeight: '700' }}>{rl.label}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={{ color: '#B0BAC9', fontSize: 11 }}>{formatTime(item.created_at)}</Text>
          {isAdmin && (
            <Pressable onPress={() => setConfirmVisible(true)} style={{ marginLeft: 6, padding: 2 }}>
              <Trash2 size={13} color="#CBD5E1" />
            </Pressable>
          )}
        </View>

        {/* 分隔线 */}
        <View style={{ height: 1, backgroundColor: '#F4F6FA', marginHorizontal: 14 }} />

        {/* 动作 + 对象 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 9, paddingBottom: item.detail ? 6 : 12, flexWrap: 'wrap' }}>
          <View style={{ backgroundColor: `${ac}18`, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
            <Text style={{ color: ac, fontSize: 12, fontWeight: '800' }}>{item.action}</Text>
          </View>
          {item.target_desc ? (
            <Text style={{ color: '#334155', fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={2}>{item.target_desc}</Text>
          ) : null}
        </View>

        {/* 详情 */}
        {item.detail ? (
          <Text style={{ color: '#7B8FA8', fontSize: 12, lineHeight: 17, paddingHorizontal: 14, paddingBottom: 12 }}>
            {item.detail}
          </Text>
        ) : null}
      </Pressable>

      {/* 删除单条确认 */}
      <Modal transparent animationType="fade" visible={confirmVisible} onRequestClose={() => setConfirmVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 32 }} onPress={() => setConfirmVisible(false)}>
          <Pressable style={{ width: '100%', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden' }} onPress={() => {}}>
            <View style={{ backgroundColor: '#FEF2F2', paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={18} color="#EF4444" />
              </View>
              <Text style={{ color: '#DC2626', fontSize: 15, fontWeight: '800' }}>删除这条记录？</Text>
            </View>
            <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
              <Text style={{ color: '#475569', fontSize: 13, lineHeight: 20 }}>
                将永久删除「{item.operator_name}」的操作记录，此操作不可恢复。
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 18 }}>
              <Pressable onPress={() => setConfirmVisible(false)}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' }}>
                <Text style={{ color: '#64748B', fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable onPress={() => { setConfirmVisible(false); onDelete(item.id); }}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>确认删除</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export default function AuditLogScreen() {
  const router = useRouter();
  const { session } = useSession();
  const isAdmin = session?.role === 'admin';
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (filterType !== 'all') q = q.eq('target_type', filterType);
    if (searchText.trim()) q = q.ilike('target_desc', `%${searchText.trim()}%`);
    const { data } = await q;
    setLogs((data as AuditLog[]) ?? []);
    setLoading(false);
  }, [filterType, searchText]);

  useFocusEffect(useCallback(() => {
    (async () => { await loadLogs(); })();
  }, [loadLogs]));

  // 删除单条
  const handleDeleteOne = async (id: number) => {
    await supabase.from('audit_logs').delete().eq('id', id);
    setLogs((prev) => prev.filter((l) => l.id !== id));
  };

  // 清空全部
  const handleClearAll = async () => {
    setClearing(true);
    await supabase.from('audit_logs').delete().neq('id', 0);
    setLogs([]);
    setClearing(false);
    setClearConfirm(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F5FA' }}>
      {/* ── Header ── */}
      <LinearGradient
        colors={['#0A1E4A', '#0D2B6B', '#1A3A8A']}
        style={{ paddingTop: 48, paddingBottom: 14, paddingHorizontal: 14 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Pressable onPress={() => router.back()}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={17} color="#fff" />
          </Pressable>
          <ClipboardList size={18} color="#93C5FD" />
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', flex: 1 }}>操作记录</Text>
          <Pressable onPress={loadLogs}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <RefreshCw size={15} color="#93C5FD" />
          </Pressable>
          {/* 清空全部按钮（仅 admin） */}
          {isAdmin && (
            <Pressable onPress={() => setClearConfirm(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.18)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' }}>
              <Trash2 size={13} color="#FCA5A5" />
              <Text style={{ color: '#FCA5A5', fontSize: 12, fontWeight: '700' }}>清空</Text>
            </Pressable>
          )}
        </View>

        {/* 搜索框 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 12, height: 42, gap: 8, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <Search size={14} color="rgba(255,255,255,0.45)" />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={loadLogs}
            placeholder="搜索操作对象…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={{ flex: 1, color: '#fff', fontSize: 13 }}
            returnKeyType="search"
          />
        </View>

        {/* 分类筛选 Pill */}
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {TARGET_TYPES.map((t) => {
            const active = filterType === t.key;
            return (
              <Pressable key={t.key} onPress={() => setFilterType(t.key)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: active ? t.color : 'rgba(255,255,255,0.1)',
                  borderWidth: 1.5, borderColor: active ? t.color : 'rgba(255,255,255,0.15)',
                }}>
                <t.icon size={11} color={active ? '#fff' : 'rgba(255,255,255,0.5)'} />
                <Text style={{ color: active ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: active ? '700' : '400' }}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </LinearGradient>

      {/* 统计栏 */}
      <View style={{ paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: '#94A3B8', fontSize: 12 }}>共 <Text style={{ color: '#475569', fontWeight: '700' }}>{logs.length}</Text> 条记录</Text>
        {isAdmin && logs.length > 0 && (
          <Text style={{ color: '#CBD5E1', fontSize: 12, marginLeft: 8 }}>· 长按或点击卡片右侧 🗑 删除单条</Text>
        )}
      </View>

      {/* 列表 */}
      {loading ? (
        <View style={{ paddingTop: 4 }}>
          {[0,1,2,3,4,5].map((i) => <LogCardSkeleton key={i} />)}
        </View>
      ) : logs.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ClipboardList size={44} color="#CBD5E1" />
          <Text style={{ color: '#94A3B8', fontSize: 14 }}>暂无操作记录</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 40).duration(350)}>
              <LogCard item={item} isAdmin={isAdmin} onDelete={handleDeleteOne} />
            </Animated.View>
          )}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await loadLogs();
                setRefreshing(false);
              }}
              colors={['#3B7BF6']}
              tintColor="#3B7BF6"
            />
          }
        />
      )}

      {/* 清空全部确认弹窗 */}
      <Modal transparent animationType="fade" visible={clearConfirm} onRequestClose={() => setClearConfirm(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 32 }} onPress={() => setClearConfirm(false)}>
          <Pressable style={{ width: '100%', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden' }} onPress={() => {}}>
            <LinearGradient colors={['#FEF2F2', '#FFF']} style={{ paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={20} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#DC2626', fontSize: 16, fontWeight: '800' }}>清空所有操作记录</Text>
                <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 2 }}>此操作不可恢复</Text>
              </View>
            </LinearGradient>
            <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
              <Text style={{ color: '#475569', fontSize: 13, lineHeight: 20 }}>
                将永久删除全部 <Text style={{ color: '#DC2626', fontWeight: '700' }}>{logs.length}</Text> 条操作记录，确认继续吗？
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 18 }}>
              <Pressable onPress={() => setClearConfirm(false)}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' }}>
                <Text style={{ color: '#64748B', fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable onPress={handleClearAll} disabled={clearing}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                {clearing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><Trash2 size={14} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700' }}>确认清空</Text></>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
