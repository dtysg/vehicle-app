import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useCallback, useRef } from 'react';import { View, Text, ScrollView, Pressable, ActivityIndicator, Animated as RNAnimated } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Bell, ChevronLeft, Fuel, TrendingUp, TrendingDown, Minus, Clock, Trash2, Car } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';

type Notif = {
  id: number;
  type: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  created_at: string;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  const dt = new Date(iso);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function TrendIcon({ val }: { val: number }) {
  if (val > 0) return <TrendingUp size={15} color="#F97316" />;
  if (val < 0) return <TrendingDown size={15} color="#34D399" />;
  return <Minus size={15} color="#94A3B8" />;
}

// 限行通知卡片（蓝色调）
function RestrictCard({
  item, idx, canDelete, onDelete,
}: {
  item: Notif; idx: number; canDelete: boolean; onDelete: (id: number) => void;
}) {
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const [swiped, setSwiped] = useState(false);
  const [pressed, setPressed] = useState(false);

  const meta = item.meta ?? {};
  const cityname = String(meta.cityname ?? '');
  const number   = String(meta.number ?? '');
  const area     = String(meta.area ?? '');
  const week     = String(meta.week ?? '');
  const timeArr  = Array.isArray(meta.time) ? (meta.time as string[]) : [];
  const dateStr  = String(meta.date ?? '');

  const handleSwipe = () => {
    if (swiped) {
      RNAnimated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      setSwiped(false);
    } else {
      RNAnimated.spring(translateX, { toValue: -70, useNativeDriver: true }).start();
      setSwiped(true);
    }
  };

  const handleDelete = () => {
    RNAnimated.timing(translateX, { toValue: -400, duration: 250, useNativeDriver: true }).start(() => {
      onDelete(item.id);
    });
  };

  return (
    <Animated.View entering={FadeInDown.delay(idx * 50).duration(300)} style={{ marginBottom: 10 }}>
      <View style={{ overflow: 'hidden', borderRadius: 16 }}>
        {canDelete && (
          <View style={{
            position: 'absolute', top: 0, bottom: 0, right: 0, width: 70,
            backgroundColor: '#DC2626',
            alignItems: 'center', justifyContent: 'center', borderRadius: 16,
          }}>
            <Pressable onPress={handleDelete} style={{ alignItems: 'center', gap: 2 }}>
              <Trash2 size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>删除</Text>
            </Pressable>
          </View>
        )}
        <RNAnimated.View style={{ transform: [{ translateX }] }}>
          <Pressable
            onPress={canDelete ? handleSwipe : undefined}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            style={{ opacity: pressed ? 0.92 : 1 }}
          >
            <LinearGradient
              colors={['#0C1E3B', '#0A1A35', '#071228']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(96,165,250,0.35)', overflow: 'hidden' }}
            >
              {/* 标题行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10, gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(96,165,250,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                  <Car size={17} color="#60A5FA" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#E0F2FE', fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Clock size={10} color="rgba(255,255,255,0.35)" />
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{timeAgo(item.created_at)}</Text>
                  </View>
                </View>
                {cityname ? (
                  <View style={{ backgroundColor: 'rgba(96,165,250,0.18)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: '#60A5FA', fontSize: 11, fontWeight: '700' }}>{cityname}</Text>
                  </View>
                ) : null}
                {canDelete && <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16 }}>‹</Text>}
              </View>

              {/* 正文 */}
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 18, marginHorizontal: 14, marginBottom: 10 }}>
                {item.body}
              </Text>

              {/* 限行速览 */}
              <View style={{ marginHorizontal: 14, marginBottom: 12, backgroundColor: 'rgba(96,165,250,0.07)', borderRadius: 10, padding: 10, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {number ? (
                  <View style={{ alignItems: 'center', backgroundColor: 'rgba(96,165,250,0.12)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>限行尾号</Text>
                    <Text style={{ color: '#60A5FA', fontSize: 15, fontWeight: '800', marginTop: 1 }}>{number}</Text>
                  </View>
                ) : null}
                {timeArr.length > 0 ? (
                  <View style={{ alignItems: 'center', flex: 1, backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>限行时段</Text>
                    <Text style={{ color: '#93C5FD', fontSize: 11, fontWeight: '700', marginTop: 1, textAlign: 'center' }}>{timeArr.join('\n')}</Text>
                  </View>
                ) : null}
              </View>

              {/* 底部：日期 / 星期 / 区域 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(96,165,250,0.1)', paddingHorizontal: 14, paddingVertical: 8, gap: 6 }}>
                {dateStr ? <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{dateStr}</Text> : null}
                {week ? <><Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>·</Text><Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{week}</Text></> : null}
                {area ? <><View style={{ flex: 1 }} /><Text style={{ color: 'rgba(96,165,250,0.6)', fontSize: 10 }} numberOfLines={1}>{area}</Text></> : null}
              </View>
            </LinearGradient>
          </Pressable>
        </RNAnimated.View>
      </View>
    </Animated.View>
  );
}

// 单条通知卡片（含左滑删除）
function NotifCard({
  item, idx, canDelete, onDelete,
}: {
  item: Notif; idx: number; canDelete: boolean; onDelete: (id: number) => void;
}) {
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const [swiped, setSwiped] = useState(false);
  const [pressed, setPressed] = useState(false);

  const meta = item.meta ?? {};
  const trendVal  = typeof meta.trend_val === 'number' ? meta.trend_val : 0;
  const trendDir  = String(meta.trend_dir ?? '');
  const trendText = String(meta.trend_text ?? '');
  const tianjin   = meta.tianjin as Record<string, string> | undefined;
  const adjustDate = String(meta.adjust_date ?? '');
  const nextDate   = String(meta.next_adjust_date ?? '');
  const isUp   = trendDir === '上调';
  const isDown = trendDir === '下调';

  // 左滑展开删除按钮（60px）
  const handleSwipe = () => {
    if (swiped) {
      RNAnimated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      setSwiped(false);
    } else {
      RNAnimated.spring(translateX, { toValue: -70, useNativeDriver: true }).start();
      setSwiped(true);
    }
  };

  const handleDelete = () => {
    RNAnimated.timing(translateX, { toValue: -400, duration: 250, useNativeDriver: true }).start(() => {
      onDelete(item.id);
    });
  };

  return (
    <Animated.View entering={FadeInDown.delay(idx * 50).duration(300)} style={{ marginBottom: 10 }}>
      <View style={{ overflow: 'hidden', borderRadius: 16 }}>
        {/* 红色删除背景层 */}
        {canDelete && (
          <View style={{
            position: 'absolute', top: 0, bottom: 0, right: 0, width: 70,
            backgroundColor: '#DC2626',
            alignItems: 'center', justifyContent: 'center', borderRadius: 16,
          }}>
            <Pressable onPress={handleDelete} style={{ alignItems: 'center', gap: 2 }}>
              <Trash2 size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>删除</Text>
            </Pressable>
          </View>
        )}

        {/* 主卡片（可左滑） */}
        <RNAnimated.View style={{ transform: [{ translateX }] }}>
          <Pressable
            onPress={canDelete ? handleSwipe : undefined}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            style={{ opacity: pressed ? 0.92 : 1 }}
          >
            <LinearGradient
              colors={
                isUp   ? ['#3B1A0A', '#2D1505', '#1C0A00'] :
                isDown ? ['#052E1A', '#031C10', '#020F08'] :
                         ['#111827', '#0F172A', '#0A0F1E']
              }
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 16, borderWidth: 1,
                borderColor: isUp ? 'rgba(249,115,22,0.3)' : isDown ? 'rgba(52,211,153,0.3)' : 'rgba(99,102,241,0.2)',
                overflow: 'hidden',
              }}
            >
              {/* 标题行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10, gap: 10 }}>
                <View style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: isUp ? 'rgba(249,115,22,0.2)' : isDown ? 'rgba(52,211,153,0.15)' : 'rgba(99,102,241,0.2)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Fuel size={17} color={isUp ? '#F97316' : isDown ? '#34D399' : '#818CF8'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#F1F5F9', fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Clock size={10} color="rgba(255,255,255,0.35)" />
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{timeAgo(item.created_at)}</Text>
                  </View>
                </View>
                {trendDir ? (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 3,
                    backgroundColor: isUp ? 'rgba(249,115,22,0.2)' : isDown ? 'rgba(52,211,153,0.15)' : 'rgba(148,163,184,0.15)',
                    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
                  }}>
                    <TrendIcon val={isUp ? 1 : isDown ? -1 : 0} />
                    <Text style={{ color: isUp ? '#F97316' : isDown ? '#34D399' : '#94A3B8', fontSize: 11, fontWeight: '700' }}>
                      {trendDir}
                    </Text>
                  </View>
                ) : null}
                {/* 左滑提示箭头（管理员可见） */}
                {canDelete && (
                  <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16 }}>‹</Text>
                )}
              </View>

              {/* 正文 */}
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 18, marginHorizontal: 14, marginBottom: 10 }}>
                {item.body}
              </Text>

              {/* 价格速览 */}
              {tianjin?.p92 ? (
                <View style={{
                  marginHorizontal: 14, marginBottom: 12,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: 10, padding: 10,
                  flexDirection: 'row', gap: 6, flexWrap: 'wrap',
                }}>
                  {[
                    { label: '92#',  val: tianjin.p92, color: '#60A5FA' },
                    { label: '95#',  val: tianjin.p95, color: '#FBBF24' },
                    { label: '柴0#', val: tianjin.p0,  color: '#4ADE80' },
                  ].map(({ label, val, color }) => (
                    <View key={label} style={{ alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, minWidth: 64 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>{label}</Text>
                      <Text style={{ color, fontSize: 14, fontWeight: '800', marginTop: 1 }}>{val}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>元/升</Text>
                    </View>
                  ))}
                  {trendVal > 0 && (
                    <View style={{ alignItems: 'center', backgroundColor: isUp ? 'rgba(249,115,22,0.12)' : 'rgba(52,211,153,0.1)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, minWidth: 64 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>调幅</Text>
                      <Text style={{ color: isUp ? '#F97316' : '#34D399', fontSize: 14, fontWeight: '800', marginTop: 1 }}>
                        {isUp ? '+' : '-'}{trendVal.toFixed(2)}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>元/升</Text>
                    </View>
                  )}
                </View>
              ) : null}

              {/* 底部：调价日 / 下期预测 */}
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
                paddingHorizontal: 14, paddingVertical: 8, gap: 8,
              }}>
                {adjustDate ? <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>本期调价日 {adjustDate}</Text> : null}
                {adjustDate && nextDate ? <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>·</Text> : null}
                {nextDate ? <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>下期 {nextDate}</Text> : null}
                {trendText ? (
                  <>
                    <View style={{ flex: 1 }} />
                    <Text style={{ color: isUp ? 'rgba(249,115,22,0.6)' : isDown ? 'rgba(52,211,153,0.6)' : 'rgba(148,163,184,0.5)', fontSize: 10 }}>
                      {trendText}
                    </Text>
                  </>
                ) : null}
              </View>
            </LinearGradient>
          </Pressable>
        </RNAnimated.View>
      </View>
    </Animated.View>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { isAdmin, isPermanentAdmin } = useSession();
  const canDelete = isAdmin || isPermanentAdmin;

  const [list, setList] = useState<Notif[]>([]);
  const [loading, setLoading]     = useState(true);
  const [clearing, setClearing]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // 记录已删除的 id，useFocusEffect 重新加载时过滤，防止 DB 延迟导致"复活"
  const deletedIdsRef = useRef<Set<number>>(new Set());

  useFocusEffect(useCallback(() => {
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      // 过滤掉本地已删除的 id
      const filtered = (data ?? []).filter(n => !deletedIdsRef.current.has(n.id));
      setList(filtered);
      setLoading(false);
    })();
  }, []));

  // 删除单条：先验证 DB 删除成功，再更新本地列表
  const handleDelete = async (id: number) => {
    const { error, count } = await supabase.from('notifications').delete({ count: 'exact' }).eq('id', id);
    if (error || count === 0) {
      setDeleteError('删除失败，请重试');
      setTimeout(() => setDeleteError(''), 3000);
      return;
    }
    // 记录已删除 id，防止 focus 重载时复活
    deletedIdsRef.current.add(id);
    setList(prev => prev.filter(n => n.id !== id));
    // 清理 AsyncStorage 中对应已读记录
    try {
      const raw = await AsyncStorage.getItem('oil_notif_read_ids');
      if (raw) {
        const ids: (number | string)[] = JSON.parse(raw);
        const updated = ids.filter(x => x !== id);
        await AsyncStorage.setItem('oil_notif_read_ids', JSON.stringify(updated));
      }
    } catch (_) { /* 忽略 */ }
  };

  // 清空全部
  const handleClearAll = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearing(true);
    const ids = list.map(n => n.id);
    if (ids.length > 0) {
      const { error } = await supabase.from('notifications').delete().in('id', ids);
      if (error) {
        setDeleteError('清空失败，请重试');
        setTimeout(() => setDeleteError(''), 3000);
        setClearing(false);
        setConfirmClear(false);
        return;
      }
      ids.forEach(id => deletedIdsRef.current.add(id));
    }
    setList([]);
    setClearing(false);
    setConfirmClear(false);
    // 清理 AsyncStorage 中所有已读记录
    try {
      await AsyncStorage.removeItem('oil_notif_read_ids');
    } catch (_) { /* 忽略 */ }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
      {/* 顶部导航栏 */}
      <LinearGradient
        colors={['#0D1B3E', '#091428']}
        style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingBottom: 14, paddingHorizontal: 16, gap: 10 }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}
        >
          <ChevronLeft size={20} color="#93C5FD" />
        </Pressable>
        <Bell size={18} color="#FDBA74" />
        <Text style={{ flex: 1, color: '#fff', fontSize: 17, fontWeight: '700' }}>通知中心</Text>
        {/* 管理员才显示清空按钮 */}
        {canDelete && list.length > 0 && (
          <Pressable
            onPress={handleClearAll}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: confirmClear ? 'rgba(220,38,38,0.25)' : 'rgba(255,255,255,0.08)',
              borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
              borderWidth: 1, borderColor: confirmClear ? 'rgba(220,38,38,0.5)' : 'rgba(255,255,255,0.1)',
            }}
          >
            {clearing
              ? <ActivityIndicator size="small" color="#F87171" />
              : <Trash2 size={13} color={confirmClear ? '#F87171' : 'rgba(255,255,255,0.5)'} />
            }
            <Text style={{ color: confirmClear ? '#F87171' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700' }}>
              {confirmClear ? '确认清空' : '清空'}
            </Text>
          </Pressable>
        )}
        {!canDelete && (
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>最近50条</Text>
        )}
      </LinearGradient>

      {/* 删除失败提示条 */}
      {deleteError ? (
        <View style={{ marginHorizontal: 14, marginTop: 8, backgroundColor: 'rgba(220,38,38,0.18)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(220,38,38,0.35)' }}>
          <Text style={{ color: '#FCA5A5', fontSize: 12, fontWeight: '600' }}>⚠️ {deleteError}</Text>
        </View>
      ) : null}

      {/* 管理员操作提示 */}
      {canDelete && list.length > 0 && (
        <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2 }}>
          <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>← 左滑通知卡片可单条删除</Text>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#60A5FA" size="large" />
          <Text style={{ color: 'rgba(255,255,255,0.4)', marginTop: 12, fontSize: 13 }}>加载通知...</Text>
        </View>
      ) : list.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(251,146,60,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <Bell size={28} color="rgba(251,146,60,0.5)" />
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '600' }}>暂无通知</Text>
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>调价日或有限行时会自动收到提醒</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 40 }}
          onScrollBeginDrag={() => setConfirmClear(false)}
        >
          {list.map((item, idx) => (
            item.type === 'traffic_restrict'
              ? <RestrictCard key={item.id} item={item} idx={idx} canDelete={canDelete} onDelete={handleDelete} />
              : <NotifCard    key={item.id} item={item} idx={idx} canDelete={canDelete} onDelete={handleDelete} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
