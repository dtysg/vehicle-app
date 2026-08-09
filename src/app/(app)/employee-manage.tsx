import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { ArrowLeft, Plus, User, Shield, ShieldCheck, ShieldHalf, UserX, UserCheck, X, Eye, EyeOff, Save, Trash2, Clock, Smartphone } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';
import { EmployeeCardSkeleton } from '@/components/Skeleton';

// ── 内联琴键按钮（角色选择用）────────────────────────────────
function RoleKeyItem({ label, color, active, onPress }: {
  label: string; color: string; active: boolean; onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} style={{ flex: 1 }}>
      <View style={{
        height: 42, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden',
        transform: [{ translateY: pressed ? 2 : 0 }],
        backgroundColor: active ? color : (pressed ? `${color}30` : `${color}15`),
        justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 8,
        borderWidth: 1, borderColor: active ? `${color}99` : `${color}40`,
      }}>
        {!pressed && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: `${color}40` }} />}
        <Text style={{ color: active ? '#fff' : color, fontSize: 12, fontWeight: '700', zIndex: 1 }}>{label}</Text>
      </View>
    </Pressable>
  );
}

interface Employee {
  id: number;
  real_name: string;
  emp_code: string;
  role: 'user' | 'admin' | 'assistant';
  is_active: boolean;
  password: string;
  temp_admin_expires_at?: string | null;
  bound_device_id?: string | null;
  avatar_url?: string | null;
}

type Mode = 'list' | 'add';

