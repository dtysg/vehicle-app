import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline, Circle, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ChevronLeft, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { supabase } from '@/client/supabase';

interface DayPoint { date: string; brent: number; wti: number; oman: number; minas: number; }
interface Crude5dData {
  days: DayPoint[];
  avgBrent: number; avgWti: number; avgOman: number; avgMinas: number;
  perLiterBrent: number; perLiterWti: number; perLiterOman: number; perLiterMinas: number;
  devBrent: number; devWti: number; devOman: number; devMinas: number;
  rmbRate: number; actualDays: number; updatedAt: string; source: string;
}

const CARD_SHADOW = {
  shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
} as const;

const VARIETIES = [
  { key: 'Brent', label: '布伦特', color: '#FBBF24', avg: (d: Crude5dData) => d.avgBrent, perLiter: (d: Crude5dData) => d.perLiterBrent, dev: (d: Crude5dData) => d.devBrent, series: (p: DayPoint) => p.brent },
  { key: 'Wti', label: 'WTI', color: '#60A5FA', avg: (d: Crude5dData) => d.avgWti, perLiter: (d: Crude5dData) => d.perLiterWti, dev: (d: Crude5dData) => d.devWti, series: (p: DayPoint) => p.wti },
  { key: 'Oman', label: '阿曼', color: '#34D399', avg: (d: Crude5dData) => d.avgOman, perLiter: (d: Crude5dData) => d.perLiterOman, dev: (d: Crude5dData) => d.devOman, series: (p: DayPoint) => p.oman },
  { key: 'Minas', label: '米纳斯', color: '#A78BFA', avg: (d: Crude5dData) => d.avgMinas, perLiter: (d: Crude5dData) => d.perLiterMinas, dev: (d: Crude5dData) => d.devMinas, series: (p: DayPoint) => p.minas },
] as const;

function DevBadge({ dev }: { dev: number }) {
  const up = dev > 0.05;
  const down = dev < -0.05;
  const color = up ? '#F87171' : down ? '#4ADE80' : 'rgba(255,255,255,0.4)';
  const bg = up ? 'rgba(248,113,113,0.16)' : down ? 'rgba(74,222,128,0.16)' : 'rgba(255,255,255,0.06)';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const text = up ? `高于均价 ${dev.toFixed(2)}%` : down ? `低于均价 ${Math.abs(dev).toFixed(2)}%` : '持平';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20, backgroundColor: bg, borderWidth: 1, borderColor: color + '55', alignSelf: 'flex-start' }}>
      <Icon size={10} color={color} />
      <Text style={{ color, fontSize: 9, fontWeight: '800' }}>{text}</Text>
    </View>
  );
}

