import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline, Circle, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ChevronLeft, RefreshCw, TrendingUp } from 'lucide-react-native';
import { supabase } from '@/client/supabase';

interface DayPoint {
  date: string;
  brent: number;
  wti: number;
  ma5Brent: number;
  ma5Wti: number;
  basketAvg: number;
}
interface Crude5dData {
  days: DayPoint[];
  startDate: string;
  targetCount: number;
  latestBrent: number;
  latestMa5: number;
  latestBasket: number;
  perLiterBasket: number;
  rmbRate: number;
  actualDays: number;
  updatedAt: string;
  source: string;
}

const CARD_SHADOW = {
  shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
} as const;

const LITERS_PER_BARREL = 158.98;

function StatBox({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <View style={{ flex: 1, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: color + '33', ...CARD_SHADOW }}>
      <LinearGradient colors={[color + '1F', 'rgba(0,0,0,0.25)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 12, gap: 4 }}>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700' }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
          <Text style={{ color, fontSize: 22, fontWeight: '900' }}>{value}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>{unit}</Text>
        </View>
      </LinearGradient>
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
  const chartH = 220;
  const padL = 40, padR = 14, padT = 16, padB = 28;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const series = data?.days ?? [];
  const yRange = (() => {
    if (series.length === 0) return null;
    const all = series.flatMap(p => [p.ma5Brent, p.ma5Wti, p.basketAvg]);
    const min = Math.floor(Math.min(...all) - 1);
    const max = Math.ceil(Math.max(...all) + 1);
    const step = Math.max(1, Math.round((max - min) / 4));
    const ticks: number[] = [];
    for (let v = min; v <= max; v += step) ticks.push(v);
    return { ticks, min, max };
  })();

  const yToPx = (v: number) => {
    if (!yRange) return 0;
    const range = yRange.max - yRange.min || 1;
    return padT + innerH - ((v - yRange.min) / range) * innerH;
  };

  const buildPoints = (sel: (p: DayPoint) => number) => {
    if (series.length === 0) return '';
    return series.map((p, i) => {
      const x = padL + (series.length === 1 ? innerW / 2 : (innerW * i) / (series.length - 1));
      const y = yToPx(sel(p));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
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
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 }}>5天滚动均价</Text>
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
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>正在抓取国际原油数据…</Text>
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
            {/* 说明 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, paddingHorizontal: 2 }}>
              <TrendingUp size={13} color="rgba(251,191,36,0.7)" />
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, lineHeight: 16, flex: 1 }}>
                从 {data.startDate.slice(5)} 起统计 {data.targetCount} 个工作日（周末/节假日不计），每个工作日给出截至该日的最近 5 个交易日滚动均价。
              </Text>
            </View>
            {/* 进度 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 2 }}>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <View style={{ width: `${Math.round((data.actualDays / data.targetCount) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: '#FBBF24' }} />
              </View>
              <Text style={{ color: '#FBBF24', fontSize: 11, fontWeight: '800' }}>已统计 {data.actualDays}/{data.targetCount}</Text>
            </View>

            {/* 最新值汇总 */}
            <Animated.View entering={FadeInDown.duration(260)} style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <StatBox label="最新布伦特现货" value={String(data.latestBrent)} unit="美元/桶" color="#FBBF24" />
              <StatBox label="最新滚动均价(MA5)" value={String(data.latestMa5)} unit="美元/桶" color="#60A5FA" />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(60).duration(260)} style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(251,191,36,0.32)', ...CARD_SHADOW, marginBottom: 12 }}>
              <LinearGradient colors={['rgba(130,85,8,0.68)', 'rgba(72,46,4,0.80)', 'rgba(28,16,2,0.90)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 4 }}>
                <Text style={{ color: 'rgba(252,211,77,0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>发改委一揽子测算均价（最新）</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text style={{ color: '#FBBF24', fontSize: 40, fontWeight: '900', letterSpacing: -1 }}>{data.latestBasket}</Text>
                  <Text style={{ color: 'rgba(252,211,77,0.6)', fontSize: 13, fontWeight: '700' }}>美元/桶</Text>
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>折算 <Text style={{ color: '#FCD34D', fontWeight: '800' }}>{data.perLiterBasket}</Text> 元/升 · 汇率 {data.rmbRate}</Text>
              </LinearGradient>
            </Animated.View>

            {/* 连续5天具体数值表格 */}
            <Animated.View entering={FadeInDown.delay(100).duration(260)} style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', ...CARD_SHADOW, marginBottom: 12 }}>
              <LinearGradient colors={['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.2)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 12 }}>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800', letterSpacing: 0.3, marginBottom: 8 }}>连续 {data.actualDays} 天滚动均价明细</Text>
                {/* 表头 */}
                <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ flex: 1.1, color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700' }}>日期</Text>
                  <Text style={{ flex: 1, color: '#FBBF24', fontSize: 10, fontWeight: '700', textAlign: 'right' }}>布伦特现货</Text>
                  <Text style={{ flex: 1, color: '#60A5FA', fontSize: 10, fontWeight: '700', textAlign: 'right' }}>滚动均价</Text>
                  <Text style={{ flex: 1, color: '#34D399', fontSize: 10, fontWeight: '700', textAlign: 'right' }}>测算均价</Text>
                </View>
                {data.days.map((p, i) => (
                  <View key={p.date} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i === data.days.length - 1 ? 0 : 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={{ flex: 1.1, color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' }}>{p.date.slice(5)}</Text>
                    <Text style={{ flex: 1, color: '#FBBF24', fontSize: 12, fontWeight: '800', textAlign: 'right' }}>{p.brent}</Text>
                    <Text style={{ flex: 1, color: '#60A5FA', fontSize: 12, fontWeight: '800', textAlign: 'right' }}>{p.ma5Brent}</Text>
                    <Text style={{ flex: 1, color: '#34D399', fontSize: 12, fontWeight: '800', textAlign: 'right' }}>{p.basketAvg}</Text>
                  </View>
                ))}
              </LinearGradient>
            </Animated.View>

            {/* 走势图 */}
            <Animated.View entering={FadeInDown.delay(140).duration(260)} style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', ...CARD_SHADOW, marginBottom: 12 }}>
              <LinearGradient colors={['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.2)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 12, gap: 10 }}>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>滚动均价走势</Text>
                <Svg width={chartW} height={chartH}>
                  {yRange && yRange.ticks.map((t: number, i: number) => (
                    <React.Fragment key={i}>
                      <SvgLine x1={padL} y1={yToPx(t)} x2={chartW - padR} y2={yToPx(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                      <SvgText x={padL - 6} y={yToPx(t) + 3} fill="rgba(255,255,255,0.35)" fontSize={9} textAnchor="end">{t}</SvgText>
                    </React.Fragment>
                  ))}
                  {/* 滚动均价线 */}
                  <Polyline points={buildPoints(p => p.ma5Brent)} fill="none" stroke="#60A5FA" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
                  {series.map((p, i) => {
                    const pts = buildPoints(x => x.ma5Brent).split(' ');
                    const [x, y] = pts[i]?.split(',').map(Number) ?? [0, 0];
                    return <Circle key={`b${i}`} cx={x} cy={y} r={3} fill="#60A5FA" />;
                  })}
                  {/* 一揽子测算均价线 */}
                  <Polyline points={buildPoints(p => p.basketAvg)} fill="none" stroke="#34D399" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
                  {series.map((p, i) => {
                    const pts = buildPoints(x => x.basketAvg).split(' ');
                    const [x, y] = pts[i]?.split(',').map(Number) ?? [0, 0];
                    return <Circle key={`k${i}`} cx={x} cy={y} r={3} fill="#34D399" />;
                  })}
                  {/* X轴日期 */}
                  {series.map((p, i) => {
                    const x = padL + (series.length === 1 ? innerW / 2 : (innerW * i) / (series.length - 1));
                    return <SvgText key={i} x={x} y={chartH - 8} fill="rgba(255,255,255,0.35)" fontSize={9} textAnchor="middle">{p.date.slice(5)}</SvgText>;
                  })}
                </Svg>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: '#60A5FA' }} />
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '600' }}>布伦特滚动均价</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: '#34D399' }} />
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '600' }}>一揽子测算均价</Text>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>

            <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, lineHeight: 15, paddingHorizontal: 4 }}>
              数据来源：FRED 官方现货价（布伦特/WTI，政府数据，滞后约1交易日）。滚动均价 = 截至该交易日的最近5个交易日均价。一揽子测算均价 = 布伦特×40% + 阿曼×30% + 米纳斯×30%（阿曼≈布伦特-8.5，米纳斯≈阿曼-3.2）。折算每升 = 桶价 × 汇率 ÷ {LITERS_PER_BARREL} 升。仅供参考。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}