import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, FlatList, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, User, Shield, ShieldHalf, Clock, X, CheckCircle2, AlertCircle,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';

// ── 类型 ──────────────────────────────────────────────────────────────
interface Employee {
  id: number;
  real_name: string;
  emp_code: string;
  role: 'user' | 'admin' | 'assistant';
  is_active: boolean;
  temp_admin_expires_at: string | null;
}

// 时效选项
const DURATION_OPTIONS = [
  { label: '1 小时', minutes: 60 },
  { label: '4 小时', minutes: 240 },
  { label: '8 小时', minutes: 480 },
  { label: '1 天',  minutes: 1440 },
  { label: '3 天',  minutes: 4320 },
  { label: '7 天',  minutes: 10080 },
];

// ── 工具函数 ──────────────────────────────────────────────────────────
function formatExpires(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d <= now) return '已过期';
  const diffMs = d.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  if (diffH >= 24) return `剩余 ${Math.floor(diffH / 24)} 天 ${diffH % 24} 小时`;
  if (diffH > 0) return `剩余 ${diffH} 小时 ${diffM} 分钟`;
  return `剩余 ${diffM} 分钟`;
}

function isTempActive(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso) > new Date();
}

// ── 组件 ──────────────────────────────────────────────────────────────
export default function TempAuthPage() {
  const router = useRouter();
  const { session, isPermanentAdmin, isAssistant } = useSession();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 弹窗状态（仅永久管理员可操作）
  const [target, setTarget] = useState<Employee | null>(null);
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState('');

  const fetchEmployees = async () => {
    setLoading(true);
    setError('');
    const { data, error: fetchErr } = await supabase
      .from('employees')
      .select('id, real_name, emp_code, role, is_active, temp_admin_expires_at')
      .order('id');
    if (fetchErr || !data) { setError('加载失败，请重试'); setLoading(false); return; }
    // 永久管理员和助理都只能给普通员工(user)授权，不能对 assistant 授权
    const list = (data as Employee[]).filter((e) => e.role === 'user');
    setEmployees(list);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchEmployees(); }, []));

  // ── 授权（永久管理员 OR 助理均可对普通员工授权） ──
  const handleGrant = async (emp: Employee, minutes: number) => {
    if (!isPermanentAdmin && !isAssistant) return;
    setApplying(true);
    setFeedback('');
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const { error: err } = await supabase
      .from('employees')
      .update({ temp_admin_expires_at: expiresAt })
      .eq('id', emp.id);
    setApplying(false);
    if (err) { setFeedback('❌ 授权失败：' + err.message); return; }
    const durationLabel = DURATION_OPTIONS.find((o) => o.minutes === minutes)?.label ?? '';
    setFeedback(`✅ 已授权「${emp.real_name}」${durationLabel}临时管理员权限`);
    setEmployees((prev) => prev.map((e) => e.id === emp.id ? { ...e, temp_admin_expires_at: expiresAt } : e));
    // 写操作日志
    await supabase.from('audit_logs').insert({
      operator_id: session?.id ?? 0,
      operator_name: session?.real_name ?? '未知',
      operator_role: session?.role ?? 'user',
      action: '授权',
      target_type: 'auth',
      target_desc: emp.real_name,
      detail: `授予「${emp.real_name}」${durationLabel}临时管理员权限`,
    });
    setTimeout(() => { setTarget(null); setFeedback(''); }, 1400);
  };

  // ── 撤销（永久管理员 OR 助理均可撤销普通员工的临时权限） ──
  const handleRevoke = async (emp: Employee) => {
    if (!isPermanentAdmin && !isAssistant) return;
    setApplying(true);
    setFeedback('');
    const { error: err } = await supabase
      .from('employees')
      .update({ temp_admin_expires_at: null })
      .eq('id', emp.id);
    setApplying(false);
    if (err) { setFeedback('❌ 撤销失败：' + err.message); return; }
    setFeedback(`已撤销「${emp.real_name}」的临时管理员权限`);
    setEmployees((prev) => prev.map((e) => e.id === emp.id ? { ...e, temp_admin_expires_at: null } : e));
    // 写操作日志
    await supabase.from('audit_logs').insert({
      operator_id: session?.id ?? 0,
      operator_name: session?.real_name ?? '未知',
      operator_role: session?.role ?? 'user',
      action: '撤销',
      target_type: 'auth',
      target_desc: emp.real_name,
      detail: `撤销「${emp.real_name}」的临时管理员权限`,
    });
    setTimeout(() => { setTarget(null); setFeedback(''); }, 1200);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
      {/* Header */}
      <LinearGradient
        colors={['#1a1060', '#2d1b8a', '#3B2AAA']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}
            style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={18} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>临时授权管理</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>
              为普通员工设置临时管理员权限
            </Text>
          </View>
          <Clock size={22} color="#A78BFA" />
        </View>
      </LinearGradient>

      {/* 说明栏 */}
      <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)', flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <AlertCircle size={15} color="#A78BFA" style={{ marginTop: 1 }} />
        <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 18, flex: 1 }}>
          临时权限到期后自动失效，无需手动撤销。员工权限实时同步。
        </Text>
      </View>

      {/* 列表 */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ color: '#94A3B8', fontSize: 14 }}>{error}</Text>
          <Pressable onPress={fetchEmployees} style={{ backgroundColor: '#3B82F6', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>重新加载</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={employees}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 10 }}>
              <User size={40} color="#334155" />
              <Text style={{ color: '#475569', fontSize: 14 }}>暂无普通员工</Text>
            </View>
          }
          renderItem={({ item }) => {
            const active = isTempActive(item.temp_admin_expires_at);
            return (
              <View style={{
                backgroundColor: '#1E293B', borderRadius: 14,
                paddingHorizontal: 16, paddingVertical: 14,
                borderWidth: 1,
                borderColor: active ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.06)',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {/* 头像 */}
                  <View style={{
                    width: 44, height: 44, borderRadius: 22,
                    backgroundColor: active ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.12)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active ? <Shield size={20} color="#A78BFA" /> : <User size={20} color="#3B82F6" />}
                  </View>

                  {/* 信息 */}
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: '#F1F5F9', fontSize: 15, fontWeight: '700' }}>{item.real_name}</Text>
                      {/* 身份徽章 */}
                      {item.role === 'assistant' ? (
                        <LinearGradient
                          colors={['#164E63', '#0E7490', '#06B6D4']}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}
                        >
                          <ShieldHalf size={10} color="#CFFAFE" />
                          <Text style={{ color: '#CFFAFE', fontSize: 10, fontWeight: '800' }}>管理员助理</Text>
                        </LinearGradient>
                      ) : active ? (
                        <LinearGradient
                          colors={['#4C1D95', '#7C3AED', '#8B5CF6']}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}
                        >
                          <ShieldHalf size={10} color="#E9D5FF" />
                          <Text style={{ color: '#E9D5FF', fontSize: 10, fontWeight: '800' }}>临时管理员</Text>
                        </LinearGradient>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(148,163,184,0.15)', borderWidth: 1, borderColor: 'rgba(148,163,184,0.22)' }}>
                          <User size={10} color="#94A3B8" />
                          <Text style={{ color: '#94A3B8', fontSize: 10, fontWeight: '700' }}>普通员工</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: '#64748B', fontSize: 12 }}>账号：{item.emp_code}</Text>
                    {active ? (
                      <Text style={{ color: '#A78BFA', fontSize: 12, fontWeight: '600' }}>
                        {formatExpires(item.temp_admin_expires_at)}
                      </Text>
                    ) : (
                      <Text style={{ color: '#334155', fontSize: 12 }}>无临时权限</Text>
                    )}
                  </View>

                  {/* 操作按钮：永久管理员 OR 助理可见 */}
                  {(isPermanentAdmin || isAssistant) && (
                    <Pressable
                      onPress={() => { setTarget(item); setFeedback(''); }}
                      style={{
                        backgroundColor: active ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.15)',
                        borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
                        flexDirection: 'row', alignItems: 'center', gap: 5,
                      }}
                      android_ripple={{ color: 'rgba(255,255,255,0.1)', borderless: false }}
                    >
                      <Clock size={14} color={active ? '#A78BFA' : '#60A5FA'} />
                      <Text style={{ color: active ? '#A78BFA' : '#60A5FA', fontSize: 12, fontWeight: '700' }}>
                        {active ? '调整' : '授权'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── 授权弹窗（永久管理员 OR 助理） ── */}
      {target && (isPermanentAdmin || isAssistant) && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 20,
        }}>
          <View style={{
            backgroundColor: '#1E293B', borderRadius: 18, padding: 22,
            borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)', width: '100%',
          }}>
            {/* 弹窗标题 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 }}>
              <Clock size={20} color="#A78BFA" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#F1F5F9', fontSize: 17, fontWeight: '700' }}>设置临时管理员权限</Text>
                <Text style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>{target.real_name}（{target.emp_code}）</Text>
              </View>
              <Pressable onPress={() => { setTarget(null); setFeedback(''); }} hitSlop={10}>
                <X size={18} color="#475569" />
              </Pressable>
            </View>

            {/* 当前状态 */}
            {isTempActive(target.temp_admin_expires_at) && (
              <View style={{ backgroundColor: 'rgba(139,92,246,0.12)', borderRadius: 8, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(139,92,246,0.2)' }}>
                <Text style={{ color: '#A78BFA', fontSize: 12 }}>
                  当前临时权限：{formatExpires(target.temp_admin_expires_at)}
                </Text>
              </View>
            )}

            {/* 时效选项网格 */}
            <Text style={{ color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 10 }}>选择授权时效：</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {DURATION_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.minutes}
                  onPress={() => handleGrant(target, opt.minutes)}
                  disabled={applying}
                  style={{
                    backgroundColor: 'rgba(139,92,246,0.15)', borderRadius: 10,
                    paddingHorizontal: 14, paddingVertical: 10,
                    borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)',
                    minWidth: '30%', alignItems: 'center',
                    opacity: applying ? 0.5 : 1,
                  }}
                  android_ripple={{ color: 'rgba(255,255,255,0.1)', borderless: false }}
                >
                  <Text style={{ color: '#A78BFA', fontSize: 13, fontWeight: '700' }}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* 反馈信息 */}
            {applying && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <ActivityIndicator size="small" color="#A78BFA" />
                <Text style={{ color: '#94A3B8', fontSize: 13 }}>处理中...</Text>
              </View>
            )}
            {!!feedback && !applying && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: feedback.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                borderRadius: 8, padding: 10, marginBottom: 12,
              }}>
                {feedback.startsWith('✅')
                  ? <CheckCircle2 size={14} color="#22C55E" />
                  : <AlertCircle size={14} color="#EF4444" />}
                <Text style={{ color: feedback.startsWith('✅') ? '#86EFAC' : '#FCA5A5', fontSize: 12, flex: 1 }}>
                  {feedback}
                </Text>
              </View>
            )}

            {/* 撤销按钮（仅有临时权限时显示） */}
            {isTempActive(target.temp_admin_expires_at) && (
              <Pressable
                onPress={() => handleRevoke(target)}
                disabled={applying}
                style={{
                  backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10,
                  paddingVertical: 11, alignItems: 'center',
                  borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
                  opacity: applying ? 0.5 : 1,
                }}
              >
                <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '700' }}>撤销临时权限</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