export default function CrudeAvgPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [data, setData] = useState<Crude5dData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke('oilprice-crude-5d', { body: {} });
      if (fnErr || !res?.data) throw new Error(fnErr?.message ?? '数据获取失败');
      setData(res.data as Crude5dData);
    } catch (e) {
      setError((e as Error)?.message ?? '数据获取失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(false); }, [fetchData]));

  const chartW = Math.min(width - 32, 460);
  const chartH = 200;
  const padL = 38, padR = 12, padT = 14, padB = 26;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const buildPoints = (series: (p: DayPoint) => number) => {
    if (!data || data.days.length === 0) return '';
    const vals = data.days.map(series);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    return data.days.map((p, i) => {
      const x = padL + (data.days.length === 1 ? innerW / 2 : (innerW * i) / (data.days.length - 1));
      const y = padT + innerH - ((series(p) - min) / range) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };

  const yTicks = (() => {
    if (!data || data.days.length === 0) return null;
    const all = data.days.flatMap(p => [p.brent, p.wti, p.oman, p.minas]);
    const min = Math.floor(Math.min(...all) - 1);
    const max = Math.ceil(Math.max(...all) + 1);
    const step = Math.max(1, Math.round((max - min) / 4));
    const ticks: number[] = [];
    for (let v = min; v <= max; v += step) ticks.push(v);
    return { ticks, min, max };
  })();

  const yToPx = (v: number) => {
    if (!yTicks) return 0;
    const range = yTicks.max - yTicks.min || 1;
    return padT + innerH - ((v - yTicks.min) / range) * innerH;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#070B16' }}>
      {/* 顶部导航 */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#0B1220', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <ChevronLeft size={22} color="#FBBF24" />
            <Text style={{ color: '#FBBF24', fontSize: 14, fontWeight: '700' }}>返回</Text>
          </Pressable>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 }}>5天活动均价</Text>
          <Pressable
            onPress={() => fetchData(true)}
            disabled={refreshing}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(251,191,36,0.14)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' }}
          >
            {refreshing ? <ActivityIndicator size="small" color="#FBBF24" style={{ transform: [{ scale: 0.6 }] }} /> : <RefreshCw size={12} color="#FBBF24" />}
            <Text style={{ color: '#FBBF24', fontSize: 11, fontWeight: '700' }}>刷新</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={{ paddingVertical: 80, alignItems: 'center', gap: 10 }}>
            <ActivityIndicator size="large" color="#FBBF24" />
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>正在获取国际原油数据…</Text>
          </View>
        ) : error || !data ? (
          <View style={{ paddingVertical: 80, alignItems: 'center', gap: 12 }}>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{error || '暂无数据'}</Text>
            <Pressable onPress={() => fetchData(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(251,191,36,0.14)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' }}>
              <RefreshCw size={13} color="#FBBF24" />
              <Text style={{ color: '#FBBF24', fontSize: 12, fontWeight: '700' }}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* 汇总卡 */}
            <Animated.View entering={FadeInDown.duration(260)} style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(251,191,36,0.32)', ...CARD_SHADOW, marginBottom: 12 }}>
              <LinearGradient colors={['rgba(130,85,8,0.68)', 'rgba(72,46,4,0.80)', 'rgba(28,16,2,0.90)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, gap: 6 }}>
                <Text style={{ color: 'rgba(252,211,77,0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>布伦特原油 · 近{data.actualDays}个交易日活动均价</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text style={{ color: '#FBBF24', fontSize: 44, fontWeight: '900', letterSpacing: -1 }}>{data.avgBrent}</Text>
                  <Text style={{ color: 'rgba(252,211,77,0.6)', fontSize: 14, fontWeight: '700' }}>美元/桶</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>折算 <Text style={{ color: '#FCD34D', fontWeight: '800' }}>{data.perLiterBrent}</Text> 元/升</Text>
                  <DevBadge dev={data.devBrent} />
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 2 }}>汇率 {data.rmbRate} · 更新于 {data.updatedAt.slice(11, 16)}</Text>
              </LinearGradient>
            </Animated.View>

            {/* 四品种均价 */}
            <Animated.View entering={FadeInDown.delay(80).duration(260)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {VARIETIES.map((v) => (
                <View key={v.key} style={{ flexBasis: '47%', flexGrow: 1, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: v.color + '33', ...CARD_SHADOW }}>
                  <LinearGradient colors={[v.color + '1F', 'rgba(0,0,0,0.25)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 12, gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: v.color }} />
                      <Text style={{ color: v.color, fontSize: 12, fontWeight: '800' }}>{v.label}</Text>
                    </View>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{v.avg(data)}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>美元/桶</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>折算 <Text style={{ color: v.color, fontWeight: '800' }}>{v.perLiter(data)}</Text> 元/升</Text>
                    <DevBadge dev={v.dev(data)} />
                  </LinearGradient>
                </View>
              ))}
            </Animated.View>

            {/* 走势图 */}
            <Animated.View entering={FadeInDown.delay(140).duration(260)} style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', ...CARD_SHADOW, marginBottom: 12 }}>
              <LinearGradient colors={['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.2)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 12, gap: 10 }}>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>近{data.actualDays}日价格走势</Text>
                <Svg width={chartW} height={chartH}>
                  {/* Y轴刻度线 */}
                  {yTicks && yTicks.ticks.map((t: number, i: number) => (
                    <React.Fragment key={i}>
                      <SvgLine x1={padL} y1={yToPx(t)} x2={chartW - padR} y2={yToPx(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                      <SvgText x={padL - 6} y={yToPx(t) + 3} fill="rgba(255,255,255,0.35)" fontSize={9} textAnchor="end">{t}</SvgText>
                    </React.Fragment>
                  ))}
                  {/* 四条曲线 */}
                  {VARIETIES.map((v) => (
                    <React.Fragment key={v.key}>
                      <Polyline points={buildPoints(v.series)} fill="none" stroke={v.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                      {data.days.map((p, i) => {
                        const pts = buildPoints(v.series).split(' ');
                        const [x, y] = pts[i]?.split(',').map(Number) ?? [0, 0];
                        return <Circle key={i} cx={x} cy={y} r={2.5} fill={v.color} />;
                      })}
                    </React.Fragment>
                  ))}
                  {/* X轴日期 */}
                  {data.days.map((p, i) => {
                    const x = padL + (data.days.length === 1 ? innerW / 2 : (innerW * i) / (data.days.length - 1));
                    return <SvgText key={i} x={x} y={chartH - 8} fill="rgba(255,255,255,0.35)" fontSize={9} textAnchor="middle">{p.date.slice(5)}</SvgText>;
                  })}
                </Svg>
                {/* 图例 */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {VARIETIES.map((v) => (
                    <View key={v.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: v.color }} />
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '600' }}>{v.label}</Text>
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </Animated.View>

            <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, lineHeight: 15, paddingHorizontal: 4 }}>
              数据来源：FRED（布伦特/WTI 官方现货价，滞后约1交易日）。阿曼、米纳斯无免费独立源，按普氏利差推算（阿曼≈布伦特-8.5，米纳斯≈阿曼-3.2）。折算每升 = 桶价 × 汇率 ÷ 158.98 升。仅供参考。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}