// 格式化临时管理员到期时间，精确到时分秒
function formatTempExpiry(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d <= now) return '已过期';
  const diffMs = d.getTime() - now.getTime();
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  const s = Math.floor((diffMs % 60000) / 1000);
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const rh = h % 24;
    return `剩余 ${days}天 ${String(rh).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  return `剩余 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export default function EmployeeManagePage() {
  const router = useRouter();
  const { session, isPermanentAdmin, isAssistant } = useSession();
  const [mode, setMode] = useState<Mode>('list');

  // ── 列表状态
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [listError, setListError] = useState('');

  // ── 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── 角色切换弹窗
  const [roleTarget, setRoleTarget] = useState<Employee | null>(null);
  const [roleSwitching, setRoleSwitching] = useState(false);

  const handleRoleSwitch = async () => {
    if (!roleTarget || roleTarget.role === 'admin') return;
    const newRole: 'user' | 'assistant' = roleTarget.role === 'user' ? 'assistant' : 'user';
    setRoleSwitching(true);
    const { error } = await supabase
      .from('employees')
      .update({ role: newRole })
      .eq('id', roleTarget.id);
    setRoleSwitching(false);
    if (!error) {
      setEmployees((prev) => prev.map((e) => e.id === roleTarget.id ? { ...e, role: newRole } : e));
      await supabase.from('audit_logs').insert({
        operator_id: session?.id ?? 0,
        operator_name: session?.real_name ?? '未知',
        operator_role: session?.role ?? 'user',
        action: '角色变更',
        target_type: 'employee',
        target_desc: roleTarget.real_name,
        detail: `将「${roleTarget.real_name}」角色从 ${roleTarget.role} 改为 ${newRole}`,
      });
    }
    setRoleTarget(null);
  };

  // ── 新增表单状态
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formPwd, setFormPwd] = useState('');
  const [formRole, setFormRole] = useState<'user' | 'assistant'>('user');
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const fetchEmployees = async () => {
    setListLoading(true);
    setListError('');
    const { data, error } = await supabase
      .from('employees')
      .select('id, real_name, emp_code, role, is_active, password, temp_admin_expires_at, bound_device_id, avatar_url')
      .order('id');
    if (error) { setListError('加载失败，请重试'); }
    else { setEmployees((data as Employee[]) ?? []); }
    setListLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchEmployees(); }, []));

  // 切换启用/停用（admin 账号永远保持启用，不可操作）
  const toggleActive = async (emp: Employee) => {
    if (emp.role === 'admin') return;
    const { error } = await supabase
      .from('employees')
      .update({ is_active: !emp.is_active })
      .eq('id', emp.id);
    if (!error) {
      setEmployees((prev) =>
        prev.map((e) => e.id === emp.id ? { ...e, is_active: !e.is_active } : e)
      );
    }
  };

  // 解绑设备（仅永久管理员可操作，清空 bound_device_id）
  const handleUnbindDevice = async (emp: Employee) => {
    const { error } = await supabase
      .from('employees')
      .update({ bound_device_id: null })
      .eq('id', emp.id);
    if (!error) {
      setEmployees((prev) => prev.map((e) => e.id === emp.id ? { ...e, bound_device_id: null } : e));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleteTarget.role === 'admin') return;
    setDeleting(true);
    const { error } = await supabase.from('employees').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (!error) {
      setEmployees((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      await supabase.from('audit_logs').insert({
        operator_id: session?.id ?? 0,
        operator_name: session?.real_name ?? '未知',
        operator_role: session?.role ?? 'user',
        action: '删除',
        target_type: 'employee',
        target_desc: deleteTarget.real_name,
        detail: `删除员工账号「${deleteTarget.real_name}」(${deleteTarget.emp_code})`,
      });
    }
    setDeleteTarget(null);
  };

  // 新增员工
  const handleAdd = async () => {
    const name = formName.trim();
    const code = formCode.trim().toUpperCase();
    const pwd = formPwd.trim();
    if (!name) { setFormError('请输入姓名'); return; }
    if (!code) { setFormError('请输入登录账号'); return; }
    if (pwd.length < 4) { setFormError('密码至少4位'); return; }

    setSaving(true);
    setFormError('');
    setFormSuccess('');

    const { error } = await supabase.from('employees').insert({
      real_name: name,
      emp_code: code,
      password: pwd,
      role: formRole,
      is_active: true,
    });

    setSaving(false);
    if (error) {
      if (error.code === '23505') setFormError('该账号已存在，请换一个');
      else setFormError('添加失败：' + error.message);
      return;
    }
    await supabase.from('audit_logs').insert({
      operator_id: session?.id ?? 0,
      operator_name: session?.real_name ?? '未知',
      operator_role: session?.role ?? 'user',
      action: '新增',
      target_type: 'employee',
      target_desc: name,
      detail: `新增员工账号「${name}」(${code})，角色：${formRole}`,
    });
    setFormSuccess(`员工「${name}」添加成功！`);
    setFormName(''); setFormCode(''); setFormPwd(''); setFormRole('user');
    await fetchEmployees();
    setTimeout(() => { setFormSuccess(''); setMode('list'); }, 1200);
  };

  const resetForm = () => {
    setFormName(''); setFormCode(''); setFormPwd('');
    setFormRole('user'); setFormError(''); setFormSuccess('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
      {/* Header */}
      <LinearGradient
        colors={['#0D1B4B', '#1A3A8F', '#0052CC']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}
            style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={18} color="#fff" />
          </Pressable>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', flex: 1 }}>员工管理</Text>
          {/* 仅永久管理员可新增员工 */}
          {mode === 'list' && isPermanentAdmin && (
            <Pressable
              onPress={() => { resetForm(); setMode('add'); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#10B981', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}
              android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
            >
              <Plus size={15} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>添加员工</Text>
            </Pressable>
          )}
          {mode === 'add' && (
            <Pressable onPress={() => setMode('list')} hitSlop={10}
              style={{ width: 32, height: 32, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} color="#fff" />
            </Pressable>
          )}
        </View>
      </LinearGradient>

      {/* ── 列表模式 */}
      {mode === 'list' && (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
          {listLoading && (
            <View style={{ paddingTop: 4 }}>
              {[0,1,2,3].map((i) => <EmployeeCardSkeleton key={i} />)}
            </View>
          )}
          {!listLoading && listError ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <Text style={{ color: '#94A3B8', fontSize: 14 }}>{listError}</Text>
              <Pressable onPress={fetchEmployees} style={{ backgroundColor: '#3B82F6', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>重新加载</Text>
              </Pressable>
            </View>
          ) : null}
          {!listLoading && !listError && (
            <FlatList
              data={employees}
              keyExtractor={(e) => String(e.id)}
              contentInsetAdjustmentBehavior="automatic"
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={listRefreshing}
                  onRefresh={async () => {
                    setListRefreshing(true);
                    await fetchEmployees();
                    setListRefreshing(false);
                  }}
                  colors={['#3B82F6']}
                  tintColor="#3B82F6"
                />
              }
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 60, gap: 10 }}>
                  <User size={40} color="#334155" />
                  <Text style={{ color: '#475569', fontSize: 14 }}>暂无员工，点击右上角添加</Text>
                </View>
              }
              renderItem={({ item, index }) => {
                const isTempActive = !!(item.temp_admin_expires_at && new Date(item.temp_admin_expires_at) > new Date());
                const canOperate = item.role !== 'admin' && item.id !== session?.id;
                return (
                <Animated.View entering={FadeInDown.delay(index * 60).duration(350)} style={{
                  backgroundColor: '#1E293B', borderRadius: 16, marginBottom: 12,
                  borderWidth: 1,
                  borderColor: isTempActive ? 'rgba(139,92,246,0.4)' : item.is_active ? 'rgba(59,130,246,0.22)' : 'rgba(255,255,255,0.08)',
                  opacity: item.is_active ? 1 : 0.65,
                  overflow: 'hidden',
                  shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
                }}>
                  {/* 顶部信息行 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
                    {/* 头像 */}
                    <View style={{
                      width: 48, height: 48, borderRadius: 16,
                      overflow: 'hidden',
                      backgroundColor:
                        item.role === 'admin' ? 'rgba(245,158,11,0.2)'
                        : item.role === 'assistant' ? 'rgba(6,182,212,0.18)'
                        : isTempActive ? 'rgba(139,92,246,0.2)'
                        : 'rgba(59,130,246,0.15)',
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1.5,
                      borderColor:
                        item.role === 'admin' ? 'rgba(245,158,11,0.35)'
                        : item.role === 'assistant' ? 'rgba(6,182,212,0.3)'
                        : isTempActive ? 'rgba(139,92,246,0.35)'
                        : 'rgba(59,130,246,0.25)',
                    }}>
                      {item.avatar_url ? (
                        <ExpoImage
                          source={{ uri: item.avatar_url }}
                          style={{ width: 48, height: 48 }}
                          contentFit="cover"
                          transition={200}
                        />
                      ) : (
                        item.role === 'admin' ? <ShieldCheck size={22} color="#F59E0B" />
                          : item.role === 'assistant' ? <ShieldHalf size={22} color="#22D3EE" />
                          : isTempActive ? <ShieldHalf size={22} color="#A78BFA" />
                          : <User size={22} color="#60A5FA" />
                      )}
                    </View>

                    {/* 姓名 + 徽章 + 账号 */}
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={{ color: '#F1F5F9', fontSize: 15, fontWeight: '700' }}>{item.real_name}</Text>
                        {item.role === 'admin' ? (
                          <LinearGradient colors={['#92400E', '#D97706', '#F59E0B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <ShieldCheck size={9} color="#fff" />
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>系统管理员</Text>
                          </LinearGradient>
                        ) : item.role === 'assistant' ? (
                          <LinearGradient colors={['#164E63', '#0E7490', '#06B6D4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <ShieldHalf size={9} color="#CFFAFE" />
                            <Text style={{ color: '#CFFAFE', fontSize: 9, fontWeight: '800' }}>管理员助理</Text>
                          </LinearGradient>
                        ) : isTempActive ? (
                          <LinearGradient colors={['#4C1D95', '#7C3AED', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <ShieldHalf size={9} color="#E9D5FF" />
                            <Text style={{ color: '#E9D5FF', fontSize: 9, fontWeight: '800' }}>临时管理员</Text>
                          </LinearGradient>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: 'rgba(148,163,184,0.13)', borderWidth: 1, borderColor: 'rgba(148,163,184,0.2)' }}>
                            <User size={9} color="#94A3B8" />
                            <Text style={{ color: '#94A3B8', fontSize: 9, fontWeight: '700' }}>普通员工</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Text style={{ color: '#64748B', fontSize: 12 }}>账号：{item.emp_code}</Text>
                        <Text style={{ color: item.is_active ? '#22C55E' : '#EF4444', fontSize: 11, fontWeight: '600' }}>
                          {item.is_active ? '● 在职' : '● 停用'}
                        </Text>
                        {isTempActive && (
                          <Text style={{ color: '#A78BFA', fontSize: 11 }}>⏱ {formatTempExpiry(item.temp_admin_expires_at)}</Text>
                        )}
                      </View>
                      {/* 设备绑定信息（所有角色均有绑定机制） */}
                      {(
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {item.bound_device_id ? (() => {
                            const parts = item.bound_device_id.split('|');
                            const model = parts[0] ?? '未知设备';
                            const os = parts[1] ?? '';
                            const build = parts[2] ?? '';
                            const isWeb = model.startsWith('web');
                            return (
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', flex: 1 }}>
                                  <Smartphone size={11} color="#4ADE80" />
                                  <Text style={{ color: '#4ADE80', fontSize: 11, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                                    {isWeb
                                      ? `📱 已绑定（预览环境）`
                                      : `${model}${os ? `  ${os}` : ''}${build ? `  ${build}` : ''}`}
                                  </Text>
                                </View>
                                {/* 解绑按钮：仅永久管理员可操作，且不对 admin 账号显示（admin 无需绑定，无需解绑） */}
                                {isPermanentAdmin && item.role !== 'admin' && (
                                  <Pressable
                                    onPress={() => handleUnbindDevice(item)}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(251,191,36,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)' }}
                                    android_ripple={{ color: 'rgba(251,191,36,0.2)', borderless: false }}
                                  >
                                    <Smartphone size={11} color="#FBBF24" />
                                    <Text style={{ color: '#FBBF24', fontSize: 11, fontWeight: '700' }}>解绑</Text>
                                  </Pressable>
                                )}
                              </View>
                            );
                          })() : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(148,163,184,0.15)' }}>
                              <Smartphone size={11} color="#475569" />
                              <Text style={{ color: '#475569', fontSize: 11 }}>未绑定设备</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  </View>

                  {/* 底部操作栏（仅可操作员工显示，用分隔线区分） */}
                  {canOperate && (
                    <View style={{
                      flexDirection: 'row', borderTopWidth: 1,
                      borderTopColor: 'rgba(255,255,255,0.07)',
                      backgroundColor: 'rgba(0,0,0,0.1)',
                    }}>
                      {/* 临时授权：仅对普通员工(user)，助理已有管理权限无需授权 */}
                      {(isPermanentAdmin || isAssistant) && item.role === 'user' && (
                        <Pressable
                          onPress={() => router.push({ pathname: '/(app)/temp-auth' as never })}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12 }}
                          android_ripple={{ color: 'rgba(139,92,246,0.15)', borderless: false }}
                        >
                          <Clock size={14} color="#A78BFA" />
                          <Text style={{ color: '#A78BFA', fontSize: 12, fontWeight: '600' }}>临时授权</Text>
                        </Pressable>
                      )}
                      {/* 解绑设备按钮已移至卡片信息区设备行，此处不再重复 */}
                      {/* 角色切换 */}
                      {isPermanentAdmin && (
                        <>
                          {(isPermanentAdmin || isAssistant) && item.role === 'user' && (
                            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                          )}
                          <Pressable
                            onPress={() => setRoleTarget(item)}
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12 }}
                            android_ripple={{ color: 'rgba(6,182,212,0.15)', borderless: false }}
                          >
                            {item.role === 'user'
                              ? <ShieldHalf size={14} color="#22D3EE" />
                              : <User size={14} color="#60A5FA" />}
                            <Text style={{ color: item.role === 'user' ? '#22D3EE' : '#60A5FA', fontSize: 12, fontWeight: '600' }}>
                              {item.role === 'user' ? '升为助理' : '改为员工'}
                            </Text>
                          </Pressable>
                          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                          <Pressable
                            onPress={() => toggleActive(item)}
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12 }}
                            android_ripple={{ color: 'rgba(239,68,68,0.15)', borderless: false }}
                          >
                            {item.is_active ? <UserX size={14} color="#F87171" /> : <UserCheck size={14} color="#4ADE80" />}
                            <Text style={{ color: item.is_active ? '#F87171' : '#4ADE80', fontSize: 12, fontWeight: '600' }}>
                              {item.is_active ? '停用' : '启用'}
                            </Text>
                          </Pressable>
                          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
                          <Pressable
                            onPress={() => setDeleteTarget(item)}
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12 }}
                            android_ripple={{ color: 'rgba(239,68,68,0.15)', borderless: false }}
                          >
                            <Trash2 size={14} color="#F87171" />
                            <Text style={{ color: '#F87171', fontSize: 12, fontWeight: '600' }}>删除</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                </Animated.View>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ── 角色切换确认弹窗 */}
      {roleTarget && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 24,
        }}>
          <View style={{
            backgroundColor: '#1E293B', borderRadius: 16, padding: 24,
            borderWidth: 1, borderColor: 'rgba(6,182,212,0.3)', width: '100%',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {roleTarget.role === 'user'
                ? <ShieldHalf size={20} color="#22D3EE" />
                : <User size={20} color="#60A5FA" />}
              <Text style={{ color: '#F1F5F9', fontSize: 17, fontWeight: '700' }}>确认切换角色</Text>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 14, lineHeight: 22, marginBottom: 20 }}>
              将{' '}
              <Text style={{ color: '#F1F5F9', fontWeight: '600' }}>{roleTarget.real_name}</Text>
              {' '}的角色从{' '}
              <Text style={{ color: roleTarget.role === 'user' ? '#60A5FA' : '#22D3EE', fontWeight: '600' }}>
                {roleTarget.role === 'user' ? '普通员工' : '管理员助理'}
              </Text>
              {' '}切换为{' '}
              <Text style={{ color: roleTarget.role === 'user' ? '#22D3EE' : '#60A5FA', fontWeight: '600' }}>
                {roleTarget.role === 'user' ? '管理员助理' : '普通员工'}
              </Text>
              ？
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setRoleTarget(null)}
                style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#94A3B8', fontWeight: '600', fontSize: 15 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleRoleSwitch}
                disabled={roleSwitching}
                style={{ flex: 1, backgroundColor: roleTarget.role === 'user' ? '#0E7490' : '#1D4ED8', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                {roleSwitching
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>确认切换</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* ── 删除确认弹窗 */}
      {deleteTarget && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 24,
        }}>
          <View style={{
            backgroundColor: '#1E293B', borderRadius: 16, padding: 24,
            borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', width: '100%',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Trash2 size={20} color="#EF4444" />
              <Text style={{ color: '#F1F5F9', fontSize: 17, fontWeight: '700' }}>确认删除</Text>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 14, lineHeight: 22, marginBottom: 20 }}>
              确认删除员工{' '}
              <Text style={{ color: '#F1F5F9', fontWeight: '600' }}>{deleteTarget.real_name}</Text>
              （账号：{deleteTarget.emp_code}）？删除后无法恢复。
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setDeleteTarget(null)}
                style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#94A3B8', fontWeight: '600', fontSize: 15 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                disabled={deleting}
                style={{ flex: 1, backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>确认删除</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* ── 新增员工表单 */}
      {mode === 'add' && (
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 姓名 */}
            <View style={{ gap: 8 }}>
              <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '600' }}>员工姓名 *</Text>
              <View style={{ backgroundColor: '#1E293B', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <User size={16} color="#475569" />
                <TextInput
                  value={formName}
                  onChangeText={(t) => { setFormName(t); setFormError(''); }}
                  placeholder="输入真实姓名"
                  placeholderTextColor="#334155"
                  style={{ flex: 1, color: '#F1F5F9', fontSize: 15 }}
                />
              </View>
            </View>

            {/* 账号 */}
            <View style={{ gap: 8 }}>
              <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '600' }}>登录账号 *</Text>
              <View style={{ backgroundColor: '#1E293B', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Shield size={16} color="#475569" />
                <TextInput
                  value={formCode}
                  onChangeText={(t) => { setFormCode(t.toUpperCase()); setFormError(''); }}
                  placeholder="如：ZS001（自动转大写）"
                  placeholderTextColor="#334155"
                  autoCapitalize="characters"
                  style={{ flex: 1, color: '#F1F5F9', fontSize: 15, letterSpacing: 1 }}
                />
              </View>
            </View>

            {/* 密码 */}
            <View style={{ gap: 8 }}>
              <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '600' }}>登录密码 *（至少4位）</Text>
              <View style={{ backgroundColor: '#1E293B', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Shield size={16} color="#475569" />
                <TextInput
                  value={formPwd}
                  onChangeText={(t) => { setFormPwd(t); setFormError(''); }}
                  placeholder="设置登录密码"
                  placeholderTextColor="#334155"
                  secureTextEntry={!showPwd}
                  style={{ flex: 1, color: '#F1F5F9', fontSize: 15 }}
                />
                <Pressable onPress={() => setShowPwd(!showPwd)} hitSlop={8}>
                  {showPwd ? <EyeOff size={16} color="#475569" /> : <Eye size={16} color="#475569" />}
                </Pressable>
              </View>
            </View>

            {/* 权限 */}
            <View style={{ gap: 8 }}>
              <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '600' }}>权限角色</Text>
              {/* 琴键式角色选择 */}
              <View style={{ flexDirection: 'row', gap: 1.5, borderRadius: 10, overflow: 'hidden', backgroundColor: '#0A0F1E', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)' }}>
                {(['user', 'assistant'] as const).map((r) => {
                  const color = r === 'assistant' ? '#F59E0B' : '#3B82F6';
                  return (
                    <RoleKeyItem
                      key={r}
                      label={r === 'assistant' ? '🛡️ 管理员助理' : '👤 普通员工'}
                      color={color}
                      active={formRole === r}
                      onPress={() => setFormRole(r)}
                    />
                  );
                })}
              </View>
            </View>

            {/* 错误/成功提示 */}
            {!!formError && (
              <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' }}>
                <Text style={{ color: '#FCA5A5', fontSize: 13 }}>{formError}</Text>
              </View>
            )}
            {!!formSuccess && (
              <View style={{ backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' }}>
                <Text style={{ color: '#86EFAC', fontSize: 13 }}>{formSuccess}</Text>
              </View>
            )}

            {/* 提交按钮 */}
            <Pressable
              onPress={handleAdd}
              disabled={saving}
              style={{ backgroundColor: '#3B82F6', borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, shadowColor: '#3B82F6', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
              android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Save size={17} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>确认添加</Text>
                  </>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
