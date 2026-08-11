import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  UIManager,
  Linking,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline, Circle, Line, Text as SvgText, Defs, LinearGradient as SvgLinearGradient, Stop, Polygon } from 'react-native-svg';
import { useFocusEffect, useRouter } from 'expo-router';
import { appEvents, EVT_OIL_IMPORTED } from '@/lib/events';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  FadeInDown,
  FadeInUp,
  ZoomIn,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera, Search, X, Car, ChevronRight, Plus, Trash2, ArrowRightLeft, LogOut, Users, FileUp, ShieldCheck, ShieldHalf, User, Clock, HardDriveDownload, ChevronDown, ChevronUp, MessageCircle, ClipboardList, Flame, Droplets, Wind, AlertTriangle, RefreshCw, Crown, Fuel, Timer, Bell, MapPin, CalendarDays, Gauge, TrendingUp, FlaskConical, Zap, Trophy, Tv, Settings2, PackageOpen, ListChecks, Hammer } from 'lucide-react-native';
import DateTimePicker from 'react-native-ui-datepicker';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';
import { VehicleCardSkeleton } from '@/components/Skeleton';
import DraggableFloat from '@/components/DraggableFloat';
import PianoKeyboard, { PianoKey } from '@/components/PianoKeyboard';
import MusicPlayer from '@/components/MusicPlayer';

// 数字滚动进场组件：从下方 +24px 滑入 + 淡入，支持 delay 错落
// ── 调价日期日历选择器（memo隔离，防止父组件重渲染导致视图弹回）──
const AdjustDatePicker = React.memo(({
  initialDate,
  onDateChange,
}: {
  initialDate: Date | undefined;
  onDateChange: (dateStr: string) => void;
}) => {
  const [selected, setSelected] = React.useState<Date | undefined>(initialDate);
  return (
    <DateTimePicker
      mode="single"
      date={selected}
      onChange={(params) => {
        const d = params.date as Date | undefined;
        if (d instanceof Date && !isNaN(d.getTime())) {
          const y = d.getFullYear();
          const mo = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          setSelected(new Date(y, d.getMonth(), d.getDate()));
          onDateChange(`${y}-${mo}-${day}`);
        }
      }}
      locale="zh"
      firstDayOfWeek={1}
      disableMonthPicker
      disableYearPicker
      styles={{
        day_label:            { color: 'rgba(255,255,255,0.85)', fontSize: 13 } as any,
        weekday_label:        { color: 'rgba(255,255,255,0.45)', fontSize: 11 } as any,
        month_label:          { color: 'rgba(255,255,255,0.80)', fontSize: 13 } as any,
        year_label:           { color: 'rgba(255,255,255,0.80)', fontSize: 13 } as any,
        month:                { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8 } as any,
        year:                 { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8 } as any,
        month_selector_label: { color: '#fff', fontWeight: '700', fontSize: 15 } as any,
        year_selector_label:  { color: '#fff', fontWeight: '700', fontSize: 15 } as any,
        button_next_image:    { tintColor: '#FBBF24' } as any,
        button_prev_image:    { tintColor: '#FBBF24' } as any,
        selected:             { backgroundColor: '#FBBF24', borderRadius: 20 } as any,
        selected_label:       { color: '#1a1a1a', fontWeight: '900' } as any,
      } as any}
    />
  );
});

function RollInText({ text, delay = 0, style }: { text: string; delay?: number; style?: object }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [22, 0]) }],
  }));
  return <Animated.Text style={[animStyle, style]}>{text}</Animated.Text>;
}

// 无缝连续字幕条 —— rAF + Date.now() 计时驱动，永不停顿
// TickerScroll — 无缝循环横向字幕滚动（永不停止版）
// 原理：offset 单调递增，永不取模；在 useAnimatedStyle 里实时 % cycle 计算位置
// 文字1: x = containerW - (offset % cycle)
// 文字2: x = containerW - (offset % cycle) + cycle
// offset 本身只增不减，位置通过取模映射，完全无跳变
function TickerScroll({ text, color, bg, borderColor, height = 30, fontSize = 12, top = 8, speed = 28, onPress }: {
  text: string; color: string; bg: string; borderColor: string;
  height?: number; fontSize?: number; top?: number;
  speed?: number;
  onPress?: () => void;
}) {
  const [textW, setTextW]           = useState(0);
  const [containerW, setContainerW] = useState(0);
  const GAP = 80;

  const offset       = useSharedValue(0);
  const textWSV      = useSharedValue(0);
  const containerWSV = useSharedValue(0);
  const speedSV      = useSharedValue(speed);
  const prevTextRef  = useRef('');

  useEffect(() => { textWSV.value      = textW;       }, [textW, textWSV]);
  useEffect(() => { containerWSV.value = containerW;  }, [containerW, containerWSV]);
  useEffect(() => { speedSV.value      = speed;       }, [speed, speedSV]);

  // text 变化才重置 offset，避免父组件无关重渲染打断
  useEffect(() => {
    if (text !== prevTextRef.current) {
      prevTextRef.current = text;
      offset.value = 0;
      setTextW(0);
    }
  }, [text, offset]);

  // rAF 驱动 — offset 单调递增，containerW > 0 就开始滚，不等 textW
  const rafRef    = useRef<number>(0);
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    let running = true;
    lastTsRef.current = 0;

    const tick = (now: number) => {
      if (!running) return;
      if (lastTsRef.current === 0) lastTsRef.current = now;
      const elapsed = Math.min(now - lastTsRef.current, 64);
      lastTsRef.current = now;

      // 只要容器已测量就一直滚，textW 为 0 时用容器宽度保证动画不停
      if (containerWSV.value > 0) {
        offset.value = offset.value + (speedSV.value * elapsed) / 1000;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      lastTsRef.current = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 取模在 worklet 里做，位置永远连续无跳变
  const style1 = useAnimatedStyle(() => {
    const tw = textWSV.value;
    const cw = containerWSV.value;
    if (!cw) return { transform: [{ translateX: cw }] };
    const cycle = (tw > 0 ? tw : cw) + GAP;
    const x = cw - (offset.value % cycle);
    return { transform: [{ translateX: x }] };
  });

  const style2 = useAnimatedStyle(() => {
    const tw = textWSV.value;
    const cw = containerWSV.value;
    if (!cw) return { transform: [{ translateX: cw }] };
    const cycle = (tw > 0 ? tw : cw) + GAP;
    const x = cw - (offset.value % cycle) + cycle;
    return { transform: [{ translateX: x }] };
  });

  const textStyle = {
    position: 'absolute' as const,
    top,
    fontSize,
    fontWeight: '800' as const,
    color,
    lineHeight: fontSize + 5,
    width: 9999,
    whiteSpace: 'nowrap' as never,
    letterSpacing: 0.3,
  };

  return (
    <View
      style={{
        height, overflow: 'hidden',
        borderRadius: 10,
        backgroundColor: bg,
        borderWidth: 1, borderColor,
        flexDirection: 'row',
        alignItems: 'center',
      }}
      onLayout={e => setContainerW(e.nativeEvent.layout.width)}
    >
      {/* 左侧渐入遮罩（加宽，遮住起始字符）*/}
      <LinearGradient
        colors={[bg, 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 28, zIndex: 2 }}
        pointerEvents="none"
      />
      {/* 右侧渐出遮罩 */}
      <LinearGradient
        colors={['transparent', bg]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, zIndex: 2 }}
        pointerEvents="none"
      />
      <Animated.Text
        style={[textStyle, style1]}
        onLayout={e => { if (e.nativeEvent.layout.width > 0) setTextW(e.nativeEvent.layout.width); }}
        onPress={onPress}
      >
        {text}
      </Animated.Text>
      {/* 第二段文字始终渲染，保证无缝衔接 */}
      <Animated.Text style={[textStyle, style2]} onPress={onPress}>
        {text}
      </Animated.Text>
    </View>
  );
}

// 精美彩色渐变分割线（可复用）
function GradDivider({ colors, marginTop = 0, marginBottom = 8 }: {
  colors: [string, string, string];
  marginTop?: number;
  marginBottom?: number;
}) {
  return (
    <View style={{ marginTop, marginBottom, gap: 2 }}>
      {/* 主光线 */}
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ height: 1 }}
      />
      {/* 下方光晕（半透明加宽） */}
      <LinearGradient
        colors={[colors[0], colors[1].replace(/[\d.]+\)$/, '0.15)'), colors[2]]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ height: 2, borderRadius: 1, opacity: 0.5 }}
      />
    </View>
  );
}

// 将 "YYYY-MM-DD" 解析为本地午夜时间戳（避免 UTC 解析导致时区偏差±1天）
function parseLocalDate(dateStr: string): number {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return NaN;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return new Date(y, m, d).getTime();
}

// 推算下次调价日期：国内成品油每10个工作日一次，跳过法定节假日（含调休补班）
// 与后端 oilprice-trend-update EF 的 calcNextAdjustDate 逻辑保持完全一致
function calcNextWorkday(fromDateStr: string): string {
  // 2026-2027 年法定节假日（与 EF 保持同步）
  const HOLIDAYS = new Set<string>([
    "2026-01-01","2026-01-02","2026-01-03",
    "2026-02-15","2026-02-16","2026-02-17","2026-02-18","2026-02-19",
    "2026-02-20","2026-02-21","2026-02-22","2026-02-23",
    "2026-04-04","2026-04-05","2026-04-06",
    "2026-05-01","2026-05-02","2026-05-03","2026-05-04","2026-05-05",
    "2026-06-19","2026-06-20","2026-06-21",
    "2026-09-25","2026-09-26","2026-09-27",
    "2026-10-01","2026-10-02","2026-10-03","2026-10-04",
    "2026-10-05","2026-10-06","2026-10-07",
    "2027-01-01","2027-01-02","2027-01-03",
    "2027-01-26","2027-01-27","2027-01-28","2027-01-29",
    "2027-01-30","2027-01-31","2027-02-01","2027-02-02",
  ]);
  // 调休补班（周末变工作日）
  const WORKDAYS = new Set<string>([
    "2026-01-04","2026-02-14","2026-02-28",
    "2026-05-09","2026-09-20","2026-10-10",
  ]);
  const isWorkday = (d: Date): boolean => {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (HOLIDAYS.has(key)) return false;
    if (WORKDAYS.has(key)) return true;
    const dow = d.getDay();
    return dow !== 0 && dow !== 6;
  };
  // 解析起始日（本地时间，避免 UTC 偏移跨天）
  const parts = fromDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return '';
  const cur = new Date(parseInt(parts[1]), parseInt(parts[2])-1, parseInt(parts[3]));
  let workdays = 0;
  while (workdays < 10) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkday(cur)) workdays++;
  }
  return `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
}

// 计算与目标日期的天数差（本地日期，正=未来，0=今天，负=已过）
function daysDiff(dateStr: string): number {
  const target = parseLocalDate(dateStr);
  if (isNaN(target)) return NaN;
  const todayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  return Math.round((target - todayMs) / 86400000);
}

type VehicleType = 'gasoline' | 'diesel' | 'lng';

interface Vehicle {
  id: number;
  seq_no: number;
  unit: string;
  plate_number: string;
  vehicle_model: string;
  body_color: string;
  fuel_type: string;
  gas_grade?: string;
  oil_card: string;
  driver_name?: string;
  remark?: string;
  _type: VehicleType;
}

interface TrafficRestriction {
  cityname: string;
  number: string;    // 限行尾号，如 "4和6"
  time: string[];    // 限行时段
  area: string;      // 限行区域
  week: string;      // 星期几
  noRestriction?: boolean; // 当日无限行
}

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六'];

function getDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const w = WEEK_DAYS[now.getDay()];
  return { date: `${y}年${m}月${d}日`, week: `星期${w}` };
}

const TYPE_LABELS: Record<VehicleType, string> = {
  gasoline: '汽油',
  diesel: '柴油',
  lng: 'LNG',
};

const TYPE_BG: Record<VehicleType, string> = {
  gasoline: '#F97316',
  diesel: '#16A34A',
  lng: '#0EA5E9',
};

const TYPE_BORDER: Record<VehicleType, string> = {
  gasoline: '#FED7AA',
  diesel: '#BBF7D0',
  lng: '#BAE6FD',
};

// 数字动画组件：用 opacity 淡入切换，固定高度不堆节点，避免大数值撑大卡片
// 数字动画组件：淡入淡出切换，固定高度不堆节点
function AnimatedNumber({ value, style }: { value: number; style?: object }) {
  const opacity = useSharedValue(1);
  const [display, setDisplay] = useState<number>(value);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    if (value === prevValueRef.current) return;
    // 淡出 → 换值 → 淡入
    opacity.value = withTiming(0, { duration: 150 });
    setTimeout(() => {
      setDisplay(value);
      prevValueRef.current = value;
      opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
    }, 160);
  }, [value, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text style={[{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 24 }, style, animStyle]}>
      {display}
    </Animated.Text>
  );
}

// 统计卡片脉冲光点
function PulseDot({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.9);
  useEffect(() => {
    scale.value = withRepeat(withSequence(
      withTiming(1.5, { duration: 900, easing: Easing.out(Easing.ease) }),
      withTiming(1, { duration: 900, easing: Easing.in(Easing.ease) }),
    ), -1, false);
    opacity.value = withRepeat(withSequence(
      withTiming(0.3, { duration: 900 }),
      withTiming(0.9, { duration: 900 }),
    ), -1, false);
  }, [scale, opacity]);
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }, dotStyle]} />
  );
}


// ─────────────────────────────────────────────
// 动态天气图标
// ─────────────────────────────────────────────
type WeatherKind = 'sunny' | 'cloudy' | 'overcast' | 'rainy' | 'snowy' | 'foggy' | 'thundery' | 'windy';

function getWeatherKind(text: string): WeatherKind {
  if (!text) return 'sunny';
  if (/雷|电/.test(text)) return 'thundery';
  if (/雪/.test(text)) return 'snowy';
  if (/雨/.test(text)) return 'rainy';
  if (/霾|雾|沙|尘/.test(text)) return 'foggy';
  if (/阴/.test(text)) return 'overcast';
  if (/多云|阴|云/.test(text)) return 'cloudy';
  if (/风/.test(text)) return 'windy';
  return 'sunny';
}

// 晴天：太阳自转 + 光芒脉冲
function SunIcon({ size = 32 }: { size?: number }) {
  const rot = useSharedValue(0);
  const glowScale = useSharedValue(1);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 8000, easing: Easing.linear }), -1, false);
    glowScale.value = withRepeat(withSequence(
      withTiming(1.18, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
    ), -1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rotStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const glowStyle = useAnimatedStyle(() => ({ transform: [{ scale: glowScale.value }], opacity: interpolate(glowScale.value, [1, 1.18], [0.35, 0.7]) }));
  const s = size;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {/* 光晕 */}
      <Animated.View style={[{ position: 'absolute', width: s, height: s, borderRadius: s / 2, backgroundColor: '#FDE68A' }, glowStyle]} />
      {/* 旋转光芒 */}
      <Animated.View style={[{ position: 'absolute', width: s, height: s, alignItems: 'center', justifyContent: 'center' }, rotStyle]}>
        {[0,45,90,135].map(deg => (
          <View key={deg} style={{ position: 'absolute', width: 2, height: s * 0.42, borderRadius: 1, backgroundColor: '#FCD34D', transform: [{ rotate: `${deg}deg` }, { translateY: -(s * 0.21) }] }} />
        ))}
      </Animated.View>
      {/* 核心圆 */}
      <View style={{ width: s * 0.5, height: s * 0.5, borderRadius: s * 0.25, backgroundColor: '#FBBF24' }} />
    </View>
  );
}

// 多云：云朵左右漂浮
function CloudIcon({ size = 32, color = '#E2E8F0' }: { size?: number; color?: string }) {
  const tx = useSharedValue(0);
  useEffect(() => {
    tx.value = withRepeat(withSequence(
      withTiming(4, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      withTiming(-4, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
    ), -1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cloudStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const s = size;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={cloudStyle}>
        {/* 云底长矩形 */}
        <View style={{ width: s * 0.85, height: s * 0.38, borderRadius: s * 0.19, backgroundColor: color, position: 'absolute', bottom: 0 }} />
        {/* 云顶左鼓包 */}
        <View style={{ width: s * 0.42, height: s * 0.42, borderRadius: s * 0.21, backgroundColor: color, position: 'absolute', bottom: s * 0.2, left: s * 0.06 }} />
        {/* 云顶右鼓包 */}
        <View style={{ width: s * 0.55, height: s * 0.55, borderRadius: s * 0.275, backgroundColor: color, position: 'absolute', bottom: s * 0.22, right: s * 0.08 }} />
      </Animated.View>
    </View>
  );
}

// 晴转多云：太阳 + 小云覆盖
function SunCloudIcon({ size = 32 }: { size?: number }) {
  const rot = useSharedValue(0);
  const tx = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 10000, easing: Easing.linear }), -1, false);
    tx.value = withRepeat(withSequence(
      withTiming(3, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      withTiming(-3, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
    ), -1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rotStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const cloudStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const s = size;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {/* 太阳（左上角，稍小） */}
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, rotStyle]}>
        <View style={{ width: s * 0.52, height: s * 0.52, borderRadius: s * 0.26, backgroundColor: '#FCD34D' }} />
      </Animated.View>
      {/* 云（右下角覆盖） */}
      <Animated.View style={[{ position: 'absolute', bottom: 0, right: 0 }, cloudStyle]}>
        <View style={{ width: s * 0.7, height: s * 0.32, borderRadius: s * 0.16, backgroundColor: '#CBD5E1', position: 'absolute', bottom: 0 }} />
        <View style={{ width: s * 0.38, height: s * 0.38, borderRadius: s * 0.19, backgroundColor: '#CBD5E1', position: 'absolute', bottom: s * 0.16, left: s * 0.04 }} />
        <View style={{ width: s * 0.44, height: s * 0.44, borderRadius: s * 0.22, backgroundColor: '#CBD5E1', position: 'absolute', bottom: s * 0.18, right: s * 0.04 }} />
      </Animated.View>
    </View>
  );
}

// 雨天：雨滴向下滴落（3条错落）
function RainIcon({ size = 32 }: { size?: number }) {
  const drops = [
    useSharedValue(0), useSharedValue(0), useSharedValue(0),
  ];
  const tx = useSharedValue(0);
  useEffect(() => {
    drops.forEach((d, i) => {
      d.value = withDelay(i * 180, withRepeat(
        withTiming(size * 0.55, { duration: 700, easing: Easing.in(Easing.quad) }),
        -1, false,
      ));
    });
    tx.value = withRepeat(withSequence(
      withTiming(3, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      withTiming(-3, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
    ), -1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cloudStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const s = size;
  const dropOffsets = [s * 0.12, s * 0.42, s * 0.68];
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {/* 云 */}
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, cloudStyle]}>
        <View style={{ width: s * 0.9, height: s * 0.35, borderRadius: s * 0.175, backgroundColor: '#94A3B8', position: 'absolute', top: s * 0.08, left: 0 }} />
        <View style={{ width: s * 0.42, height: s * 0.42, borderRadius: s * 0.21, backgroundColor: '#94A3B8', position: 'absolute', top: 0, left: s * 0.05 }} />
        <View style={{ width: s * 0.5, height: s * 0.5, borderRadius: s * 0.25, backgroundColor: '#94A3B8', position: 'absolute', top: 0, right: s * 0.1 }} />
      </Animated.View>
      {/* 雨滴 */}
      {drops.map((d, i) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const dropStyle = useAnimatedStyle(() => ({
          transform: [{ translateY: d.value }],
          opacity: interpolate(d.value, [0, size * 0.1, size * 0.45, size * 0.55], [0, 0.9, 0.7, 0]),
        }));
        return (
          <Animated.View key={i} style={[{
            position: 'absolute', top: s * 0.42, left: dropOffsets[i],
            width: 2, height: s * 0.2, borderRadius: 1, backgroundColor: '#60A5FA',
          }, dropStyle]} />
        );
      })}
    </View>
  );
}

// 雪天：雪花旋转飘落
function SnowIcon({ size = 32 }: { size?: number }) {
  const rot = useSharedValue(0);
  const drops = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 3000, easing: Easing.linear }), -1, false);
    drops.forEach((d, i) => {
      d.value = withDelay(i * 220, withRepeat(
        withTiming(size * 0.5, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        -1, false,
      ));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rotStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const s = size;
  const dropOffsets = [s * 0.1, s * 0.4, s * 0.66];
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {/* 雪花中心 */}
      <Animated.View style={[{ position: 'absolute', top: s * 0.04, alignSelf: 'center', width: s * 0.3, height: s * 0.3, alignItems: 'center', justifyContent: 'center' }, rotStyle]}>
        {[0,60,120].map(deg => (
          <View key={deg} style={{ position: 'absolute', width: s * 0.28, height: 2, borderRadius: 1, backgroundColor: '#BAE6FD', transform: [{ rotate: `${deg}deg` }] }} />
        ))}
        <View style={{ width: s * 0.1, height: s * 0.1, borderRadius: s * 0.05, backgroundColor: '#fff' }} />
      </Animated.View>
      {/* 飘落小点 */}
      {drops.map((d, i) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const dropStyle = useAnimatedStyle(() => ({
          transform: [{ translateY: d.value }],
          opacity: interpolate(d.value, [0, s * 0.1, s * 0.42, s * 0.5], [0, 1, 0.8, 0]),
        }));
        return (
          <Animated.View key={i} style={[{
            position: 'absolute', top: s * 0.35, left: dropOffsets[i],
            width: 4, height: 4, borderRadius: 2, backgroundColor: '#BAE6FD',
          }, dropStyle]} />
        );
      })}
    </View>
  );
}

// 雾霾：圆圈脉冲扩散
function FogIcon({ size = 32 }: { size?: number }) {
  const sc1 = useSharedValue(0.6);
  const sc2 = useSharedValue(0.6);
  const tx = useSharedValue(0);
  useEffect(() => {
    sc1.value = withRepeat(withTiming(1.1, { duration: 1600, easing: Easing.out(Easing.ease) }), -1, false);
    sc2.value = withDelay(800, withRepeat(withTiming(1.1, { duration: 1600, easing: Easing.out(Easing.ease) }), -1, false));
    tx.value = withRepeat(withSequence(
      withTiming(6, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      withTiming(-6, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
    ), -1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const s = size;
  const fogStyle1 = useAnimatedStyle(() => ({ transform: [{ scaleX: sc1.value }], opacity: interpolate(sc1.value, [0.6, 1.1], [0.7, 0.2]) }));
  const fogStyle2 = useAnimatedStyle(() => ({ transform: [{ scaleX: sc2.value }], opacity: interpolate(sc2.value, [0.6, 1.1], [0.6, 0.15]) }));
  const txStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ width: s * 0.9, height: s * 0.18, borderRadius: s * 0.09, backgroundColor: '#94A3B8', marginBottom: 3 }, fogStyle1]} />
      <Animated.View style={[{ width: s * 0.7, height: s * 0.16, borderRadius: s * 0.08, backgroundColor: '#94A3B8', marginBottom: 3 }, txStyle, fogStyle2]} />
      <Animated.View style={[{ width: s * 0.85, height: s * 0.16, borderRadius: s * 0.08, backgroundColor: '#94A3B8' }, fogStyle1]} />
    </View>
  );
}

// 雷阵雨：云 + 闪电闪烁
function ThunderIcon({ size = 32 }: { size?: number }) {
  const flash = useSharedValue(1);
  const tx = useSharedValue(0);
  useEffect(() => {
    flash.value = withRepeat(withSequence(
      withTiming(0.2, { duration: 80 }),
      withTiming(1, { duration: 80 }),
      withTiming(0.3, { duration: 80 }),
      withTiming(1, { duration: 2500 }),
    ), -1, false);
    tx.value = withRepeat(withSequence(
      withTiming(3, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      withTiming(-3, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
    ), -1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const cloudStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const s = size;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, cloudStyle]}>
        <View style={{ width: s * 0.9, height: s * 0.33, borderRadius: s * 0.165, backgroundColor: '#64748B', position: 'absolute', top: s * 0.06 }} />
        <View style={{ width: s * 0.4, height: s * 0.4, borderRadius: s * 0.2, backgroundColor: '#64748B', position: 'absolute', top: 0, left: s * 0.04 }} />
        <View style={{ width: s * 0.48, height: s * 0.48, borderRadius: s * 0.24, backgroundColor: '#64748B', position: 'absolute', top: 0, right: s * 0.08 }} />
      </Animated.View>
      {/* 闪电 */}
      <Animated.View style={[{ position: 'absolute', bottom: 0, left: s * 0.35 }, flashStyle]}>
        <View style={{ width: 0, height: 0, borderLeftWidth: s * 0.14, borderRightWidth: 0, borderTopWidth: s * 0.22, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FCD34D' }} />
        <View style={{ width: 0, height: 0, borderRightWidth: s * 0.14, borderLeftWidth: 0, borderBottomWidth: s * 0.22, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#FCD34D', marginLeft: -s * 0.03 }} />
      </Animated.View>
    </View>
  );
}

// 大风：三条波浪线横移
function WindyIcon({ size = 32 }: { size?: number }) {
  const tx1 = useSharedValue(0);
  const tx2 = useSharedValue(0);
  const tx3 = useSharedValue(0);
  useEffect(() => {
    tx1.value = withRepeat(withSequence(withTiming(8, { duration: 600, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 600, easing: Easing.inOut(Easing.sin) })), -1, false);
    tx2.value = withDelay(200, withRepeat(withSequence(withTiming(6, { duration: 700, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.sin) })), -1, false));
    tx3.value = withDelay(400, withRepeat(withSequence(withTiming(10, { duration: 550, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 550, easing: Easing.inOut(Easing.sin) })), -1, false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const s = size;
  const s1 = useAnimatedStyle(() => ({ transform: [{ translateX: tx1.value }] }));
  const s2 = useAnimatedStyle(() => ({ transform: [{ translateX: tx2.value }] }));
  const s3 = useAnimatedStyle(() => ({ transform: [{ translateX: tx3.value }] }));
  return (
    <View style={{ width: s, height: s, alignItems: 'flex-start', justifyContent: 'center', gap: 5, paddingLeft: 2 }}>
      <Animated.View style={[{ height: 3, borderRadius: 2, backgroundColor: '#7DD3FC' }, s1, { width: s * 0.75 }]} />
      <Animated.View style={[{ height: 3, borderRadius: 2, backgroundColor: '#38BDF8' }, s2, { width: s * 0.55 }]} />
      <Animated.View style={[{ height: 3, borderRadius: 2, backgroundColor: '#7DD3FC' }, s3, { width: s * 0.65 }]} />
    </View>
  );
}

function AnimatedWeatherIcon({ weatherText, size = 32 }: { weatherText: string; size?: number }) {
  const kind = getWeatherKind(weatherText);
  if (kind === 'sunny')    return <SunIcon size={size} />;
  if (kind === 'cloudy')   return <SunCloudIcon size={size} />;
  if (kind === 'overcast') return <CloudIcon size={size} color="#94A3B8" />;
  if (kind === 'rainy')    return <RainIcon size={size} />;
  if (kind === 'snowy')    return <SnowIcon size={size} />;
  if (kind === 'foggy')    return <FogIcon size={size} />;
  if (kind === 'thundery') return <ThunderIcon size={size} />;
  if (kind === 'windy')    return <WindyIcon size={size} />;
  return <SunIcon size={size} />;
}

// 浮动粒子（Header 装饰）
// ─────────────────────────────────────────────────────────────────
// 天气全屏粒子特效（绝对定位覆盖全屏，pointerEvents='none'，不影响交互）
// ─────────────────────────────────────────────────────────────────

// 雨滴（单根）
function RainDrop({ x, duration, delay, width: w }: { x: number; duration: number; delay: number; width: number }) {
  const ty = useSharedValue(-60);
  useEffect(() => {
    ty.value = withDelay(delay, withRepeat(withTiming(900, { duration, easing: Easing.linear }), -1, false));
  }, [ty, delay, duration]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  return (
    <Animated.View style={[{
      position: 'absolute', left: x, top: 0,
      width: 1.2, height: 18 + w,
      backgroundColor: 'rgba(147,197,253,0.55)',
      borderRadius: 1,
      transform: [{ rotate: '15deg' }],
    }, s]} />
  );
}

// 雪花（单个）
function SnowFlake({ x, size, duration, delay }: { x: number; size: number; duration: number; delay: number }) {
  const ty = useSharedValue(-20);
  const tx = useSharedValue(0);
  const op = useSharedValue(0);
  useEffect(() => {
    op.value = withDelay(delay, withTiming(0.7, { duration: 400 }));
    ty.value = withDelay(delay, withRepeat(withTiming(880, { duration, easing: Easing.linear }), -1, false));
    tx.value = withDelay(delay, withRepeat(withSequence(
      withTiming(12, { duration: duration * 0.4, easing: Easing.inOut(Easing.sin) }),
      withTiming(-12, { duration: duration * 0.6, easing: Easing.inOut(Easing.sin) }),
    ), -1, true));
  }, [ty, tx, op, delay, duration]);
  const s = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { translateX: tx.value }],
    opacity: op.value,
  }));
  return (
    <Animated.View style={[{
      position: 'absolute', left: x, top: 0,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: 'rgba(219,234,254,0.85)',
    }, s]} />
  );
}

// 雾气条（单条）
function FogStrip({ y, duration, delay, width: sw, opacity: baseOp }: { y: number; duration: number; delay: number; width: number; opacity: number }) {
  const tx = useSharedValue(-sw * 0.6);
  const op = useSharedValue(0);
  useEffect(() => {
    op.value = withDelay(delay, withRepeat(withSequence(
      withTiming(baseOp, { duration: duration * 0.3 }),
      withTiming(baseOp * 0.3, { duration: duration * 0.4 }),
      withTiming(baseOp, { duration: duration * 0.3 }),
    ), -1, false));
    tx.value = withDelay(delay, withRepeat(withSequence(
      withTiming(sw * 0.3, { duration, easing: Easing.inOut(Easing.sin) }),
      withTiming(-sw * 0.2, { duration, easing: Easing.inOut(Easing.sin) }),
    ), -1, true));
  }, [tx, op, delay, duration, sw, baseOp]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }], opacity: op.value }));
  return (
    <Animated.View style={[{
      position: 'absolute', left: 0, top: y,
      width: sw, height: 28 + Math.random() * 12,
      backgroundColor: 'rgba(148,163,184,0.22)',
      borderRadius: 14,
    }, s]} />
  );
}

// 闪电闪烁（雷雨用）
function LightningFlash({ screenW, screenH }: { screenW: number; screenH: number }) {
  const op = useSharedValue(0);
  useEffect(() => {
    const flash = () => {
      op.value = withSequence(
        withTiming(0.18, { duration: 60 }),
        withTiming(0, { duration: 80 }),
        withTiming(0.12, { duration: 50 }),
        withTiming(0, { duration: 120 }),
      );
      const next = 3000 + Math.random() * 5000;
      setTimeout(flash, next);
    };
    const t = setTimeout(flash, 1500 + Math.random() * 2000);
    return () => clearTimeout(t);
  }, [op]);
  const s = useAnimatedStyle(() => ({ opacity: op.value }));
  return (
    <Animated.View style={[{
      position: 'absolute', left: 0, top: 0,
      width: screenW, height: screenH,
      backgroundColor: '#E0F2FE',
    }, s]} pointerEvents="none" />
  );
}

// 风粒子（斜向扫过）
function WindParticle({ y, duration, delay, screenW }: { y: number; duration: number; delay: number; screenW: number }) {
  const tx = useSharedValue(-80);
  const op = useSharedValue(0);
  useEffect(() => {
    tx.value = withDelay(delay, withRepeat(withTiming(screenW + 80, { duration, easing: Easing.linear }), -1, false));
    op.value = withDelay(delay, withRepeat(withSequence(
      withTiming(0.45, { duration: duration * 0.1 }),
      withTiming(0.35, { duration: duration * 0.8 }),
      withTiming(0, { duration: duration * 0.1 }),
    ), -1, false));
  }, [tx, op, delay, duration, screenW]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }], opacity: op.value }));
  return (
    <Animated.View style={[{
      position: 'absolute', left: 0, top: y,
      width: 60 + Math.random() * 40, height: 1.5,
      backgroundColor: 'rgba(186,230,253,0.6)',
      borderRadius: 1,
      transform: [{ rotate: '-8deg' }],
    }, s]} />
  );
}

// 主特效层组件
function WeatherFxLayer({ kind, screenW, screenH }: { kind: WeatherKind; screenW: number; screenH: number }) {
  // 无特效天气直接返回 null
  if (kind === 'sunny' || kind === 'cloudy' || kind === 'overcast') return null;

  // 固定种子生成粒子位置，避免每次渲染随机重排
  const rainDrops  = Array.from({ length: 55 }, (_, i) => ({ id: i, x: (i * 137.5) % screenW, dur: 900 + (i * 37) % 400, delay: (i * 79) % 1000, w: (i * 11) % 8 }));
  const snowFlakes = Array.from({ length: 30 }, (_, i) => ({ id: i, x: (i * 113.7) % screenW, dur: 3500 + (i * 97) % 2000, delay: (i * 173) % 2000, sz: 3 + (i * 7) % 5 }));
  const fogStrips  = Array.from({ length: 8  }, (_, i) => ({ id: i, y: 80 + i * 100, dur: 8000 + (i * 431) % 4000, delay: (i * 617) % 3000, op: 0.18 + (i * 0.03) }));
  const windLines  = Array.from({ length: 18 }, (_, i) => ({ id: i, y: (i * 51) % screenH, dur: 1200 + (i * 67) % 600, delay: (i * 83) % 1200 }));

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, width: screenW, height: screenH, zIndex: 1 }}
      pointerEvents="none"
    >
      {/* 雨天 / 雷雨 */}
      {(kind === 'rainy' || kind === 'thundery') && (
        <>
          {/* 顶部蓝色雨帘渐变覆盖 */}
          <LinearGradient
            colors={['rgba(15,30,60,0.55)', 'rgba(10,15,30,0.0)']}
            style={{ position: 'absolute', top: 0, left: 0, width: screenW, height: screenH * 0.6 }}
            pointerEvents="none"
          />
          {rainDrops.map(d => <RainDrop key={d.id} x={d.x} duration={d.dur} delay={d.delay} width={d.w} />)}
          {kind === 'thundery' && <LightningFlash screenW={screenW} screenH={screenH} />}
        </>
      )}
      {/* 雪天 */}
      {kind === 'snowy' && (
        <>
          <LinearGradient
            colors={['rgba(30,41,80,0.4)', 'rgba(10,15,30,0.0)']}
            style={{ position: 'absolute', top: 0, left: 0, width: screenW, height: screenH * 0.5 }}
            pointerEvents="none"
          />
          {snowFlakes.map(f => <SnowFlake key={f.id} x={f.x} size={f.sz} duration={f.dur} delay={f.delay} />)}
        </>
      )}
      {/* 雾/霾 */}
      {kind === 'foggy' && (
        <>
          <LinearGradient
            colors={['rgba(71,85,105,0.35)', 'rgba(10,15,30,0.0)']}
            style={{ position: 'absolute', top: 0, left: 0, width: screenW, height: screenH }}
            pointerEvents="none"
          />
          {fogStrips.map(f => <FogStrip key={f.id} y={f.y} duration={f.dur} delay={f.delay} width={screenW * 1.4} opacity={f.op} />)}
        </>
      )}
      {/* 风天 */}
      {kind === 'windy' && (
        <>
          {windLines.map(w => <WindParticle key={w.id} y={w.y} duration={w.dur} delay={w.delay} screenW={screenW} />)}
        </>
      )}
    </View>
  );
}


// FloatingParticle：用于主界面装饰性漂浮粒子（搜索栏上方等区域）
function FloatingParticle({ x, y, size, delay, color }: { x: number; y: number; size: number; delay: number; color: string }) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(delay, withRepeat(withSequence(
      withTiming(0.6, { duration: 1200 }),
      withTiming(0.1, { duration: 1200 }),
    ), -1, false));
    translateY.value = withDelay(delay, withRepeat(withSequence(
      withTiming(-12, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
    ), -1, false));
  }, [translateY, opacity, delay]);
  const particleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View style={[{
      position: 'absolute', left: x, top: y,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
    }, particleStyle]} />
  );
}

// 判断车牌号尾号是否受限行影响
// limitNumber 示例："4和6"、"1、6"、"2，5"、"4,9"
function checkPlateRestricted(plate: string, limitNumber: string): boolean {
  if (!plate || !limitNumber) return false;
  // 取车牌最后一位字符（通常为数字或字母）
  const last = plate.trim().slice(-1).toUpperCase();
  // 从限行字符串提取所有数字/字母 token
  const tokens = limitNumber.match(/[0-9A-Za-z]+/g) ?? [];
  return tokens.some((t) => t.toUpperCase() === last);
}

// 单条结果卡片
function VehicleCard({ item, restricted, onPress }: { item: Vehicle; restricted: boolean | null; onPress: () => void }) {
  const iconBg = item._type === 'gasoline' ? '#FFF7ED' : item._type === 'diesel' ? '#F0FDF4' : '#F0F9FF';
  const iconColor = TYPE_BG[item._type];
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: TYPE_BORDER[item._type],
        borderRadius: 14,
        marginBottom: 8,
        overflow: 'hidden',
        borderLeftWidth: 4,
        borderLeftColor: TYPE_BG[item._type],
      }}
      android_ripple={{ color: 'rgba(0,82,204,0.06)', borderless: false }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 }}>
        <View style={{ width: 44, height: 44, backgroundColor: iconBg, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: TYPE_BORDER[item._type] }}>
          <Car size={20} color={iconColor} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          {/* 第一行：车牌号 + 类型 + 限行状态 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Text style={{ color: '#0F172A', fontWeight: '800', fontSize: 16, letterSpacing: 0.5 }}>{item.plate_number}</Text>
            <View style={{ backgroundColor: TYPE_BG[item._type], borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{TYPE_LABELS[item._type]}车</Text>
            </View>
            {restricted === true && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF2F2', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#FECACA' }}>
                <AlertTriangle size={9} color="#EF4444" />
                <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: '800' }}>今日限行</Text>
              </View>
            )}
            {restricted === false && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F0FDF4', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#BBF7D0' }}>
                <Car size={9} color="#16A34A" />
                <Text style={{ color: '#16A34A', fontSize: 10, fontWeight: '700' }}>不受限</Text>
              </View>
            )}
          </View>
          {/* 第二行：所属单位 */}
          <Text style={{ color: '#334155', fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{item.unit}</Text>
          {/* 第三行：车型+颜色 · 油卡 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: '#94A3B8', fontSize: 11 }} numberOfLines={1}>{item.vehicle_model} · {item.body_color}</Text>
            {!!item.oil_card && (
              <>
                <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#CBD5E1' }} />
                <Text style={{ color: '#64748B', fontSize: 11, fontWeight: '500' }} numberOfLines={1}>油卡 {item.oil_card}</Text>
              </>
            )}
          </View>
          {/* 第四行：司机（可选） */}
          {!!item.driver_name && (
            <Text style={{ color: '#64748B', fontSize: 11 }} numberOfLines={1}>司机：{item.driver_name}</Text>
          )}
        </View>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}>
          <ChevronRight size={14} color="#94A3B8" />
        </View>
      </View>
    </Pressable>
  );
}

// 下次调价胶囊 — 带边框脉冲动画
function PulseAdjustCapsule({ nextAdjustDate, nextTrend, nextTrendText }: {
  nextAdjustDate?: string; nextTrend?: number; nextTrendText?: string;
}) {
  // 边框透明度脉冲：1.0 → 0.3 → 1.0，每2秒一次
  const borderOpacity = useSharedValue(1);
  useEffect(() => {
    borderOpacity.value = withRepeat(
      withSequence(
        withTiming(0.28, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1,    { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1, false,
    );
  }, [borderOpacity]);
  const pulseStyle = useAnimatedStyle(() => ({
    borderColor: `rgba(251,191,36,${borderOpacity.value * 0.6})`,
    backgroundColor: `rgba(251,191,36,${borderOpacity.value * 0.055})`,
  }));

  // 左侧小圆点闪烁
  const dotOpacity = useSharedValue(1);
  useEffect(() => {
    dotOpacity.value = withRepeat(
      withSequence(
        withTiming(0.15, { duration: 600 }),
        withTiming(1,    { duration: 600 }),
      ),
      -1, false,
    );
  }, [dotOpacity]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  // 若 EF 未返回下次调价日期，不使用推算值，直接用空字符串
  const effectiveNextAdjustDate = nextAdjustDate || '';
  const diff = effectiveNextAdjustDate ? daysDiff(effectiveNextAdjustDate) : null;
  const countdown = diff === null || isNaN(diff) ? '' : diff > 0 ? `${diff}天后` : diff === 0 ? '今日24:00' : '已开启（窗口已过）';

  // 调价日前3天（含当日）激活涨幅标签脉冲
  const isUrgent = diff !== null && !isNaN(diff) && diff >= 0 && diff <= 3;

  let effectiveNt = nextTrend ?? 0;
  if (effectiveNt === 0 && nextTrendText) {
    const foldM = nextTrendText.match(/折合.*?([\d.]+)(?:[~～]([\d.]+))?\s*元\/升/);
    const upM   = nextTrendText.match(/上[涨调][+＋]?\s*([\d.]+)\s*元\/升/);
    const dnM   = nextTrendText.match(/下[降调]\s*([\d.]+)\s*元\/升/);
    if (foldM) { const lo = parseFloat(foldM[1]); const hi = foldM[2] ? parseFloat(foldM[2]) : lo; effectiveNt = +((lo + hi) / 2).toFixed(2); }
    else if (upM) effectiveNt = parseFloat(upM[1]);
    else if (dnM) effectiveNt = -parseFloat(dnM[1]);
  }
  const nUp = effectiveNt > 0; const nDn = effectiveNt < 0;
  const nArrow = nUp ? '▲' : nDn ? '▼' : '—';
  const nColor = nUp ? '#F87171' : nDn ? '#34D399' : '#94A3B8';
  let trendLabel = '';
  const foldM2 = (nextTrendText ?? '').match(/折合.*?([\d.]+)(?:[~～]([\d.]+))?\s*元\/升/);
  if (foldM2) {
    const lo = parseFloat(foldM2[1]); const hi = foldM2[2] ? parseFloat(foldM2[2]) : lo;
    trendLabel = nUp ? `+${lo.toFixed(2)}~+${hi.toFixed(2)}元/升` : `-${lo.toFixed(2)}~-${hi.toFixed(2)}元/升`;
  } else if (Math.abs(effectiveNt) > 0.001) {
    trendLabel = (nUp ? '+' : '') + effectiveNt.toFixed(2) + '元/升';
  } else if (/持平/.test(nextTrendText ?? '')) {
    trendLabel = '持平';
  }

  // 从 nextTrendText 中提取"X~X元/升"范围标签（优先）
  const rangeM = (nextTrendText ?? '').match(/[+＋]?([\d.]+)[~～]([\d.]+)\s*元\/升/);
  const displayLabel = rangeM
    ? (nUp ? `+${rangeM[1]}~+${rangeM[2]}元/升` : `-${rangeM[1]}~-${rangeM[2]}元/升`)
    : trendLabel;

  // 涨幅标签脉冲：仅调价日前3天内激活（快节奏 600ms，高对比度）
  const tagOpacity = useSharedValue(1);
  useEffect(() => {
    if (isUrgent && displayLabel) {
      tagOpacity.value = withRepeat(
        withSequence(
          withTiming(0.2, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(1,   { duration: 400, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, false,
      );
    } else {
      tagOpacity.value = 1;
    }
  }, [isUrgent, displayLabel, tagOpacity]);
  const tagBgColor  = nUp ? '248,113,113' : nDn ? '52,211,153' : '148,163,184';
  const tagPulseStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(${tagBgColor},${isUrgent ? tagOpacity.value * 0.32 : 0.18})`,
    borderColor:     `rgba(${tagBgColor},${isUrgent ? 0.4 + tagOpacity.value * 0.5 : 0.5})`,
  }));

  return (
    <Animated.View style={[{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1,
    }, pulseStyle]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {/* 闪烁圆点 */}
        <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FBBF24' }, dotStyle]} />
        <Timer size={10} color="#FBBF24" />
        <Text style={{ color: 'rgba(251,191,36,0.7)', fontSize: 10, fontWeight: '600' }}>下次调价</Text>
        {nextAdjustDate ? (
          <Text style={{ color: '#FBBF24', fontSize: 10, fontWeight: '800' }}>{nextAdjustDate}</Text>
        ) : effectiveNextAdjustDate ? (
          <Text style={{ color: 'rgba(251,191,36,0.6)', fontSize: 10, fontWeight: '700' }}>{effectiveNextAdjustDate}(预估)</Text>
        ) : null}
        {countdown ? (
          <View style={{ backgroundColor: 'rgba(251,191,36,0.18)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: '#FBBF24', fontSize: 10, fontWeight: '700' }}>{countdown}</Text>
          </View>
        ) : null}
      </View>
      {displayLabel ? (
        <Animated.View style={[{
          flexDirection: 'row', alignItems: 'center', gap: 3,
          borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
        }, tagPulseStyle]}>
          <Text style={{ color: nColor, fontSize: 11, fontWeight: '900' }}>{nArrow}</Text>
          <Text style={{ color: nColor, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>{displayLabel}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

// 横条卡内嵌调价胶囊行（精简版，无独立边框，适合嵌入深色横条卡）
function CapsuleRow({ nextAdjustDate, nextTrend, nextTrendText, isWindowOpen }: {
  nextAdjustDate?: string; nextTrend?: number; nextTrendText?: string; isWindowOpen?: boolean;
}) {
  const borderOpacity = useSharedValue(1);
  useEffect(() => {
    borderOpacity.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1,    { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1, false,
    );
  }, [borderOpacity]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: borderOpacity.value }));

  const effectiveNextAdjustDate = nextAdjustDate || '';
  const diff = effectiveNextAdjustDate ? daysDiff(effectiveNextAdjustDate) : null;
  const countdown = diff === null || isNaN(diff) ? '' : diff > 0 ? `${diff}天后` : diff === 0 ? '今日24:00' : '已开启';

  let effectiveNt = nextTrend ?? 0;
  if (effectiveNt === 0 && nextTrendText) {
    const foldM = nextTrendText.match(/折合.*?([\d.]+)(?:[~～]([\d.]+))?\s*元\/升/);
    const upM   = nextTrendText.match(/上[涨调][+＋]?\s*([\d.]+)\s*元\/升/);
    const dnM   = nextTrendText.match(/下[降调]\s*([\d.]+)\s*元\/升/);
    if (foldM) { const lo = parseFloat(foldM[1]); const hi = foldM[2] ? parseFloat(foldM[2]) : lo; effectiveNt = +((lo + hi) / 2).toFixed(2); }
    else if (upM) effectiveNt = parseFloat(upM[1]);
    else if (dnM) effectiveNt = -parseFloat(dnM[1]);
  }
  const nUp = effectiveNt > 0; const nDn = effectiveNt < 0;
  const nArrow = nUp ? '▲' : nDn ? '▼' : '—';
  const nColor = nUp ? '#F87171' : nDn ? '#34D399' : '#94A3B8';

  // 从 nextTrendText 提取区间标签，优先匹配 "X.XX~X.XX元/升" 格式
  const rangeM2 = (nextTrendText ?? '').match(/[+＋-]?([\d.]+)[~～][+＋-]?([\d.]+)\s*元\/升/);
  let displayLabel = '';
  if (rangeM2) {
    const lo = rangeM2[1], hi = rangeM2[2];
    displayLabel = nUp ? `+${lo}~+${hi}元/升` : nDn ? `-${lo}~-${hi}元/升` : `${lo}~${hi}元/升`;
  } else if (effectiveNt !== 0) {
    // 降级：单值格式
    displayLabel = nUp ? `+${Math.abs(effectiveNt).toFixed(2)}元/升` : nDn ? `-${Math.abs(effectiveNt).toFixed(2)}元/升` : '';
  }


  const isUrgent = diff !== null && !isNaN(diff) && diff >= 0 && diff <= 3;
  const tagOpacity = useSharedValue(1);
  useEffect(() => {
    tagOpacity.value = isUrgent && displayLabel
      ? withRepeat(withSequence(withTiming(0.2, { duration: 400 }), withTiming(1, { duration: 400 })), -1, false)
      : 1;
  }, [isUrgent, displayLabel, tagOpacity]);
  const tagBgColor = nUp ? '248,113,113' : nDn ? '52,211,153' : '148,163,184';
  const tagPulseStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(${tagBgColor},${isUrgent ? tagOpacity.value * 0.3 : 0.15})`,
    borderColor:     `rgba(${tagBgColor},${isUrgent ? 0.4 + tagOpacity.value * 0.45 : 0.45})`,
  }));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: isWindowOpen ? 'rgba(251,146,60,0.2)' : 'rgba(96,165,250,0.12)', backgroundColor: isWindowOpen ? 'rgba(251,146,60,0.1)' : 'transparent' }}>
      {/* 左侧：图标 + 竖排"下次/调价" + 日期 + 倒计时 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
        <Animated.View style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: isWindowOpen ? '#F97316' : '#FBBF24' }, dotStyle]} />
        <Timer size={9} color={isWindowOpen ? '#F97316' : '#FBBF24'} />
        {/* "下次" 上 / "调价" 下 */}
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: isWindowOpen ? 'rgba(251,146,60,0.9)' : 'rgba(251,191,36,0.7)', fontSize: 9, fontWeight: '700', lineHeight: 11 }}>下次</Text>
          <Text style={{ color: isWindowOpen ? 'rgba(251,146,60,0.9)' : 'rgba(251,191,36,0.7)', fontSize: 9, fontWeight: '700', lineHeight: 11 }}>调价</Text>
        </View>
        {effectiveNextAdjustDate ? (
          <Text style={{ color: nextAdjustDate ? (isWindowOpen ? '#FB923C' : '#FBBF24') : 'rgba(251,191,36,0.6)', fontSize: 10, fontWeight: '800' }} numberOfLines={1}>
            {effectiveNextAdjustDate
              .replace(/^20(\d{2})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}年${parseInt(m)}月${parseInt(d)}日`)}
            {!nextAdjustDate ? '(预估)' : ''}
          </Text>
        ) : null}
        {countdown ? (
          <View style={{ backgroundColor: isWindowOpen ? 'rgba(251,146,60,0.22)' : 'rgba(251,191,36,0.18)', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 }}>
            <Text style={{ color: isWindowOpen ? '#FB923C' : '#FBBF24', fontSize: 10, fontWeight: '700' }}>{countdown}</Text>
          </View>
        ) : null}
      </View>
      {/* 右侧：窗口/涨跌标签 */}
      {isWindowOpen ? (
        <Animated.View style={[{
          flexDirection: 'row', alignItems: 'center', gap: 3,
          borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2,
          borderWidth: 1, borderColor: 'rgba(239,68,68,0.7)',
          backgroundColor: 'rgba(239,68,68,0.18)',
          marginLeft: 4, flexShrink: 0,
        }, tagPulseStyle]}>
          <Text style={{ color: '#FCA5A5', fontSize: 10, fontWeight: '900' }}>●</Text>
          <Text style={{ color: '#FCA5A5', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>窗口已开启</Text>
        </Animated.View>
      ) : displayLabel ? (
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, marginLeft: 4, flexShrink: 0 }, tagPulseStyle]}>
          <Text style={{ color: nColor, fontSize: 10, fontWeight: '900' }}>{nArrow}</Text>
          <Text style={{ color: nColor, fontSize: 10, fontWeight: '800' }}>{displayLabel}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

// 油价涨跌提示条
// 字幕只显示一段：本期每吨已涨/降多少元（去掉预计走势预测信息）
// 今天调价橙色脉冲光晕 — 绝对定位贴底部，向上扩散
function PulseGlow() {
  const opacity = useSharedValue(0.7);
  const scale   = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0, { duration: 1200, easing: Easing.out(Easing.cubic) }),
      -1, true
    );
    scale.value = withRepeat(
      withTiming(1.06, { duration: 1200, easing: Easing.out(Easing.quad) }),
      -1, true
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scaleX: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute', bottom: 0, left: -8, right: -8, zIndex: 98,
        height: 56,
      }, glowStyle]}
    >
      <LinearGradient
        colors={['transparent', 'rgba(251,146,60,0.28)', 'rgba(251,146,60,0.55)']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

// 油价涨跌提示条 — 多段滚动：本期涨跌 + 各油品价格
function OilTickerBar({ trend, p92, p95, p0, prevP92, nextTrend, nextTrendText,
  updateDate, crudeUpdatedAt, deltaPerLiter }: {
  trend: number;
  nextTrend?: number; nextTrendText?: string;
  p92?: string; p95?: string; p0?: string;
  prevP92?: string;         // 有旧价时用「新价-旧价」直接计算，无旧价时用 DB trend 字段
  updateDate?: string;      // 油价更新日期 YYYY-MM-DD
  crudeUpdatedAt?: string;  // 原油更新 ISO 时间戳
  deltaPerLiter?: number;   // 测算卡同源：原油变化折算的预计每升调幅（sharedCrude.deltaPerLiter92）
}) {
  // 本期涨跌优先级（本期 = 上次已实际调价的幅度，不是预测）：
  //   1. prevP92 + p92 差值（已实际调价后的真实本期涨跌，最准确）
  //   2. DB trend 字段（AI 写入，兜底）
  // 注：deltaPerLiter 是原油折算的"预测下期调幅"，只用于 nextTrend，不能代替本期涨跌
  const effectiveTrend =
    (prevP92 && prevP92 !== '' && p92 && p92 !== '--') ? parseFloat(p92) - parseFloat(prevP92)
    : trend;

  const isUp   = effectiveTrend > 0;
  const isDown = effectiveTrend < 0;
  // 更饱和的颜色 — 涨价橙红，降价翠绿，持平天蓝
  const trendColor = isUp ? '#FB923C' : isDown ? '#34D399' : '#7DD3FC';
  const trendBg    = isUp ? 'rgba(251,146,60,0.10)' : isDown ? 'rgba(52,211,153,0.10)' : 'rgba(125,211,252,0.07)';
  const borderC    = isUp ? 'rgba(251,146,60,0.28)' : isDown ? 'rgba(52,211,153,0.28)' : 'rgba(125,211,252,0.18)';
  const arrow      = isUp ? '▲' : isDown ? '▼' : '—';

  const absTrend = Math.abs(effectiveTrend);
  const trendSeg = absTrend > 0.001
    ? `${arrow} 本期每升${isUp ? '涨' : '降'} ${isUp ? '+' : '-'}${absTrend.toFixed(2)} 元`
    : '— 本期油价持平';

  // 下次预测涨幅段：优先用 sharedCrude 传入的 nextTrend（deltaPerLiter92）
  const ntSeg = (() => {
    const nt = nextTrend ?? 0;
    if (Math.abs(nt) >= 0.005) {
      const dir = nt > 0 ? '📈 预计下期上调' : '📉 预计下期下调';
      const sign = nt > 0 ? '+' : '';
      return `${dir} ${sign}${nt.toFixed(2)} 元/升`;
    }
    if (nextTrendText) return `预测：${nextTrendText}`;
    return '';
  })();

  // 油品价格用高亮颜色区分
  const priceParts: string[] = [];
  if (p92 && p92 !== '--') priceParts.push(`92# ¥${p92}`);
  if (p95 && p95 !== '--') priceParts.push(`95# ¥${p95}`);
  if (p0  && p0  !== '--') priceParts.push(`柴 ¥${p0}`);

  const sep = '  ·  ';
  const segments: string[] = [trendSeg];
  if (ntSeg) segments.push(ntSeg);
  if (priceParts.length > 0) segments.push(priceParts.join(sep));

  // 时间戳段：优先用原油更新时间（精确到分钟），退回油价日期
  const timeSeg = (() => {
    if (crudeUpdatedAt) {
      // ISO 时间戳转北京时间 HH:MM
      const bjMs = new Date(crudeUpdatedAt).getTime() + 8 * 3600_000;
      const bjDate = new Date(bjMs);
      const hh = String(bjDate.getUTCHours()).padStart(2, '0');
      const mm = String(bjDate.getUTCMinutes()).padStart(2, '0');
      return `🕐 更新 ${hh}:${mm}`;
    }
    if (updateDate && /^\d{4}-\d{2}-\d{2}$/.test(updateDate)) {
      const [, mo, dd] = updateDate.split('-');
      return `🕐 更新 ${parseInt(mo)}/${parseInt(dd)}`;
    }
    return '';
  })();
  if (timeSeg) segments.push(timeSeg);

  const fullText = segments.join('    ');

  return (
    <TickerScroll
      text={fullText}
      color={trendColor}
      bg={trendBg}
      borderColor={borderC}
      height={30}
      fontSize={11.5}
      top={7}
      speed={30}
    />
  );
}

// ─────────────────────────────────────────
// 天气详情弹窗组件（重设计版）
// 含：今日实况 + 逐小时滚动 + 7日预报 + 数据网格
// ─────────────────────────────────────────
type HourItem  = { time: string; weather: string; temp: string; pop?: string };
type DayItem   = { time: string; weather: string; tempMax: string; tempMin: string; windDay?: string; windPow?: string; pop?: string; sunrise?: string; sunset?: string };

type WeatherDetailProps = {
  visible: boolean;
  onClose: () => void;
  weatherData: {
    weather: string; temp: string; humidity: string; windDir: string; windPower: string;
    windSpeed?: string; feelsLike?: string; pressure?: string; visibility?: string;
    uvIndex?: string; airQuality?: string; sunrise?: string; sunset?: string;
    precip?: string; cityName?: string; alarm?: string; fetchedAt?: string;
  } | null;
  cityKey?: string;
};

function WeatherDetailModal({ visible, onClose, weatherData, cityKey }: WeatherDetailProps) {
  const [hour1d,    setHour1d]    = useState<HourItem[]>([]);
  const [forecast7d,setForecast7d]= useState<DayItem[]>([]);
  const [f7loading, setF7loading] = useState(false);

  // 打开时读取逐小时 + 7日预报
  useEffect(() => {
    if (!visible || !cityKey) return;
    let cancelled = false;
    (async () => {
      // 逐小时 + 7日预报：从 DB 一并读取（含 fetched_at 用于有效性检查）
      const { data: row } = await supabase
        .from('weather_cache')
        .select('hour1d, forecast7d, fetched_at')
        .eq('city', cityKey.replace(/[市区县省]$/, ''))
        .maybeSingle();
      if (cancelled) return;

      // 今天北京时间日期字符串（共用）
      const todayBj = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

      // ── 逐小时缓存有效性检查：fetched_at 必须是今天（北京时间）──
      // hour1d.time 只存 "HH:MM"，无法按条目判断日期，用 fetched_at 代替
      const cachedHour    = row?.hour1d as HourItem[] | undefined;
      const fetchedDateBj = row?.fetched_at
        ? new Date(new Date(row.fetched_at).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
        : '';
      const hourValid = cachedHour && cachedHour.length > 0 && fetchedDateBj === todayBj;

      // ── 7日缓存有效性检查：第一条 time >= 今天 ──
      const cached7d      = row?.forecast7d as DayItem[] | undefined;
      const cached7dValid = cached7d && cached7d.length > 0 && (cached7d[0].time ?? '') >= todayBj;

      if (hourValid)    setHour1d(cachedHour!);
      if (cached7dValid) setForecast7d(cached7d!);

      // 两者都有效 → 直接返回，无需网络请求
      if (hourValid && cached7dValid) return;

      // 有任一过期 → 并发调对应 EF
      if (!hourValid) {
        // 调 weather-1d EF：刷新实况+逐小时（EF 同时写 DB，下次打开直接命中缓存）
        supabase.functions.invoke('weather-1d', { body: { areaCn: cityKey } })
          .then(({ data: efData }) => {
            if (!cancelled && Array.isArray(efData?.data?.hour1d) && efData.data.hour1d.length > 0) {
              setHour1d(efData.data.hour1d as HourItem[]);
            }
          })
          .catch(() => { /* 静默失败，保留空列表 */ });
      }

      if (!cached7dValid) {
        setF7loading(true);
        try {
          const { data } = await supabase.functions.invoke('weather-7d', {
            body: { areaCn: cityKey, force: false },
          });
          if (!cancelled && data?.data?.forecast7d) setForecast7d(data.data.forecast7d as DayItem[]);
        } finally {
          if (!cancelled) setF7loading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [visible, cityKey]);

  if (!weatherData) return null;

  // 星期转换
  const dayOfWeek = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date();
    const diff  = Math.round((d.getTime() - today.setHours(0,0,0,0)) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    return ['日','一','二','三','四','五','六'][d.getDay()] ? `周${'日一二三四五六'[d.getDay()]}` : dateStr.slice(5);
  };

  const statsItems = [
    { label: '湿度',   value: weatherData.humidity   ? `${weatherData.humidity}%`         : '', icon: '💧' },
    { label: '体感',   value: weatherData.feelsLike   ? `${weatherData.feelsLike}°`        : '', icon: '🌡' },
    { label: '风向',   value: weatherData.windDir     ? `${weatherData.windDir} ${weatherData.windPower ?? ''}` : '', icon: '🌬' },
    { label: '气压',   value: weatherData.pressure    ? `${weatherData.pressure}hPa`       : '', icon: '🔵' },
    { label: '能见度', value: weatherData.visibility  ? `${weatherData.visibility}km`      : '', icon: '👁' },
    { label: '降水量', value: weatherData.precip      ? `${weatherData.precip}mm`          : '', icon: '🌧' },
    { label: '空气',   value: weatherData.airQuality  ?? '',                                     icon: '🍃' },
    { label: '日出',   value: weatherData.sunrise     ?? '',                                     icon: '🌅' },
    { label: '日落',   value: weatherData.sunset      ?? '',                                     icon: '🌇' },
  ].filter(x => !!x.value);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#0B1120',
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        borderTopWidth: 1, borderColor: 'rgba(96,165,250,0.3)',
        maxHeight: '92%', overflow: 'hidden',
      }}>
        {/* 顶部拖拽条 */}
        <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 2 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

          {/* ── 英雄区：背景渐变 + 大温度 + 天气图标 ── */}
          <LinearGradient
            colors={['rgba(56,116,226,0.28)', 'rgba(14,28,64,0.10)', 'transparent']}
            style={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 18 }}
          >
            {/* 城市行 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <MapPin size={13} color="#60A5FA" />
              <Text style={{ color: '#93C5FD', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 }}>
                {weatherData.cityName ?? '天津'}
              </Text>
              {!!weatherData.fetchedAt && weatherData.fetchedAt !== '2000-01-01T00:00:00+00:00' && (
                <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10, marginLeft: 4 }}>
                  更新 {weatherData.fetchedAt.slice(11, 16)}
                </Text>
              )}
            </View>

            {/* 温度 + 图标 */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ color: '#fff', fontSize: 72, fontWeight: '900', lineHeight: 76, letterSpacing: -2 }}>
                  {weatherData.temp}°
                </Text>
                <Text style={{ color: '#BAE6FD', fontSize: 18, fontWeight: '700', marginTop: 2 }}>
                  {weatherData.weather}
                </Text>
                {!!weatherData.feelsLike && (
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 3 }}>
                    体感温度 {weatherData.feelsLike}°C
                  </Text>
                )}
              </View>
              <View style={{ paddingTop: 4 }}>
                <AnimatedWeatherIcon weatherText={weatherData.weather} size={80} />
              </View>
            </View>

            {/* 预警横幅 */}
            {!!weatherData.alarm && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
                backgroundColor: 'rgba(239,68,68,0.18)', borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 8,
                borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)' }}>
                <AlertTriangle size={14} color="#F87171" />
                <Text style={{ color: '#FCA5A5', fontSize: 12, fontWeight: '700', flex: 1 }}>{weatherData.alarm}</Text>
              </View>
            )}
          </LinearGradient>

          {/* ── 逐小时滚动条 ── */}
          {hour1d.length > 0 && (
            <View style={{ marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, marginBottom: 8 }}>
                <Clock size={12} color="#60A5FA" />
                <Text style={{ color: '#93C5FD', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>逐小时预报</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}>
                {hour1d.map((h, i) => (
                  <View key={i} style={{
                    alignItems: 'center', gap: 4,
                    backgroundColor: i === 0 ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.05)',
                    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 10,
                    borderWidth: 1, borderColor: i === 0 ? 'rgba(96,165,250,0.45)' : 'rgba(255,255,255,0.08)',
                    minWidth: 56,
                  }}>
                    <Text style={{ color: i === 0 ? '#93C5FD' : 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' }}>
                      {i === 0 ? '现在' : h.time}
                    </Text>
                    <AnimatedWeatherIcon weatherText={h.weather} size={22} />
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{h.temp}°</Text>
                    {!!h.pop && h.pop !== '0' && (
                      <Text style={{ color: '#60A5FA', fontSize: 9 }}>{h.pop}%</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* ── 7日预报 ── */}
          <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <CalendarDays size={12} color="#60A5FA" />
              <Text style={{ color: '#93C5FD', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>7日天气预报</Text>
            </View>
            {f7loading ? (
              <ActivityIndicator size="small" color="rgba(96,165,250,0.5)" style={{ marginVertical: 12 }} />
            ) : forecast7d.length > 0 ? (
              <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                {forecast7d.map((d, i) => (
                  <View key={i} style={{
                    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11,
                    borderBottomWidth: i < forecast7d.length - 1 ? 1 : 0,
                    borderBottomColor: 'rgba(255,255,255,0.06)',
                  }}>
                    {/* 日期 */}
                    <Text style={{ color: i === 0 ? '#93C5FD' : 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700', width: 38 }}>
                      {dayOfWeek(d.time)}
                    </Text>
                    {/* 天气描述 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 }}>
                      <AnimatedWeatherIcon weatherText={d.weather} size={18} />
                      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{d.weather}</Text>
                      {!!d.pop && d.pop !== '0' && (
                        <Text style={{ color: '#60A5FA', fontSize: 10 }}>💧{d.pop}%</Text>
                      )}
                    </View>
                    {/* 温度范围 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>{d.tempMin}°</Text>
                      {/* 温度进度条 */}
                      <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
                          backgroundColor: 'rgba(96,165,250,0.5)', borderRadius: 2 }} />
                      </View>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{d.tempMax}°</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* ── 实况数据网格 ── */}
          {statsItems.length > 0 && (
            <View style={{ marginHorizontal: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Gauge size={12} color="#60A5FA" />
                <Text style={{ color: '#93C5FD', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>实况监测</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {statsItems.map(({ label, value, icon }) => (
                  <View key={label} style={{
                    width: '47%',
                    backgroundColor: 'rgba(96,165,250,0.07)',
                    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
                    borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)',
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                  }}>
                    <Text style={{ fontSize: 16 }}>{icon}</Text>
                    <View>
                      <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{label}</Text>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* 底部关闭按钮 */}
        <Pressable onPress={onClose} style={{
          alignItems: 'center', paddingVertical: 14,
          borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)',
          backgroundColor: '#0B1120',
        }}>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '600' }}>关 闭</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isAdmin, isPermanentAdmin, isAssistant, profile, session, signOut, refreshProfile } = useSession();

  // ── 实时同步状态：监听 Realtime channel 断线，显示提示条 ──
  const [realtimeOffline, setRealtimeOffline] = useState(false);
  const realtimeBannerOpacity = useSharedValue(0);
  const realtimeBannerStyle = useAnimatedStyle(() => ({
    opacity: realtimeBannerOpacity.value,
    transform: [{ translateY: withTiming(realtimeOffline ? 0 : -8, { duration: 300 }) }],
  }));
  useEffect(() => {
    realtimeBannerOpacity.value = withTiming(realtimeOffline ? 1 : 0, { duration: 400 });
  }, [realtimeOffline, realtimeBannerOpacity]);

  // 临时管理员剩余时间格式化（精确到秒）
  const tempExpiry = session?.temp_admin_expires_at ?? null;
  function formatTempRemaining(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    if (d <= now) return '';
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

  // 身份徽章倒计时文本（临时管理员）
  const tempRemaining = !isPermanentAdmin && isAdmin ? formatTempRemaining(tempExpiry) : '';

  // ── 通知状态（调价 + 限行）──────────────────────────────────
  type NotifBanner = {
    id: number | string;          // 调价用 DB id(number)；限行用 'restrict_YYYY-MM-DD'(string)
    type: 'oil_adjust' | 'traffic_restrict';
    title: string;
    body: string;
    meta: Record<string, unknown>;
    created_at: string;
  };
  const [activeBanner, setActiveBanner] = useState<NotifBanner | null>(null);
  const [notifVisible, setNotifVisible] = useState(false);
  // 通知红点（有未读通知时显示）
  const [unreadNotif, setUnreadNotif] = useState(0);
  // 已读通知 ID/key 集合（AsyncStorage 持久化，跨启动记忆）
  const readNotifIdsRef = useRef<Set<number | string>>(new Set());
  const STORAGE_KEY = 'oil_notif_read_ids';

  // 从 AsyncStorage 加载已读列表，然后查新调价通知
  // 用 useEffect 只做一次：加载 AsyncStorage + 注册 Realtime
  // 用 useFocusEffect 每次回屏重新从 DB 校准未读数（删除后再进来能正确清零）
  useEffect(() => {
    (async () => {
      // 1. 加载持久化已读列表
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const ids: (number | string)[] = JSON.parse(raw);
          ids.forEach(id => readNotifIdsRef.current.add(id));
        }
      } catch (_) { /* 读取失败不影响主流程 */ }
    })();
    // 不再注册 Realtime 监听，不再自动弹出任何通知横幅
  }, []);

  // 标记为已读并持久化到 AsyncStorage，同时减少未读红点计数
  const markNotifRead = useCallback(async (id: number | string) => {
    readNotifIdsRef.current.add(id);
    setNotifVisible(false);
    setUnreadNotif(n => Math.max(0, n - 1));
    try {
      const ids = Array.from(readNotifIdsRef.current);
      const trimmed = ids.slice(-200);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (_) { /* 写入失败不影响主流程 */ }
  }, []);

  // 限行通知横幅：已禁用，不再弹出任何提示信息
  const restrictNotifShownRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const showRestrictionBanner = useCallback(async (_r: TrafficRestriction, _city: string) => {
    // 功能已关闭：不写DB，不弹横幅，不显示红点
    restrictNotifShownRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 管理员功能区折叠状态已移除，始终展示
  // 油价数据
  const [oilPrice, setOilPrice] = useState<{
    p92: string; p95: string; p98: string; p0: string;
    pm10?: string; pm20?: string; pm35?: string;
    updateDate: string; trend: number; trendDate: string;
    nextAdjustDate?: string; nextTrend?: number; nextTrendText?: string;
    prevP92?: string; prevP95?: string; prevP98?: string; prevP0?: string;
    isSimul?: boolean;
    // 原油数据
    crudeBrent?: number; crudeWti?: number; crudeDubai?: number; crudeBasketAvg?: number;
    crudeBasketBrent?: number; crudeBasketDubai?: number; crudeBasketMinas?: number; // 10日窗口均价（三品种）
    crudeBasketDays?: number; crudeBasketStart?: string; crudeEiaDataDate?: string; lastAdjustDate?: string;
    crudeAvg10d?: number; crudeLastCycleAvg?: number;
    crudeLastCycleAvgLocked?: boolean;  // DB 持久化锁定（crude_last_cycle_locked）
    crudeLastCycleManual?: number;      // 管理员手动上期均价值（crude_last_cycle_manual）
    crudeChangeRate?: number; crudeCalcText?: string; crudeUpdatedAt?: string;
    crudeCoeffLow?: number; crudeCoeffHigh?: number; crudeCoeffN?: number;
    crudeAvg10dSource?: string; // eia / baidu_ai / baidu_ai_cache / cache / brent_fallback / manual_locked
    crudeAvg10dLocked?: boolean; // 管理员手动锁定本期均价标志
    crudeAvg10dManual?: number;  // 管理员手动设定的本期均价值
    // 税费联动公式结果（EF v7 + 实时汇率）
    crudeGrades?: Array<{ grade: string; convFactor: number; deltaPerLiter: number }>;
    crudeDeltaTon?: number;
    crudeRmbRate?: number;
    crudeRmbRateTime?: string;
    crudeRmbSource?: string;
    crudeFormulaParams?: { deltaP: number; R: number; barrelPerTon: number; T1: number; T2: number; K: number; deltaTon: number };
  } | null>(null);
  // 原油价格状态（全局，不随城市切换变化）
  const [crudeLoading, setCrudeLoading] = useState(false);
  const [oilLoading, setOilLoading] = useState(false);
  const [oilRefreshing, setOilRefreshing] = useState(false); // 手动刷新旋转状态
  const [oilCity, setOilCity] = useState('天津');
  const [oilCityModalVisible, setOilCityModalVisible] = useState(false);
  // 历史调价折线图
  type OilHistoryItem = { update_date: string; p92: string; p95: string; p98: string; p0: string; trend: number };
  const [oilHistory, setOilHistory] = useState<OilHistoryItem[]>([]);
  const [oilHistoryExpanded, setOilHistoryExpanded] = useState(false);
  const [oilHistoryLoading, setOilHistoryLoading] = useState(false);
  // 模拟变价产生的临时走势点（内存级，不写数据库；exitSimulMode 时清空）
  const [oilHistorySimul, setOilHistorySimul] = useState<OilHistoryItem | null>(null);
  // 油价卡内容区实际宽度（onLayout 动态测量，解决 flex:1 布局下无法推算宽度的问题）

  const [crudeCardW, setCrudeCardW] = useState(0); // 测算卡内容宽度，供走势图使用

  // ── NBA 赛事 ──
  type NbaGame = {
    matchId: string; matchDate: string; startTime: string;
    homeTeam: string; awayTeam: string;
    homeScore: string; awayScore: string;
    status: string; period: string;
    homeLogo: string; awayLogo: string;
  };
  const [nbaGames, setNbaGames] = useState<NbaGame[]>([]);
  const [nbaLoading, setNbaLoading] = useState(false);
  const [nbaChannelOpen, setNbaChannelOpen] = useState(false);
  const [nbaExpanded, setNbaExpanded] = useState(false); // 默认折叠

  // NBA 免费观看渠道（2026 中国大陆合规免费渠道）
  const NBA_WATCH_CHANNELS: { name: string; url: string; desc: string; color: string }[] = [
    { name: '直播吧', url: 'https://www.zhibo8.cc/nba/', desc: '文字直播+实时比分', color: '#1DB954' },
    { name: '央视体育', url: 'https://sports.cctv.com/nba/', desc: '每周免费直播焦点赛事', color: '#E60012' },
    { name: '腾讯体育', url: 'https://sports.qq.com/nba/', desc: '每日2场免费直播', color: '#12B7F5' },
    { name: '咪咕视频', url: 'https://www.miguvideo.com/', desc: '部分场次免费', color: '#0096E6' },
    { name: '虎扑NBA', url: 'https://nba.hupu.com/', desc: '文字直播+社区', color: '#F56C2D' },
  ];
  const openNbaChannel = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
    setNbaChannelOpen(false);
  }, []);

  const fetchNbaGames = useCallback(async () => {
    setNbaLoading(true);
    try {
      const { data } = await supabase.functions.invoke('nba-games', { body: { days: 5 } });
      if (Array.isArray((data as any)?.games)) setNbaGames((data as any).games as NbaGame[]);
    } catch { /* 静默失败 */ } finally {
      setNbaLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchNbaGames(); }, [fetchNbaGames]));

  // NBA 赛事状态文案
  const nbaStatusText = (g: NbaGame): string => {
    if (g.status === '进行中') return g.period || '进行中';
    if (g.status === '已结束') return '完场';
    const m = g.startTime && g.startTime.match(/(\d{2}):(\d{2})/);
    if (m) return `${m[1]}:${m[2]}`;
    return '待定';
  };
  // NBA 赛事日期标签（今天/明天/昨天/M/D）
  const nbaDateLabel = (g: NbaGame): string => {
    const d = g.matchDate;
    if (!d || d.length !== 8) return '';
    const date = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const fetchOilHistory = useCallback(async (city: string) => {
    setOilHistoryLoading(true);
    try {
      const cityKey = city.replace(/[市区县省]$/, '');
      const { data } = await supabase
        .from('oil_price_history')
        .select('update_date,p92,p95,p98,p0,trend')
        .eq('city', cityKey)
        .order('update_date', { ascending: false })
        .limit(10);
      if (data && data.length > 0) {
        setOilHistory([...data].reverse());
      }
    } catch { /* 静默失败 */ } finally {
      setOilHistoryLoading(false);
    }
  }, []);
  // 后台静默触发全国油价更新（当天只触发一次，调价日后自动强制刷新，不阻塞UI）
  // 首次加载原油价格的 useEffect 已移至 handleFetchCrudePrice 定义之后（见下方）

  // 所有支持的省份列表（与 EF 对应）
  const OIL_CITIES = ['北京','天津','上海','广东','重庆','四川','浙江','江苏','湖北','湖南','河北','河南','山东','陕西','辽宁','吉林','黑龙江','内蒙古','山西','安徽','福建','江西','广西','海南','贵州','云南','西藏','甘肃','青海','宁夏','新疆'];

  // ── 新闻头条状态 ──
  // Android 需要手动开启 LayoutAnimation
  if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  const toggleHeader = () => { /* 已废弃，折叠功能已移除 */ };

  // 直接从 oil_prices 数据库读取指定城市油价
  // 用 ref 持久化当前选中城市（state 在 effect 闭包内是旧快照，ref 始终最新）
  const oilCityRef = useRef('天津');
  // fetchOilPriceRef 始终指向最新 fetchOilPrice，供 useCallback 内安全调用（避免闭包捕获旧引用）
  const fetchOilPriceRef = useRef<(city?: string) => Promise<void>>(async () => {});

  const fetchOilPrice = async (city = oilCityRef.current) => {
    const cityKey = city.replace(/[市区县省]$/, '');

    // ── 读数据库（始终读最新）──
    if (!oilPrice) setOilLoading(true);
    try {
      const { data: dbRow } = await supabase
        .from('oil_prices')
        .select('*')
        .or(`city.eq.${cityKey},city.eq.${city}`)
        .maybeSingle();
      if (dbRow) {
        const parsed = {
          p92: dbRow.p92, p95: dbRow.p95, p98: dbRow.p98, p0: dbRow.p0,
          pm10: dbRow.pm10, pm20: dbRow.pm20, pm35: dbRow.pm35,
          updateDate: dbRow.update_date,
          trend: Number(dbRow.trend), trendDate: dbRow.trend_date,
          nextAdjustDate: dbRow.next_adjust_date,
          nextTrend: Number(dbRow.next_trend),
          nextTrendText: dbRow.next_trend_text,
          prevP92: dbRow.prev_p92 ?? '',
          prevP95: dbRow.prev_p95 ?? '',
          prevP98: dbRow.prev_p98 ?? '',
          prevP0:  dbRow.prev_p0  ?? '',
          isSimul: dbRow.is_simul ?? false,
          crudeBrent:     dbRow.crude_brent     ? Number(dbRow.crude_brent)      : undefined,
          crudeWti:       dbRow.crude_wti       ? Number(dbRow.crude_wti)        : undefined,
          crudeDubai:     dbRow.crude_dubai     ? Number(dbRow.crude_dubai)      : undefined,
          crudeBasketDays:  dbRow.crude_basket_days  ? Number(dbRow.crude_basket_days)  : undefined,
          crudeBasketStart: dbRow.crude_basket_start ?? undefined,
          lastAdjustDate:   dbRow.last_adjust_date   ?? undefined,
          crudeAvg10d:    dbRow.crude_avg10d    ? Number(dbRow.crude_avg10d)     : undefined,
          crudeLastCycleAvg: dbRow.crude_last_cycle_avg ? Number(dbRow.crude_last_cycle_avg) : undefined,
          // DB 持久化锁定：直接从 DB 字段读取，刷新页面也不会丢失
          crudeLastCycleAvgLocked: dbRow.crude_last_cycle_locked === true,
          crudeLastCycleManual: dbRow.crude_last_cycle_manual ? Number(dbRow.crude_last_cycle_manual) : undefined,
          crudeChangeRate: dbRow.crude_change_rate ? Number(dbRow.crude_change_rate) : undefined,
          crudeCalcText:  dbRow.crude_calc_text  ?? undefined,
          crudeUpdatedAt: dbRow.crude_updated_at ?? undefined,
          crudeCoeffLow:  dbRow.crude_coeff_low  ? Number(dbRow.crude_coeff_low)  : undefined,
          crudeCoeffHigh: dbRow.crude_coeff_high ? Number(dbRow.crude_coeff_high) : undefined,
          crudeCoeffN:    dbRow.crude_coeff_n    ? Number(dbRow.crude_coeff_n)    : undefined,
          crudeAvg10dSource: dbRow.crude_avg10d_source ?? undefined,
          crudeAvg10dLocked: dbRow.crude_avg10d_locked ?? false,
          crudeAvg10dManual: dbRow.crude_avg10d_manual ? Number(dbRow.crude_avg10d_manual) : undefined,
        };
        setOilPrice(prev => {
          // 本期均价锁定保护：若 DB 行仍是锁定状态（crude_avg10d_locked=true），保留手动值
          const keepLock = (prev?.crudeAvg10dLocked === true) || (parsed.crudeAvg10dLocked === true);
          const lockedVal = prev?.crudeAvg10dManual ?? prev?.crudeAvg10d;
          if (keepLock && lockedVal) {
            parsed.crudeAvg10d       = lockedVal;
            parsed.crudeAvg10dLocked = true;
            parsed.crudeAvg10dManual = lockedVal;
            parsed.crudeAvg10dSource = 'manual_locked';
          }
          // 上期均价锁定保护：DB 字段 crude_last_cycle_locked=true 时，用手动值覆盖读回值
          if (parsed.crudeLastCycleAvgLocked && (parsed.crudeLastCycleManual ?? 0) > 0) {
            parsed.crudeLastCycleAvg = parsed.crudeLastCycleManual;
          }
          return parsed;
        });
        setOilCity(cityKey || city);
        oilCityRef.current = cityKey || city; // 同步 ref
        // 同步拉取历史走势（静默，不阻塞主流程）
        fetchOilHistory(cityKey || city);
      } else {
        // 数据库无该城市数据 → 卡片保留，价格归零显示"--"，不清空卡片
        const empty = {
          p92: '--', p95: '--', p98: '--', p0: '--',
          pm10: '--', pm20: '--', pm35: '--',
          updateDate: '', trend: 0, trendDate: '',
          nextAdjustDate: '', nextTrend: 0, nextTrendText: '',
        };
        setOilPrice(empty);
        setOilCity(cityKey || city);
        oilCityRef.current = cityKey || city;
      }
    } catch (_) { /* 静默失败 */ } finally {
      setOilLoading(false);
    }
  };
  // 每次渲染后同步最新引用，供 useCallback 安全调用
  fetchOilPriceRef.current = fetchOilPrice;
  const [oilForceLoading, setOilForceLoading] = useState(false);
  const [oilForceResult, setOilForceResult] = useState<string>('');
  const handleForceOilUpdate = useCallback(async () => {
    if (oilForceLoading) return;
    setOilForceLoading(true);
    setOilForceResult('');
    try {
      const { data, error } = await supabase.functions.invoke('oilprice-admin-update', {
        body: { force: true },
      });
      if (error) {
        setOilForceResult(`❌ ${error.message}`);
      } else if (data?.status === 0) {
        const juhe = data.juhe_count ?? 0;
        const ai   = data.ai_count   ?? 0;
        const sc   = data.scrape_count ?? 0;
        const db   = data.db_count   ?? 0;
        const msg  = juhe > 0
          ? `✅ 聚合:${juhe} AI:${ai} 爬:${sc} 保:${db}`
          : `✅ AI:${ai} 爬:${sc} 保:${db}`;
        setOilForceResult(msg);
        // 调价完成（adjust-hook 已把本期均价→上期均价），解锁前端上期均价锁定
        setOilPrice(prev => prev ? { ...prev, crudeLastCycleAvgLocked: false } : prev);
        // 清缓存，立即重新读库
        await fetchOilPrice(oilCity);
        // 走势图同步刷新，展示最新调价价格
        await fetchOilHistory(oilCity);
      } else {
        setOilForceResult(`⚠️ ${data?.message ?? '未知错误'}`);
      }
    } catch (e) {
      setOilForceResult(`❌ ${String(e)}`);
    } finally {
      setOilForceLoading(false);
      // 5秒后清空结果文本
      setTimeout(() => setOilForceResult(''), 5000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oilForceLoading, oilCity]);

  // 管理员手动强制刷新走势预测（百度AI搜索 JSON格式）
  const [trendForceLoading, setTrendForceLoading] = useState(false);
  const [trendForceResult, setTrendForceResult] = useState<string>('');
  const handleForceTrendUpdate = useCallback(async () => {
    if (trendForceLoading) return;
    setTrendForceLoading(true);
    setTrendForceResult('');
    try {
      const { data, error } = await supabase.functions.invoke('oilprice-trend-update', {
        body: { force: true },
      });
      if (error) {
        setTrendForceResult(`❌ ${error.message}`);
      } else if (data?.status === 0 && !data?.skipped) {
        // EF 返回了 AI 抓取的最新走势数据 → 直接更新前端 state，无需等 DB 落盘
        const aiTrend = data?.data as { nextAdjustDate?: string; nextTrend?: number; nextTrendText?: string } | undefined;
        if (aiTrend) {
          setOilPrice(prev => prev ? {
            ...prev,
            ...(aiTrend.nextAdjustDate && { nextAdjustDate: aiTrend.nextAdjustDate }),
            ...(typeof aiTrend.nextTrend === 'number' && aiTrend.nextTrend !== 0 && { nextTrend: aiTrend.nextTrend }),
            ...(aiTrend.nextTrendText && { nextTrendText: aiTrend.nextTrendText }),
          } : prev);
        }
        // 同步清缓存，让下次自动刷新读最新 DB
        const cityKey = oilCity.replace(/[市区县省]$/, '');
        // 延迟 1s 后静默刷新 DB（不阻塞 UI）
        setTimeout(async () => {
          await fetchOilPrice(oilCity);
        }, 1000);
        const trendLabel = aiTrend?.nextTrendText
          ? ` · ${aiTrend.nextTrendText.replace(/^预计/, '')}`
          : '';
        setTrendForceResult(`✅ 调价预测已更新${trendLabel}`);
      } else if (data?.skipped) {
        // EF 命中24h冷却，但 DB 里已有最新数据，重读一次同步底栏
        const cityKey = oilCity.replace(/[市区县省]$/, '');
        await fetchOilPrice(oilCity);
        setTrendForceResult('ℹ️ 数据已是最新');
      } else {
        setTrendForceResult(`⚠️ ${data?.message ?? '未知错误'}`);
      }
    } catch (e) {
      setTrendForceResult(`❌ ${String(e)}`);
    } finally {
      setTrendForceLoading(false);
      setTimeout(() => setTrendForceResult(''), 6000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendForceLoading, oilCity]);

  // ── 原油数据刷新（调用 oilprice-crude EF）──
  const [crudeForceLoading, setCrudeForceLoading] = useState(false);
  const [crudeCollapsed, setCrudeCollapsed] = useState(true); // 原油卡默认折叠
  const [crudeForceResult, setCrudeForceResult] = useState<string>('');
  const handleFetchCrudePrice = useCallback(async (force = false) => {
    if (crudeForceLoading) return;
    setCrudeLoading(true);
    setCrudeForceLoading(force);
    setCrudeForceResult('');
    try {
      const { data, error } = await supabase.functions.invoke('oilprice-crude', {
        body: {
          force,
          city:  oilCity,
          tempC: weatherData?.temp != null ? parseFloat(String(weatherData.temp)) || null : null,
        },
      });
      if (error) {
        if (force) setCrudeForceResult(`❌ ${error.message}`);
      } else if (data?.status === 1) {
        // 税费联动公式结果（EF v6）
        const brentVal    = data.data?.brent          ?? 0;
        const deltaVal    = data.data?.estimatedDelta ?? 0;
        const willTrigger = data.data?.willTrigger    ?? false;
        const grades      = data.data?.grades         ?? [];
        const deltaTon    = data.data?.deltaTon       ?? 0;
        const formulaParams = data.data?.formulaParams ?? {};
        const g92 = grades.find((g: any) => g.grade === '92#');
        // 用本期均价-上期均价公式算变化率（锁定时用手动值）
        const curAvgEF  = (data.data?.avg10d ?? 0) > 0 ? (data.data?.avg10d ?? 0) : brentVal;
        const prevAvgEF = (data.data?.lastCycleAvg ?? 0) > 0 ? (data.data?.lastCycleAvg ?? 0) : curAvgEF;
        const rateByAvgEF = prevAvgEF > 0 ? +((curAvgEF - prevAvgEF) / prevAvgEF * 100).toFixed(1) : 0;
        const buildTrendText = () => {
          if (!willTrigger || deltaVal === 0) return '';
          const v = g92 ? g92.deltaPerLiter : deltaVal;
          const s = v >= 0 ? '+' : '';
          return deltaVal > 0 ? `预计上调 ${s}${Number(v).toFixed(2)}元/升（92#）`
                              : `预计下调 ${s}${Number(v).toFixed(2)}元/升（92#）`;
        };
        setOilPrice(prev => {
          if (!prev) return prev;
          const isLocked = prev.crudeAvg10dLocked || data.data?.isManualLocked;
          const effectiveAvg = isLocked ? (prev.crudeAvg10dManual ?? prev.crudeAvg10d) : data.data?.avg10d;
          // 上期均价已手动锁定则不被 EF 覆盖
          const lastCycle = prev.crudeLastCycleAvgLocked
            ? (prev.crudeLastCycleAvg ?? 0)
            : (data.data?.lastCycleAvg ?? prev.crudeLastCycleAvg ?? 0);
          // 锁定时用手动均价重算趋势变化率
          const lockedRate = isLocked && (effectiveAvg ?? 0) > 0 && lastCycle > 0
            ? +((effectiveAvg! - lastCycle) / lastCycle * 100).toFixed(1) : null;
          return {
            ...prev,
            crudeBrent:         brentVal,
            crudeWti:           data.data?.wti,
            crudeDubai:         data.data?.dubai,
            crudeBasketAvg:     data.data?.basketAvg,
            crudeBasketBrent:   data.data?.basketBrent,
            crudeBasketDubai:   data.data?.basketDubai,
            crudeBasketMinas:   data.data?.basketMinas,
            crudeBasketDays:    data.data?.basketDays,
            crudeBasketStart:   data.data?.basketStart,
            crudeEiaDataDate:   data.data?.eiaDataDate,
            crudeAvg10d:        effectiveAvg,
            crudeLastCycleAvg:  lastCycle,
            crudeChangeRate:    isLocked && lockedRate !== null ? lockedRate : data.data?.changeRate,
            crudeCalcText:      data.data?.calcText,
            crudeUpdatedAt:     data.data?.updatedAt,
            crudeGrades:        grades,
            crudeDeltaTon:      deltaTon,
            crudeFormulaParams: formulaParams,
            crudeRmbRate:       data.data?.rmbRate,
            crudeRmbRateTime:   data.data?.rmbRateTime,
            crudeRmbSource:     data.data?.rmbSource,
            crudeAvg10dSource:  isLocked ? 'manual_locked' : data.data?.avg10dSource,
            crudeAvg10dLocked:  isLocked ?? false,
            ...(willTrigger && deltaVal !== 0 && {
              nextTrend: deltaVal, nextTrendText: buildTrendText(),
            }),
          };
        });
        if (force) {
          const rateStr = rateByAvgEF >= 0
            ? `+${rateByAvgEF.toFixed(1)}%`
            : `${rateByAvgEF.toFixed(1)}%`;
          setCrudeForceResult(`✅ 布伦特$${Number(data.data?.brent).toFixed(1)} 均价变化${rateStr}`);
        }
      } else if (data?.skipped) {
        if (data?.data) {
          const sDeltaVal    = data.data?.estimatedDelta ?? 0;
          const sWillTrigger = data.data?.willTrigger    ?? false;
          const sGrades      = data.data?.grades         ?? [];
          const sg92 = sGrades.find((g: any) => g.grade === '92#');
          setOilPrice(prev => {
            if (!prev) return prev;
            const isLocked = prev.crudeAvg10dLocked || data.data?.isManualLocked;
            const effectiveAvg = isLocked ? (prev.crudeAvg10dManual ?? prev.crudeAvg10d) : data.data?.avg10d;
            const sLastCycle = prev.crudeLastCycleAvgLocked
              ? (prev.crudeLastCycleAvg ?? 0)
              : (data.data?.lastCycleAvg ?? prev.crudeLastCycleAvg ?? 0);
            const buildSkippedTrendText = () => {
              if (!sWillTrigger || sDeltaVal === 0) return '';
              const v = sg92 ? sg92.deltaPerLiter : sDeltaVal;
              const s = v >= 0 ? '+' : '';
              return sDeltaVal > 0 ? `预计上调 ${s}${Number(v).toFixed(2)}元/升（92#）`
                                   : `预计下调 ${s}${Number(v).toFixed(2)}元/升（92#）`;
            };
            const lockedRate = isLocked && (effectiveAvg ?? 0) > 0 && sLastCycle > 0
              ? +((effectiveAvg! - sLastCycle) / sLastCycle * 100).toFixed(2) : null;
            return {
              ...prev,
              crudeBrent:         data.data?.brent,
              crudeWti:           data.data?.wti,
              crudeDubai:         data.data?.dubai,
              crudeBasketAvg:     data.data?.basketAvg,
              crudeBasketBrent:   data.data?.basketBrent,
              crudeBasketDubai:   data.data?.basketDubai,
              crudeBasketMinas:   data.data?.basketMinas,
              crudeBasketDays:    data.data?.basketDays,
              crudeBasketStart:   data.data?.basketStart,
              crudeEiaDataDate:   data.data?.eiaDataDate,
              crudeAvg10d:        effectiveAvg,
              crudeLastCycleAvg:  sLastCycle,
              crudeChangeRate:    isLocked && lockedRate !== null ? lockedRate : (sLastCycle > 0 ? +((( data.data?.avg10d ?? 0) - sLastCycle) / sLastCycle * 100).toFixed(2) : data.data?.changeRate),
              crudeCalcText:      data.data?.calcText,
              crudeUpdatedAt:     data.data?.updatedAt,
              crudeGrades:        sGrades,
              crudeDeltaTon:      data.data?.deltaTon ?? 0,
              crudeFormulaParams: data.data?.formulaParams ?? {},
              crudeRmbRate:       data.data?.rmbRate,
              crudeRmbRateTime:   data.data?.rmbRateTime,
              crudeRmbSource:     data.data?.rmbSource,
              crudeAvg10dSource:  isLocked ? 'manual_locked' : data.data?.avg10dSource,
              crudeAvg10dLocked:  isLocked ?? false,
              ...(sWillTrigger && sDeltaVal !== 0 && {
                nextTrend: sDeltaVal, nextTrendText: buildSkippedTrendText(),
              }),
            };
          });
        }
        if (force) setCrudeForceResult('ℹ️ 数据1h内已是最新');
      } else {
        if (force) setCrudeForceResult(`⚠️ ${data?.error ?? '获取失败'}`);
      }
    } catch (e) {
      if (force) setCrudeForceResult(`❌ ${String(e)}`);
    } finally {
      setCrudeLoading(false);
      setCrudeForceLoading(false);
      if (force) setTimeout(() => setCrudeForceResult(''), 6000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crudeForceLoading]);

  // ── 首次加载时静默获取原油价格（在函数定义后，保证引用有效）──
  React.useEffect(() => {
    handleFetchCrudePrice(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 走势/调价日期相关 state（trendEdit已合并进模拟调价Modal，仅保留此注释占位）──
  // ── 调价窗口日期 独立弹窗（isAdmin/isAssistant 可见）──
  const [adjustDateVisible, setAdjustDateVisible] = useState(false);
  const [adjustDateInput, setAdjustDateInput] = useState('');
  const [adjustDateSaving, setAdjustDateSaving] = useState(false);
  const [adjustDateMsg, setAdjustDateMsg] = useState('');
  // 稳定的选中日期 Date 对象（传给 AdjustDatePicker 的 initialDate，弹窗打开时初始化一次）
  const [calSelectedDate, setCalSelectedDate] = useState<Date | undefined>(undefined);
  // 稳定的 onDateChange 回调，避免每次父组件渲染生成新引用导致 AdjustDatePicker 重渲染
  const onAdjustDateChange = useCallback((dateStr: string) => {
    setAdjustDateInput(dateStr);
    setAdjustDateMsg('');
  }, []);

  // ── 模拟调价 Modal（发改委测试专用，支持多城市批量下发）──
  const [simulVisible, setSimulVisible] = useState(false);
  const [simulCities, setSimulCities] = useState<Set<string>>(new Set()); // 选中的目标城市
  const [simulDate, setSimulDate] = useState('');
  const [simulDir, setSimulDir] = useState<'up'|'down'|'flat'>('flat');
  const [simulVal, setSimulVal] = useState('');
  const [simulSaving, setSimulSaving] = useState(false);
  const [simulMsg, setSimulMsg] = useState('');
  const [simulProgress, setSimulProgress] = useState(''); // "3/5" 批量进度
  // 模拟模式自动过期定时器（30分钟后退出）  // 模拟模式标志：下发成功后置 true，屏蔽所有自动刷新（防止真实 EF 覆盖模拟数据）
  // 用 ref 而非 state：不触发 re-render，且在 useEffect/useCallback 闭包内始终读到最新值
  const simulModeRef = useRef(false);
  // 模拟模式自动过期定时器（30分钟后退出，恢复真实数据刷新）
  const simulExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const SIMUL_TTL_MS = 60 * 60 * 1000; // 60 分钟（1小时）
  // 剩余秒数（null = 不在模拟模式）
  const [simulSecsLeft, setSimulSecsLeft] = useState<number | null>(null);

  // 退出模拟模式的统一入口：清标志 + 清定时器 + 调 oilprice-restore EF 恢复真实DB数据
  const exitSimulMode = useCallback(() => {
    if (!simulModeRef.current) return;
    simulModeRef.current = false;
    setSimulSecsLeft(null);
    if (simulExpireTimerRef.current) {
      clearTimeout(simulExpireTimerRef.current);
      simulExpireTimerRef.current = null;
    }
    if (simulCountdownIntervalRef.current) {
      clearInterval(simulCountdownIntervalRef.current);
      simulCountdownIntervalRef.current = null;
    }
    // 调 oilprice-restore EF 将 DB 里的模拟数据恢复为真实价格，然后刷新前端
    setOilHistorySimul(null); // 清除模拟临时点，折线图回到真实历史
    // 立即清除前端 state 里模拟写入的 nextAdjustDate / updateDate，防止调价窗口卡住
    setOilPrice(prev => prev ? {
      ...prev,
      nextAdjustDate: undefined, // 清空，待 fetchOilPrice 从 DB 读回真实值
      isSimul: false,
      prevP92: '', prevP95: '', prevP98: '', prevP0: '',
    } : prev);
    supabase.functions.invoke('oilprice-restore', { body: {} })
      .then(() => {
        fetchOilPrice(oilCityRef.current);
      })
      .catch(() => {
        // EF 失败时降级：只清内存缓存，重新读库
        fetchOilPrice(oilCityRef.current);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 开启模拟模式的统一入口：设标志 + 清已有轮询 + 挂 30min 自动过期 + 秒级倒计时
  const enterSimulMode = useCallback(() => {
    simulModeRef.current = true;
    // 清已有的自动刷新轮询
    if (adjAutoRefreshRef.current) {
      clearInterval(adjAutoRefreshRef.current);
      adjAutoRefreshRef.current = null;
    }
    // 清已有过期/倒计时定时器，重新计时
    if (simulExpireTimerRef.current) clearTimeout(simulExpireTimerRef.current);
    if (simulCountdownIntervalRef.current) clearInterval(simulCountdownIntervalRef.current);

    const startAt = Date.now();
    const totalSecs = Math.round(SIMUL_TTL_MS / 1000);
    setSimulSecsLeft(totalSecs);

    // 每秒更新剩余秒数
    simulCountdownIntervalRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startAt) / 1000);
      const remaining = totalSecs - elapsed;
      if (remaining <= 0) {
        if (simulCountdownIntervalRef.current) {
          clearInterval(simulCountdownIntervalRef.current);
          simulCountdownIntervalRef.current = null;
        }
        setSimulSecsLeft(0);
      } else {
        setSimulSecsLeft(remaining);
      }
    }, 1000);

    // 30min 到期后退出
    simulExpireTimerRef.current = setTimeout(() => {
      exitSimulMode();
    }, SIMUL_TTL_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitSimulMode]);

  const toggleSimulCity = useCallback((city: string) => {
    setSimulCities(prev => {
      const next = new Set(prev);
      next.has(city) ? next.delete(city) : next.add(city);
      return next;
    });
  }, []);

  const openSimul = useCallback(() => {
    const cur = oilCityRef.current.replace(/[市区县省]$/, '');
    setSimulCities(new Set([cur]));
    setSimulDate(oilPrice?.nextAdjustDate ?? '');
    const t = oilPrice?.nextTrend ?? 0;
    setSimulDir(t > 0 ? 'up' : t < 0 ? 'down' : 'flat');
    setSimulVal(t !== 0 ? Math.abs(t).toFixed(2) : '');
    setSimulMsg('');
    setSimulProgress('');
    setSimulVisible(true);
  }, [oilPrice]);

  const submitSimul = useCallback(async () => {
    if (simulSaving) return;
    if (simulCities.size === 0) { setSimulMsg('❌ 请至少选择一个城市'); return; }
    if (simulDate && !/^\d{4}-\d{2}-\d{2}$/.test(simulDate)) { setSimulMsg('❌ 调价日期格式应为 YYYY-MM-DD'); return; }
    const valNum = simulDir === 'flat' ? 0 : parseFloat(simulVal);
    if (simulDir !== 'flat' && (isNaN(valNum) || valNum <= 0 || valNum > 3)) { setSimulMsg('❌ 幅度应在 0.01~3.00 之间'); return; }

    const delta = simulDir === 'up' ? valNum : simulDir === 'down' ? -valNum : 0;
    const trend = delta;
    const trendText = simulDir === 'flat' ? '预计持平'
      : simulDir === 'up' ? `预计上调 +${valNum.toFixed(2)} 元/升`
      : `预计下调 -${valNum.toFixed(2)} 元/升`;

    setSimulSaving(true);
    setSimulMsg('');

    try {
      const cityList = Array.from(simulCities);

      setSimulMsg('⏳ 下发变价中…');

      // ⚡ 提前开启模拟模式（含 30min 自动过期），必须在第一次 EF 调用前
      enterSimulMode();

      // 分批下发（每批 20 个城市）
      // 新架构：直接传 delta 给 EF，由 EF 内部「读当前价→存 prev_*→算新价→写入」
      // 一次 EF 调用完成读写，彻底消除前端预读与 EF 写入之间的竞态
      const BATCH = 20;
      let done = 0;
      for (let i = 0; i < cityList.length; i += BATCH) {
        const batchCities = cityList.slice(i, i + BATCH);
        const batchBody = {
          cities: batchCities,
          ...(simulDate && { next_adjust_date: simulDate }),
          trend,
          next_trend: trend,
          next_trend_text: trendText,
          delta,   // ← 直接传 delta，EF 内部基于当前价计算
        };

        const { data, error } = await supabase.functions.invoke('oilprice-simul', { body: batchBody });
        if (error) throw new Error(error.message || JSON.stringify(error));
        if (data?.error) throw new Error(data.error);

        done += batchCities.length;
        setSimulProgress(`${done}/${cityList.length}`);
      }

      // 清内存缓存 → 刷新当前城市显示
      await fetchOilPrice(oilCityRef.current);

      // ── 构建模拟临时点并追加到走势图（内存级，不写数据库）──
      // 此时 fetchOilPrice 已刷新 oilPrice（新价 = 旧价+delta），
      // 所以直接用刷新后的 oilPrice ref 读新价，无需再加 delta
      const today = (() => {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      })();

      // ① 先单独设置模拟历史点（必须在 setOilPrice 外部，不能嵌套 setState）
      setOilPrice(prev => {
        if (!prev) return prev;
        // 模拟点价格 = 当前最新价（EF已写入delta后的价格）
        const simulPoint: OilHistoryItem = {
          update_date: simulDate || today,
          p92: prev.p92,
          p95: prev.p95,
          p98: prev.p98,
          p0:  prev.p0,
          trend: delta,
        };
        // 用 setTimeout 0 在本次渲染结束后触发，确保 React 批处理不冲突
        setTimeout(() => setOilHistorySimul(simulPoint), 0);

        // ② 同步更新走势胶囊文本
        return {
          ...prev,
          nextTrend: trend,
          nextTrendText: trendText,
          ...(simulDate && { nextAdjustDate: simulDate }),
        };
      });

      const plural = cityList.length > 1 ? ` 共 ${cityList.length} 个城市` : ` ${cityList[0]}`;
      setSimulMsg(`✅ 变价已下发！${plural}，请观察联动效果`);

      // ── 补全真实调价完整链路：触发 trend-update 推算下一期 next_adjust_date ──
      // 真实调价后 oilprice-trend-update 会自动被触发（每天一次），模拟调价手动补触发
      setSimulMsg(`✅ 变价已下发！${plural}，正在推算下期调价窗口…`);
      try {
        const { data: trendData } = await supabase.functions.invoke('oilprice-trend-update', {
          body: { force: true, algo_only: true }, // algo_only=true 跳过AI/爬虫，纯算法推算下一期
        });
        if (trendData?.status === 0) {
          // trend-update 成功 → 再次刷新前端，拿到新的 nextAdjustDate/nextTrend
          await fetchOilPrice(oilCityRef.current);
          // 重置 trendTriggerDateRef，防止今日触发标志阻止后续真实触发
          trendTriggerDateRef.current = '';
          setSimulMsg(`✅ 变价已下发！${plural}，下期调价窗口已推算完成`);
        } else {
          setSimulMsg(`✅ 变价已下发！${plural}（下期窗口推算跳过：数据已是最新）`);
        }
      } catch {
        // trend-update 失败不阻断主流程，只提示
        setSimulMsg(`✅ 变价已下发！${plural}（下期窗口推算失败，可手动刷新预测）`);
      }

      // ── 写入通知中心 ──
      const dirLabel = simulDir === 'up' ? '上涨' : simulDir === 'down' ? '下跌' : '持平';
      const valLabel = simulDir === 'flat' ? '' : ` ${valNum.toFixed(2)} 元/升`;
      const notifTitle = `🧪 模拟调价：油价${dirLabel}${valLabel}`;
      const notifBody = cityList.length > 3
        ? `已对 ${cityList.slice(0, 3).join('、')} 等 ${cityList.length} 个城市下发模拟${dirLabel}${valLabel}，30 分钟后自动恢复真实数据。`
        : `已对 ${cityList.join('、')} 下发模拟${dirLabel}${valLabel}，30 分钟后自动恢复真实数据。`;
      await supabase.from('notifications').insert({
        type:  'oil_simul',
        title: notifTitle,
        body:  notifBody,
        meta:  { cities: cityList, dir: simulDir, val: valNum, trend, trendText },
      });
      // 更新铃铛未读计数
      setUnreadNotif(n => n + 1);

      setTimeout(() => { setSimulVisible(false); setSimulMsg(''); setSimulProgress(''); }, 2200);
    } catch (e) {
      const msg = e instanceof Error
        ? e.message
        : (e && typeof e === 'object' && 'message' in e)
          ? String((e as { message: unknown }).message)
          : JSON.stringify(e);
      console.error('[simulSubmit] 下发失败:', e);
      setSimulMsg(`❌ 下发失败：${msg}`);
    } finally {
      setSimulSaving(false);
    }
  }, [simulSaving, simulCities, simulDate, simulDir, simulVal]);

  // ── 折算系数管理（管理员查看/编辑 DB 中的 conv_coeff_92/95/98/0）──
  type ConvRow = { city: string; conv_coeff_92: number | null; conv_coeff_95: number | null; conv_coeff_98: number | null; conv_coeff_0: number | null; conv_fuel_type: string | null; conv_data_src: string | null };
  const [convRows, setConvRows]               = useState<ConvRow[]>([]);
  const [convLoading, setConvLoading]         = useState(false);
  const [convPanelOpen, setConvPanelOpen]     = useState(false);
  const [convEditing, setConvEditing]         = useState<string | null>(null); // 当前编辑的城市
  const [convEdit92, setConvEdit92]           = useState('');
  const [convEdit95, setConvEdit95]           = useState('');
  const [convEdit98, setConvEdit98]           = useState('');
  const [convEdit0, setConvEdit0]             = useState('');
  const [convSaving, setConvSaving]           = useState(false);
  const [convMsg, setConvMsg]                 = useState('');

  const convEditingRef  = React.useRef<string | null>(null);
  // ref 同步追踪编辑值，避免 useCallback 闭包捕获旧 state 快照
  const convEdit92Ref   = React.useRef('');
  const convEdit95Ref   = React.useRef('');
  const convEdit98Ref   = React.useRef('');
  const convEdit0Ref    = React.useRef('');
  // 会话级持久缓存：保存每次成功写入的系数值，在任何 reload 中作为兜底
  const savedCoeffsRef  = React.useRef<Map<string, { c92: number; c95: number; c98: number; c0: number }>>(new Map());

  const loadConvCoeffs = useCallback(async (force = false) => {
    // 编辑进行中时跳过后台 reload，避免覆盖用户正在输入的值
    if (!force && convEditingRef.current) return;
    setConvLoading(true);
    try {
      const { data, error } = await supabase
        .from('oil_prices')
        .select('city,conv_coeff_92,conv_coeff_95,conv_coeff_98,conv_coeff_0,conv_fuel_type,conv_data_src')
        .neq('city', '__placeholder__')
        .order('city');
      if (error) throw new Error(error.message);
      const dbRows = (data ?? []) as ConvRow[];
      // 三级合并：DB 值 > 会话缓存 > 内存快照，确保任何情况下已保存的系数不丢失
      setConvRows(prev => dbRows.map(dbRow => {
        const cached   = savedCoeffsRef.current.get(dbRow.city);
        const existing = prev.find(r => r.city === dbRow.city);
        return {
          ...dbRow,
          conv_coeff_92: dbRow.conv_coeff_92 ?? (cached?.c92 != null ? cached.c92 : null) ?? existing?.conv_coeff_92 ?? null,
          conv_coeff_95: dbRow.conv_coeff_95 ?? (cached?.c95 != null ? cached.c95 : null) ?? existing?.conv_coeff_95 ?? null,
          conv_coeff_98: dbRow.conv_coeff_98 ?? (cached?.c98 != null ? cached.c98 : null) ?? existing?.conv_coeff_98 ?? null,
          conv_coeff_0:  dbRow.conv_coeff_0  ?? (cached?.c0  != null ? cached.c0  : null) ?? existing?.conv_coeff_0  ?? null,
        };
      }));
    } catch (e) {
      setConvMsg(`❌ 加载失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setConvLoading(false);
    }
  }, []);

  const handleConvPanelToggle = useCallback(() => {
    const opening = !convPanelOpen;
    setConvPanelOpen(opening);
    if (opening) {
      // 打开面板：强制刷新 DB 最新值，清掉上次残留的编辑状态
      loadConvCoeffs(true);
      convEditingRef.current = null;
      setConvEditing(null);
      setConvMsg('');
    }
    // 收起面板时不清除正在进行的编辑状态，避免 race condition
  }, [convPanelOpen, loadConvCoeffs]);

  const startEditConv = useCallback((row: ConvRow) => {
    convEditingRef.current = row.city;
    setConvEditing(row.city);
    // 清空输入框，让用户主动填写新值；placeholder 显示当前 DB 值作为参考
    convEdit92Ref.current = ''; setConvEdit92('');
    convEdit95Ref.current = ''; setConvEdit95('');
    convEdit98Ref.current = ''; setConvEdit98('');
    convEdit0Ref.current  = ''; setConvEdit0('');
    setConvMsg('');
  }, []);

  // 读 ref（而非 state 快照），彻底解决 useCallback 闭包捕获旧值问题
  const handleSaveConvCoeff = useCallback(async () => {
    const city = convEditingRef.current;
    if (!city) return;
    // 直接读 ref 的最新值，不依赖 state 快照
    const v92 = parseFloat(convEdit92Ref.current);
    const v95 = parseFloat(convEdit95Ref.current);
    const v98 = parseFloat(convEdit98Ref.current);
    const v0  = parseFloat(convEdit0Ref.current);
    if (!convEdit92Ref.current || isNaN(v92) || v92 < 1000 || v92 > 1500) { setConvMsg('❌ 请填写 92# 系数（1000~1500）'); return; }
    if (!convEdit95Ref.current || isNaN(v95) || v95 < 1000 || v95 > 1500) { setConvMsg('❌ 请填写 95# 系数（1000~1500）'); return; }
    if (!convEdit98Ref.current || isNaN(v98) || v98 < 1000 || v98 > 1500) { setConvMsg('❌ 请填写 98# 系数（1000~1500）'); return; }
    if (!convEdit0Ref.current  || isNaN(v0)  || v0  < 1000 || v0  > 1500) { setConvMsg('❌ 请填写 0#柴系数（1000~1500）'); return; }
    setConvSaving(true);
    setConvMsg('');
    try {
      // 先写入会话缓存（无论 DB 最终结果如何，本次输入不会因 reload 丢失）
      savedCoeffsRef.current.set(city, { c92: v92, c95: v95, c98: v98, c0: v0 });
      // 立即更新内存列表，消除等待感
      setConvRows(prev => prev.map(r => r.city === city
        ? { ...r, conv_coeff_92: v92, conv_coeff_95: v95, conv_coeff_98: v98, conv_coeff_0: v0, conv_data_src: '管理员手动修改' }
        : r));
      convEditingRef.current = null;
      setConvEditing(null);
      setConvMsg(`✅ ${city} 正在保存…`);
      // 异步写入 DB（不阻塞 UI，失败时不影响会话缓存和内存列表）
      const { error } = await supabase.from('oil_prices').update({
        conv_coeff_92: v92,
        conv_coeff_95: v95,
        conv_coeff_98: v98,
        conv_coeff_0:  v0,
        conv_data_src: '管理员手动修改',
      }).eq('city', city);
      if (error) {
        setConvMsg(`⚠️ ${city} 已缓存，DB 写入异常：${error.message}`);
      } else {
        setConvMsg(`✅ ${city} 折算系数已保存`);
      }
    } catch (e) {
      setConvMsg(`❌ ${e instanceof Error ? e.message : '保存失败'}`);
    } finally {
      setConvSaving(false);
      setTimeout(() => setConvMsg(''), 5000);
    }
  }, []); // 空依赖数组：所有值从 ref 读取，永不产生过期闭包

  // ── 手动写入/锁定本期均价 & 上期均价 ──
  const [avgEditModal, setAvgEditModal]         = useState<'prev' | 'basket' | null>(null);
  const [lastCycleInput, setLastCycleInput]     = useState('');
  const [lastCycleLoading, setLastCycleLoading] = useState(false);
  const [lastCycleMsg, setLastCycleMsg]         = useState('');

  // basket（一揽子均价）手动修正
  const [basketInput, setBasketInput]     = useState('');
  const [basketLoading, setBasketLoading] = useState(false);
  const [basketMsg, setBasketMsg]         = useState('');

  // 所有均价写入/解锁操作全部走 oilprice-manual-lock EF（service_role key），
  // 绕过 RLS（anon key 无 UPDATE 权限，直接 supabase.from().update() 被静默拒绝）

  const handleSaveLastCycleAvg = useCallback(async () => {
    const val = parseFloat(lastCycleInput);
    if (isNaN(val) || val < 30 || val > 200) {
      setLastCycleMsg('❌ 请输入合理均价（30~200 $/桶）'); return;
    }
    setLastCycleLoading(true); setLastCycleMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('oilprice-manual-lock', {
        body: { action: 'lock_last_cycle', value: val },
      });
      if (error || data?.status !== 0) throw new Error(data?.message ?? error?.message ?? '写入失败');
      setOilPrice(prev => prev ? { ...prev, crudeLastCycleAvg: val, crudeLastCycleManual: val, crudeLastCycleAvgLocked: true } : prev);
      setLastCycleInput('');
      setLastCycleMsg(`✅ 上期均价已锁定 $${val.toFixed(2)}，刷新不变`);
      setTimeout(() => { setAvgEditModal(null); setLastCycleMsg(''); }, 1400);
    } catch (e) {
      setLastCycleMsg(`❌ ${e instanceof Error ? e.message : '保存失败'}`);
    } finally {
      setLastCycleLoading(false);
      setTimeout(() => setLastCycleMsg(''), 5000);
    }
  }, [lastCycleInput]);

  const handleUnlockLastCycleAvg = useCallback(async () => {
    setLastCycleLoading(true); setLastCycleMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('oilprice-manual-lock', {
        body: { action: 'unlock_last_cycle' },
      });
      if (error || data?.status !== 0) throw new Error(data?.message ?? error?.message ?? '解锁失败');
      setOilPrice(prev => prev ? { ...prev, crudeLastCycleAvgLocked: false, crudeLastCycleManual: undefined } : prev);
      setLastCycleMsg('🔓 上期均价锁定已解除，恢复自动获取');
      setTimeout(() => { setAvgEditModal(null); setLastCycleMsg(''); }, 1200);
    } catch (e) {
      setLastCycleMsg(`❌ ${e instanceof Error ? e.message : '解锁失败'}`);
    } finally {
      setLastCycleLoading(false);
      setTimeout(() => setLastCycleMsg(''), 5000);
    }
  }, []);

  // ── 一揽子均价手动修正（lock_avg10d / unlock_avg10d）──
  const handleSaveBasketAvg = useCallback(async () => {
    const val = parseFloat(basketInput);
    if (isNaN(val) || val < 30 || val > 200) {
      setBasketMsg('❌ 请输入合理均价（30~200 $/桶）'); return;
    }
    setBasketLoading(true); setBasketMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('oilprice-manual-lock', {
        body: { action: 'lock_avg10d', value: val },
      });
      if (error || data?.status !== 0) throw new Error(data?.message ?? error?.message ?? '写入失败');
      setOilPrice(prev => prev ? {
        ...prev,
        crudeAvg10d: val,
        crudeAvg10dLocked: true,
        crudeAvg10dManual: val,
        crudeAvg10dSource: 'manual_locked',
      } : prev);
      setBasketInput('');
      setBasketMsg(`✅ 一揽子均价已锁定 $${val.toFixed(2)}，刷新不变`);
      setTimeout(() => { setAvgEditModal(null); setBasketMsg(''); }, 1400);
    } catch (e) {
      setBasketMsg(`❌ ${e instanceof Error ? e.message : '保存失败'}`);
    } finally {
      setBasketLoading(false);
      setTimeout(() => setBasketMsg(''), 5000);
    }
  }, [basketInput]);

  const handleUnlockBasketAvg = useCallback(async () => {
    setBasketLoading(true); setBasketMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('oilprice-manual-lock', {
        body: { action: 'unlock_avg10d' },
      });
      if (error || data?.status !== 0) throw new Error(data?.message ?? error?.message ?? '解锁失败');
      setOilPrice(prev => prev ? { ...prev, crudeAvg10dLocked: false, crudeAvg10dManual: undefined } : prev);
      setBasketMsg('🔓 一揽子均价锁定已解除，恢复自动获取');
      setTimeout(() => { setAvgEditModal(null); setBasketMsg(''); }, 1200);
    } catch (e) {
      setBasketMsg(`❌ ${e instanceof Error ? e.message : '解锁失败'}`);
    } finally {
      setBasketLoading(false);
      setTimeout(() => setBasketMsg(''), 5000);
    }
  }, []);

  // ── 立即测试联动：只把 next_adjust_date 设为今天、update_date 设为昨天 ──  // 目的：让胶囊/窗口条件立即成立，观察 UI 联动效果，不触发任何价格变更
  const handleSimulLiveTest = useCallback(async () => {
    const cities = Array.from(simulCities);
    if (cities.length === 0) { setSimulMsg('❌ 请先选择城市'); return; }

    const todayLocal = new Date();
    const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}`;
    const yesterday = (() => {
      const d = new Date(Date.now() - 86400000);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();

    setSimulMsg('⏳ 正在设置测试窗口…');

    // ⚡ 提前开启模拟模式（含 30min 自动过期），必须在 EF 调用前
    enterSimulMode();

    // 只更新日期字段，完全不碰价格（service_role 绕过 RLS）
    const { error } = await supabase.functions.invoke('oilprice-simul', {
      body: {
        cities,
        next_adjust_date: todayStr,      // 调价日 = 今天 → 窗口立刻打开
        update_date_override: yesterday, // update_date 写昨天 → 窗口条件成立
        // 不传 per_city_prices → EF 不覆盖任何价格字段
      },
    });
    if (error) { setSimulMsg(`❌ ${error.message}`); return; }

    // 清缓存并刷新，让前端重算 isWindowOpen
    await fetchOilPrice(oilCityRef.current);
    setSimulMsg('✅ 测试窗口已打开，关闭弹窗观察胶囊变色');
    setTimeout(() => { setSimulVisible(false); setSimulMsg(''); }, 2000);
  }, [simulCities]);

  // 仅在调价窗口开启后才触发全国油价价格更新（平时油价不变，无需更新）
  // 走势（next_trend/next_adjust_date）由 oilprice-trend-update EF 每天独立维护
  const triggerOilPriceBackgroundUpdate = useCallback(() => {
    if (!oilPrice) return;

    const todayLocal = new Date();
    const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}`;
    const nextAdj  = oilPrice.nextAdjustDate ?? '';
    const updateDt = oilPrice.updateDate     ?? '';

    // 精准调价窗口：今日 > 调价日（即调价日当天24:00已过，次日0:00起开窗），且本期价格数据尚未更新
    // 国内成品油价格在调价日24:00生效，因此窗口从次日0:00开启
    const isAdjustWindow = nextAdj && todayStr > nextAdj && updateDt < nextAdj;
    if (!isAdjustWindow) return;
    // 模拟模式期间屏蔽真实 EF 自动刷新，防止覆盖模拟数据
    if (simulModeRef.current) return;

    // fire-and-forget：调价窗口开启，后台静默抓取最新价格（只更新一次，EF内部有锁）
    supabase.functions.invoke('oilprice-admin-update', { body: { force: false } })
      .then(({ data }) => {
        if (data?.status === 0 && !data?.skipped) {
          // 价格已更新（adjust-hook 已把本期均价→上期均价），解锁上期均价锁定
          // 让 fetchOilPrice 读回 DB 里轮换后的新上期均价
          setOilPrice(prev => prev ? { ...prev, crudeLastCycleAvgLocked: false } : prev);
          fetchOilPrice(oilCity);
          fetchOilHistory(oilCity); // 走势图同步刷新
        }
      })
      .catch(() => { /* 后台失败静默处理 */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oilCity, oilPrice?.nextAdjustDate, oilPrice?.updateDate]);

  // 走势更新：每天北京日期首次进入App时触发一次（EF服务端24h冷却兜底）
  const trendTriggerDateRef = useRef<string>('');
  const triggerTrendBackgroundUpdate = useCallback(() => {
    // 北京时间今日日期 YYYY-MM-DD
    const bjDate = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const todayBj = bjDate.toISOString().slice(0, 10);
    if (trendTriggerDateRef.current === todayBj) return; // 今天已触发
    trendTriggerDateRef.current = todayBj;
    supabase.functions.invoke('oilprice-trend-update', { body: { force: false, algo_only: true } })
      .then(({ data }) => {
        if (data?.status === 0 && !data?.skipped) {
          // 走势已更新 → 清内存缓存，重读数据库获取新走势
          const cityKey = oilCity.replace(/[市区县省]$/, '');
          fetchOilPrice(oilCity);
        }
      })
      .catch(() => { trendTriggerDateRef.current = ''; /* 失败则下次重试 */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oilCity]);

  // ── 调价日自动刷新：daysLeft 降为 0 时触发后台价格更新，直到价格已更新为止 ──
  const adjAutoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!oilPrice?.nextAdjustDate) return;

    const todayLocal = new Date();
    const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}`;
    const nextAdj  = oilPrice.nextAdjustDate;
    const updateDt = oilPrice.updateDate ?? '';

    // 窗口条件：今日 > 调价日（调价日24:00已过）且本期价格尚未更新
    const isWindow = todayStr > nextAdj && updateDt < nextAdj;
    if (!isWindow || simulModeRef.current) {
      // 窗口未开或模拟模式 → 清除旧轮询
      if (adjAutoRefreshRef.current) {
        clearInterval(adjAutoRefreshRef.current);
        adjAutoRefreshRef.current = null;
      }
      return;
    }

    // 窗口已开且还没有轮询 → 立即触发一次，再每 5 分钟重试
    if (adjAutoRefreshRef.current) return; // 已在轮询中，不重复注册

    const doRefresh = () => {
      supabase.functions.invoke('oilprice-admin-update', { body: { force: false } })
        .then(({ data }) => {
          if (data?.status === 0 && !data?.skipped) {
            // adjust-hook 已把本期均价轮换为上期均价，解锁前端锁定标志
            setOilPrice(prev => prev ? { ...prev, crudeLastCycleAvgLocked: false } : prev);
            fetchOilPrice(oilCityRef.current);
            fetchOilHistory(oilCityRef.current); // 走势图同步刷新
          }
        })
        .catch(() => { /* 静默失败，等下次轮询 */ });
    };

    doRefresh(); // 立即执行一次
    adjAutoRefreshRef.current = setInterval(doRefresh, 5 * 60 * 1000); // 每5分钟重试

    return () => {
      if (adjAutoRefreshRef.current) {
        clearInterval(adjAutoRefreshRef.current);
        adjAutoRefreshRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oilPrice?.nextAdjustDate, oilPrice?.updateDate]);

  // Realtime：监听 oil_prices 表变化，自动刷新当前城市显示
  // 同时响应天津行的锁定状态变更（crude_avg10d_locked）
  // v962：DB 的 crude_* 字段变更时同步触发 handleFetchCrudePrice，测算卡实时更新
  useEffect(() => {
    const channel = supabase
      .channel('oil_prices_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'oil_prices' },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            city?: string;
            crude_avg10d_locked?: boolean;
            crude_avg10d_manual?: number;
            crude_updated_at?: string;
          } | undefined;
          const cur = oilCity.replace(/[市区县省]$/, '');
          const isTianjinRow = row?.city === '天津';
          const isCurrentCityRow = row?.city && (row.city === cur || row.city === oilCity);

          // 当前城市行变更 → 刷新基础油价
          if (isCurrentCityRow) {
            fetchOilPrice(oilCity);
          }
          // 天津行变更（锁定状态 / 原油字段）→ 刷新基础油价
          if (isTianjinRow) {
            fetchOilPrice(oilCityRef.current);
          }
          // crude_updated_at 有值说明 oilprice-crude EF 刚写完 → 同步刷新测算卡
          if ((isCurrentCityRow || isTianjinRow) && (payload.new as any)?.crude_updated_at) {
            // 延迟 300ms 确保 DB 事务完全提交后再读
            setTimeout(() => { handleFetchCrudePrice(false); }, 300);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oilCity]);

  const [query, setQuery] = useState('');
  const searchInputRef = useRef<import('react-native').TextInput>(null);
  const [results, setResults] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  // 查询悬浮球展开状态
  const [searchBallOpen, setSearchBallOpen] = useState(false);
  // 悬浮球屏幕坐标（用于展开面板定位）
  const [searchBallPos, setSearchBallPos] = useState<{ x: number; y: number } | null>(null);
  // 结果弹窗
  const [resultModalVisible, setResultModalVisible] = useState(false);
  // 记录最近一次搜索关键词，供后台轮询复用
  const lastQueryRef = useRef('');
  // 近期搜索记录（最多6条）
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  // 结果类型筛选
  const [typeFilter, setTypeFilter] = useState<'all' | VehicleType>('all');

  // ── 安全区适配常量（动态随 insets 变化）──
  // 底部横条卡实际高度：由 onLayout 动态测量，初始值 62 防止首帧闪烁
  const [bottomBarH, setBottomBarH] = useState(62);
  // safeBottom：iOS Home 指示条高度；Android 为 0
  const safeBottom = insets.bottom;
  // 顶部留白：状态栏 + 16px 呼吸空间（insets.top=0 时回退到 16）
  const dynPaddingTop = Math.max(insets.top, 0) + 16;
  // ScrollView 底部留白（由 oilPrice 是否存在决定横条卡是否显示）
  const dynPaddingBottomOil  = bottomBarH + 8; // 有横条卡：卡高 + 少量呼吸
  const dynPaddingBottomNoOil = safeBottom + 20; // 无横条卡（退化悬浮球）
  // 搜索悬浮球初始底部距离
  const ballBottomOil   = bottomBarH + 8;
  const ballBottomNoOil = safeBottom + 32;
  // 聊天/通知悬浮球初始底部（无横条卡时显示）
  const chatBallBottom = safeBottom + 32;

  // ── 头像上传 ──
  // （头像上传功能已移除）

  // 车辆总数统计 — 初始给 0 避免显示"…"，useFocusEffect 会立即刷新真实值
  const [counts, setCounts] = useState<{ gasoline: number; diesel: number; lng: number }>({ gasoline: 0, diesel: 0, lng: 0 });

  // 未读私信数（Realtime 实时更新）
  const [unreadDm, setUnreadDm] = useState(0);
  // 全体频道未读数（基于 lastSeenAt 本地时间戳）
  const [unreadChat, setUnreadChat] = useState(0);
  const CHAT_SEEN_KEY = 'chat_last_seen';

  // 全体频道未读：查询 lastSeenAt 之后的新消息数
  const fetchUnreadChat = useCallback(async () => {
    const lastSeen = process.env.EXPO_OS === 'web'
      ? localStorage.getItem(CHAT_SEEN_KEY)
      : null;
    // 没有记录说明从未进过聊天，查最新1条是否存在
    if (!lastSeen) {
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'general');
      setUnreadChat(count && count > 0 ? 1 : 0); // 有消息就显示点
      return;
    }
    const { count } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'general')
      .gt('created_at', lastSeen);
    setUnreadChat(count ?? 0);
  }, []);

  // 限行弹窗状态
  const [restrictionModalVisible, setRestrictionModalVisible] = useState(false);
  // 限行信息状态
  const [restriction, setRestriction] = useState<TrafficRestriction | null>(null);
  const [restrictionLoading, setRestrictionLoading] = useState(false);
  const [restrictionCity, setRestrictionCity] = useState('tianjin');
  const restrictionCityRef = useRef('tianjin'); // ref 避免 useFocusEffect 闭包捕获过期值
  // 受限车辆弹窗状态
  const [restrictedVehiclesVisible, setRestrictedVehiclesVisible] = useState(false);
  const [restrictedVehicles, setRestrictedVehicles] = useState<Vehicle[]>([]);
  const [restrictedLoading, setRestrictedLoading] = useState(false);
  // 天气状态
  const [weatherData, setWeatherData] = useState<{
    weather: string; temp: string; humidity: string; windDir: string; windPower: string;
    windSpeed?: string; feelsLike?: string; pressure?: string; visibility?: string;
    uvIndex?: string; airQuality?: string; sunrise?: string; sunset?: string;
    moonPhase?: string; precip?: string; cityName?: string; alarm?: string;
    fetchedAt?: string;
  } | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherRefreshing, setWeatherRefreshing] = useState(false);
  const [weatherCity, setWeatherCity] = useState('天津');
  const [weatherDetailVisible, setWeatherDetailVisible] = useState(false);
  // 特效预览模式：null = 跟随真实天气，非 null = 临时预览指定特效
  const [fxPreview, setFxPreview] = useState<WeatherKind | null>(null);
  const [fxPickerVisible, setFxPickerVisible] = useState(false);

  // 获取今日天气：
  //   Step1: 先读数据库，有缓存（30min内）立即展示
  //   Step2: 缓存过期/无缓存 → 调 weather-1d EF（写库+返回最新数据）
  const fetchWeather = useCallback(async (fallbackAreaCn = '天津') => {
    const CACHE_TTL = 15 * 60 * 1000;
    const cityKey = fallbackAreaCn.replace(/[市区县省]$/, '');

    // ── Step 1: 先读 DB 缓存，立即显示 ──
    try {
      const { data: cached } = await supabase
        .from('weather_cache')
        .select('city,city_name,weather,temp,humidity,wind_dir,wind_power,wind_speed,feels_like,pressure,visibility,uv_index,air_quality,sunrise,sunset,moon_phase,precip,alarm,fetched_at')
        .eq('city', cityKey)
        .maybeSingle();
      if (cached?.temp && cached.temp !== '--' && cached.temp !== '') {
        const age = Date.now() - new Date(cached.fetched_at).getTime();
        const displayName = cached.city_name || cached.city || cityKey;
        setWeatherData({
          weather:    cached.weather     ?? '晴',
          temp:       cached.temp        ?? '--',
          humidity:   cached.humidity    ?? '--',
          windDir:    cached.wind_dir    ?? '',
          windPower:  cached.wind_power  ?? '',
          windSpeed:  cached.wind_speed  ?? '',
          feelsLike:  cached.feels_like  ?? '',
          pressure:   cached.pressure    ?? '',
          visibility: cached.visibility  ?? '',
          uvIndex:    cached.uv_index    ?? '',
          airQuality: cached.air_quality ?? '',
          sunrise:    cached.sunrise     ?? '',
          sunset:     cached.sunset      ?? '',
          moonPhase:  cached.moon_phase  ?? '',
          precip:     cached.precip      ?? '',
          alarm:      cached.alarm       ?? '',
          fetchedAt:  cached.fetched_at  ?? '',
          cityName:   displayName,
        });
        setWeatherCity(displayName);
        if (age < CACHE_TTL) return; // 缓存新鲜，无需联网
        // 缓存过期：已有旧数据展示，静默后台刷新（不 setLoading）
      }
    } catch { /* 读库失败，继续走 EF */ }

    // ── Step 2: 缓存过期或无缓存 → 调 weather-1d EF 实时拉取并写库 ──
    setWeatherLoading(true);
    try {
      let reqBody: Record<string, unknown> = { areaCn: fallbackAreaCn, needalarm: '1', cityLabel: fallbackAreaCn };
      let cityLabel = fallbackAreaCn;

      // 尝试 GPS 定位（Native 端）
      try {
        if (process.env.EXPO_OS !== 'web') {
          const Location = await import('expo-location');
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const pos = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 3000 })
              ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low, timeInterval: 1000 });
            if (pos) {
              const { latitude: lat, longitude: lng } = pos.coords;
              reqBody = { lat: String(lat), lng: String(lng), needalarm: '1', cityLabel: fallbackAreaCn };
              try {
                const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
                cityLabel = geo?.city ?? geo?.subregion ?? geo?.region ?? fallbackAreaCn;
                reqBody.cityLabel = cityLabel;
                reqBody.areaCn = cityLabel;
              } catch { /* 逆编码失败 */ }
            }
          }
        } else {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000, maximumAge: 60000 })
          );
          reqBody = { lat: String(pos.coords.latitude), lng: String(pos.coords.longitude), needalarm: '1', cityLabel: '当前位置', areaCn: fallbackAreaCn };
        }
      } catch { /* GPS 不可用，使用城市名降级 */ }

      const { data, error } = await supabase.functions.invoke('weather-1d', { body: reqBody });
      if (error || !data?.data) {
        console.warn('[weather] weather-1d EF error:', error, 'data:', JSON.stringify(data));
        throw new Error('weather-1d EF 返回异常');
      }

      const w = data.data;
      const displayName = (w.cityName && w.cityName !== '当前位置') ? w.cityName : cityLabel;
      setWeatherData({
        weather:    w.weather    ?? '晴',
        temp:       w.temp       ?? '--',
        humidity:   w.humidity   ?? '--',
        windDir:    w.windDir    ?? '',
        windPower:  w.windPower  ?? '',
        windSpeed:  w.windSpeed  ?? '',
        feelsLike:  w.feelsLike  ?? '',
        pressure:   w.pressure   ?? '',
        visibility: w.visibility ?? '',
        uvIndex:    w.uvIndex    ?? '',
        airQuality: w.airQuality ?? '',
        sunrise:    w.sunrise    ?? '',
        sunset:     w.sunset     ?? '',
        moonPhase:  w.moonPhase  ?? '',
        precip:     w.precip     ?? '',
        alarm:      w.alarm      ?? '',
        fetchedAt:  w.fetchedAt  ?? '',
        cityName:   displayName,
      });
      setWeatherCity(displayName);
    } catch (err) {
      console.warn('[weather] fetchWeather failed:', err);
      // 全部失败时保留旧数据不清空
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  // 7日天气预报 fetch 已移除（不再显示7日预报）

  const { date, week } = getDateStr();

  // GPS → 城市代号映射（仅限限行 API 支持的12个城市）
  const GPS_CITY_MAP: Record<string, string> = {
    '北京': 'beijing', '天津': 'tianjin', '杭州': 'hangzhou', '成都': 'chengdu',
    '兰州': 'lanzhou', '贵阳': 'guiyang', '南昌': 'nanchang', '长春': 'changchun',
    '哈尔滨': 'haerbin', '武汉': 'wuhan', '上海': 'shanghai', '深圳': 'shenzhen',
  };

  // 未读私信数：初始加载 + useFocusEffect 刷新（回到首页时同步） + Realtime 推送
  useEffect(() => {
    if (!session?.id) return;
    const fetchUnread = async () => {
      const { count } = await supabase
        .from('private_messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', session.id)
        .eq('is_read', false);
      setUnreadDm(count ?? 0);
    };
    fetchUnread();
    // Realtime：新私信到达时 +1；更新已读时重新查询
    const ch = supabase
      .channel('home_pm_badge')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'private_messages',
        filter: `receiver_id=eq.${session.id}`,
      }, () => { fetchUnread(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'private_messages',
        filter: `receiver_id=eq.${session.id}`,
      }, () => { fetchUnread(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.id]);

  // 全体频道未读：初始加载 + Realtime 推送（有新消息即递增）
  useEffect(() => {
    fetchUnreadChat();
    const ch = supabase
      .channel('home_chat_badge')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: 'channel=eq.general',
      }, (payload) => {
        // 排除自己发的消息
        if (String((payload.new as { sender_id: string }).sender_id) === String(session?.id)) return;
        setUnreadChat((n) => n + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchUnreadChat, session?.id]);

  // 回到首页时刷新未读数（从私信页/聊天页返回后同步）
  useFocusEffect(useCallback(() => {
    if (!session?.id) return;
    (async () => {
      const { count } = await supabase
        .from('private_messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', session.id)
        .eq('is_read', false);
      setUnreadDm(count ?? 0);
    })();
    fetchUnreadChat();
    fetchWeather('天津');
    fetchOilPrice(oilCityRef.current); // 使用 ref 读当前城市，不覆盖用户选择
    loadConvCoeffs();                   // 静默拉取 DB 折算系数（编辑中时跳过，避免覆盖输入）
    triggerOilPriceBackgroundUpdate();
    triggerTrendBackgroundUpdate();

    // 每次回到首页重新从 DB 校准通知未读数
    // 解决：通知页删除/清空后返回首页红点仍在的问题
    (async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: notifData } = await supabase
          .from('notifications')
          .select('id')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(50);
        if (!notifData || notifData.length === 0) {
          // DB 里已无通知（全部被删除），清零红点和横幅
          setUnreadNotif(0);
          setNotifVisible(false);
        } else {
          // 仅统计 DB 中实际存在且未读的条目
          const unread = notifData.filter(n => !readNotifIdsRef.current.has(n.id)).length;
          setUnreadNotif(unread);
          if (unread === 0) setNotifVisible(false);
        }
      } catch (_) { /* 网络失败不影响主流程 */ }
    })();


    const unsubOilImport = appEvents.on(EVT_OIL_IMPORTED, () => {
      fetchOilPrice(oilCityRef.current);
    });

    // 监听 oil_prices 表任意变更（含批量删除），防抖 800ms 避免连续触发
    // v962：同时检测 crude_updated_at 变化，自动刷新测算卡（无需手动点刷新）
    let oilRealtimeTimer: ReturnType<typeof setTimeout> | null = null;
    let crudeRealtimeTimer: ReturnType<typeof setTimeout> | null = null;
    let hasBeenSubscribed = false; // 防止初次连接时 CLOSED 状态误触发断线横幅
    const oilChannel = supabase
      .channel('oil_prices_changes_' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oil_prices' }, (payload) => {
        if (oilRealtimeTimer) clearTimeout(oilRealtimeTimer);
        oilRealtimeTimer = setTimeout(() => {
          fetchOilPrice(oilCityRef.current);
        }, 800);
        // crude_updated_at 存在 → EF 刚写完原油数据 → 延迟刷新测算卡
        if ((payload.new as any)?.crude_updated_at) {
          if (crudeRealtimeTimer) clearTimeout(crudeRealtimeTimer);
          crudeRealtimeTimer = setTimeout(() => {
            handleFetchCrudePrice(false);
          }, 1200);
        }
      })
      .subscribe((status) => {
        // SUBSCRIBED → 连接正常；CHANNEL_ERROR / TIMED_OUT → 断线提示
        // 注意：初始连接过程中会经过 CLOSED 状态，不应触发断线横幅
        // 只有曾经成功订阅过（hasBeenSubscribed）后再断开，才显示提示
        if (status === 'SUBSCRIBED') {
          hasBeenSubscribed = true;
          setRealtimeOffline(false);
        } else if (hasBeenSubscribed && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
          setRealtimeOffline(true);
        }
      });

    // 天气每15分钟、油价每60分钟自动刷新；原油测算每60分钟静默刷新
    const weatherTimer = setInterval(() => fetchWeather('天津'),                15 * 60 * 1000);
    const oilTimer     = setInterval(() => fetchOilPrice(oilCityRef.current),   60 * 60 * 1000);
    const crudeTimer   = setInterval(() => handleFetchCrudePrice(false),         60 * 60 * 1000);

    return () => {
      clearInterval(weatherTimer);
      clearInterval(oilTimer);
      clearInterval(crudeTimer);
      if (oilRealtimeTimer) clearTimeout(oilRealtimeTimer);
      if (crudeRealtimeTimer) clearTimeout(crudeRealtimeTimer);
      unsubOilImport();
      supabase.removeChannel(oilChannel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, fetchUnreadChat, fetchWeather, triggerTrendBackgroundUpdate]));

  const RESTRICTION_CITY_CN: Record<string, string> = {
    tianjin: '天津', beijing: '北京', hangzhou: '杭州', chengdu: '成都',
    lanzhou: '兰州', guiyang: '贵阳', nanchang: '南昌', changchun: '长春',
    haerbin: '哈尔滨', wuhan: '武汉', shanghai: '上海',
  };

  // 限行查询函数
  const fetchRestriction = async (city: string) => {
    setRestrictionLoading(true);
    try {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const { data, error } = await supabase.functions.invoke('vehiclelimit-query', {
        body: { city, date: dateStr },
      });
      if (error) throw error;
      if (data?.status === 0 && data?.result) {
        const r = data.result;
        const noRestriction = !r.number || r.number === '' || r.number.includes('不限');
        // API 返回的 cityname 可能是拼音，优先用本地中文映射
        const cityNameCN = RESTRICTION_CITY_CN[city] ?? RESTRICTION_CITY_CN[r.cityname] ?? r.cityname ?? city;
        const newRestriction: TrafficRestriction = {
          cityname: cityNameCN,
          number: r.number ?? '',
          time: r.time ?? [],
          area: r.area ?? '',
          week: r.week ?? '',
          noRestriction,
        };
        setRestriction(newRestriction);
        // 限行就绪后推通知横幅（每日只弹一次）
        showRestrictionBanner(newRestriction, city).catch(() => {/* 静默处理 */});
      }
    } catch { /* 静默处理 */ }
    finally { setRestrictionLoading(false); }
  };

  // 查询本库今日受限行影响的车辆
  const fetchRestrictedVehicles = async () => {
    if (!restriction || restriction.noRestriction) return;
    setRestrictedLoading(true);
    try {
      const [g, d, l] = await Promise.all([
        supabase.from('gasoline_vehicles').select('*'),
        supabase.from('diesel_vehicles').select('*'),
        supabase.from('lng_vehicles').select('*'),
      ]);
      const all: Vehicle[] = [
        ...(g.data ?? []).map((v) => ({ ...v, _type: 'gasoline' as const })),
        ...(d.data ?? []).map((v) => ({ ...v, _type: 'diesel' as const })),
        ...(l.data ?? []).map((v) => ({ ...v, _type: 'lng' as const })),
      ];
      setRestrictedVehicles(
        all.filter((v) => checkPlateRestricted(v.plate_number, restriction.number))
      );
    } catch { /* 静默 */ }
    finally { setRestrictedLoading(false); }
  };

  // 初始化：GPS定位 → 限行城市查询；新闻首次加载
  useEffect(() => {
    let noonTimer: ReturnType<typeof setTimeout> | null = null;
    let dailyInterval: ReturnType<typeof setInterval> | null = null;

    // GPS → 城市中文名映射（限行 API 城市代码 → 中文名）
    const CITY_CODE_TO_CN: Record<string, string> = {
      tianjin: '天津', beijing: '北京', hangzhou: '杭州', chengdu: '成都',
      lanzhou: '兰州', guiyang: '贵阳', nanchang: '南昌', changchun: '长春',
      haerbin: '哈尔滨', wuhan: '武汉', shanghai: '上海', shenzhen: '深圳',
    };

    (async () => {
      let city = 'tianjin';
      try {
        if (process.env.EXPO_OS !== 'web') {
          // Native：expo-location GPS 定位
          const Location = await import('expo-location');
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            let pos = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 2000 });
            if (!pos) {
              pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low, timeInterval: 1000 });
            }
            const [geo] = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
            const cityName = geo?.city ?? geo?.subregion ?? '';
            const matched = Object.keys(GPS_CITY_MAP).find((k) => cityName.includes(k));
            if (matched) city = GPS_CITY_MAP[matched];
          }
        } else {
          // Web：navigator.geolocation 降级（仅精确到城市名，无逆地理编码，用 IP 兜底）
          try {
            const pos = await new Promise<GeolocationPosition>((res, rej) =>
              navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000, maximumAge: 60000 })
            );
            // Web 无逆地理编码 API，仅用坐标粗判天津范围（38.5~40.3, 116.7~118.1）
            const { latitude: lat, longitude: lng } = pos.coords;
            if (lat >= 38.5 && lat <= 40.3 && lng >= 116.7 && lng <= 118.1) city = 'tianjin';
            else if (lat >= 39.4 && lat <= 41.1 && lng >= 115.4 && lng <= 117.5) city = 'beijing';
            else if (lat >= 29.9 && lat <= 31.9 && lng >= 120.2 && lng <= 122.2) city = 'hangzhou';
            else if (lat >= 30.0 && lat <= 31.5 && lng >= 121.0 && lng <= 122.2) city = 'shanghai';
            else if (lat >= 30.2 && lat <= 31.4 && lng >= 103.5 && lng <= 104.9) city = 'chengdu';
            else if (lat >= 22.3 && lat <= 23.1 && lng >= 113.6 && lng <= 114.7) city = 'shenzhen';
            else if (lat >= 30.3 && lat <= 31.1 && lng >= 113.5 && lng <= 115.1) city = 'wuhan';
          } catch { /* 保持 tianjin 兜底 */ }
        }
      } catch (e) {
        console.error('[定位] 获取位置失败，降级为天津兜底:', e instanceof Error ? e.message : String(e));
      }

      setRestrictionCity(city);
      restrictionCityRef.current = city;

      // 并行：限行查询
      await fetchRestriction(city);

      // 每天 12:00 自动刷新限行 + 新闻
      const now = new Date();
      const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
      if (now >= noon) noon.setDate(noon.getDate() + 1);
      noonTimer = setTimeout(() => {
        fetchRestriction(city);
        dailyInterval = setInterval(() => {
          fetchRestriction(city);
        }, 24 * 60 * 60 * 1000);
      }, noon.getTime() - now.getTime());
    })();

    return () => {
      if (noonTimer) clearTimeout(noonTimer);
      if (dailyInterval) clearInterval(dailyInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(useCallback(() => {
    // 拉取最新统计数（汽油 / 柴油 / LNG）+ 刷新未读私信数
    const fetchCounts = async () => {
      try {
        const [gasRes, dieselRes, lngRes] = await Promise.all([
          supabase.from('gasoline_vehicles').select('id', { count: 'exact', head: true }),
          supabase.from('diesel_vehicles').select('id', { count: 'exact', head: true }),
          supabase.from('lng_vehicles').select('id', { count: 'exact', head: true }),
        ]);
        setCounts({
          gasoline: gasRes.count ?? 0,
          diesel: dieselRes.count ?? 0,
          lng: lngRes.count ?? 0,
        });
      } catch { /* 静默处理 */ }
    };

    // 刷新未读私信数（从私信页返回后立即同步）
    const fetchUnread = async () => {
      if (!session?.id) return;
      const { count } = await supabase
        .from('private_messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', session.id)
        .eq('is_read', false);
      setUnreadDm(count ?? 0);
    };

    // 静默刷新搜索结果（不触发 loading 态，避免界面闪烁）
    const silentRefreshResults = async () => {
      const q = lastQueryRef.current;
      if (!q) return;
      try {
        const [gasRes, dieselRes, lngRes] = await Promise.all([
          supabase.from('gasoline_vehicles').select('*').ilike('plate_number', `%${q}%`),
          supabase.from('diesel_vehicles').select('*').ilike('plate_number', `%${q}%`),
          supabase.from('lng_vehicles').select('*').ilike('plate_number', `%${q}%`),
        ]);
        if (gasRes.error || dieselRes.error || lngRes.error) return;
        const all: Vehicle[] = [
          ...(gasRes.data || []).map((v) => ({ ...v, _type: 'gasoline' as VehicleType })),
          ...(dieselRes.data || []).map((v) => ({ ...v, _type: 'diesel' as VehicleType })),
          ...(lngRes.data || []).map((v) => ({ ...v, _type: 'lng' as VehicleType })),
        ];
        const seen = new Set<string>();
        const deduped = all.filter((v) => {
          const key = v.plate_number?.trim().toUpperCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setResults(deduped);
      } catch { /* 静默处理 */ }
    };

    // 立即执行一次，然后每 3 秒同步一次（统计 + 搜索结果同步刷新）
    fetchCounts();
    fetchUnread();
    silentRefreshResults();
    fetchRestriction(restrictionCityRef.current); // 每次回到首页自动刷新限号
    const timer = setInterval(() => {
      fetchCounts();
      silentRefreshResults();
    }, 1000);

    // 离开首页时停止轮询
    return () => clearInterval(timer);
  }, []));

  // 加入近期搜索（去重 + 最多保留 6 条）
  const addToRecentSearches = (q: string) => {
    const upper = q.toUpperCase();
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s !== upper);
      return [upper, ...filtered].slice(0, 6);
    });
  };

  const searchVehicles = async (plate: string) => {
    const q = plate.trim();
    if (!q) { setError('请输入车牌号'); return; }
    setLoading(true);
    setError('');
    setSearched(true);
    setTypeFilter('all');
    addToRecentSearches(q);
    lastQueryRef.current = q;
    try {
      const [gasRes, dieselRes, lngRes] = await Promise.all([
        supabase.from('gasoline_vehicles').select('*').ilike('plate_number', `%${q}%`),
        supabase.from('diesel_vehicles').select('*').ilike('plate_number', `%${q}%`),
        supabase.from('lng_vehicles').select('*').ilike('plate_number', `%${q}%`),
      ]);
      if (gasRes.error || dieselRes.error || lngRes.error) {
        setError('查询失败，请稍后重试'); setResults([]); return;
      }
      const all: Vehicle[] = [
        ...(gasRes.data || []).map((v) => ({ ...v, _type: 'gasoline' as VehicleType })),
        ...(dieselRes.data || []).map((v) => ({ ...v, _type: 'diesel' as VehicleType })),
        ...(lngRes.data || []).map((v) => ({ ...v, _type: 'lng' as VehicleType })),
      ];
      // 按车牌号去重：同一车牌在多张表中存在时只保留第一条（优先级：gasoline > diesel > lng）
      const seen = new Set<string>();
      const deduped = all.filter((v) => {
        const key = v.plate_number?.trim().toUpperCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setResults(deduped);
      // 打开结果弹窗
      setResultModalVisible(true);
      setSearchBallOpen(false);
    } catch {
      setError('网络异常，请稍后重试'); setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCamera = async () => {
    setSearchBallOpen(false);
    setOcrLoading(true);
    setError('');
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { setError('请授权相机权限以使用拍照识别功能'); return; }

      const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;

      const compressed = await manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.8, format: SaveFormat.JPEG, base64: true }
      );
      if (!compressed.base64) { setError('图片处理失败，请重新拍照'); return; }

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
      const resp = await fetch(`${supabaseUrl}/functions/v1/accurate-ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey },
        body: JSON.stringify({ image: compressed.base64, language_type: 'CHN_ENG' }),
      });

      if (!resp.ok) { setError('识别失败，请重新拍照或手动输入车牌号'); return; }

      const data = await resp.json();
      const words: string[] = (data.words_result || []).map((w: { words: string }) => w.words);
      // 中国车牌正则（含厂内/冀等）
      const plateRegex = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-Z0-9]{5}/;
      let detected = '';
      for (const w of words) {
        const clean = w.replace(/\s/g, '').toUpperCase();
        const match = clean.match(plateRegex);
        if (match) { detected = match[0]; break; }
      }
      if (!detected) detected = words.sort((a, b) => b.length - a.length)[0] || '';

      if (detected) {
        setQuery(detected);
        await searchVehicles(detected);
      } else {
        setError('未能识别车牌号，请重新拍照或手动输入');
      }
    } catch {
      setError('识别失败，请重新拍照或手动输入车牌号');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleClear = () => { setQuery(''); setResults([]); setError(''); setSearched(false); setTypeFilter('all'); lastQueryRef.current = ''; setResultModalVisible(false); };

  const goToDetail = (vehicle: Vehicle) => {
    router.push({ pathname: '/(app)/vehicle-detail', params: { data: JSON.stringify(vehicle) } });
  };

  // 根据天气文字推导特效类型（fxPreview 优先）
  const weatherKind = fxPreview ?? getWeatherKind(weatherData?.weather ?? '');

  // ── 原油卡片与底部走势胶囊共享计算（前端实时，不依赖 AI/EF 的 nextTrend）──
  // 与原油卡片闭包内逻辑完全同源，确保两处显示一致
  const sharedCrude = (() => {
    if (!oilPrice || !(oilPrice.crudeBrent ?? 0)) return null;
    const brent      = oilPrice.crudeBrent ?? 0;
    const wti        = oilPrice.crudeWti   ?? (brent > 0 ? brent - 2 : 0);
    const dubai      = oilPrice.crudeDubai ?? (brent > 0 ? +(brent - 1.5).toFixed(1) : 0);
    const basketAvg  = oilPrice.crudeBasketAvg
      ?? (brent > 0 ? +((brent * 4 + dubai * 3 + wti * 3) / 10).toFixed(2) : 0);
    const avg10d     = oilPrice.crudeAvg10d ?? 0;
    const lastCycle  = oilPrice.crudeLastCycleAvg ?? 0;
    const deltaTon   = oilPrice.crudeDeltaTon ?? 0;
    // 与测算卡完全同源：一揽子均价 > EIA 10日均价 > 布伦特盘价
    const curAvg     = basketAvg > 0 ? basketAvg : (avg10d > 0 ? avg10d : brent);
    const prevAvg    = lastCycle > 0 ? lastCycle : curAvg;
    const rateByAvg  = prevAvg > 0 ? +((curAvg - prevAvg) / prevAvg * 100).toFixed(2) : 0;
    const willTrigger = Math.abs(rateByAvg) >= 4.0;
    // 折算系数：优先 DB，其次硬编码表，兜底 1318
    const cityKey = oilCity.replace(/[市区县省]$/, '');
    const dbRow   = convRows.find(r => r.city === cityKey || r.city === oilCity);
    const conv92  = (dbRow?.conv_coeff_92 && dbRow.conv_coeff_92 > 0)
      ? dbRow.conv_coeff_92 : 1318;
    // ΔP/升：优先 EF deltaTon（与测算卡 getGrade 同源），否则前端兜底公式
    const FALLBACK_RMB = oilPrice.crudeRmbRate ?? 7.25;
    const rawDiff = curAvg - prevAvg;
    const fallbackDeltaTon = +(rawDiff * FALLBACK_RMB * 7.33 * 1.1456 + 60).toFixed(1);
    const ton = deltaTon > 0 ? deltaTon : fallbackDeltaTon;
    const deltaPerLiter92 = +(ton / conv92).toFixed(3);
    return { rateByAvg, willTrigger, deltaPerLiter92, isUp: rateByAvg > 0, isDn: rateByAvg < 0 };
  })();

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0A0F1E' }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}>

      {/* ── 天气全屏粒子特效（雨/雷/雪/雾/风，绝对定位不影响交互）── */}
      <WeatherFxLayer kind={weatherKind} screenW={screenWidth} screenH={screenHeight} />

      {/* ── 通知横幅（顶部滑入：调价橙色 / 限行蓝色）──────────────── */}
      {notifVisible && activeBanner && (
        <Animated.View
          entering={FadeInDown.duration(400).springify()}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999, marginHorizontal: 12, marginTop: 44 }}
        >
          <Pressable
            onPress={() => {
              markNotifRead(activeBanner.id);
              if (activeBanner.type === 'oil_adjust') {
                router.push('/(app)/notifications' as never);
              }
              // 限行横幅点击只关闭，不跳转（限行详情在主页已有弹窗）
            }}
            style={{ borderRadius: 16, overflow: 'hidden' }}
          >
            <LinearGradient
              colors={activeBanner.type === 'traffic_restrict'
                ? ['#0C2340', '#0E2D52', '#1A4A7A']
                : ['#7C2D12', '#9A3412', '#C2410C']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, gap: 10, borderRadius: 16, borderWidth: 1, borderColor: activeBanner.type === 'traffic_restrict' ? 'rgba(96,165,250,0.5)' : 'rgba(251,146,60,0.5)' }}
            >
              {/* 图标 */}
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                {activeBanner.type === 'traffic_restrict'
                  ? <Car size={17} color="#93C5FD" />
                  : <Fuel size={17} color="#FDBA74" />}
              </View>
              {/* 文字 */}
              <View style={{ flex: 1 }}>
                <Text style={{ color: activeBanner.type === 'traffic_restrict' ? '#BFDBFE' : '#FED7AA', fontSize: 12, fontWeight: '700', marginBottom: 2 }}>
                  {activeBanner.title}
                </Text>
                <Text style={{ color: activeBanner.type === 'traffic_restrict' ? 'rgba(191,219,254,0.8)' : 'rgba(254,215,170,0.8)', fontSize: 11, lineHeight: 15 }} numberOfLines={2}>
                  {activeBanner.body}
                </Text>
              </View>
              {/* 右侧：查看/关闭 */}
              <View style={{ gap: 4, alignItems: 'flex-end' }}>
                {activeBanner.type === 'oil_adjust' && (
                  <Text style={{ color: '#FDBA74', fontSize: 10, fontWeight: '700' }}>查看 ›</Text>
                )}
                <Pressable
                  onPress={(e) => { e.stopPropagation(); markNotifRead(activeBanner.id); }}
                  hitSlop={8}
                >
                  <X size={14} color={activeBanner.type === 'traffic_restrict' ? 'rgba(191,219,254,0.6)' : 'rgba(254,215,170,0.6)'} />
                </Pressable>
              </View>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      )}

      {/* 限行详情弹窗 — 右侧抽屉式 */}
      <Modal
        visible={restrictionModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRestrictionModalVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row', justifyContent: 'flex-end' }}
          onPress={() => setRestrictionModalVisible(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: 320, height: '100%', overflow: 'hidden' }}>
            {/* 弹窗渐变背景 */}
            <LinearGradient
              colors={['#1A1A2E', '#16213E', '#0F3460']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ flex: 1, paddingTop: 52, padding: 20, borderTopLeftRadius: 20, borderBottomLeftRadius: 20 }}
            >
              {/* 顶部标题行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(251,146,60,0.2)', borderWidth: 1, borderColor: 'rgba(251,146,60,0.4)', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={20} color="#fb923c" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>今日限行公告</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>
                    {restriction?.cityname} · {restriction?.week} · {date}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setRestrictionModalVisible(false)}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, lineHeight: 20 }}>✕</Text>
                </Pressable>
              </View>

              {/* 限行尾号 */}
              <View style={{ backgroundColor: 'rgba(251,146,60,0.12)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(251,146,60,0.3)', padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 }}>限行尾号</Text>
                  <Text style={{ color: '#fb923c', fontSize: 28, fontWeight: '900', letterSpacing: 3 }}>{restriction?.number}</Text>
                </View>
                <View style={{ backgroundColor: 'rgba(251,146,60,0.2)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(251,146,60,0.35)' }}>
                  <Car size={28} color="#fb923c" />
                </View>
              </View>

              {/* 限行时段 */}
              {restriction?.time && restriction.time.length > 0 && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 14, marginBottom: 12 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 8 }}>🕐 限行时段</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {restriction.time.map((t, i) => (
                      <View key={i} style={{ backgroundColor: 'rgba(96,165,250,0.15)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)' }}>
                        <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: '700' }}>{t}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* 限行区域 */}
              {!!restriction?.area && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 14, marginBottom: 16 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 6 }}>📍 限行区域</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 18 }}>{restriction.area}</Text>
                </View>
              )}

              {/* 刷新按钮 */}
              <Pressable
                onPress={() => { fetchRestriction(restrictionCity); setRestrictionModalVisible(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(251,146,60,0.2)', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(251,146,60,0.4)' }}
              >
                <RefreshCw size={14} color="#fb923c" />
                <Text style={{ color: '#fb923c', fontSize: 13, fontWeight: '700' }}>刷新限行数据</Text>
              </Pressable>


            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 受限车辆列表弹窗 ── */}
      <Modal
        visible={restrictedVehiclesVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRestrictedVehiclesVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          onPress={() => setRestrictedVehiclesVisible(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: '#0C1A3A', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', overflow: 'hidden' }}
          >
            <LinearGradient
              colors={['#0C1A3A', '#0D2C6E']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ flex: 1 }}
            >
              {/* 标题行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.18)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={18} color="#f87171" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>今日受限车辆</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 1 }}>
                    限行尾号：{restriction?.number ?? '—'} · {restriction?.cityname}
                  </Text>
                </View>
                <View style={{ backgroundColor: 'rgba(239,68,68,0.2)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' }}>
                  <Text style={{ color: '#f87171', fontSize: 12, fontWeight: '800' }}>
                    {restrictedLoading ? '…' : `${restrictedVehicles.length} 辆`}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setRestrictedVehiclesVisible(false)}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, lineHeight: 20 }}>✕</Text>
                </Pressable>
              </View>

              {/* 内容区 */}
              {restrictedLoading ? (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 }}>
                  <ActivityIndicator color="#60a5fa" size="large" />
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>正在查询受限车辆…</Text>
                </View>
              ) : restrictedVehicles.length === 0 ? (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 }}>
                  <Text style={{ fontSize: 36 }}>🎉</Text>
                  <Text style={{ color: '#4ade80', fontSize: 15, fontWeight: '700' }}>本库无今日受限车辆</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>所有车辆均可正常出行</Text>
                </View>
              ) : (
                <FlatList
                  data={restrictedVehicles}
                  keyExtractor={(v) => `${v._type}-${v.id}`}
                  contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => {
                    const iconBg = item._type === 'gasoline' ? '#FFF7ED' : item._type === 'diesel' ? '#F0FDF4' : '#F0F9FF';
                    const iconColor = TYPE_BG[item._type];
                    return (
                      <Pressable
                        onPress={() => { setRestrictedVehiclesVisible(false); goToDetail(item); }}
                        style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', borderLeftWidth: 3, borderLeftColor: '#ef4444', overflow: 'hidden' }}
                        android_ripple={{ color: 'rgba(239,68,68,0.1)' }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 }}>
                          <View style={{ width: 42, height: 42, backgroundColor: iconBg, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
                            <Car size={20} color={iconColor} />
                          </View>
                          <View style={{ flex: 1, gap: 3 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 }}>{item.plate_number}</Text>
                              <View style={{ backgroundColor: 'rgba(239,68,68,0.25)', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)' }}>
                                <Text style={{ color: '#fca5a5', fontSize: 9, fontWeight: '800' }}>今日限行</Text>
                              </View>
                              <View style={{ backgroundColor: iconColor + '33', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}>
                                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{TYPE_LABELS[item._type]}车</Text>
                              </View>
                            </View>
                            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }} numberOfLines={1}>{item.unit}</Text>
                            {!!item.driver_name && (
                              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }} numberOfLines={1}>司机：{item.driver_name}</Text>
                            )}
                          </View>
                          <ChevronRight size={14} color="rgba(255,255,255,0.3)" />
                        </View>
                      </Pressable>
                    );
                  }}
                />
              )}
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 油价城市选择 Modal ── */}
      <Modal
        visible={oilCityModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setOilCityModalVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
          onPress={() => setOilCityModalVisible(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}>
            <LinearGradient
              colors={['#1A1A2E', '#16213E', '#0F3460']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ paddingBottom: 32 }}
            >
              {/* 标题行 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Fuel size={18} color="#FBBF24" />
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>选择省份/城市</Text>
                </View>
                <Pressable
                  onPress={() => setOilCityModalVisible(false)}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={14} color="rgba(255,255,255,0.6)" />
                </Pressable>
              </View>
              {/* 省份网格 */}
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 }} showsVerticalScrollIndicator={false}>
                {OIL_CITIES.map((city) => {
                  const isSelected = city === oilCity;
                  return (
                    <Pressable
                      key={city}
                      onPress={() => {
                        setOilCityModalVisible(false);
                        oilCityRef.current = city; // 先同步 ref，再 fetch
                        setOilCity(city);
                        setOilHistory([]); // 切换城市清空历史缓存
                        setOilHistoryExpanded(false);
                        fetchOilPrice(city);
                      }}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                        backgroundColor: isSelected ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.07)',
                        borderWidth: 1,
                        borderColor: isSelected ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.1)',
                      }}
                    >
                      <Text style={{ color: isSelected ? '#FBBF24' : 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: isSelected ? '700' : '500' }}>{city}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 调价窗口日期设置 Modal（管理员/助手，日历控件）── */}
      <Modal
        visible={adjustDateVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAdjustDateVisible(false)}
      >
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }} onPress={() => setAdjustDateVisible(false)}>
          <Pressable onPress={e => e.stopPropagation()} style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}>
            <LinearGradient colors={['#1a1428', '#120e22', '#0d1020']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingBottom: 40 }}>

              {/* 把手 */}
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' }} />
              </View>

              {/* 标题栏 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(251,191,36,0.18)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)', alignItems: 'center', justifyContent: 'center' }}>
                    <CalendarDays size={17} color="#FBBF24" />
                  </View>
                  <View>
                    <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>设置调价窗口日期</Text>
                    <Text style={{ color: 'rgba(251,191,36,0.55)', fontSize: 11, marginTop: 1 }}>
                      {oilPrice?.nextAdjustDate ? `当前：${oilPrice.nextAdjustDate}` : '当前未设置'}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={() => setAdjustDateVisible(false)}
                  style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={14} color="rgba(255,255,255,0.5)" />
                </Pressable>
              </View>

              <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 20, marginBottom: 4 }} />

              {/* 已选日期展示 + +10工作日 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 12, fontWeight: '600' }}>已选：</Text>
                  {adjustDateInput.length === 10 ? (
                    <View style={{ backgroundColor: 'rgba(251,191,36,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(251,191,36,0.40)' }}>
                      <Text style={{ color: '#FEF08A', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 }}>{adjustDateInput}</Text>
                    </View>
                  ) : (
                    <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 13 }}>请在日历中选择</Text>
                  )}
                </View>
                <Pressable
                  onPress={() => {
                    const bjToday = new Date(Date.now() + 8 * 3600 * 1000);
                    const todayStr = `${bjToday.getUTCFullYear()}-${String(bjToday.getUTCMonth()+1).padStart(2,'0')}-${String(bjToday.getUTCDate()).padStart(2,'0')}`;
                    const base = (adjustDateInput && /^\d{4}-\d{2}-\d{2}$/.test(adjustDateInput)) ? adjustDateInput : (oilPrice?.nextAdjustDate || todayStr);
                    const next = calcNextWorkday(base);
                    if (next) {
                      setAdjustDateInput(next);
                      const [ny, nm, nd] = next.split('-').map(Number);
                      setCalSelectedDate(new Date(ny, nm - 1, nd));
                      setAdjustDateMsg('');
                    }
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: 'rgba(251,191,36,0.12)', borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 5,
                    borderWidth: 1, borderColor: 'rgba(251,191,36,0.30)' }}
                >
                  <CalendarDays size={11} color="#FBBF24" />
                  <Text style={{ color: '#FBBF24', fontSize: 11, fontWeight: '800' }}>+10工作日</Text>
                </Pressable>
              </View>

              {/* 日历控件：key绑定visible状态，关闭重开时重新挂载拿新initialDate；开着时不因父组件渲染重建 */}
              <View style={{ marginHorizontal: 12, borderRadius: 16, overflow: 'hidden',
                backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <AdjustDatePicker
                  key={adjustDateVisible ? 'picker-open' : 'picker-closed'}
                  initialDate={calSelectedDate}
                  onDateChange={onAdjustDateChange}
                />
              </View>

              <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 10 }}>

                {/* 状态提示 */}
                {!!adjustDateMsg && (
                  <Animated.View entering={FadeInUp.duration(200)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: adjustDateMsg.startsWith('✅') ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)',
                      borderRadius: 10, borderWidth: 1,
                      borderColor: adjustDateMsg.startsWith('✅') ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)',
                      paddingVertical: 10, paddingHorizontal: 14 }}>
                    <Text style={{ color: adjustDateMsg.startsWith('✅') ? '#34D399' : '#F87171', fontSize: 13, fontWeight: '700', textAlign: 'center' }}>
                      {adjustDateMsg}
                    </Text>
                  </Animated.View>
                )}

                {/* 保存按钮 */}
                <Pressable
                  onPress={async () => {
                    if (adjustDateSaving) return;
                    const val = adjustDateInput.trim();
                    if (!val) { setAdjustDateMsg('❌ 请先在日历中选择日期'); return; }
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) { setAdjustDateMsg('❌ 格式应为 YYYY-MM-DD'); return; }
                    const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
                    const todayBj = `${bjNow.getUTCFullYear()}-${String(bjNow.getUTCMonth()+1).padStart(2,'0')}-${String(bjNow.getUTCDate()).padStart(2,'0')}`;
                    let finalDate = val;
                    // 只有严格过期（< 今天）才提示，不自动修改用户选定的日期
                    if (finalDate < todayBj) {
                      setAdjustDateMsg(`⚠️ 所选日期已过期（${finalDate}），建议重新选择`);
                      setAdjustDateSaving(false);
                      return;
                    }
                    setAdjustDateSaving(true);
                    setAdjustDateMsg('');
                    try {
                      const { data, error } = await supabase.functions.invoke('oilprice-manual-lock', {
                        body: { action: 'save_trend', trend: { next_trend: oilPrice?.nextTrend ?? 0, next_trend_text: oilPrice?.nextTrendText ?? '', trend_updated_at: new Date().toISOString(), next_adjust_date: finalDate } },
                      });
                      if (error || data?.status !== 0) throw new Error(data?.message ?? error?.message ?? '保存失败');
                      setAdjustDateMsg('✅ 调价日期已保存');
                      await fetchOilPrice(oilCity);
                      setTimeout(() => { setAdjustDateVisible(false); setAdjustDateMsg(''); }, 1200);
                    } catch (e) { setAdjustDateMsg(`❌ 保存失败：${String(e)}`); }
                    finally { setAdjustDateSaving(false); }
                  }}
                  disabled={adjustDateSaving || adjustDateInput.length < 10}
                  style={{ height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: adjustDateInput.length === 10 && !adjustDateSaving ? 'rgba(251,191,36,0.88)' : 'rgba(255,255,255,0.07)',
                    borderWidth: 1.5, borderColor: adjustDateInput.length === 10 && !adjustDateSaving ? 'rgba(253,224,71,0.6)' : 'rgba(255,255,255,0.1)' }}
                >
                  {adjustDateSaving
                    ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color="#1a1a1a" size="small" /><Text style={{ color: '#1a1a1a', fontSize: 14, fontWeight: '700' }}>保存中…</Text></View>
                    : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <CalendarDays size={16} color={adjustDateInput.length === 10 ? '#1a1a1a' : 'rgba(255,255,255,0.25)'} />
                        <Text style={{ color: adjustDateInput.length === 10 ? '#1a1a1a' : 'rgba(255,255,255,0.25)', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 }}>保存日期</Text>
                      </View>
                  }
                </Pressable>

              </View>
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 模拟调价 Modal（发改委测试专用，超级管理员）── */}
      <Modal
        visible={simulVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSimulVisible(false)}
      >
        <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }} onPress={() => setSimulVisible(false)}>
            <Pressable onPress={(e) => e.stopPropagation()} style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}>
              <LinearGradient colors={['#130828', '#1a0f35', '#0d1a38']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingBottom: 40 }}>

                {/* ── 顶部把手 ── */}
                <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
                  <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' }} />
                </View>

                {/* ── 标题栏 ── */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(139,92,246,0.25)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                      <FlaskConical size={17} color="#C4B5FD" />
                    </View>
                    <View>
                      <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 }}>模拟调价下发</Text>
                      <Text style={{ color: 'rgba(167,139,250,0.65)', fontSize: 11, marginTop: 1 }}>发改委测试模式 · 30分钟自动还原</Text>
                    </View>
                  </View>
                  <Pressable onPress={() => setSimulVisible(false)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={14} color="rgba(255,255,255,0.5)" />
                  </Pressable>
                </View>

                {/* ── 分割线 ── */}
                <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 20, marginBottom: 4 }} />

                <ScrollView style={{ maxHeight: 530 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 18 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                  {/* ══ 第一区：走势方向 + 幅度（横排，视觉最重要放最前）══ */}
                  <View style={{ gap: 10 }}>
                    {/* 走势三按钮 */}
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>本次调价方向</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {([
                        { key: 'up',   emoji: '↑', label: '上调', color: '#F87171', glow: 'rgba(239,68,68,0.20)',   border: 'rgba(239,68,68,0.55)' },
                        { key: 'down', emoji: '↓', label: '下调', color: '#34D399', glow: 'rgba(52,211,153,0.20)',  border: 'rgba(52,211,153,0.55)' },
                        { key: 'flat', emoji: '─', label: '持平', color: '#94A3B8', glow: 'rgba(148,163,184,0.15)', border: 'rgba(148,163,184,0.40)' },
                      ] as const).map(({ key, emoji, label, color, glow, border }) => {
                        const active = simulDir === key;
                        return (
                          <Pressable key={key} onPress={() => setSimulDir(key)}
                            style={{ flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 3,
                              backgroundColor: active ? glow : 'rgba(255,255,255,0.04)',
                              borderWidth: active ? 1.5 : 1, borderColor: active ? border : 'rgba(255,255,255,0.09)' }}>
                            <Text style={{ color: active ? color : 'rgba(255,255,255,0.25)', fontSize: 20, fontWeight: '800', lineHeight: 24 }}>{emoji}</Text>
                            <Text style={{ color: active ? color : 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: active ? '800' : '500' }}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* 幅度输入（仅上调/下调时显示） */}
                    {simulDir !== 'flat' && (
                      <Animated.View entering={FadeInUp.duration(200)}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1.5,
                          backgroundColor: 'rgba(255,255,255,0.05)',
                          borderColor: simulDir === 'up' ? 'rgba(248,113,113,0.45)' : 'rgba(52,211,153,0.45)',
                          paddingHorizontal: 16, height: 54, gap: 10 }}>
                          <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                            backgroundColor: simulDir === 'up' ? 'rgba(239,68,68,0.18)' : 'rgba(52,211,153,0.18)' }}>
                            <Text style={{ color: simulDir === 'up' ? '#F87171' : '#34D399', fontSize: 18, fontWeight: '900', lineHeight: 22 }}>
                              {simulDir === 'up' ? '+' : '−'}
                            </Text>
                          </View>
                          <TextInput
                            value={simulVal}
                            onChangeText={setSimulVal}
                            placeholder="0.00"
                            placeholderTextColor="rgba(255,255,255,0.2)"
                            style={{ flex: 1, color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: 0.5 }}
                            keyboardType="decimal-pad"
                            maxLength={5}
                          />
                          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: '600' }}>元/升</Text>
                        </View>
                      </Animated.View>
                    )}
                  </View>

                  {/* ══ 第二区：调后价格预览卡片 ══ */}
                  {simulDir !== 'flat' && parseFloat(simulVal) > 0 && oilPrice && (() => {
                    const delta = simulDir === 'up' ? parseFloat(simulVal) : -parseFloat(simulVal);
                    const specs = [
                      { label: '92#', sub: '汽油', color: '#FBBF24', cur: oilPrice.p92 },
                      { label: '95#', sub: '汽油', color: '#F87171', cur: oilPrice.p95 },
                      { label: '98#', sub: '汽油', color: '#94A3B8', cur: oilPrice.p98 },
                      { label: '柴油', sub: '0#',  color: '#34D399', cur: oilPrice.p0  },
                    ] as const;
                    return (
                      <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 14, gap: 10 }}>
                        <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>调后价格预览（当前城市）</Text>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {specs.map(({ label, sub, color, cur }) => {
                            const n = parseFloat(String(cur));
                            const newP = isNaN(n) || n <= 0 ? '--' : Math.max(0, n + delta).toFixed(2);
                            const arrowClr = simulDir === 'up' ? '#F87171' : '#34D399';
                            return (
                              <View key={label} style={{ flex: 1, alignItems: 'center', backgroundColor: `${color}0d`, borderRadius: 12, borderWidth: 1, borderColor: `${color}25`, paddingVertical: 10, gap: 2 }}>
                                <Text style={{ color, fontSize: 10, fontWeight: '800' }}>{label}</Text>
                                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>{sub}</Text>
                                <View style={{ width: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 1 }} />
                                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, textDecorationLine: 'line-through' }}>{cur}</Text>
                                <Text style={{ color: arrowClr, fontSize: 9, fontWeight: '700' }}>{simulDir === 'up' ? '▲' : '▼'}</Text>
                                <Text style={{ color, fontSize: 15, fontWeight: '900', letterSpacing: -0.3 }}>{newP}</Text>
                              </View>
                            );
                          })}
                        </View>
                        <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9, textAlign: 'center' }}>实际下发时各城市按原价独立计算</Text>
                      </View>
                    );
                  })()}

                  {/* ══ 第三区：下次调价日期 ══ */}
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>下次调价日期</Text>
                      {/* +10工作日 快捷按钮 */}
                      <Pressable
                        onPress={() => {
                          const bjToday = new Date(Date.now() + 8 * 3600 * 1000);
                          const todayStr = `${bjToday.getUTCFullYear()}-${String(bjToday.getUTCMonth()+1).padStart(2,'0')}-${String(bjToday.getUTCDate()).padStart(2,'0')}`;
                          const base = (simulDate && /^\d{4}-\d{2}-\d{2}$/.test(simulDate)) ? simulDate : todayStr;
                          const next = calcNextWorkday(base);
                          if (next) setSimulDate(next);
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                          backgroundColor: 'rgba(167,139,250,0.15)', borderRadius: 8,
                          paddingHorizontal: 10, paddingVertical: 4,
                          borderWidth: 1, borderColor: 'rgba(167,139,250,0.35)' }}
                      >
                        <CalendarDays size={11} color="#A78BFA" />
                        <Text style={{ color: '#A78BFA', fontSize: 11, fontWeight: '800' }}>+10工作日</Text>
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)',
                      borderRadius: 14, borderWidth: 1, borderColor: 'rgba(167,139,250,0.25)',
                      paddingHorizontal: 14, height: 50, gap: 10 }}>
                      <CalendarDays size={16} color="#A78BFA" />
                      <TextInput
                        value={simulDate}
                        onChangeText={setSimulDate}
                        placeholder="YYYY-MM-DD，如 2026-07-31"
                        placeholderTextColor="rgba(255,255,255,0.22)"
                        style={{ flex: 1, color: '#E9D5FF', fontSize: 15, fontWeight: '600' }}
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                      />
                      {simulDate.length === 10 && (
                        <View style={{ backgroundColor: 'rgba(167,139,250,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: '#C4B5FD', fontSize: 9, fontWeight: '700' }}>已填</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: 'rgba(167,139,250,0.45)', fontSize: 10, marginTop: -4 }}>
                      可手动填入日期，或点「+10工作日」从当前日期自动推算下一窗口期
                    </Text>
                  </View>

                  {/* ══ 第四区：目标城市 ══ */}
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>目标城市</Text>
                        {simulCities.size > 0 && (
                          <View style={{ backgroundColor: 'rgba(139,92,246,0.3)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(139,92,246,0.5)' }}>
                            <Text style={{ color: '#C4B5FD', fontSize: 10, fontWeight: '800' }}>已选 {simulCities.size}</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable onPress={() => setSimulCities(new Set(OIL_CITIES))}
                          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(139,92,246,0.2)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.45)' }}>
                          <Text style={{ color: '#C4B5FD', fontSize: 10, fontWeight: '700' }}>全选</Text>
                        </Pressable>
                        <Pressable onPress={() => setSimulCities(new Set())}
                          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700' }}>清空</Text>
                        </Pressable>
                      </View>
                    </View>
                    {/* chip 网格 */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                      {OIL_CITIES.map(city => {
                        const sel = simulCities.has(city);
                        return (
                          <Pressable key={city} onPress={() => toggleSimulCity(city)}
                            style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
                              backgroundColor: sel ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.04)',
                              borderColor: sel ? 'rgba(167,139,250,0.65)' : 'rgba(255,255,255,0.1)' }}>
                            <Text style={{ color: sel ? '#DDD6FE' : 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: sel ? '700' : '400' }}>
                              {city}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* ══ 汇总预览条 ══ */}
                  <View style={{ flexDirection: 'row', backgroundColor: 'rgba(139,92,246,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(139,92,246,0.2)', padding: 12, gap: 10, alignItems: 'center' }}>
                    <FlaskConical size={14} color="#A78BFA" />
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        {/* 方向标签 */}
                        <View style={{ backgroundColor: simulDir === 'up' ? 'rgba(239,68,68,0.18)' : simulDir === 'down' ? 'rgba(52,211,153,0.18)' : 'rgba(148,163,184,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: simulDir === 'up' ? '#F87171' : simulDir === 'down' ? '#34D399' : '#94A3B8', fontSize: 10, fontWeight: '800' }}>
                            {simulDir === 'flat' ? '持平' : simulDir === 'up' ? `↑ +${simulVal || '?'} 元/升` : `↓ −${simulVal || '?'} 元/升`}
                          </Text>
                        </View>
                        {/* 日期标签 */}
                        <View style={{ backgroundColor: 'rgba(167,139,250,0.12)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: '#C4B5FD', fontSize: 10, fontWeight: '700' }}>
                            {simulDate || '日期未填'}
                          </Text>
                        </View>
                        {/* 城市标签 */}
                        <View style={{ backgroundColor: simulCities.size > 0 ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: simulCities.size > 0 ? '#FCD34D' : 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: '700' }}>
                            {simulCities.size > 0 ? `${simulCities.size} 个城市` : '未选城市'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* ══ 状态提示 ══ */}
                  {simulMsg ? (
                    <Animated.View entering={FadeInUp.duration(200)}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                        backgroundColor: simulMsg.startsWith('✅') ? 'rgba(52,211,153,0.1)' : simulMsg.startsWith('⏳') ? 'rgba(251,191,36,0.1)' : 'rgba(239,68,68,0.1)',
                        borderRadius: 10, borderWidth: 1,
                        borderColor: simulMsg.startsWith('✅') ? 'rgba(52,211,153,0.3)' : simulMsg.startsWith('⏳') ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)',
                        paddingVertical: 10, paddingHorizontal: 14 }}>
                      <Text style={{ color: simulMsg.startsWith('✅') ? '#34D399' : simulMsg.startsWith('⏳') ? '#FBBF24' : '#F87171', fontSize: 13, fontWeight: '700', textAlign: 'center' }}>
                        {simulMsg}
                      </Text>
                    </Animated.View>
                  ) : (
                    <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'center' }}>
                      下发后写入数据库并立即刷新，关闭后可观察联动效果
                    </Text>
                  )}

                  {/* ══ 操作按钮 ══ */}
                  <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 4 }}>
                    {/* 单独保存调价日期按钮 */}
                    <Pressable
                      onPress={async () => {
                        if (!simulDate) return;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(simulDate)) {
                          setSimulMsg('❌ 日期格式应为 YYYY-MM-DD');
                          return;
                        }
                        // 日期已过期则自动推算下一期
                        const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
                        const todayBj = `${bjNow.getUTCFullYear()}-${String(bjNow.getUTCMonth()+1).padStart(2,'0')}-${String(bjNow.getUTCDate()).padStart(2,'0')}`;
                        let finalDate = simulDate;
                        if (finalDate <= todayBj) {
                          const advanced = calcNextWorkday(finalDate);
                          if (advanced) { finalDate = advanced; setSimulDate(advanced); }
                        }
                        setSimulMsg('⏳ 保存调价日期中…');
                        try {
                          const { data, error } = await supabase.functions.invoke('oilprice-manual-lock', {
                            body: { action: 'save_trend', trend: { next_trend: oilPrice?.nextTrend ?? 0, next_trend_text: oilPrice?.nextTrendText ?? '', trend_updated_at: new Date().toISOString(), next_adjust_date: finalDate } },
                          });
                          if (error || data?.status !== 0) throw new Error(data?.message ?? error?.message ?? '保存失败');
                          setSimulMsg('✅ 调价日期已保存');
                          await fetchOilPrice(oilCity);
                        } catch (e) { setSimulMsg(`❌ 保存失败：${String(e)}`); }
                      }}
                      disabled={simulSaving || !simulDate}
                      style={{ flex: 1.2, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 2,
                        backgroundColor: simulDate ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
                        borderWidth: 1, borderColor: simulDate ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)' }}
                    >
                      <CalendarDays size={13} color={simulDate ? '#FBBF24' : 'rgba(255,255,255,0.25)'} />
                      <Text style={{ color: simulDate ? '#FBBF24' : 'rgba(255,255,255,0.25)', fontSize: 10, fontWeight: '800' }}>存日期</Text>
                    </Pressable>
                    {/* 下发主按钮 */}
                    <Pressable onPress={submitSimul} disabled={simulSaving}
                      style={{ flex: 3, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: simulSaving ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.85)',
                        borderWidth: 1.5, borderColor: simulSaving ? 'rgba(139,92,246,0.3)' : 'rgba(196,167,255,0.6)' }}>
                      {simulSaving
                        ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <ActivityIndicator color="#C4B5FD" size="small" />
                            <Text style={{ color: '#C4B5FD', fontSize: 14, fontWeight: '700' }}>
                              {simulProgress ? `下发中 ${simulProgress}` : '处理中…'}
                            </Text>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Zap size={16} color="#fff" />
                            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 }}>下发变价</Text>
                          </View>
                        )
                      }
                    </Pressable>
                    {/* 测试联动次级按钮 */}
                    <Pressable onPress={handleSimulLiveTest} disabled={simulSaving}
                      style={{ flex: 1.3, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 2,
                        backgroundColor: 'rgba(251,146,60,0.1)',
                        borderWidth: 1, borderColor: 'rgba(251,146,60,0.4)' }}>
                      <Text style={{ color: '#FB923C', fontSize: 13 }}>🔥</Text>
                      <Text style={{ color: '#FB923C', fontSize: 10, fontWeight: '800' }}>测试联动</Text>
                    </Pressable>
                  </View>

                </ScrollView>
              </LinearGradient>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══════════════ 全新 Header ═══════════════ */}
      <LinearGradient
        colors={['#050E2A', '#0A1F5C', '#0D3385', '#0052CC', '#0A6ED1']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        {/* 背景大光晕（精简） */}
        <View style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(59,130,246,0.1)' }} />
        <View style={{ position: 'absolute', bottom: 10, left: -20, width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(99,179,237,0.07)' }} />
        {/* 少量粒子 */}
        <FloatingParticle x={20}  y={10} size={4} delay={0}   color="rgba(255,255,255,0.4)" />
        <FloatingParticle x={100} y={6}  size={3} delay={400} color="rgba(147,210,255,0.5)" />
        <FloatingParticle x={200} y={14} size={5} delay={700} color="rgba(96,165,250,0.5)" />
        <FloatingParticle x={300} y={5}  size={3} delay={200} color="rgba(255,255,255,0.3)" />

        {/* ── 实时同步断线提示条（网络断开时浮现，重连后自动消失）── */}
        <Animated.View
          pointerEvents="none"
          style={[{
            position: 'absolute', top: insets.top + 4, left: 12, right: 12, zIndex: 999,
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: 'rgba(30,20,10,0.88)',
            borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
            borderWidth: 1, borderColor: 'rgba(251,146,60,0.45)',
          }, realtimeBannerStyle]}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F87171' }} />
          <Text style={{ color: 'rgba(255,200,150,0.95)', fontSize: 11, fontWeight: '700', flex: 1 }}>
            实时同步已断开，数据可能延迟
          </Text>
          <View style={{ backgroundColor: 'rgba(251,146,60,0.18)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: '#FB923C', fontSize: 9, fontWeight: '700' }}>重连中…</Text>
          </View>
        </Animated.View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingTop: dynPaddingTop, paddingBottom: oilPrice ? dynPaddingBottomOil : dynPaddingBottomNoOil, paddingHorizontal: 10 }}
        >

        {/* ── 背景音乐播放器（内嵌式，随页面滚动，不遮挡底部）── */}
        <MusicPlayer />

        {/* ── 第一区：日期限行行 ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          {/* 左：日期星期 + 铃铛 */}
          <View style={{ gap: 2 }}>
            {/* 年份小字 + 月日大字 同行 baseline 对齐 */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <View style={{ overflow: 'hidden' }}>
                <RollInText
                  text={`${date.split('年')[0]}年`}
                  delay={0}
                  style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}
                />
              </View>
              <View style={{ overflow: 'hidden' }}>
                <RollInText
                  text={(() => { const p = date.split('年'); return p[1] ?? ''; })()}
                  delay={80}
                  style={{ color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: 0, lineHeight: 34 }}
                />
              </View>
            </View>
            {/* 星期 + 铃铛 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                <LinearGradient
                  colors={['#60A5FA', 'rgba(96,165,250,0)']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ width: 24, height: 2, borderRadius: 1 }}
                />
                <RollInText
                  text={week}
                  delay={160}
                  style={{ color: 'rgba(255,255,255,0.50)', fontSize: 11, letterSpacing: 2.5, fontWeight: '700' }}
                />
              </View>
              {/* 通知铃铛 */}
              <Pressable
                onPress={() => { setUnreadNotif(0); router.push('/(app)/notifications' as never); }}
                hitSlop={14}
                style={{ alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
                  borderRadius: 10,
                  backgroundColor: unreadNotif > 0 ? 'rgba(96,165,250,0.20)' : 'rgba(255,255,255,0.08)',
                  borderWidth: 1,
                  borderColor: unreadNotif > 0 ? 'rgba(96,165,250,0.50)' : 'rgba(255,255,255,0.12)',
                }}
              >
                <Bell size={15} color={unreadNotif > 0 ? '#93C5FD' : 'rgba(255,255,255,0.38)'} />
                {unreadNotif > 0 && (
                  <View style={{
                    position: 'absolute', top: 3, right: 3,
                    minWidth: 14, height: 14, borderRadius: 7,
                    backgroundColor: '#F97316',
                    alignItems: 'center', justifyContent: 'center',
                    paddingHorizontal: 2,
                    borderWidth: 1.5, borderColor: '#0A0F1E',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 7.5, fontWeight: '900', lineHeight: 10 }}>
                      {unreadNotif > 9 ? '9+' : String(unreadNotif)}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          {/* 右：限行胶囊 */}
          <View style={{ alignItems: 'flex-end' }}>
          {restrictionLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(148,163,184,0.09)', borderRadius: 16,
              paddingHorizontal: 14, paddingVertical: 8,
              borderWidth: 1, borderColor: 'rgba(148,163,184,0.18)' }}>
              <ActivityIndicator size="small" color="rgba(148,163,184,0.6)" style={{ transform: [{ scale: 0.75 }] }} />
              <Text style={{ color: 'rgba(148,163,184,0.65)', fontSize: 11, fontWeight: '600' }}>查询中…</Text>
            </View>
          ) : restriction ? (
            restriction.noRestriction ? (
              /* 不限行 — 绿色 */
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(34,197,94,0.13)', borderRadius: 16,
                paddingHorizontal: 13, paddingVertical: 8,
                borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)' }}>
                <Car size={14} color="#4ade80" />
                <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '800' }}>
                  {restriction.cityname} · 不限行
                </Text>
              </View>
            ) : (
              /* 限行 — 橙色警示 */
              <Pressable onPress={() => setRestrictionModalVisible(true)}>
                <LinearGradient
                  colors={['rgba(251,146,60,0.28)', 'rgba(234,88,12,0.20)', 'rgba(180,50,0,0.15)']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(251,146,60,0.55)',
                    paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center', gap: 3 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={13} color="#fb923c" />
                    <Text style={{ color: '#FDE68A', fontSize: 20, fontWeight: '900', letterSpacing: 4 }}>
                      {restriction.number}
                    </Text>
                  </View>
                  <Text style={{ color: 'rgba(253,186,116,0.75)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
                    {restriction.cityname} · 尾号限行 · 点击详情
                  </Text>
                </LinearGradient>
              </Pressable>
            )
          ) : (
            /* 未查询 */
            <Pressable
              onPress={() => fetchRestriction(restrictionCity)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 16,
                paddingHorizontal: 13, paddingVertical: 8,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}
            >
              <RefreshCw size={12} color="rgba(255,255,255,0.38)" />
              <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, fontWeight: '700' }}>查限行</Text>
            </Pressable>
          )}
          </View>
        </View>

        {/* ── 天气+油价+统计区：始终展示 ── */}
        <>

        {/* ── 分割光线 ── */}
        <GradDivider colors={['transparent', 'rgba(96,165,250,0.6)', 'transparent']} marginBottom={4} />

        {/* ── 天气 + 油价 左右并排（无油价数据时天气全宽） ── */}
        <Animated.View entering={FadeInDown.delay(180).duration(260)} style={{ flexDirection: 'row', gap: 6, marginBottom: 6, alignItems: 'flex-start' }}>

          {/* ── 天气卡 ── */}
          <View style={{ flex: 1, position: 'relative' }}>
          <Pressable
            onLongPress={() => setFxPickerVisible(true)}
            onPress={() => {}}
            delayLongPress={600}
            style={{ flex: 1, borderRadius: 20, overflow: 'hidden',
              borderWidth: 1, borderColor: fxPreview ? 'rgba(167,139,250,0.55)' : 'rgba(96,165,250,0.28)' }}
          >
            <LinearGradient
              colors={['rgba(25,65,180,0.72)', 'rgba(10,30,100,0.82)', 'rgba(4,12,50,0.92)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ flex: 1, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 12, gap: 9 }}
            >
              {/* 顶部：城市 + 刷新 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Pressable
                  onPress={() => setWeatherDetailVisible(true)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <MapPin size={11} color="#60A5FA" />
                  <Text style={{ color: '#93C5FD', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>
                    {weatherData?.cityName ?? weatherCity ?? '实时天气'}
                  </Text>
                  <ChevronDown size={10} color="rgba(96,165,250,0.70)" />
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {fxPreview && (
                    <View style={{ backgroundColor: 'rgba(167,139,250,0.25)', borderRadius: 6,
                      paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: 'rgba(167,139,250,0.5)' }}>
                      <Text style={{ color: '#C084FC', fontSize: 9, fontWeight: '800' }}>预览</Text>
                    </View>
                  )}
                  {weatherLoading
                    ? <ActivityIndicator size="small" color="rgba(96,165,250,0.7)" style={{ transform: [{ scale: 0.65 }] }} />
                    : (
                      <Pressable
                        onPress={async () => {
                          if (weatherRefreshing) return;
                          setWeatherRefreshing(true);
                          await fetchWeather(weatherCity ?? '天津');
                          setWeatherRefreshing(false);
                        }}
                        style={{ width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: 'rgba(96,165,250,0.10)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.22)' }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <RefreshCw
                          size={12}
                          color={weatherRefreshing ? '#60A5FA' : 'rgba(255,255,255,0.40)'}
                        />
                      </Pressable>
                    )
                  }
                </View>
              </View>

              {/* 主体：图标 + 温度 + 描述 */}
              {weatherData ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {/* 天气大图标 */}
                  <View style={{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(96,165,250,0.13)', borderRadius: 18,
                    borderWidth: 1, borderColor: 'rgba(96,165,250,0.28)' }}>
                    {weatherLoading
                      ? <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
                      : <AnimatedWeatherIcon weatherText={weatherData.weather ?? ''} size={34} />}
                  </View>
                  {/* 右侧：温度 + 描述 + 体感 */}
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                      <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900', lineHeight: 44, letterSpacing: -1 }}>
                        {weatherData.temp}°
                      </Text>
                      <Text style={{ color: '#BAE6FD', fontSize: 13, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                        {weatherData.weather}
                      </Text>
                    </View>
                    {!!weatherData.feelsLike && (
                      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                        体感 {weatherData.feelsLike}°C
                      </Text>
                    )}
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(96,165,250,0.11)', borderRadius: 18,
                    borderWidth: 1, borderColor: 'rgba(96,165,250,0.22)' }}>
                    {weatherLoading
                      ? <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
                      : <AnimatedWeatherIcon weatherText="" size={34} />}
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                    {weatherLoading ? '定位中…' : '自动定位天气'}
                  </Text>
                </View>
              )}

              {/* 分割线 */}
              {!!weatherData && (
                <View style={{ height: 1, backgroundColor: 'rgba(96,165,250,0.12)' }} />
              )}

              {/* 湿度 + 风向 */}
              {!!weatherData && (!!weatherData.humidity || !!weatherData.windDir) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {!!weatherData.humidity && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Droplets size={12} color="#60A5FA" />
                      <Text style={{ color: 'rgba(255,255,255,0.68)', fontSize: 11 }}>
                        湿度 {weatherData.humidity}%
                      </Text>
                    </View>
                  )}
                  {!!weatherData.windDir && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                      <Wind size={12} color="#7DD3FC" />
                      <Text style={{ color: 'rgba(255,255,255,0.68)', fontSize: 11 }} numberOfLines={1}>
                        {weatherData.windDir}{weatherData.windPower ? ` ${weatherData.windPower}` : ''}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* 能见度 + 气压 */}
              {!!weatherData && (!!weatherData.visibility || !!weatherData.pressure) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {!!weatherData.visibility && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Text style={{ color: 'rgba(147,197,253,0.7)', fontSize: 10 }}>👁</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 10 }}>
                        {weatherData.visibility}km
                      </Text>
                    </View>
                  )}
                  {!!weatherData.pressure && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Text style={{ color: 'rgba(147,197,253,0.7)', fontSize: 10 }}>🔵</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 10 }}>
                        {weatherData.pressure}hPa
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* 日出日落 */}
              {!!weatherData?.sunrise && !!weatherData?.sunset && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: 'rgba(255,220,130,0.65)', fontSize: 10 }}>🌅 {weatherData.sunrise}</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
                  <Text style={{ color: 'rgba(180,200,255,0.55)', fontSize: 10 }}>🌇 {weatherData.sunset}</Text>
                </View>
              )}

              {/* 预警条 */}
              {!!weatherData?.alarm && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5,
                  marginHorizontal: -13, marginBottom: -12,
                  paddingHorizontal: 13, paddingVertical: 7,
                  backgroundColor: 'rgba(239,68,68,0.20)',
                  borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.28)' }}>
                  <AlertTriangle size={11} color="#F87171" />
                  <Text style={{ color: '#FCA5A5', fontSize: 10, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                    {weatherData.alarm}
                  </Text>
                </View>
              )}
            </LinearGradient>
          </Pressable>

          {/* 预警角标 */}
          {!!weatherData?.alarm && (
            <View style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9,
              backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5, borderColor: '#0F172A' }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900', lineHeight: 13 }}>!</Text>
            </View>
          )}
          </View>{/* 天气卡外层View结束 */}

          {/* ── 油价卡 ── */}
          {(oilLoading || oilPrice) ? (
            <View style={{ flex: 1, borderRadius: 20, overflow: 'hidden',
              borderWidth: 1, borderColor: 'rgba(251,191,36,0.32)' }}>
              <LinearGradient
                colors={['rgba(130,85,8,0.68)', 'rgba(72,46,4,0.80)', 'rgba(28,16,2,0.90)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10, gap: 7 }}
              >
                {/* 顶部：城市选择 + 刷新 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Pressable
                    onPress={() => setOilCityModalVisible(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  >
                    <Fuel size={11} color="#FBBF24" />
                    <Text style={{ color: '#FCD34D', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>{oilCity}</Text>
                    <ChevronDown size={10} color="rgba(251,191,36,0.7)" />
                  </Pressable>
                  {oilLoading
                    ? <ActivityIndicator size="small" color="rgba(255,191,36,0.7)" style={{ transform: [{ scale: 0.65 }] }} />
                    : (
                      <Pressable
                        onPress={async () => {
                          if (oilRefreshing) return;
                          setOilRefreshing(true);
                          await fetchOilPrice(oilCityRef.current);
                          setOilRefreshing(false);
                        }}
                        style={{ width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.22)' }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <RefreshCw
                          size={12}
                          color={oilRefreshing ? '#FBBF24' : 'rgba(255,255,255,0.40)'}
                        />
                      </Pressable>
                    )
                  }
                </View>


                {/* ── 油品价格四格（大字版，模拟模式下隐藏，数据已显示在底部对话框）── */}
                <View>
                  {oilLoading && !oilPrice ? (
                    <ActivityIndicator size="small" color="rgba(255,191,36,0.5)" style={{ marginVertical: 14 }} />
                  ) : oilPrice && simulSecsLeft === null ? (() => {
                    // 调价日判断（与底部横条卡逻辑一致）
                    const _todayLocal = new Date();
                    const _todayStr = `${_todayLocal.getFullYear()}-${String(_todayLocal.getMonth()+1).padStart(2,'0')}-${String(_todayLocal.getDate()).padStart(2,'0')}`;
                    const _nextAdj  = oilPrice.nextAdjustDate ?? '';
                    const _updateDt = oilPrice.updateDate ?? '';
                    const isAdjustToday = !!(_nextAdj && _todayStr >= _nextAdj && _updateDt < _nextAdj);
                    const tempNum = weatherData ? parseInt(weatherData.temp, 10) : NaN;
                    let dieselLabel = '0#柴';
                    let dieselValue = oilPrice.p0;
                    if (!isNaN(tempNum)) {
                      if (tempNum <= -15)     { dieselLabel = '-35#柴'; dieselValue = oilPrice.pm35 || oilPrice.p0; }
                      else if (tempNum <= -5) { dieselLabel = '-20#柴'; dieselValue = oilPrice.pm20 || oilPrice.p0; }
                      else if (tempNum <= 0)  { dieselLabel = '-10#柴'; dieselValue = oilPrice.pm10 || oilPrice.p0; }
                    }
                    const isEmpty = oilPrice.p92 === '--';
                    // 标签：保留完整名称（柴油前缀+#）
                    const dieselGrade = dieselLabel.replace('#柴', '');  // e.g. '0', '-20'
                    const items = [
                      { label: '92#', sublabel: '汽油', value: oilPrice.p92, color: '#FBBF24', prev: oilPrice.prevP92 },
                      { label: '95#', sublabel: '汽油', value: oilPrice.p95, color: '#F87171', prev: oilPrice.prevP95 },
                      { label: '98#', sublabel: '汽油', value: oilPrice.p98, color: '#94A3B8', prev: oilPrice.prevP98 },
                      { label: `${dieselGrade}#`, sublabel: '柴油', value: dieselValue, color: '#34D399', prev: oilPrice.prevP0 },
                    ];
                    const CAPSULE_GAP = 5;
                    // 调价日脉冲动画 hook（每格独立，避免在 map 里用 hook）
                    const PriceCapsule = ({ label, sublabel, value, color, prev }: { label: string; sublabel: string; value: string; color: string; prev?: string }) => {
                      const glowAnim = useSharedValue(0);
                      React.useEffect(() => {
                        if (isAdjustToday) {
                          glowAnim.value = withRepeat(
                            withSequence(
                              withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) }),
                              withTiming(0, { duration: 1000, easing: Easing.in(Easing.ease) }),
                            ),
                            -1, false
                          );
                        } else {
                          glowAnim.value = 0;
                        }
                      }, [isAdjustToday]);
                      const glowStyle = useAnimatedStyle(() => ({
                        shadowOpacity: isAdjustToday ? interpolate(glowAnim.value, [0, 1], [0.0, 0.9]) : 0,
                        shadowRadius:  isAdjustToday ? interpolate(glowAnim.value, [0, 1], [0, 10]) : 0,
                      }));
                      const is98 = sublabel === '汽油' && label === '98#';
                      const mainColor  = is98 ? '#94A3B8' : color;
                      const cardBorder = isAdjustToday
                        ? (is98 ? 'rgba(148,163,184,0.70)' : `${color}A0`)
                        : (is98 ? 'rgba(148,163,184,0.28)' : `${color}40`);
                      const valClr = isEmpty ? 'rgba(255,255,255,0.22)' : mainColor;
                      const delta = (prev && prev !== '' && value && value !== '--')
                        ? (parseFloat(value) - parseFloat(prev)) : null;
                      const deltaStr = delta !== null && Math.abs(delta) > 0.001
                        ? (delta >= 0 ? `+${delta.toFixed(2)}` : `${delta.toFixed(2)}`)
                        : null;
                      const deltaColor = delta !== null
                        ? (delta > 0.001 ? '#F87171' : delta < -0.001 ? '#4ADE80' : 'rgba(255,255,255,0.30)')
                        : null;
                      const arrowChar = delta !== null
                        ? (delta > 0.001 ? '▲' : delta < -0.001 ? '▼' : '—')
                        : null;
                      return (
                        <Animated.View style={[{
                          flex: 1,
                          borderRadius: 14,
                          overflow: 'hidden',
                          borderWidth: 1.5, borderColor: cardBorder,
                          shadowColor: mainColor,
                          shadowOffset: { width: 0, height: 3 },
                        }, glowStyle]}>
                          <LinearGradient
                            colors={[`${mainColor}22`, `${mainColor}08`, 'rgba(0,0,0,0.15)']}
                            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
                            style={{ alignItems: 'center',
                              paddingTop: 8, paddingBottom: 8, paddingHorizontal: 2, gap: 0 }}
                          >
                            {/* 🔥调价日标 */}
                            {isAdjustToday && (
                              <Text style={{ position: 'absolute', top: 3, right: 4, fontSize: 8 }}>🔥</Text>
                            )}

                            {/* ── 油品标号 ── */}
                            <Text
                              adjustsFontSizeToFit
                              numberOfLines={1}
                              minimumFontScale={0.7}
                              style={{ color: mainColor, fontSize: 14, fontWeight: '900',
                                letterSpacing: 0.3, textAlign: 'center', width: '94%' }}
                            >
                              {label}
                            </Text>

                            {/* 油品类型彩色小徽章 */}
                            <View style={{ marginTop: 3, paddingHorizontal: 6, paddingVertical: 2,
                              borderRadius: 20, backgroundColor: `${mainColor}28`,
                              borderWidth: 1, borderColor: `${mainColor}50`,
                              alignSelf: 'center' }}>
                              <Text style={{ color: mainColor, fontSize: 9, fontWeight: '800', letterSpacing: 0.2 }}>
                                {sublabel}
                              </Text>
                            </View>

                            {/* 分隔线 */}
                            <View style={{ width: '55%', height: 1, borderRadius: 1,
                              backgroundColor: mainColor, opacity: 0.28, marginTop: 5, marginBottom: 4 }} />

                            {/* ── 价格大字 ── */}
                            <Text
                              adjustsFontSizeToFit
                              numberOfLines={1}
                              minimumFontScale={0.6}
                              style={{ color: valClr, fontSize: 17, fontWeight: '900',
                                letterSpacing: -0.5, textAlign: 'center', width: '96%' }}
                            >
                              {value}
                            </Text>

                            {/* ── 单位 ── */}
                            <Text style={{ color: `${mainColor}55`, fontSize: 8, fontWeight: '600', marginTop: 1 }}>
                              元/升
                            </Text>

                            {/* ── 涨跌幅徽章 ── */}
                            <View style={{
                              marginTop: 4,
                              paddingHorizontal: deltaStr ? 5 : 4,
                              paddingVertical: 2,
                              borderRadius: 20,
                              backgroundColor: deltaStr
                                ? (delta! > 0.001 ? 'rgba(248,113,113,0.20)' : delta! < -0.001 ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.06)')
                                : 'rgba(255,255,255,0.06)',
                              borderWidth: 1,
                              borderColor: deltaStr
                                ? (delta! > 0.001 ? 'rgba(248,113,113,0.45)' : delta! < -0.001 ? 'rgba(74,222,128,0.40)' : 'rgba(255,255,255,0.12)')
                                : 'rgba(255,255,255,0.12)',
                              flexDirection: 'row', alignItems: 'center', gap: 1,
                            }}>
                              {deltaStr ? (
                                <>
                                  <Text style={{ color: deltaColor!, fontSize: 9, fontWeight: '900', lineHeight: 13 }}>{arrowChar}</Text>
                                  <Text style={{ color: deltaColor!, fontSize: 9, fontWeight: '900', lineHeight: 13 }}>{deltaStr}</Text>
                                </>
                              ) : (
                                <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 9, fontWeight: '700' }}>持平</Text>
                              )}
                            </View>
                          </LinearGradient>
                        </Animated.View>
                      );
                    };
                    return (
                      <View>
                        {/* 单行排列：92# 95# 98# 柴油 全部可见 */}
                        <View style={{ flexDirection: 'row', gap: CAPSULE_GAP }}>
                          {items.map((item) => <PriceCapsule key={item.label} {...item} />)}
                        </View>
                        {isEmpty && (
                          <Text style={{ color: 'rgba(255,191,36,0.45)', fontSize: 10, textAlign: 'center', marginTop: 6 }}>
                            暂无该城市油价数据
                          </Text>
                        )}
                      </View>
                    );
                  })() : null}
                </View>



                {/* ── 管理员操作区 ── */}
                {isPermanentAdmin && (
                  <View style={{ gap: 5 }}>
                    {/* 刷新油价 */}
                    <Pressable
                      onPress={handleForceOilUpdate}
                      disabled={oilForceLoading}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                        backgroundColor: oilForceLoading ? 'rgba(14,165,233,0.08)' : 'rgba(14,165,233,0.15)',
                        borderRadius: 12, paddingVertical: 6,
                        borderWidth: 1, borderColor: oilForceLoading ? 'rgba(14,165,233,0.20)' : 'rgba(14,165,233,0.45)' }}
                    >
                      {oilForceLoading
                        ? <ActivityIndicator size="small" color="#38BDF8" style={{ transform: [{ scale: 0.65 }] }} />
                        : <RefreshCw size={12} color="#38BDF8" />}
                      <Text style={{ color: '#38BDF8', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }} numberOfLines={1}>
                        {oilForceLoading ? '更新中…' : '刷新全国油价'}
                      </Text>
                    </Pressable>
                    {/* 模拟调价 */}
                    <Pressable
                      onPress={openSimul}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                        backgroundColor: 'rgba(139,92,246,0.15)', borderRadius: 12, paddingVertical: 6,
                        borderWidth: 1, borderColor: 'rgba(139,92,246,0.45)' }}
                    >
                      <FlaskConical size={12} color="#A78BFA" />
                      <Text style={{ color: '#A78BFA', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>模拟调价</Text>
                    </Pressable>
                  </View>
                )}


              </LinearGradient>
            </View>
          ) : null}

        </Animated.View>

        </>


        {/* ── NBA 赛事卡 ── */}
        <Animated.View entering={FadeInDown.delay(120).duration(260)}
          style={{ marginBottom: 6, borderRadius: 20, overflow: 'hidden',
            borderWidth: 1, borderColor: 'rgba(251,146,60,0.30)' }}>
          <LinearGradient
            colors={['rgba(120,53,15,0.62)', 'rgba(67,20,7,0.78)', 'rgba(28,12,4,0.88)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, gap: 8 }}
          >
            {/* 标题栏 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Trophy size={13} color="#FB923C" />
                <Text style={{ color: '#FDBA74', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 }}>NBA 赛事</Text>
                <Text style={{ color: 'rgba(251,146,60,0.4)', fontSize: 8, fontWeight: '600' }}>点击赛事观看</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Pressable onPress={() => setNbaChannelOpen(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Tv size={11} color="rgba(251,146,60,0.7)" />
                  <Text style={{ color: 'rgba(251,146,60,0.6)', fontSize: 9, fontWeight: '700' }}>渠道</Text>
                </Pressable>
                <Pressable onPress={fetchNbaGames} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  {nbaLoading
                    ? <ActivityIndicator size="small" color="rgba(251,146,60,0.7)" style={{ transform: [{ scale: 0.6 }] }} />
                    : <RefreshCw size={11} color="rgba(251,146,60,0.7)" />}
                  <Text style={{ color: 'rgba(251,146,60,0.6)', fontSize: 9, fontWeight: '700' }}>刷新</Text>
                </Pressable>
                <Pressable onPress={() => setNbaExpanded(v => !v)} hitSlop={8}>
                  {nbaExpanded
                    ? <ChevronUp size={14} color="rgba(251,146,60,0.7)" />
                    : <ChevronDown size={14} color="rgba(251,146,60,0.7)" />}
                </Pressable>
              </View>
            </View>

            {/* 赛事横向滚动列表 / 加载 / 空状态（折叠时不渲染） */}
            {nbaExpanded && (nbaLoading && nbaGames.length === 0 ? (
              <View style={{ paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                <ActivityIndicator size="small" color="rgba(251,146,60,0.7)" />
                <Text style={{ color: 'rgba(251,146,60,0.5)', fontSize: 10 }}>加载赛事中…</Text>
              </View>
            ) : nbaGames.length === 0 ? (
              <View style={{ paddingVertical: 14, alignItems: 'center', gap: 4 }}>
                <Trophy size={18} color="rgba(251,146,60,0.3)" />
                <Text style={{ color: 'rgba(251,146,60,0.5)', fontSize: 10, fontWeight: '600' }}>近期暂无 NBA 赛事</Text>
              </View>
            ) : (
              (() => {
                // 进行中排最前，其余保持原顺序
                const sortedGames = [...nbaGames].sort((a, b) => {
                  const aLive = a.status === '进行中' ? 0 : 1;
                  const bLive = b.status === '进行中' ? 0 : 1;
                  return aLive - bLive;
                });
                // 按 matchDate 分组
                type Grp = { date: string; label: string; shortDate: string; games: NbaGame[] };
                const groups: Grp[] = [];
                for (const g of sortedGames) {
                  let grp = groups.find(x => x.date === g.matchDate);
                  if (!grp) {
                    grp = { date: g.matchDate, label: nbaDateLabel(g), shortDate: '', games: [] };
                    groups.push(grp);
                  }
                  grp.games.push(g);
                }
                groups.forEach(grp => {
                  const d = grp.date;
                  if (d && d.length === 8) {
                    const dt = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
                    grp.shortDate = `${dt.getMonth() + 1}/${dt.getDate()}`;
                  }
                });
                // 展平为滚动项：日期分隔卡 + 赛事卡
                type ScrollItem =
                  | { type: 'date'; grp: Grp; key: string }
                  | { type: 'game'; g: NbaGame; key: string };
                const items: ScrollItem[] = [];
                for (const grp of groups) {
                  items.push({ type: 'date', grp, key: `d-${grp.date}` });
                  for (const g of grp.games) items.push({ type: 'game', g, key: g.matchId });
                }
                return (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 5, paddingBottom: 2, paddingRight: 2 }}
                  >
                    {items.map(item => {
                      if (item.type === 'date') {
                        const { grp } = item;
                        return (
                          <View key={item.key} style={{ width: 32, justifyContent: 'center', alignItems: 'center', gap: 4 }}>
                            <View style={{ width: 3, height: 32, borderRadius: 2, backgroundColor: '#FB923C', opacity: 0.7 }} />
                            <Text style={{ color: '#FB923C', fontSize: 8, fontWeight: '900', letterSpacing: 0.2, textAlign: 'center' }}>{grp.label}</Text>
                            {grp.shortDate ? (
                              <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 7, fontWeight: '600' }}>{grp.shortDate}</Text>
                            ) : null}
                            <View style={{ backgroundColor: 'rgba(251,146,60,0.14)', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 }}>
                              <Text style={{ color: 'rgba(251,146,60,0.85)', fontSize: 7, fontWeight: '800' }}>{grp.games.length}场</Text>
                            </View>
                          </View>
                        );
                      }
                      const { g } = item;
                      const live = g.status === '进行中';
                      const finished = g.status === '已结束';
                      const statusText = nbaStatusText(g);
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => openNbaChannel('https://www.zhibo8.cc/nba/')}
                          android_ripple={{ color: 'rgba(251,146,60,0.2)', borderless: false }}
                          style={{
                            width: 96, borderRadius: 14,
                            paddingVertical: 9, paddingHorizontal: 7,
                            backgroundColor: live ? 'rgba(251,146,60,0.13)' : 'rgba(255,255,255,0.05)',
                            borderWidth: 1, borderColor: live ? 'rgba(251,146,60,0.55)' : 'rgba(255,255,255,0.10)',
                            alignItems: 'center', gap: 5,
                          }}
                        >
                          {/* 客队名 */}
                          <Text style={{ color: live ? '#FED7AA' : 'rgba(255,255,255,0.82)', fontSize: 10, fontWeight: '800', textAlign: 'center' }} numberOfLines={1}>
                            {g.awayTeam || '客队'}
                          </Text>
                          {/* 比分 + 状态 */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <Text style={{ color: live ? '#FB923C' : 'rgba(255,255,255,0.65)', fontSize: 16, fontWeight: '900', width: 22, textAlign: 'center' }}>
                              {g.awayScore || (finished ? '0' : '-')}
                            </Text>
                            <View style={{ alignItems: 'center', gap: 2, width: 28 }}>
                              {live && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#FB923C' }} />}
                              <Text style={{
                                color: live ? '#FB923C' : finished ? 'rgba(255,255,255,0.35)' : 'rgba(251,146,60,0.8)',
                                fontSize: 7, fontWeight: '800', textAlign: 'center', letterSpacing: 0.2,
                              }} numberOfLines={2}>
                                {statusText}
                              </Text>
                            </View>
                            <Text style={{ color: live ? '#FB923C' : 'rgba(255,255,255,0.65)', fontSize: 16, fontWeight: '900', width: 22, textAlign: 'center' }}>
                              {g.homeScore || (finished ? '0' : '-')}
                            </Text>
                          </View>
                          {/* 主队名 */}
                          <Text style={{ color: live ? '#FED7AA' : 'rgba(255,255,255,0.82)', fontSize: 10, fontWeight: '800', textAlign: 'center' }} numberOfLines={1}>
                            {g.homeTeam || '主队'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                );
              })()
            ))}
          </LinearGradient>
        </Animated.View>

        {/* ── NBA 赛事免费观看渠道抽屉 ── */}
        <Modal
          visible={nbaChannelOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setNbaChannelOpen(false)}
        >
          <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setNbaChannelOpen(false)}>
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: '#1C1208',
                borderTopLeftRadius: 24, borderTopRightRadius: 24,
                paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24,
                borderWidth: 1, borderColor: 'rgba(251,146,60,0.30)',
              }}
            >
              {/* 拖动指示条 */}
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(251,146,60,0.4)', alignSelf: 'center', marginBottom: 14 }} />
              {/* 标题 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Trophy size={15} color="#FB923C" />
                <Text style={{ color: '#FDBA74', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 }}>免费观看渠道</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600', marginBottom: 14 }}>点击赛事可直接跳转直播吧文字直播</Text>
              {/* 渠道列表 */}
              <View style={{ gap: 8 }}>
                {NBA_WATCH_CHANNELS.map(ch => (
                  <Pressable
                    key={ch.name}
                    onPress={() => openNbaChannel(ch.url)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
                    }}
                    android_ripple={{ color: 'rgba(251,146,60,0.18', radius: 200, borderless: false }}
                  >
                    {/* 渠道色块 */}
                    <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: ch.color, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>{ch.name.slice(0, 1)}</Text>
                    </View>
                    {/* 名称+描述 */}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{ch.name}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' }} numberOfLines={1}>{ch.desc}</Text>
                    </View>
                    {/* 跳转箭头 */}
                    <ChevronRight size={18} color="rgba(251,146,60,0.7)" />
                  </Pressable>
                ))}
              </View>
              {/* 关闭按钮 */}
              <Pressable
                onPress={() => setNbaChannelOpen(false)}
                style={{ marginTop: 14, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700' }}>关闭</Text>
              </Pressable>
              {/* 免责提示 */}
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: '500', textAlign: 'center', marginTop: 10, lineHeight: 14 }}>
                渠道链接跳转至第三方平台，免费场次以实际为准，请优先选择官方授权渠道。
              </Text>
            </Pressable>
          </Pressable>
        </Modal>
        {/* ── 原油→国内油价测算卡片（有数据显示详情，无数据显示占位+刷新） ── */}
        {oilPrice && (() => {
          const brent = oilPrice.crudeBrent ?? 0;
          const hasData = brent > 0;
          const wti   = oilPrice.crudeWti ?? (brent > 0 ? brent - 2 : 0);
          const dubai = oilPrice.crudeDubai ?? (brent > 0 ? +(brent - 1.5).toFixed(1) : 0);
          // 10日窗口均价（三品种）：EF返回时优先使用，否则降级到现货价估算
          const basketBrent = oilPrice.crudeBasketBrent ?? brent;
          const basketDubai = oilPrice.crudeBasketDubai ?? dubai;
          const basketMinas = oilPrice.crudeBasketMinas ?? (brent > 0 ? brent + 1.5 : wti);
          // ── 一揽子油加权均价：布伦特:阿曼:米纳斯 = 4:3:3（发改委权重）
          // EF 已实时计算并回传 crudeBasketAvg；无则前端本地加权兜底
          const basketAvg = oilPrice.crudeBasketAvg
            ?? (brent > 0 ? +((brent * 4 + dubai * 3 + wti * 3) / 10).toFixed(2) : 0);
          const basketDays  = oilPrice.crudeBasketDays  ?? 0;
          const basketStart = oilPrice.crudeBasketStart ?? '';
          const eiaDataDate = oilPrice.crudeEiaDataDate ?? '';
          const rate  = oilPrice.crudeChangeRate ?? 0;
          const calcText = oilPrice.crudeCalcText ?? '';
          const avg10d = oilPrice.crudeAvg10d ?? 0;
          const lastCycleAvg = oilPrice.crudeLastCycleAvg ?? 0;
          // 均价来源标签（用于 UI 显示，仅标注非默认来源）
          const avg10dSrc = oilPrice.crudeAvg10dSource ?? '';
          const avg10dSrcLabel = avg10dSrc === 'eia' ? 'EIA官方'
            : avg10dSrc === 'brent_fallback' ? '盘价估算'
            : '';
          const avg10dSrcColor = avg10dSrc === 'eia' ? '#34D399'
            : avg10dSrc === 'brent_fallback' ? '#F87171'
            : '#94A3B8';

          // ── 本期调价基准：一揽子加权均价（布伦特×40%+阿曼×30%+米纳斯×30%）优先
          // 一揽子均价 > EIA 10日均价 > 布伦特当日盘价（与 EF calcChange 优先级一致）
          const curAvg  = basketAvg > 0 ? basketAvg : (avg10d > 0 ? avg10d : brent);
          const prevAvg = lastCycleAvg > 0 ? lastCycleAvg : curAvg; // 上期均价
          const baseAvg = curAvg;  // rawDiff 基准（供 fallbackDeltaTon 使用）
          const rateByAvg = prevAvg > 0 ? +((curAvg - prevAvg) / prevAvg * 100).toFixed(2) : rate;
          const isUp  = rateByAvg > 0;
          const isDn  = rateByAvg < 0;
          const rateColor = isUp ? '#FCA5A5' : isDn ? '#6EE7B7' : '#94A3B8';
          const willTrigger = Math.abs(rateByAvg) >= 4.0;
          const pct = Math.min(Math.abs(rateByAvg) / 4.0, 1.0);
          const barColor = Math.abs(rateByAvg) >= 4.0 ? '#EF4444' : Math.abs(rateByAvg) >= 2.5 ? '#F97316' : '#FBBF24';
          const grades = oilPrice.crudeGrades ?? [];
          const deltaTon = oilPrice.crudeDeltaTon ?? 0;
          const fp = oilPrice.crudeFormulaParams;
          // 城市标准化（提前声明，供冷区判断使用）
          const cityKey = oilCity.replace(/[市省区县]$/, '');
          // ── 低温柴油折算系数表（温度修正版）──
          // 原理：低温柴油（-10#/-20#/-35#）加入降凝剂后密度略低于0#，升/吨系数相应升高
          // 数据来源：黑龙江★官方(-35#1189.05)/甘肃★官方/内蒙古★官方，其余☆邻省推算
          const COLD_CONV_MAP: Record<string, Record<string, number>> = {
            '-10#柴': {
              '全国通用': 1195,
              // ── 东北 ──
              '黑龙江': 1193, '黑龙江南区': 1193, '黑龙江北区': 1188,
              '哈尔滨': 1193, '齐齐哈尔': 1188, '黑河': 1188,
              '吉林': 1193, '长春': 1193,
              '辽宁': 1194, '沈阳': 1194, '大连': 1195,
              // ── 华北 ──
              '内蒙古': 1188, '内蒙古东部': 1185, '内蒙古西部': 1188,
              '呼和浩特': 1188, '通辽': 1185, '赤峰': 1185,
              '河北': 1191, '石家庄': 1191, '张家口': 1191,
              '山西': 1191, '太原': 1191,
              // ── 西北 ──
              '陕西': 1195, '西安': 1195,
              '甘肃': 1178, '兰州': 1178,  // ★ 甘肃官方-10#≈1178
              '青海': 1193, '西宁': 1193,
              '宁夏': 1193, '银川': 1193,
              '新疆': 1193, '乌鲁木齐': 1193,
              // ── 西南高原 ──
              '西藏': 1179, '拉萨': 1179,
              '四川甘孜': 1185,
            },
            '-20#柴': {
              '全国通用': 1196,
              // ── 东北 ──
              '黑龙江': 1194, '黑龙江南区': 1194, '黑龙江北区': 1189,
              '哈尔滨': 1194, '齐齐哈尔': 1189, '黑河': 1189,
              '吉林': 1194, '长春': 1194,
              '辽宁': 1195, '沈阳': 1195, '大连': 1196,
              // ── 华北 ──
              '内蒙古': 1189, '内蒙古东部': 1186, '内蒙古西部': 1189,
              '呼和浩特': 1189, '通辽': 1186, '赤峰': 1186,
              '河北': 1192, '石家庄': 1192, '张家口': 1192,
              '山西': 1192, '太原': 1192,
              // ── 西北 ──
              '陕西': 1196, '西安': 1196,
              '甘肃': 1179, '兰州': 1179,
              '青海': 1194, '西宁': 1194,
              '宁夏': 1194, '银川': 1194,
              '新疆': 1194, '乌鲁木齐': 1194,
              // ── 西南高原 ──
              '西藏': 1180, '拉萨': 1180,
              '四川甘孜': 1186,
            },
            '-35#柴': {
              '全国通用': 1192,
              // ── 东北 ──
              '黑龙江': 1189, '黑龙江南区': 1189, // ★ 黑龙江官方2026/05-10 -35#=1189.05
              '黑龙江北区': 1187,                  // ★ 黑龙江官方北区=1187.02
              '哈尔滨': 1189, '齐齐哈尔': 1187, '黑河': 1187,
              '吉林': 1191, '长春': 1191,
              '辽宁': 1192, '沈阳': 1192, '大连': 1193,
              // ── 华北 ──
              '内蒙古': 1188, '内蒙古东部': 1185, // ★ 内蒙古官方 -35#东部≈1187.5
              '内蒙古西部': 1188,
              '呼和浩特': 1188, '通辽': 1185, '赤峰': 1185,
              '河北': 1190, '石家庄': 1190, '张家口': 1190,
              '山西': 1190, '太原': 1190,
              // ── 西北 ──
              '陕西': 1192, '西安': 1192,
              '甘肃': 1178, '兰州': 1178,
              '青海': 1191, '西宁': 1191,
              '宁夏': 1191, '银川': 1191,
              '新疆': 1191, '乌鲁木齐': 1191,
              // ── 西南高原 ──
              '西藏': 1178, '拉萨': 1178,
              '四川甘孜': 1184,
            },
          };
          // ── 根据当前温度自动选择柴油品号 ──
          // 仅在东北/西北/华北寒冷温区且低于阈值时切换，南方城市常年用0#不切
          const COLD_ZONE = new Set([
            '黑龙江','黑龙江南区','黑龙江北区','哈尔滨','齐齐哈尔','牡丹江','绥化','伊春','黑河',
            '吉林','长春','四平','白城','延边',
            '辽宁','沈阳','大连','鞍山','本溪','铁岭','朝阳',
            '内蒙古','内蒙古东部','内蒙古西部','呼和浩特','包头','通辽','赤峰','呼伦贝尔',
            '河北','石家庄','张家口','承德','唐山',
            '山西','太原','大同','朔州','忻州',
            '陕西','西安','延安','榆林',
            '甘肃','兰州','张掖','酒泉','嘉峪关','武威',
            '青海','西宁','海西','海北',
            '宁夏','银川','固原',
            '新疆','乌鲁木齐','哈密','吐鲁番','喀什','伊犁',
            '西藏','拉萨','日喀则','昌都',
            '四川甘孜',
          ]);
          const curTempNum = weatherData ? parseInt(weatherData.temp, 10) : NaN;
          const isInColdZone = COLD_ZONE.has(cityKey) || COLD_ZONE.has(oilCity);
          // 柴油品号自动选择逻辑（含温区限制）
          const dieselGradeKey = (() => {
            if (!isInColdZone || isNaN(curTempNum)) return '0#柴';
            if (curTempNum <= -15) return '-35#柴';
            if (curTempNum <=  -5) return '-20#柴';
            if (curTempNum <=   0) return '-10#柴';
            return '0#柴';
          })();
          // 城市标准化：去掉市/省/区/县后缀，再查表（已在上方声明，此处省略）
          const getConvFactor = (grade: string): number => {
            // ① 优先读 DB 精确值（convRows 来自 oil_prices.conv_coeff_*，重置/修改立即生效）
            const dbRow = convRows.find(r => r.city === cityKey || r.city === oilCity);
            if (dbRow) {
              if (grade === '92#' && dbRow.conv_coeff_92 && dbRow.conv_coeff_92 > 0) return dbRow.conv_coeff_92;
              if (grade === '95#' && dbRow.conv_coeff_95 && dbRow.conv_coeff_95 > 0) return dbRow.conv_coeff_95;
              if ((grade === '0#柴' || grade === '-10#柴' || grade === '-20#柴' || grade === '-35#柴')
                  && dbRow.conv_coeff_0 && dbRow.conv_coeff_0 > 0) return dbRow.conv_coeff_0;
            }
            // ② 低温柴油专表（COLD_CONV_MAP）
            const coldSrc = COLD_CONV_MAP[grade];
            if (coldSrc) {
              return coldSrc[cityKey] ?? coldSrc[oilCity] ?? coldSrc['全国通用'] ?? 1191;
            }
            // ③ 兜底默认值（DB 未配置时使用）
            return 1318;
          };
          // 前端兜底参数（EF 未返回时使用）
          const FALLBACK_RMB = oilPrice.crudeRmbRate ?? 7.25;
          const FALLBACK_BPT = 7.33, FALLBACK_TAX = 1.1456, FALLBACK_K = 60;
          // ΔP = 本期均价(curAvg) − 上期均价(prevAvg)，与后端 calcChange 一致
          const rawDiff = curAvg - prevAvg;
          const fallbackDeltaTon = +(rawDiff * FALLBACK_RMB * FALLBACK_BPT * FALLBACK_TAX + FALLBACK_K).toFixed(1);
          // getGrade：优先用 EF deltaTon + 当前城市系数重算，EF 无数据才用兜底
          const getGrade = (g: string) => {
            const conv = getConvFactor(g);
            const ton  = deltaTon > 0 ? deltaTon : fallbackDeltaTon;
            return { grade: g, convFactor: conv, deltaPerLiter: +(ton / conv).toFixed(3) };
          };
          const g92      = getGrade('92#');
          const g95      = getGrade('95#');
          const gDiesel  = getGrade(dieselGradeKey);  // 动态柴油品号（含温度修正）
          // 判断城市系数是否来自真实城市（DB 有精确值则为 true）
          const hasLocalConv = !!(
            convRows.find(r => (r.city === cityKey || r.city === oilCity) && r.conv_coeff_92)
          );
          // 柴油品号温区标注（测算卡展示）
          const dieselTempLabel = dieselGradeKey !== '0#柴'
            ? ` (${curTempNum}°→温区切换)` : '';
          // 测算预计价：优先用历史调价最后一期（走势图底部显示的那个价），其次才用 oilPrice.p92
          const lastHistoryP92 = oilHistory.length > 0 ? parseFloat(oilHistory[oilHistory.length - 1].p92) : NaN;
          const p92cur = !isNaN(lastHistoryP92) && lastHistoryP92 > 0 ? lastHistoryP92 : parseFloat(oilPrice.p92);
          const estimatedP92 = !isNaN(p92cur) && willTrigger ? (p92cur + g92.deltaPerLiter).toFixed(2) : null;

          return (
            <Animated.View entering={FadeInDown.delay(80).duration(260)}
              style={{ marginBottom: 4, borderRadius: 14, overflow: 'hidden',
                borderWidth: 1, borderColor: 'rgba(251,146,60,0.30)' }}>
              <LinearGradient
                colors={['rgba(120,50,8,0.55)', 'rgba(60,20,2,0.80)', 'rgba(20,8,0,0.90)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0) setCrudeCardW(w); }}
                style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 8 }}
              >
                {/* ── 标题行：点击折叠/展开 + 右侧刷新按钮 ── */}
                <Pressable
                  onPress={() => setCrudeCollapsed(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TrendingUp size={13} color="#FB923C" />
                    <Text style={{ color: '#FCD34D', fontSize: 12, fontWeight: '900', letterSpacing: 0.4 }}>
                      原油→国内油价测算
                    </Text>
                    {/* 折叠箭头 */}
                    {crudeCollapsed
                      ? <ChevronDown size={13} color="rgba(251,146,60,0.55)" />
                      : <ChevronUp   size={13} color="rgba(251,146,60,0.55)" />}
                  </View>
                  {/* 刷新按钮（已整合到卡内）*/}
                  <Pressable
                    onPress={() => handleFetchCrudePrice(true)}
                    disabled={crudeForceLoading}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: crudeForceLoading ? 'rgba(251,146,60,0.07)' : 'rgba(251,146,60,0.14)',
                      borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                      borderWidth: 1, borderColor: crudeForceLoading ? 'rgba(251,146,60,0.18)' : 'rgba(251,146,60,0.40)' }}
                  >
                    {crudeForceLoading
                      ? <ActivityIndicator size="small" color="#FB923C" style={{ transform: [{ scale: 0.55 }] }} />
                      : <RefreshCw size={9} color="#FB923C" />}
                    <Text style={{ color: crudeForceLoading ? 'rgba(251,146,60,0.55)' : '#FB923C', fontSize: 9, fontWeight: '700' }}>
                      {crudeForceLoading ? '获取中…' : '刷新'}
                    </Text>
                  </Pressable>
                </Pressable>

                {/* ── 无数据时：占位提示 + 大刷新按钮（折叠时隐藏）── */}
                {!hasData && !crudeCollapsed && (
                  <View style={{ alignItems: 'center', paddingVertical: 14, gap: 10 }}>
                    {crudeLoading
                      ? <ActivityIndicator size="large" color="rgba(251,146,60,0.6)" />
                      : (
                        <>
                          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
                            暂无国际原油实时数据
                          </Text>
                          <Pressable
                            onPress={() => handleFetchCrudePrice(true)}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                              backgroundColor: 'rgba(251,146,60,0.18)', borderRadius: 10,
                              paddingHorizontal: 16, paddingVertical: 8,
                              borderWidth: 1, borderColor: 'rgba(251,146,60,0.45)' }}
                          >
                            <TrendingUp size={13} color="#FB923C" />
                            <Text style={{ color: '#FB923C', fontSize: 12, fontWeight: '800' }}>
                              {crudeForceLoading ? '获取中…' : '点击获取原油价格'}
                            </Text>
                          </Pressable>
                          <Text style={{ color: 'rgba(255,255,255,0.20)', fontSize: 9, textAlign: 'center' }}>
                            获取布伦特/阿曼/米纳斯实时报价{'\n'}自动测算国内调价幅度
                          </Text>
                        </>
                      )}
                  </View>
                )}

                {/* ── 有数据时：完整内容（折叠时隐藏）── */}
                {hasData && !crudeCollapsed && (<>
                {/* ── 国际原油价格行（布伦特 + 阿曼 + 米纳斯 + 变化率）── */}
                <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 5 }}>
                  {[
                    { label: '布伦特', val: basketBrent, unit: '10日均价', color: '#FB923C', border: 'rgba(251,146,60,0.30)', bg: 'rgba(251,146,60,0.09)', accent: true },
                    { label: '阿曼',   val: basketDubai, unit: '10日均价', color: '#FDE047', border: 'rgba(250,204,21,0.25)', bg: 'rgba(250,204,21,0.07)', accent: false },
                    { label: '米纳斯', val: basketMinas, unit: '10日均价', color: '#C4B5FD', border: 'rgba(167,139,250,0.20)', bg: 'rgba(167,139,250,0.06)', accent: false },
                  ].map(({ label, val, unit, color, border, bg }) => (
                    <View key={label} style={{ flex: 1, backgroundColor: bg, borderRadius: 12,
                      paddingHorizontal: 6, paddingVertical: 9, borderWidth: 1, borderColor: border,
                      alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.38)', fontSize: 8, fontWeight: '700', letterSpacing: 0.3 }}>{label}</Text>
                      <Text style={{ color, fontSize: 17, fontWeight: '900', letterSpacing: 0.3 }}>
                        ${val.toFixed(1)}
                      </Text>
                      <Text style={{ color: `${color}55`, fontSize: 7 }}>{unit}</Text>
                    </View>
                  ))}
                  {/* 变化率卡 */}
                  <View style={{ flex: 1, backgroundColor: `${rateColor}12`, borderRadius: 12,
                    paddingHorizontal: 6, paddingVertical: 9, borderWidth: 1, borderColor: `${rateColor}30`,
                    alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, fontWeight: '600', letterSpacing: 0.3 }}>询价变化</Text>
                    <Text style={{ color: rateColor, fontSize: 14, fontWeight: '900', letterSpacing: 0.2 }}>
                      {rateByAvg >= 0 ? '+' : ''}{rateByAvg.toFixed(1)}%
                    </Text>
                    <View style={{ backgroundColor: `${rateColor}20`, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ color: rateColor, fontSize: 7, fontWeight: '800' }}>
                        {isUp ? '↑ 上涨' : isDn ? '↓ 下跌' : '→ 持平'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* ── 均价对照区 ── */}
                <View style={{ gap: 7 }}>

                  {/* ── TOP：一揽子加权均价大卡 ── */}
                  {basketAvg > 0 && (
                    <LinearGradient
                      colors={['rgba(251,146,60,0.16)', 'rgba(250,204,21,0.06)', 'rgba(20,20,40,0.0)']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(251,146,60,0.28)', padding: 12, gap: 10 }}
                    >
                      {/* 标题行 */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 3, height: 13, borderRadius: 2, backgroundColor: '#FB923C' }} />
                          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>一揽子加权均价</Text>
                          <View style={{ backgroundColor: 'rgba(251,146,60,0.15)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ color: 'rgba(251,146,60,0.80)', fontSize: 8, fontWeight: '700' }}>4:3:3</Text>
                          </View>
                          {/* 管理员：手动修正入口 */}
                          {isAdmin && (
                            <Pressable
                              onPress={() => {
                                setBasketInput((oilPrice?.crudeBasketAvg ?? 0) > 0 ? oilPrice!.crudeBasketAvg!.toFixed(2) : '');
                                setBasketMsg('');
                                setAvgEditModal('basket');
                              }}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              style={{ width: 18, height: 18, borderRadius: 9,
                                backgroundColor: oilPrice?.crudeAvg10dLocked ? 'rgba(99,102,241,0.22)' : 'rgba(251,146,60,0.12)',
                                alignItems: 'center', justifyContent: 'center',
                                borderWidth: 1, borderColor: oilPrice?.crudeAvg10dLocked ? 'rgba(99,102,241,0.45)' : 'rgba(251,146,60,0.30)' }}
                            >
                              <Text style={{ fontSize: 8 }}>{oilPrice?.crudeAvg10dLocked ? '🔒' : '✏️'}</Text>
                            </Pressable>
                          )}
                        </View>
                        {basketDays > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            {basketStart ? (
                              <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 8 }}>{basketStart.slice(5)}起</Text>
                            ) : null}
                            <View style={{ backgroundColor: basketDays < 5 ? 'rgba(251,146,60,0.18)' : 'rgba(250,204,21,0.13)',
                              borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
                              borderWidth: 0.5, borderColor: basketDays < 5 ? 'rgba(251,146,60,0.45)' : 'rgba(250,204,21,0.35)' }}>
                              <Text style={{ color: basketDays < 5 ? '#FB923C' : '#FDE047', fontSize: 8, fontWeight: '800' }}>
                                {basketDays < 5 ? `⚠ ${basketDays}天` : `${basketDays}天`}
                              </Text>
                            </View>
                            {/* 截至日期 */}
                            {eiaDataDate ? (
                              <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 8 }}>
                                {`截至${eiaDataDate.replace(/^\d{4}-(\d{2})-(\d{2})$/, (_, m, d) => `${parseInt(m)}月${parseInt(d)}日`)}`}
                              </Text>
                            ) : null}
                          </View>
                        )}
                      </View>

                      {/* 价格 + 三品种分解 */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <View style={{ alignItems: 'flex-start', gap: 1 }}>
                          <Text style={{ color: '#FB923C', fontSize: 30, fontWeight: '900', letterSpacing: 0.5, lineHeight: 33 }}>
                            ${basketAvg.toFixed(2)}
                          </Text>
                          <Text style={{ color: 'rgba(251,146,60,0.42)', fontSize: 9 }}>美元 / 桶</Text>
                        </View>
                        <View style={{ width: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.07)' }} />
                        <View style={{ flex: 1, gap: 5 }}>
                          {[
                            { label: '布伦特', val: basketBrent, color: '#FB923C', w: 0.4 },
                            { label: '阿曼',   val: basketDubai, color: '#FDE047', w: 0.3 },
                            { label: '米纳斯', val: basketMinas, color: '#C4B5FD', w: 0.3 },
                          ].map(({ label, val, color, w }) => (
                            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Text style={{ color: 'rgba(255,255,255,0.32)', fontSize: 8, width: 28 }}>{label}</Text>
                              <View style={{ flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                                <View style={{ width: `${w * 100}%`, height: '100%', backgroundColor: color, opacity: 0.55, borderRadius: 2 }} />
                              </View>
                              <View style={{ backgroundColor: `${color}18`, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1.5, minWidth: 44, alignItems: 'center' }}>
                                <Text style={{ color, fontSize: 8.5, fontWeight: '700' }}>${val.toFixed(1)}</Text>
                              </View>
                              <Text style={{ color: 'rgba(255,255,255,0.18)', fontSize: 7.5, width: 14, textAlign: 'right' }}>{Math.round(w * 10)}成</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </LinearGradient>
                  )}

                  {/* ── 上期基准卡（全宽）+ 差值胶囊横排 ── */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {/* 上期基准卡 */}
                    {isAdmin ? (
                      <Pressable
                        onPress={() => { setLastCycleInput(lastCycleAvg > 0 ? lastCycleAvg.toFixed(2) : ''); setLastCycleMsg(''); setAvgEditModal('prev'); }}
                        style={{ flex: 1, borderRadius: 14, overflow: 'hidden',
                          borderWidth: oilPrice?.crudeLastCycleAvgLocked ? 1.5 : 1,
                          borderColor: oilPrice?.crudeLastCycleAvgLocked ? 'rgba(99,102,241,0.55)' : 'rgba(148,163,184,0.20)' }}
                      >
                        <LinearGradient
                          colors={oilPrice?.crudeLastCycleAvgLocked
                            ? ['rgba(99,102,241,0.16)', 'rgba(99,102,241,0.05)']
                            : ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.01)']}
                          style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 3 }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 9, fontWeight: '700', letterSpacing: 0.4 }}>上期基准</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              {oilPrice?.crudeLastCycleAvgLocked && (
                                <View style={{ backgroundColor: 'rgba(99,102,241,0.18)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                                  <Text style={{ color: '#818CF8', fontSize: 7, fontWeight: '800' }}>🔒</Text>
                                </View>
                              )}
                              <View style={{ width: 16, height: 16, borderRadius: 8,
                                backgroundColor: 'rgba(148,163,184,0.10)', alignItems: 'center', justifyContent: 'center',
                                borderWidth: 1, borderColor: 'rgba(148,163,184,0.22)' }}>
                                <Text style={{ fontSize: 8 }}>✏️</Text>
                              </View>
                            </View>
                          </View>
                          <Text style={{ color: lastCycleAvg > 0
                            ? (oilPrice?.crudeLastCycleAvgLocked ? '#A5B4FC' : 'rgba(148,163,184,0.85)')
                            : 'rgba(255,255,255,0.18)',
                            fontSize: 19, fontWeight: '900', letterSpacing: 0.3 }}>
                            {lastCycleAvg > 0 ? `$${lastCycleAvg.toFixed(2)}` : '—'}
                          </Text>
                          <Text style={{ color: 'rgba(148,163,184,0.35)', fontSize: 8 }}>🔄 变价后由一揽子均价自动转入</Text>
                        </LinearGradient>
                      </Pressable>
                    ) : (
                      <View style={{ flex: 1, borderRadius: 14, overflow: 'hidden',
                        borderWidth: 1, borderColor: 'rgba(148,163,184,0.16)',
                        backgroundColor: 'rgba(148,163,184,0.04)' }}>
                        <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 3 }}>
                          <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 9, fontWeight: '700', letterSpacing: 0.4 }}>上期基准</Text>
                          <Text style={{ color: lastCycleAvg > 0 ? 'rgba(148,163,184,0.85)' : 'rgba(255,255,255,0.18)',
                            fontSize: 19, fontWeight: '900' }}>
                            {lastCycleAvg > 0 ? `$${lastCycleAvg.toFixed(2)}` : '—'}
                          </Text>
                          <Text style={{ color: 'rgba(148,163,184,0.35)', fontSize: 8 }}>🔄 变价后自动转入</Text>
                        </View>
                      </View>
                    )}

                    {/* 差值胶囊（竖排，嵌在右侧）*/}
                    {curAvg > 0 && prevAvg > 0 && (() => {
                      const diff = +(curAvg - prevAvg).toFixed(2);
                      const isPos = diff > 0; const isNeg = diff < 0;
                      const col = isPos ? '#FCA5A5' : isNeg ? '#6EE7B7' : '#94A3B8';
                      const pctDiff = prevAvg > 0 ? +((diff / prevAvg) * 100).toFixed(1) : 0;
                      return (
                        <View style={{ alignItems: 'center', gap: 4,
                          backgroundColor: `${col}0C`, borderRadius: 12,
                          paddingHorizontal: 10, paddingVertical: 10,
                          borderWidth: 1, borderColor: `${col}20` }}>
                          <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 7.5, fontWeight: '600' }}>Δ</Text>
                          <Text style={{ color: col, fontSize: 13, fontWeight: '900', letterSpacing: 0.2 }}>
                            {isPos ? '+' : ''}{diff}
                          </Text>
                          <Text style={{ color: `${col}80`, fontSize: 7 }}>$/桶</Text>
                          <View style={{ height: 0.5, width: 28, backgroundColor: `${col}25` }} />
                          <Text style={{ color: col, fontSize: 10, fontWeight: '800' }}>
                            {isPos ? '+' : ''}{pctDiff}%
                          </Text>
                        </View>
                      );
                    })()}
                  </View>
                </View>

                {/* ── 发改委测算区块 ── */}
                <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1,
                  borderColor: willTrigger ? `${barColor}35` : 'rgba(255,255,255,0.08)',
                  backgroundColor: willTrigger ? `${barColor}08` : 'rgba(0,0,0,0.18)' }}>
                  <View style={{ padding: 11, gap: 8 }}>
                    {/* 标题行 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3,
                          backgroundColor: willTrigger ? barColor : 'rgba(251,146,60,0.50)' }} />
                        <Text style={{ color: 'rgba(255,255,255,0.60)', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 }}>发改委定价规则测算</Text>
                        <Text style={{ color: hasLocalConv ? 'rgba(251,146,60,0.65)' : 'rgba(255,255,255,0.25)', fontSize: 9 }}>
                          · {hasLocalConv ? cityKey : '全国通用'}
                        </Text>
                      </View>
                      <View style={{ backgroundColor: willTrigger ? `${barColor}22` : 'rgba(255,255,255,0.06)',
                        borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
                        borderWidth: 1, borderColor: willTrigger ? `${barColor}45` : 'rgba(255,255,255,0.10)' }}>
                        <Text style={{ color: willTrigger ? barColor : 'rgba(255,255,255,0.30)', fontSize: 8.5, fontWeight: '800' }}>
                          {willTrigger ? '🔴 已触发' : `达标${(pct * 100).toFixed(0)}%`}
                        </Text>
                      </View>
                    </View>

                    {/* 进度条 */}
                    <View style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8 }}>调价门槛 ≥ ±4%</Text>
                        <Text style={{ color: barColor, fontSize: 8, fontWeight: '700' }}>
                          当前 {rateByAvg >= 0 ? '+' : ''}{rateByAvg.toFixed(1)}%
                        </Text>
                      </View>
                      <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ height: 6, borderRadius: 3,
                          width: `${Math.min(pct * 100, 100)}%` as `${number}%`,
                          backgroundColor: barColor, opacity: 0.85 }} />
                      </View>
                    </View>

                    {/* 测算结论 */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <View style={{ width: 18, height: 18, borderRadius: 9,
                        backgroundColor: willTrigger ? `${barColor}20` : 'rgba(255,255,255,0.05)',
                        borderWidth: 1, borderColor: willTrigger ? `${barColor}45` : 'rgba(255,255,255,0.10)',
                        alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                        <Text style={{ fontSize: 9, fontWeight: '900', color: willTrigger ? barColor : 'rgba(255,255,255,0.30)' }}>
                          {willTrigger ? (isUp ? '↑' : '↓') : '—'}
                        </Text>
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        {willTrigger ? (<>
                          {[g92, g95, gDiesel].map(gr => {
                            const s = gr.deltaPerLiter >= 0 ? '+' : '';
                            const dir = gr.deltaPerLiter > 0 ? '上调' : '下调';
                            const isDiesel = gr.grade !== '92#' && gr.grade !== '95#';
                            return (
                              <View key={gr.grade} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                                backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                  <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '800' }}>{gr.grade}</Text>
                                  {isDiesel && dieselGradeKey !== '0#柴' && (
                                    <Text style={{ color: '#34D399', fontSize: 7.5, fontWeight: '700' }}>{curTempNum}°</Text>
                                  )}
                                </View>
                                <Text style={{ color: barColor, fontSize: 12, fontWeight: '900' }}>
                                  {dir} {s}{gr.deltaPerLiter.toFixed(2)} 元/升
                                </Text>
                                <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 8 }}>{gr.convFactor}升/吨</Text>
                              </View>
                            );
                          })}
                          {estimatedP92 && (
                            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, paddingHorizontal: 2 }}>
                              预计92# → {estimatedP92}元/升（当前{p92cur.toFixed(2)}）
                            </Text>
                          )}
                          <Text style={{ color: 'rgba(255,255,255,0.18)', fontSize: 8, paddingHorizontal: 2 }}>
                            {fp
                              ? `ΔP$${fp.deltaP.toFixed(2)}×${fp.R}${oilPrice.crudeRmbSource === 'realtime' ? '(实时)' : '(估算)'}汇率×${fp.barrelPerTon}桶/吨×${(1+fp.T1+fp.T1*fp.T2).toFixed(4)}税费+${fp.K}K = ${fp.deltaTon.toFixed(1)}元/吨`
                              : `税费联动公式 ΔC=${(deltaTon||fallbackDeltaTon).toFixed(1)}元/吨`}
                          </Text>
                          {oilPrice.crudeRmbRate != null && (
                            oilPrice.crudeRmbSource !== 'realtime'
                              ? <Text style={{ color: '#FB923C', fontSize: 8, fontWeight: '700', paddingHorizontal: 2 }}>
                                  {`⚠️ 汇率降级（估算值 ${oilPrice.crudeRmbRate.toFixed(4)}）`}
                                </Text>
                              : <Text style={{ color: 'rgba(255,255,255,0.16)', fontSize: 8, paddingHorizontal: 2 }}>
                                  {`USD/CNY ${oilPrice.crudeRmbRate.toFixed(4)} · 实时${oilPrice.crudeRmbRateTime ? ' · ' + oilPrice.crudeRmbRateTime : ''}`}
                                </Text>
                          )}
                        </>) : (
                          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700' }}>
                            {calcText || `均价变化${rateByAvg >= 0 ? '+' : ''}${rateByAvg.toFixed(1)}%，未达调价门槛`}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                </View>

                {/* ── 原油刷新结果提示 ── */}
                {!!crudeForceResult && (
                  <Text style={{ color: crudeForceResult.startsWith('✅') ? '#6EE7B7' : '#FCA5A5',
                    fontSize: 10, textAlign: 'center', fontWeight: '700' }}>
                    {crudeForceResult}
                  </Text>
                )}

                {/* ── 下次调价走势（测算卡内）── */}
                {!crudeCollapsed && oilPrice && (() => {
                  // 复用底部横条卡的走势计算逻辑
                  const sc2 = sharedCrude;
                  const useCrude2 = !!(sc2 && (sc2.willTrigger || Math.abs(sc2.rateByAvg) > 0));
                  const nt2 = oilPrice.nextTrend ?? 0;
                  const nt2IsUp = useCrude2 ? sc2!.isUp  : nt2 > 0;
                  const nt2IsDn = useCrude2 ? sc2!.isDn  : nt2 < 0;
                  const nt2Arrow = nt2IsUp ? '▲' : nt2IsDn ? '▼' : '—';
                  const nt2Color  = nt2IsUp ? '#FCA070' : nt2IsDn ? '#6EE7B7' : '#7DD3FC';
                  const nt2Bg     = nt2IsUp ? 'rgba(251,146,60,0.18)'  : nt2IsDn ? 'rgba(52,211,153,0.16)'  : 'rgba(125,211,252,0.10)';
                  const nt2Border = nt2IsUp ? 'rgba(251,146,60,0.42)'  : nt2IsDn ? 'rgba(52,211,153,0.38)'  : 'rgba(125,211,252,0.24)';

                  // 原油测算区间：从 g92/g95/gDiesel 的 deltaPerLiter 中取最小/最大值
                  const allDeltas = [g92.deltaPerLiter, g95.deltaPerLiter, gDiesel.deltaPerLiter].filter(d => Math.abs(d) >= 0.005);
                  const hasCrudeRange = useCrude2 && allDeltas.length > 0;
                  const rawMin = hasCrudeRange ? Math.min(...allDeltas) : 0;
                  const rawMax = hasCrudeRange ? Math.max(...allDeltas) : 0;
                  const rangeSign = rawMax >= 0 ? '+' : '';
                  const rangeLabel = hasCrudeRange
                    ? (Math.abs(rawMax - rawMin) < 0.005
                        ? `${rawMax > 0 ? '+' : ''}${rawMax.toFixed(2)}元/升`
                        : `${rawMin > 0 ? '+' : ''}${rawMin.toFixed(2)}～${rawMax > 0 ? '+' : ''}${rawMax.toFixed(2)}元/升`)
                    : (useCrude2 ? '持平' : '待预测');

                  // 倒计时计算
                  const bjNow2 = new Date(Date.now() + 8 * 3600 * 1000);
                  const todayBj2 = `${bjNow2.getUTCFullYear()}-${String(bjNow2.getUTCMonth()+1).padStart(2,'0')}-${String(bjNow2.getUTCDate()).padStart(2,'0')}`;
                  const nad2 = oilPrice.nextAdjustDate ?? '';
                  let daysLeft2: number | null = null;
                  if (nad2 && /^\d{4}-\d{2}-\d{2}$/.test(nad2)) {
                    const ms = new Date(nad2).getTime() - new Date(todayBj2).getTime();
                    daysLeft2 = Math.round(ms / 86400000);
                  }
                  const daysUrgent2 = daysLeft2 !== null && daysLeft2 >= 0 && daysLeft2 <= 3;
                  const daysLabel2 = daysLeft2 === null ? '' : daysLeft2 < 0 ? '窗口已过' : daysLeft2 === 0 ? '今天调价' : `${daysLeft2}天后`;

                  return (
                    <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(251,146,60,0.15)', paddingTop: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 7 }}>

                        {/* 左：调价日期 + 倒计时 */}
                        <LinearGradient
                          colors={daysUrgent2
                            ? ['rgba(249,115,22,0.14)', 'rgba(249,115,22,0.04)']
                            : ['rgba(251,191,36,0.10)', 'rgba(251,191,36,0.02)']}
                          style={{ flex: 1, borderRadius: 13, borderWidth: 1,
                            borderColor: daysUrgent2 ? 'rgba(249,115,22,0.38)' : 'rgba(251,191,36,0.22)',
                            paddingHorizontal: 11, paddingVertical: 10, gap: 4, justifyContent: 'center' }}
                        >
                          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 }}>调价窗口</Text>
                          {nad2 ? (
                            <Text style={{ color: daysUrgent2 ? '#FDBA74' : '#FCD34D', fontSize: 15, fontWeight: '900', letterSpacing: 0.2 }}>
                              {nad2.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, _y, m, d) => `${parseInt(m)}月${parseInt(d)}日`)}
                            </Text>
                          ) : (
                            <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 13, fontWeight: '700' }}>待设置</Text>
                          )}
                          {daysLabel2 ? (
                            <View style={{ alignSelf: 'flex-start',
                              backgroundColor: daysUrgent2 ? 'rgba(249,115,22,0.18)' : 'rgba(251,191,36,0.10)',
                              borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
                              borderWidth: 1, borderColor: daysUrgent2 ? 'rgba(249,115,22,0.42)' : 'rgba(251,191,36,0.26)' }}>
                              <Text style={{ color: daysUrgent2 ? '#FB923C' : '#FBBF24', fontSize: 9, fontWeight: '900' }}>
                                {daysLeft2 === 0 ? '🔔 今天调价' : `还剩 ${daysLabel2}`}
                              </Text>
                            </View>
                          ) : null}
                        </LinearGradient>

                        {/* 右：原油测算区间 */}
                        <LinearGradient
                          colors={[`${nt2Color}18`, `${nt2Color}05`]}
                          style={{ flex: 1, borderRadius: 13, borderWidth: 1, borderColor: nt2Border,
                            paddingHorizontal: 11, paddingVertical: 10, gap: 4, justifyContent: 'center' }}
                        >
                          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 }}>预计调幅</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                            <Text style={{ color: nt2Color, fontSize: 17, fontWeight: '900' }}>{nt2Arrow}</Text>
                            <Text style={{ color: nt2Color, fontSize: 12, fontWeight: '900', flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>
                              {rangeLabel}
                            </Text>
                          </View>
                          <Text style={{ color: `${nt2Color}70`, fontSize: 8 }}>
                            {hasCrudeRange ? '92# ～ 柴油' : useCrude2 ? '原油测算' : '暂无数据'}
                          </Text>
                        </LinearGradient>

                      </View>
                    </View>
                  );
                })()}

                {/* ── 历史调价折线走势图（测算卡内，折叠展开）── */}
                {!crudeCollapsed && (() => {
                  const displayHistory: (OilHistoryItem & { isSimul?: boolean })[] =
                    oilHistorySimul
                      ? [...oilHistory, { ...oilHistorySimul, isSimul: true }]
                      : oilHistory;
                  if (displayHistory.length < 2 || crudeCardW === 0) return null;
                  const chartInnerPad = 8;
                  const chartW = crudeCardW - chartInnerPad * 2 - 24; // 扣测算卡paddingHorizontal 12*2
                  const chartH = 110;
                  const padL = 32; const padR = 6; const padT = 12; const padB = 24;
                  const innerH = chartH - padT - padB;
                  const series = [
                    { key: 'p92' as const, color: '#FBBF24', label: '92#' },
                    { key: 'p95' as const, color: '#F87171', label: '95#' },
                    { key: 'p0'  as const, color: '#34D399', label: '柴' },
                  ];
                  const crudeBrent2 = oilPrice?.crudeBrent ?? 0;
                  const hasCrude2 = crudeBrent2 > 0;
                  const crudeMin2 = crudeBrent2 > 0 ? crudeBrent2 * 0.93 : 60;
                  const crudeMax2 = crudeBrent2 > 0 ? crudeBrent2 * 1.07 : 90;
                  const crudeRange2 = crudeMax2 - crudeMin2 || 1;
                  const padR2 = 38;
                  const innerW2 = chartW - padL - (hasCrude2 ? padR2 : padR);
                  const yOfCrude2 = (v: number) => padT + (1 - (v - crudeMin2) / crudeRange2) * innerH;
                  const crudeCurY2 = hasCrude2 ? yOfCrude2(crudeBrent2) : -1;
                  const firstPoint = displayHistory[0];
                  const baseVals = series.map(s => parseFloat(firstPoint[s.key])).filter(v => !isNaN(v) && v > 0);
                  const allVals = displayHistory.flatMap(h => series.map(s => parseFloat(h[s.key])).filter(v => !isNaN(v) && v > 0));
                  const baseMin = Math.min(...baseVals);
                  const baseMax = Math.max(...baseVals);
                  const dataMax = Math.max(...allVals);
                  const basePad = (baseMax - baseMin) * 0.4 + 0.08;
                  const minV = baseMin - basePad;
                  const maxV = Math.max(baseMax + basePad, dataMax + 0.05);
                  const rangeV = maxV - minV || 1;
                  const n = displayHistory.length;
                  const nReal = oilHistory.length;
                  const xOf = (i: number) => padL + (n === 1 ? innerW2 / 2 : (i / (n - 1)) * innerW2);
                  const yOf = (v: number) => padT + (1 - (v - minV) / rangeV) * innerH;
                  const realPointsStr = (key: 'p92' | 'p95' | 'p98' | 'p0') =>
                    displayHistory.slice(0, nReal).map((h, i) => {
                      const v = parseFloat(h[key]);
                      return isNaN(v) ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
                    }).filter(Boolean).join(' ');
                  const simulLineStr = (key: 'p92' | 'p95' | 'p98' | 'p0') => {
                    if (!oilHistorySimul) return '';
                    const lR = displayHistory[nReal - 1];
                    const vR = parseFloat(lR[key]);
                    const vS = parseFloat(displayHistory[n - 1][key]);
                    if (isNaN(vR) || isNaN(vS)) return '';
                    return `${xOf(nReal-1).toFixed(1)},${yOf(vR).toFixed(1)} ${xOf(n-1).toFixed(1)},${yOf(vS).toFixed(1)}`;
                  };
                  const labelIdxs = (() => {
                    const ri = nReal <= 3 ? Array.from({ length: nReal }, (_, i) => i) : [0, Math.floor((nReal-1)/2), nReal-1];
                    return oilHistorySimul ? [...new Set([...ri, n-1])] : ri;
                  })();
                  const lastReal = displayHistory[nReal - 1];
                  const prevReal = nReal >= 2 ? displayHistory[nReal - 2] : null;
                  const delta92 = prevReal ? (parseFloat(lastReal.p92) - parseFloat(prevReal.p92)) : 0;
                  const trendClr = delta92 > 0.005 ? '#F87171' : delta92 < -0.005 ? '#34D399' : '#94A3B8';
                  const trendTxt = delta92 > 0.005 ? `↑${delta92.toFixed(2)}` : delta92 < -0.005 ? `↓${Math.abs(delta92).toFixed(2)}` : '持平';

                  return (
                    <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(251,146,60,0.15)',
                      paddingTop: 8, marginTop: 2,
                      borderRadius: 10, overflow: 'hidden' }}>
                      {/* 标题行 */}
                      <Pressable
                        onPress={() => setOilHistoryExpanded(v => !v)}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          paddingBottom: 6 }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, height: 10 }}>
                            {[{ c: '#FBBF24', h: 7 }, { c: '#F87171', h: 10 }, { c: '#34D399', h: 5 }].map((b, idx) => (
                              <View key={idx} style={{ width: 2.5, height: b.h, backgroundColor: b.c, borderRadius: 1.5, opacity: 0.85 }} />
                            ))}
                          </View>
                          <Text style={{ color: 'rgba(255,255,255,0.60)', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 }}>历史调价走势</Text>
                          <View style={{ backgroundColor: `${trendClr}22`, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: `${trendClr}50` }}>
                            <Text style={{ color: trendClr, fontSize: 9, fontWeight: '800' }}>{trendTxt}</Text>
                          </View>
                          {!!oilHistorySimul && (
                            <View style={{ backgroundColor: 'rgba(167,139,250,0.15)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: 'rgba(167,139,250,0.4)' }}>
                              <Text style={{ color: '#C4B5FD', fontSize: 9, fontWeight: '800' }}>🧪模拟</Text>
                            </View>
                          )}
                          {oilHistoryLoading && (
                            <ActivityIndicator size="small" color="rgba(251,191,36,0.4)" style={{ transform: [{ scale: 0.45 }], marginLeft: -2 }} />
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 9 }}>
                            {oilHistoryExpanded ? '收起' : `${nReal}期`}
                          </Text>
                          <View style={{ transform: [{ rotate: oilHistoryExpanded ? '180deg' : '0deg' }] }}>
                            <ChevronDown size={11} color="rgba(255,255,255,0.3)" />
                          </View>
                        </View>
                      </Pressable>

                      {/* 图表展开区 */}
                      {oilHistoryExpanded && (
                        <Animated.View entering={FadeInUp.duration(220)}
                          style={{ borderTopWidth: 1, borderTopColor: 'rgba(251,146,60,0.10)',
                            paddingTop: 8, paddingBottom: 4 }}>
                          {/* 图例 */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 6 }}>
                            {series.map(s => (
                              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                <View style={{ width: 14, height: 2.5, backgroundColor: s.color, borderRadius: 2 }} />
                                <Text style={{ color: `${s.color}cc`, fontSize: 9, fontWeight: '700' }}>{s.label}</Text>
                              </View>
                            ))}
                            {hasCrude2 && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                <View style={{ width: 14, height: 0, borderTopWidth: 1.5, borderTopColor: 'rgba(251,146,60,0.70)', borderStyle: 'dashed' }} />
                                <Text style={{ color: 'rgba(251,146,60,0.70)', fontSize: 9, fontWeight: '700' }}>原油</Text>
                              </View>
                            )}
                            {!!oilHistorySimul && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                <View style={{ width: 14, height: 2, borderTopWidth: 2, borderTopColor: 'rgba(167,139,250,0.7)', borderStyle: 'dashed' }} />
                                <Text style={{ color: 'rgba(196,181,253,0.7)', fontSize: 9, fontWeight: '700' }}>模拟</Text>
                              </View>
                            )}
                          </View>

                          {/* SVG 折线图 */}
                          <View style={{ alignItems: 'center' }}>
                            <Svg width={chartW} height={chartH}>
                              <Defs>
                                {series.map(s => (
                                  <SvgLinearGradient key={s.key} id={`cgrad_${s.key}`} x1="0" y1="0" x2="0" y2="1">
                                    <Stop offset="0" stopColor={s.color} stopOpacity="0.22" />
                                    <Stop offset="1" stopColor={s.color} stopOpacity="0" />
                                  </SvgLinearGradient>
                                ))}
                              </Defs>

                              {/* Y轴网格 */}
                              {[0, 0.5, 1].map(t => {
                                const y = padT + t * innerH;
                                const val = (maxV - t * rangeV).toFixed(2);
                                return (
                                  <React.Fragment key={t}>
                                    <Line x1={padL} y1={y} x2={padL + innerW2} y2={y}
                                      stroke={t === 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.09)'}
                                      strokeWidth={1} strokeDasharray={t === 0.5 ? '3,3' : undefined} />
                                    <SvgText x={padL - 4} y={y + 3.5} fontSize={7.5} fill="rgba(255,255,255,0.30)" textAnchor="end">{val}</SvgText>
                                  </React.Fragment>
                                );
                              })}
                              <Line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="rgba(255,255,255,0.09)" strokeWidth={1} />

                              {/* 原油参考线 */}
                              {hasCrude2 && crudeCurY2 >= padT && crudeCurY2 <= padT + innerH && (<>
                                <Line x1={padL} y1={crudeCurY2} x2={padL + innerW2} y2={crudeCurY2}
                                  stroke="rgba(251,146,60,0.55)" strokeWidth={1} strokeDasharray="4,3" />
                                <SvgText x={padL + innerW2 + 3} y={crudeCurY2 + 3.5} fontSize={7} fill="rgba(251,146,60,0.80)" textAnchor="start" fontWeight="bold">${crudeBrent2.toFixed(0)}</SvgText>
                                <SvgText x={padL + innerW2 + 3} y={padT + 4} fontSize={6.5} fill="rgba(251,146,60,0.45)" textAnchor="start">${crudeMax2.toFixed(0)}</SvgText>
                                <SvgText x={padL + innerW2 + 3} y={padT + innerH + 3} fontSize={6.5} fill="rgba(251,146,60,0.45)" textAnchor="start">${crudeMin2.toFixed(0)}</SvgText>
                                <Line x1={padL + innerW2 + 1} y1={padT} x2={padL + innerW2 + 1} y2={padT + innerH} stroke="rgba(251,146,60,0.18)" strokeWidth={0.8} />
                              </>)}

                              {/* 真实段：面积 + 实线 */}
                              {series.map(s => {
                                const pts = displayHistory.slice(0, nReal).map((h, i) => {
                                  const v = parseFloat(h[s.key]);
                                  return isNaN(v) ? null : { x: xOf(i), y: yOf(v) };
                                }).filter(Boolean) as { x: number; y: number }[];
                                if (pts.length < 2) return null;
                                const ap = [
                                  ...pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
                                  `${pts[pts.length-1].x.toFixed(1)},${(padT+innerH).toFixed(1)}`,
                                  `${pts[0].x.toFixed(1)},${(padT+innerH).toFixed(1)}`,
                                ].join(' ');
                                return (
                                  <React.Fragment key={s.key}>
                                    <Polygon points={ap} fill={`url(#cgrad_${s.key})`} />
                                    <Polyline points={realPointsStr(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                                  </React.Fragment>
                                );
                              })}

                              {/* 模拟段虚线 */}
                              {!!oilHistorySimul && series.map(s => {
                                const ls = simulLineStr(s.key);
                                if (!ls) return null;
                                return <Polyline key={`csl_${s.key}`} points={ls} fill="none" stroke={s.color} strokeWidth={1.4} strokeDasharray="4,3" strokeLinecap="round" opacity={0.6} />;
                              })}

                              {/* 数据点 */}
                              {series.map(s => displayHistory.slice(0, nReal).map((h, i) => {
                                const v = parseFloat(h[s.key]);
                                if (isNaN(v)) return null;
                                const isLast = i === nReal - 1;
                                return <Circle key={`${s.key}_${i}`} cx={xOf(i)} cy={yOf(v)} r={isLast ? 3.5 : 2} fill={isLast ? s.color : `${s.color}88`} stroke={isLast ? 'rgba(0,0,0,0.5)' : 'none'} strokeWidth={isLast ? 1 : 0} />;
                              }))}

                              {/* 模拟点空心圆 */}
                              {!!oilHistorySimul && series.map(s => {
                                const v = parseFloat(displayHistory[n-1][s.key]);
                                if (isNaN(v)) return null;
                                return (
                                  <React.Fragment key={`csp_${s.key}`}>
                                    <Circle cx={xOf(n-1)} cy={yOf(v)} r={4} fill="rgba(0,0,0,0.6)" stroke={s.color} strokeWidth={1.5} opacity={0.7} />
                                    <Circle cx={xOf(n-1)} cy={yOf(v)} r={1.5} fill={s.color} opacity={0.6} />
                                  </React.Fragment>
                                );
                              })}

                              {/* 最新点价格标注 */}
                              {series.map(s => {
                                const v = parseFloat(lastReal[s.key]);
                                if (isNaN(v)) return null;
                                const cx = xOf(nReal - 1);
                                const cy = yOf(v);
                                const anchor = cx > chartW * 0.7 ? 'end' : cx < chartW * 0.3 ? 'start' : 'middle';
                                const dx = cx > chartW * 0.7 ? -6 : cx < chartW * 0.3 ? 6 : 0;
                                return <SvgText key={s.key} x={cx + dx} y={cy - 6} fontSize={8} fill={s.color} fontWeight="bold" textAnchor={anchor}>{v.toFixed(2)}</SvgText>;
                              })}

                              {/* 模拟点标注 */}
                              {!!oilHistorySimul && series.slice(0, 1).map(s => {
                                const v = parseFloat(displayHistory[n-1][s.key]);
                                if (isNaN(v)) return null;
                                return <SvgText key={`csl2_${s.key}`} x={xOf(n-1)} y={yOf(v) - 8} fontSize={8} fill="rgba(196,181,253,0.9)" fontWeight="bold" textAnchor="middle">🧪</SvgText>;
                              })}

                              {/* X轴标签 */}
                              {labelIdxs.map(i => {
                                const isSimulIdx = oilHistorySimul && i === n - 1;
                                return (
                                  <SvgText key={i} x={xOf(i)} y={chartH - 5} fontSize={7.5}
                                    fill={isSimulIdx ? 'rgba(196,181,253,0.55)' : 'rgba(255,255,255,0.32)'}
                                    textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                                    {displayHistory[i].update_date.slice(5)}{isSimulIdx ? '🧪' : ''}
                                  </SvgText>
                                );
                              })}
                            </Svg>
                          </View>
                        </Animated.View>
                      )}
                    </View>
                  );
                })()}

                {/* ── 折算系数管理（测算卡底部，管理员可展开编辑，所有人可见入口）── */}
                {isAdmin && (
                  <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(99,102,241,0.15)', paddingTop: 8, gap: 5 }}>
                    {/* 标题行：左侧标题 + 右侧「重置」+「展开/收起」 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>⚙️ 折算系数</Text>
                        {convRows.length > 0 && (
                          <View style={{ backgroundColor: 'rgba(99,102,241,0.15)', borderRadius: 4,
                            paddingHorizontal: 5, paddingVertical: 1, borderWidth: 0.5, borderColor: 'rgba(99,102,241,0.35)' }}>
                            <Text style={{ color: '#818CF8', fontSize: 8, fontWeight: '700' }}>{convRows.length} 省</Text>
                          </View>
                        )}
                        <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8 }}>升/吨 · 影响调幅测算</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {/* 展开/收起 */}
                        <Pressable
                          onPress={handleConvPanelToggle}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                            backgroundColor: convPanelOpen ? 'rgba(99,102,241,0.20)' : 'rgba(99,102,241,0.10)',
                            borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3,
                            borderWidth: 1, borderColor: convPanelOpen ? 'rgba(99,102,241,0.45)' : 'rgba(99,102,241,0.28)' }}
                        >
                          <Text style={{ color: '#818CF8', fontSize: 8.5, fontWeight: '700' }}>
                            {convPanelOpen ? '收起 ▲' : '展开 ▼'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* 展开内容 */}
                    {convPanelOpen && (
                      <View style={{ gap: 4 }}>
                        {convMsg ? (
                          <Text style={{ color: convMsg.startsWith('✅') ? '#34D399' : '#F87171',
                            fontSize: 9, fontWeight: '600' }}>{convMsg}</Text>
                        ) : null}
                        {convLoading ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 }}>
                            <ActivityIndicator size="small" color="#818CF8" style={{ transform: [{ scale: 0.6 }] }} />
                            <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 9 }}>加载中…</Text>
                          </View>
                        ) : (
                          <View style={{ gap: 3, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 8, padding: 6 }}>
                            <View style={{ flexDirection: 'row', gap: 2, paddingHorizontal: 3, paddingBottom: 3,
                              borderBottomWidth: 1, borderBottomColor: 'rgba(99,102,241,0.20)' }}>
                              <Text style={{ width: 52, color: 'rgba(255,255,255,0.35)', fontSize: 8 }}>省份</Text>
                              <Text style={{ flex: 1, color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>92#</Text>
                              <Text style={{ flex: 1, color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>95#</Text>
                              <Text style={{ flex: 1, color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>98#</Text>
                              <Text style={{ flex: 1, color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>0#柴</Text>
                              <View style={{ width: 28 }} />
                            </View>
                            {convRows.map(row => (
                              <View key={row.city}>
                                {convEditing === row.city ? (
                                  <View style={{ backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 6,
                                    padding: 6, gap: 5, borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)' }}>
                                    <Text style={{ color: '#818CF8', fontSize: 9, fontWeight: '700' }}>
                                      {'✏️ 编辑 ' + row.city}
                                    </Text>
                                    <View style={{ flexDirection: 'row', gap: 4 }}>
                                      {(() => {
                                        const cached = savedCoeffsRef.current.get(row.city);
                                        const ph = (dbVal: number | null, cVal: number | undefined) =>
                                          dbVal != null ? String(dbVal) : cVal != null ? String(cVal) : '请输入';
                                        return [
                                          ['92#',  convEdit92, (v: string) => { convEdit92Ref.current = v; setConvEdit92(v); }, ph(row.conv_coeff_92, cached?.c92)],
                                          ['95#',  convEdit95, (v: string) => { convEdit95Ref.current = v; setConvEdit95(v); }, ph(row.conv_coeff_95, cached?.c95)],
                                          ['98#',  convEdit98, (v: string) => { convEdit98Ref.current = v; setConvEdit98(v); }, ph(row.conv_coeff_98, cached?.c98)],
                                          ['0#柴', convEdit0,  (v: string) => { convEdit0Ref.current  = v; setConvEdit0(v);  }, ph(row.conv_coeff_0,  cached?.c0)],
                                        ];
                                      })().map(
                                        ([label, val, setter, ph]) => (
                                          <View key={label as string} style={{ flex: 1, gap: 2 }}>
                                            <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 7 }}>{label as string}</Text>
                                            <View style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 5,
                                              paddingHorizontal: 5, borderWidth: 1, borderColor: 'rgba(99,102,241,0.30)' }}>
                                              <TextInput value={val as string} onChangeText={setter as (v: string) => void}
                                                keyboardType="decimal-pad" placeholder={ph as string}
                                                placeholderTextColor="rgba(255,255,255,0.20)"
                                                style={{ color: '#818CF8', fontSize: 11, fontWeight: '700', paddingVertical: 4 }} />
                                            </View>
                                          </View>
                                        )
                                      )}
                                    </View>
                                    <View style={{ flexDirection: 'row', gap: 5 }}>
                                      <Pressable onPress={handleSaveConvCoeff} disabled={convSaving}
                                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
                                          backgroundColor: convSaving ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.22)',
                                          borderRadius: 5, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(99,102,241,0.40)' }}>
                                        {convSaving
                                          ? <ActivityIndicator size="small" color="#818CF8" style={{ transform: [{ scale: 0.5 }] }} />
                                          : <Text style={{ fontSize: 8 }}>💾</Text>}
                                        <Text style={{ color: '#818CF8', fontSize: 9, fontWeight: '800' }}>保存</Text>
                                      </Pressable>
                                      <Pressable onPress={() => { convEditingRef.current = null; setConvEditing(null); setConvMsg(''); }}
                                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                                          backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 5, paddingVertical: 5,
                                          borderWidth: 1, borderColor: 'rgba(148,163,184,0.20)' }}>
                                        <Text style={{ color: '#94A3B8', fontSize: 9, fontWeight: '700' }}>取消</Text>
                                      </Pressable>
                                    </View>
                                  </View>
                                ) : (
                                  <Pressable onPress={() => startEditConv(row)}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 2,
                                      paddingVertical: 3, paddingHorizontal: 3, borderRadius: 4,
                                      backgroundColor: 'rgba(255,255,255,0.025)' }}>
                                    <Text style={{ width: 52, color: 'rgba(255,255,255,0.70)', fontSize: 8.5, fontWeight: '600' }} numberOfLines={1}>{row.city}</Text>
                                    <Text style={{ flex: 1, color: row.conv_coeff_92 ? '#818CF8' : 'rgba(255,255,255,0.20)', fontSize: 8.5, textAlign: 'center', fontWeight: row.conv_coeff_92 ? '700' : '400' }}>
                                      {row.conv_coeff_92 != null ? String(row.conv_coeff_92) : '—'}
                                    </Text>
                                    <Text style={{ flex: 1, color: row.conv_coeff_95 ? '#818CF8' : 'rgba(255,255,255,0.20)', fontSize: 8.5, textAlign: 'center', fontWeight: row.conv_coeff_95 ? '700' : '400' }}>
                                      {row.conv_coeff_95 != null ? String(row.conv_coeff_95) : '—'}
                                    </Text>
                                    <Text style={{ flex: 1, color: row.conv_coeff_98 ? '#818CF8' : 'rgba(255,255,255,0.20)', fontSize: 8.5, textAlign: 'center', fontWeight: row.conv_coeff_98 ? '700' : '400' }}>
                                      {row.conv_coeff_98 != null ? String(row.conv_coeff_98) : '—'}
                                    </Text>
                                    <Text style={{ flex: 1, color: row.conv_coeff_0 ? '#818CF8' : 'rgba(255,255,255,0.20)', fontSize: 8.5, textAlign: 'center', fontWeight: row.conv_coeff_0 ? '700' : '400' }}>
                                      {row.conv_coeff_0 != null ? String(row.conv_coeff_0) : '—'}
                                    </Text>
                                    <Text style={{ width: 28, color: 'rgba(99,102,241,0.55)', fontSize: 8, textAlign: 'right' }}>✏️</Text>
                                  </Pressable>
                                )}
                              </View>
                            ))}
                            <Text style={{ color: 'rgba(255,255,255,0.18)', fontSize: 7.5, marginTop: 2 }}>
                              点击省份行编辑（升/吨），EF 计算优先使用 DB 精确值
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* ── 原油刷新结果提示 ── */}
                {!!crudeForceResult && (
                  <Text style={{ color: crudeForceResult.startsWith('✅') ? '#6EE7B7' : '#FCA5A5',
                    fontSize: 10, textAlign: 'center', fontWeight: '700' }}>
                    {crudeForceResult}
                  </Text>
                )}
                </>)}

              </LinearGradient>
            </Animated.View>
          );
        })()}

        <GradDivider
          colors={oilPrice
            ? ['rgba(96,165,250,0.4)', 'rgba(251,191,36,0.5)', 'rgba(96,165,250,0.4)']
            : ['transparent', 'rgba(96,165,250,0.5)', 'transparent']}
          marginBottom={3}
        />

        {/* ── 上期均价编辑 Modal（管理员专用）── */}
        <Modal
          visible={avgEditModal !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setAvgEditModal(null)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}
            onPress={() => setAvgEditModal(null)}
          >
            <Pressable onPress={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 360, borderRadius: 18, overflow: 'hidden',
                borderWidth: 1, borderColor: 'rgba(148,163,184,0.35)' }}
            >
              <LinearGradient
                colors={['#0d1117','#161d27','#0d1117']}
                style={{ padding: 20, gap: 14 }}
              >
                {/* ── basket（一揽子均价）分支 ── */}
                {avgEditModal === 'basket' && (<>
                  {/* 标题行 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Pressable onPress={() => setAvgEditModal(null)}
                      style={{ width: 28, height: 28, borderRadius: 14,
                        backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.50)', fontSize: 14 }}>×</Text>
                    </Pressable>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
                      backgroundColor: 'rgba(251,146,60,0.10)',
                      borderRadius: 10, padding: 10,
                      borderWidth: 1, borderColor: 'rgba(251,146,60,0.28)' }}>
                      <Text style={{ fontSize: 18 }}>🛢️</Text>
                      <View style={{ gap: 1 }}>
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>修正一揽子均价</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 10 }}>本期计价周期三品种加权均值（4:3:3）</Text>
                      </View>
                    </View>
                  </View>

                  {/* 当前值展示 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
                    borderRadius: 10, padding: 10,
                    borderWidth: 1, borderColor: 'rgba(251,146,60,0.18)' }}>
                    <View style={{ width: 4, height: 36, borderRadius: 2, backgroundColor: '#FB923C' }} />
                    <View style={{ gap: 2 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>当前一揽子均价</Text>
                      <Text style={{ color: '#FB923C', fontSize: 20, fontWeight: '900' }}>
                        {(oilPrice?.crudeBasketAvg ?? 0) > 0 ? `$${oilPrice!.crudeBasketAvg!.toFixed(2)}` : '暂无'}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>
                        {oilPrice?.crudeAvg10dLocked ? '🔒 已手动锁定（持久化，刷新不变）' : '🔄 EIA自动计算（可被EF刷新覆盖）'}
                      </Text>
                    </View>
                  </View>

                  {/* 输入区 */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700' }}>输入修正均价（$/桶）</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center',
                      backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 12, paddingHorizontal: 14,
                      borderWidth: 1.5, borderColor: 'rgba(251,146,60,0.35)' }}>
                      <Text style={{ color: 'rgba(251,146,60,0.60)', fontSize: 16, fontWeight: '800', marginRight: 4 }}>$</Text>
                      <TextInput
                        value={basketInput}
                        onChangeText={setBasketInput}
                        keyboardType="decimal-pad"
                        placeholder="如 88.52"
                        placeholderTextColor="rgba(255,255,255,0.20)"
                        style={{ flex: 1, color: '#fff', fontSize: 20, fontWeight: '800', paddingVertical: 12 }}
                      />
                    </View>
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>合理范围 30~200 $/桶，锁定后EF刷新不覆盖</Text>
                  </View>

                  {/* 消息提示 */}
                  {basketMsg ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                      backgroundColor: basketMsg.startsWith('✅') ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
                      borderRadius: 8, padding: 10,
                      borderWidth: 1, borderColor: basketMsg.startsWith('✅') ? 'rgba(52,211,153,0.30)' : 'rgba(248,113,113,0.30)' }}>
                      <Text style={{ color: basketMsg.startsWith('✅') ? '#34D399' : '#F87171',
                        fontSize: 12, fontWeight: '600', flex: 1 }}>
                        {basketMsg}
                      </Text>
                    </View>
                  ) : null}

                  {/* 操作按钮 */}
                  <View style={{ gap: 8 }}>
                    <Pressable
                      onPress={handleSaveBasketAvg}
                      disabled={basketLoading}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                        backgroundColor: basketLoading ? 'rgba(251,146,60,0.06)' : 'rgba(251,146,60,0.18)',
                        borderRadius: 12, paddingVertical: 13,
                        borderWidth: 1.5, borderColor: 'rgba(251,146,60,0.40)' }}
                    >
                      {basketLoading
                        ? <ActivityIndicator size="small" color="#FB923C" />
                        : <Text style={{ fontSize: 14 }}>🔒</Text>}
                      <Text style={{ color: '#FB923C', fontSize: 14, fontWeight: '800' }}>
                        {basketLoading ? '保存中…' : '锁定一揽子均价'}
                      </Text>
                    </Pressable>
                    {oilPrice?.crudeAvg10dLocked && (
                      <Pressable
                        onPress={handleUnlockBasketAvg}
                        disabled={basketLoading}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                          backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 12, paddingVertical: 11,
                          borderWidth: 1, borderColor: 'rgba(148,163,184,0.25)' }}
                      >
                        <Text style={{ fontSize: 13 }}>🔓</Text>
                        <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '700' }}>解除锁定，恢复自动获取</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => setAvgEditModal(null)} style={{ alignItems: 'center', paddingVertical: 8 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 12 }}>取消</Text>
                    </Pressable>
                  </View>
                </>)}

                {/* ── prev（上期均价）分支 ── */}
                {avgEditModal === 'prev' && (<>
                  {/* 标题行 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Pressable onPress={() => setAvgEditModal(null)}
                      style={{ width: 28, height: 28, borderRadius: 14,
                        backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.50)', fontSize: 14 }}>×</Text>
                    </Pressable>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
                      backgroundColor: 'rgba(148,163,184,0.12)',
                      borderRadius: 10, padding: 10,
                      borderWidth: 1, borderColor: 'rgba(148,163,184,0.30)' }}>
                      <Text style={{ fontSize: 18 }}>📌</Text>
                      <View style={{ gap: 1 }}>
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>修改上期均价</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.40)', fontSize: 10 }}>上次计价周期发改委基准均值</Text>
                      </View>
                    </View>
                  </View>

                  {/* 当前值展示 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
                    borderRadius: 10, padding: 10,
                    borderWidth: 1, borderColor: 'rgba(148,163,184,0.15)' }}>
                    <View style={{ width: 4, height: 36, borderRadius: 2, backgroundColor: '#94A3B8' }} />
                    <View style={{ gap: 2 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>当前上期均价（发改委基准）</Text>
                      <Text style={{ color: '#94A3B8', fontSize: 20, fontWeight: '900' }}>
                        {(oilPrice?.crudeLastCycleAvg ?? 0) > 0 ? `$${oilPrice!.crudeLastCycleAvg!.toFixed(2)}` : '暂无'}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>
                        {oilPrice?.crudeLastCycleAvgLocked ? '🔒 已手动锁定（持久化，刷新不变）' : '🔄 变价后由一揽子均价自动转入'}
                      </Text>
                    </View>
                  </View>

                  {/* 输入区 */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700' }}>输入上期均价（$/桶）</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center',
                      backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 12, paddingHorizontal: 14,
                      borderWidth: 1.5, borderColor: 'rgba(148,163,184,0.35)' }}>
                      <Text style={{ color: 'rgba(148,163,184,0.60)', fontSize: 16, fontWeight: '800', marginRight: 4 }}>$</Text>
                      <TextInput
                        value={lastCycleInput}
                        onChangeText={setLastCycleInput}
                        keyboardType="decimal-pad"
                        placeholder="如 68.30"
                        placeholderTextColor="rgba(255,255,255,0.20)"
                        style={{ flex: 1, color: '#fff', fontSize: 20, fontWeight: '800', paddingVertical: 12 }}
                      />
                    </View>
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>合理范围 30~200 $/桶，所有设备实时同步</Text>
                  </View>

                  {/* 消息提示 */}
                  {lastCycleMsg ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                      backgroundColor: lastCycleMsg.startsWith('✅') ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
                      borderRadius: 8, padding: 10,
                      borderWidth: 1, borderColor: lastCycleMsg.startsWith('✅') ? 'rgba(52,211,153,0.30)' : 'rgba(248,113,113,0.30)' }}>
                      <Text style={{ color: lastCycleMsg.startsWith('✅') ? '#34D399' : '#F87171',
                        fontSize: 12, fontWeight: '600', flex: 1 }}>
                        {lastCycleMsg}
                      </Text>
                    </View>
                  ) : null}

                  {/* 操作按钮 */}
                  <View style={{ gap: 8 }}>
                    {(
                      <Pressable
                        onPress={handleSaveLastCycleAvg}
                        disabled={lastCycleLoading}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                          backgroundColor: lastCycleLoading ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.18)',
                          borderRadius: 12, paddingVertical: 13,
                          borderWidth: 1.5, borderColor: 'rgba(148,163,184,0.40)' }}
                      >
                        {lastCycleLoading
                          ? <ActivityIndicator size="small" color="#CBD5E1" />
                          : <Text style={{ fontSize: 14 }}>🔒</Text>}
                        <Text style={{ color: '#CBD5E1', fontSize: 14, fontWeight: '800' }}>
                          {lastCycleLoading ? '保存中…' : '锁定上期均价'}
                        </Text>
                      </Pressable>
                    )}
                    {oilPrice?.crudeLastCycleAvgLocked && (
                      <Pressable
                        onPress={handleUnlockLastCycleAvg}
                        disabled={lastCycleLoading}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                          backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 12, paddingVertical: 11,
                          borderWidth: 1, borderColor: 'rgba(148,163,184,0.25)' }}
                      >
                        <Text style={{ fontSize: 13 }}>🔓</Text>
                        <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '700' }}>解除锁定，恢复自动获取</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => setAvgEditModal(null)} style={{ alignItems: 'center', paddingVertical: 8 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 12 }}>取消</Text>
                    </Pressable>
                  </View>
                </>)}
              </LinearGradient>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── 油价字幕条+调价胶囊已整合到底部聊天悬浮卡 ── */}

        {/* 调价胶囊 → 统计卡 分割线：紫→蓝渐变 */}
        <GradDivider colors={['transparent', 'rgba(167,139,250,0.5)', 'transparent']} marginBottom={3} />

        {/* ── 统计卡片 ── */}
        <Animated.View entering={FadeInDown.delay(160).duration(250)} style={{ marginBottom: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
          {/* 渐变标题栏 */}
          <LinearGradient
            colors={['rgba(255,255,255,0.11)', 'rgba(255,255,255,0.03)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 7 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.75)' }} />
              <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 }}>车辆统计</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.32)', fontSize: 10, fontWeight: '600' }}>实时在册</Text>
          </LinearGradient>
          {/* 四格数据区 */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 8, paddingTop: 4, gap: 5 }}>
            {[
              { icon: <Flame size={14} color="#FF8060" />, label: '汽油', value: counts.gasoline, accent: '#FF5630', gradColors: ['rgba(255,86,48,0.22)', 'rgba(255,86,48,0.06)'] as const },
              { icon: <Droplets size={14} color="#4ade80" />, label: '柴油', value: counts.diesel, accent: '#16A34A', gradColors: ['rgba(22,163,74,0.22)', 'rgba(22,163,74,0.06)'] as const },
              { icon: <Wind size={14} color="#38bdf8" />, label: 'LNG', value: counts.lng, accent: '#0EA5E9', gradColors: ['rgba(14,165,233,0.22)', 'rgba(14,165,233,0.06)'] as const },
              { icon: <Car size={14} color="rgba(255,255,255,0.85)" />, label: '合计', value: counts.gasoline + counts.diesel + counts.lng, accent: 'rgba(255,255,255,0.7)', gradColors: ['rgba(255,255,255,0.13)', 'rgba(255,255,255,0.04)'] as const },
            ].map(({ icon, label, value, accent, gradColors }, idx) => (
              <Animated.View
                key={label}
                entering={FadeInDown.delay(40 + idx * 30).duration(200)}
                style={{ flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: `${accent}35` }}
              >
                <LinearGradient
                  colors={gradColors}
                  start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                  style={{ alignItems: 'center', paddingVertical: 10, gap: 4 }}
                >
                  {/* 图标圆 */}
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: `${accent}22`, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${accent}40` }}>
                    {icon}
                  </View>
                  {/* 数字 — 加大加粗 */}
                  <AnimatedNumber value={value} style={{ color: '#fff', fontSize: 22, fontWeight: '900', lineHeight: 26, letterSpacing: -0.5 }} />
                  {/* 标签 */}
                  <Text style={{ color: accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>{label}</Text>
                </LinearGradient>
              </Animated.View>
            ))}
          </View>
        </Animated.View>

        {/* 统计卡 → 用户行 分割线：白色光线 */}
        <GradDivider colors={['transparent', 'rgba(255,255,255,0.35)', 'transparent']} marginBottom={3} />

        {/* ── 用户信息卡：两行布局，避免徽章被按钮挤压 ── */}
        <Animated.View entering={FadeInUp.delay(40).duration(260)}
          style={{ marginBottom: 4,
            backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 20,
            paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', gap: 12 }}>

          {/* 第一行：头像 + 姓名 + 徽章 — 独占全宽，徽章不被按钮压缩 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {/* 头像圆 */}
            <View style={{ width: 52, height: 52, borderRadius: 26,
              borderWidth: 2, borderColor: 'rgba(255,255,255,0.28)',
              padding: 2, flexShrink: 0,
              backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <View style={{ flex: 1, borderRadius: 24, overflow: 'hidden' }}>
                {profile?.avatar_url ? (
                  <ExpoImage
                    source={{ uri: profile.avatar_url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 21, fontWeight: '900' }}>
                      {(profile?.real_name ?? '车').slice(0, 1)}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* 姓名 + 徽章（纵向，flex:1 撑满剩余宽度） */}
            <View style={{ flex: 1, gap: 7 }}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 }} numberOfLines={1}>
                {profile?.real_name ?? '车辆信息系统'}
              </Text>
              {/* 权限徽章 — 独立一行，横向充分展开 */}
              {isPermanentAdmin ? (
                <LinearGradient colors={['#92400E', '#D97706', '#F59E0B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' }}>
                  <ShieldCheck size={13} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 }}>系统管理员</Text>
                </LinearGradient>
              ) : isAssistant ? (
                <LinearGradient colors={['#164E63', '#0E7490', '#06B6D4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' }}>
                  <ShieldHalf size={13} color="#CFFAFE" />
                  <Text style={{ color: '#CFFAFE', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 }}>管理员助理</Text>
                </LinearGradient>
              ) : isAdmin ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                  <LinearGradient colors={['#4C1D95', '#7C3AED', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10,
                      paddingHorizontal: 12, paddingVertical: 5 }}>
                    <ShieldHalf size={13} color="#E9D5FF" />
                    <Text style={{ color: '#E9D5FF', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 }}>临时管理员</Text>
                  </LinearGradient>
                  {tempRemaining ? (
                    <Text style={{ color: '#A78BFA', fontSize: 11, fontWeight: '700' }}>⏱ {tempRemaining}</Text>
                  ) : null}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 5,
                  backgroundColor: 'rgba(148,163,184,0.15)', borderWidth: 1,
                  borderColor: 'rgba(148,163,184,0.22)', alignSelf: 'flex-start' }}>
                  <User size={13} color="#94A3B8" />
                  <Text style={{ color: '#94A3B8', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>普通员工</Text>
                </View>
              )}
            </View>
          </View>

          {/* 细分割线 */}
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: 2 }} />

          {/* 第二行：三功能按钮等宽排列 */}
          <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 10 }}>

            {/* ── 消息 ── */}
            <Pressable
              onPress={() => router.push('/(app)/chat' as never)}
              android_ripple={{ color: 'rgba(96,165,250,0.2)', borderless: false }}
              className="active:opacity-80"
              style={{ flex: 1 }}
            >
              <LinearGradient
                colors={(unreadDm + unreadChat) > 0
                  ? ['rgba(59,130,246,0.35)', 'rgba(37,99,235,0.20)']
                  : ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.04)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
                  paddingVertical: 14, borderRadius: 16,
                  borderWidth: 1,
                  borderColor: (unreadDm + unreadChat) > 0 ? 'rgba(96,165,250,0.45)' : 'rgba(255,255,255,0.10)' }}
              >
                <View style={{ position: 'relative' }}>
                  <MessageCircle
                    size={20}
                    color={(unreadDm + unreadChat) > 0 ? '#60A5FA' : 'rgba(255,255,255,0.45)'}
                  />
                  {(unreadDm + unreadChat) > 0 && (
                    <View style={{
                      position: 'absolute', top: -5, right: -6,
                      minWidth: 15, height: 15, borderRadius: 8,
                      backgroundColor: '#EF4444',
                      alignItems: 'center', justifyContent: 'center',
                      paddingHorizontal: 2,
                      borderWidth: 1.5, borderColor: 'rgba(15,23,42,0.9)',
                    }}>
                      <Text style={{ color: '#fff', fontSize: 7, fontWeight: '900', lineHeight: 11 }}>
                        {(unreadDm + unreadChat) > 99 ? '99+' : String(unreadDm + unreadChat)}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={{
                  color: (unreadDm + unreadChat) > 0 ? '#93C5FD' : 'rgba(255,255,255,0.45)',
                  fontSize: 11, fontWeight: '800', letterSpacing: 0.5,
                }}>
                  消息
                </Text>
              </LinearGradient>
            </Pressable>

            {/* ── 退出登录 ── */}
            <Pressable
              onPress={async () => { await signOut(); router.replace('/'); }}
              android_ripple={{ color: 'rgba(239,68,68,0.2)', borderless: false }}
              className="active:opacity-80"
              style={{ flex: 1 }}
            >
              <LinearGradient
                colors={['rgba(239,68,68,0.25)', 'rgba(185,28,28,0.14)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
                  paddingVertical: 14, borderRadius: 16,
                  borderWidth: 1, borderColor: 'rgba(239,68,68,0.38)' }}
              >
                <LogOut size={20} color="#FCA5A5" />
                <Text style={{ color: '#FECACA', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>
                  退出登录
                </Text>
              </LinearGradient>
            </Pressable>

          </View>

        </Animated.View>

        {/* ── 管理员功能区（环形圆形图标） ── */}
        {isAdmin && (
          <Animated.View entering={FadeInUp.delay(80).duration(260)} style={{ alignItems: 'center' }}>

            {/* 超级管理员：左3 + 中心(员工管理) + 右3 胶囊布局 */}
            {isPermanentAdmin && (
              <PianoKeyboard
                centerIndex={3}
                keys={[
                  {
                    label: '新增车辆',
                    icon: <Plus size={20} color="#fff" />,
                    color: '#34D399',
                    bgTop: 'rgba(16,185,129,0.22)',
                    bgBottom: 'rgba(16,185,129,0.10)',
                    heightRatio: 0.95,
                    onPress: () => router.push({ pathname: '/(app)/vehicle-form', params: { mode: 'add' } }),
                  },
                  {
                    label: '信息修改',
                    icon: <ArrowRightLeft size={20} color="#fff" />,
                    color: '#A78BFA',
                    bgTop: 'rgba(139,92,246,0.22)',
                    bgBottom: 'rgba(139,92,246,0.10)',
                    heightRatio: 1.05,
                    onPress: () => router.push('/(app)/vehicle-transfer' as never),
                  },
                  {
                    label: '删除车辆',
                    icon: <Trash2 size={20} color="#fff" />,
                    color: '#F87171',
                    bgTop: 'rgba(239,68,68,0.22)',
                    bgBottom: 'rgba(239,68,68,0.10)',
                    heightRatio: 0.88,
                    onPress: () => router.push('/(app)/vehicle-delete' as never),
                  },
                  {
                    label: '员工管理',
                    icon: <Users size={20} color="#fff" />,
                    color: '#818CF8',
                    bgTop: 'rgba(99,102,241,0.20)',
                    bgBottom: 'rgba(99,102,241,0.08)',
                    heightRatio: 1.12,
                    onPress: () => router.push('/(app)/employee-manage' as never),
                  },
                  {
                    label: '导入更新',
                    icon: <FileUp size={20} color="#fff" />,
                    color: '#6EE7B7',
                    bgTop: 'rgba(52,211,153,0.20)',
                    bgBottom: 'rgba(52,211,153,0.08)',
                    heightRatio: 0.92,
                    onPress: () => router.push('/(app)/import-excel' as never),
                  },
                  {
                    label: '数据备份',
                    icon: <HardDriveDownload size={20} color="#fff" />,
                    color: '#60A5FA',
                    bgTop: 'rgba(59,130,246,0.20)',
                    bgBottom: 'rgba(59,130,246,0.08)',
                    heightRatio: 1.0,
                    onPress: () => router.push('/(app)/backup-restore' as never),
                  },
                  {
                    label: '操作记录',
                    icon: <ClipboardList size={20} color="#fff" />,
                    color: '#FBBF24',
                    bgTop: 'rgba(245,158,11,0.20)',
                    bgBottom: 'rgba(245,158,11,0.08)',
                    heightRatio: 0.85,
                    onPress: () => router.push('/(app)/audit-log' as never),
                  },
                  {
                    label: '版本管理',
                    icon: <Hammer size={20} color="#fff" />,
                    color: '#FBBF24',
                    bgTop: 'rgba(251,191,36,0.22)',
                    bgBottom: 'rgba(251,191,36,0.10)',
                    heightRatio: 0.88,
                    onPress: () => router.push('/(app)/version-hub' as never),
                  },
                ] satisfies PianoKey[]}
              />
            )}

            {/* 普通管理员（非超级）：3 键琴键 */}
            {!isPermanentAdmin && (
              <PianoKeyboard
                keys={[
                  {
                    label: '新增车辆',
                    icon: <Plus size={20} color="#fff" />,
                    color: '#34D399',
                    bgTop: 'rgba(16,185,129,0.22)',
                    bgBottom: 'rgba(16,185,129,0.10)',
                    heightRatio: 1.0,
                    onPress: () => router.push({ pathname: '/(app)/vehicle-form', params: { mode: 'add' } }),
                  },
                  {
                    label: '信息修改',
                    icon: <ArrowRightLeft size={20} color="#fff" />,
                    color: '#A78BFA',
                    bgTop: 'rgba(139,92,246,0.22)',
                    bgBottom: 'rgba(139,92,246,0.10)',
                    heightRatio: 1.12,
                    onPress: () => router.push('/(app)/vehicle-transfer' as never),
                  },
                  {
                    label: '删除车辆',
                    icon: <Trash2 size={20} color="#fff" />,
                    color: '#F87171',
                    bgTop: 'rgba(239,68,68,0.22)',
                    bgBottom: 'rgba(239,68,68,0.10)',
                    heightRatio: 0.90,
                    onPress: () => router.push('/(app)/vehicle-delete' as never),
                  },
                ] satisfies PianoKey[]}
              />
            )}

            {/* 助理：临时授权（单键） */}
            {isAssistant && (
              <PianoKeyboard
                keys={[
                  {
                    label: '临时授权',
                    icon: <Clock size={22} color="#fff" />,
                    color: '#A78BFA',
                    bgTop: 'rgba(139,92,246,0.22)',
                    bgBottom: 'rgba(139,92,246,0.10)',
                    onPress: () => router.push('/(app)/temp-auth' as never),
                  },
                ] satisfies PianoKey[]}
              />
            )}

          </Animated.View>
        )}

        </ScrollView>
      </LinearGradient>



      {/* ── 天气详情弹窗 ── */}
      {/* ── 天气特效预览选择器（长按天气卡触发）── */}
      <Modal visible={fxPickerVisible} transparent animationType="fade" onRequestClose={() => setFxPickerVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}
          onPress={() => setFxPickerVisible(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: '#0B1120', borderTopLeftRadius: 24, borderTopRightRadius: 24,
              borderTopWidth: 1, borderColor: 'rgba(167,139,250,0.3)', paddingBottom: 36 }}>
              {/* 标题 */}
              <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 6 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: 12 }} />
                <Text style={{ color: '#C084FC', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 }}>天气特效预览</Text>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 4 }}>长按天气卡切换 · 单击卡片看详情</Text>
              </View>
              {/* 特效选项网格 */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginTop: 8 }}>
                {([
                  { kind: null,        emoji: '🔄', label: '跟随天气',  desc: `当前：${weatherData?.weather ?? '多云'}` },
                  { kind: 'sunny',     emoji: '☀️',  label: '晴天',    desc: '无粒子特效' },
                  { kind: 'cloudy',    emoji: '⛅',  label: '多云',    desc: '无粒子特效' },
                  { kind: 'rainy',     emoji: '🌧',  label: '雨天',    desc: '55粒雨滴' },
                  { kind: 'thundery',  emoji: '⛈',  label: '雷雨',    desc: '雨滴+闪电' },
                  { kind: 'snowy',     emoji: '❄️',  label: '雪天',    desc: '30片雪花' },
                  { kind: 'foggy',     emoji: '🌫',  label: '大雾',    desc: '8条雾气带' },
                  { kind: 'windy',     emoji: '💨',  label: '大风',    desc: '18条风线' },
                ] as Array<{ kind: WeatherKind | null; emoji: string; label: string; desc: string }>).map(({ kind, emoji, label, desc }) => {
                  const isActive = fxPreview === kind;
                  return (
                    <Pressable key={label}
                      onPress={() => {
                        setFxPreview(kind);
                        setFxPickerVisible(false);
                      }}
                      style={{ width: '22%', alignItems: 'center', gap: 4,
                        backgroundColor: isActive ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)',
                        borderRadius: 14, paddingVertical: 10,
                        borderWidth: 1.5, borderColor: isActive ? 'rgba(167,139,250,0.7)' : 'rgba(255,255,255,0.08)' }}>
                      <Text style={{ fontSize: 22 }}>{emoji}</Text>
                      <Text style={{ color: isActive ? '#C084FC' : '#fff', fontSize: 11, fontWeight: '700' }}>{label}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 8, textAlign: 'center' }}>{desc}</Text>
                      {isActive && (
                        <View style={{ position: 'absolute', top: 5, right: 5, width: 7, height: 7,
                          borderRadius: 3.5, backgroundColor: '#C084FC' }} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {/* 提示 */}
              {fxPreview && (
                <Pressable onPress={() => { setFxPreview(null); setFxPickerVisible(false); }}
                  style={{ margin: 16, paddingVertical: 10, borderRadius: 12,
                    backgroundColor: 'rgba(167,139,250,0.12)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)',
                    alignItems: 'center' }}>
                  <Text style={{ color: '#C084FC', fontSize: 12, fontWeight: '700' }}>退出预览模式，恢复真实天气</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <WeatherDetailModal
        visible={weatherDetailVisible}
        onClose={() => setWeatherDetailVisible(false)}
        weatherData={weatherData}
        cityKey={weatherCity}
      />

      {/* ── 查询结果弹窗 Modal（对话框样式，半屏底部弹出） ── */}
      <Modal
        visible={resultModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setResultModalVisible(false)}
      >
        {/* 半透明遮罩 */}
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
          onPress={() => setResultModalVisible(false)}
        >
          {/* 对话框主体（阻止点击穿透） */}
          <Pressable
            style={{ backgroundColor: '#0F172A', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', overflow: 'hidden',
              shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: -4 } }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* 顶部拖拽指示条 */}
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' }} />
            </View>

            {/* 标题栏 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(59,130,246,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                  <Car size={17} color="#60A5FA" />
                </View>
                <View>
                  <Text style={{ color: '#F8FAFC', fontSize: 15, fontWeight: '800' }}>查询结果</Text>
                  {query.length > 0 && (
                    <Text style={{ color: '#94A3B8', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>{query.toUpperCase()}</Text>
                  )}
                </View>
              </View>
              <Pressable
                onPress={() => setResultModalVisible(false)}
                hitSlop={12}
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={16} color="#94A3B8" />
              </Pressable>
            </View>

            {/* 分隔线 */}
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginHorizontal: 18 }} />

            {/* 类型筛选 Tab */}
            {(() => {
              const gasCount  = results.filter((v) => v._type === 'gasoline').length;
              const dslCount  = results.filter((v) => v._type === 'diesel').length;
              const lngCount  = results.filter((v) => v._type === 'lng').length;
              const tabs: { key: 'all' | VehicleType; label: string; count: number; color: string }[] = [
                { key: 'all',      label: '全部', count: results.length, color: '#60A5FA' },
                { key: 'gasoline', label: '汽油', count: gasCount,        color: '#F97316' },
                { key: 'diesel',   label: '柴油', count: dslCount,        color: '#16A34A' },
                { key: 'lng',      label: 'LNG',  count: lngCount,        color: '#0EA5E9' },
              ];
              return (
                <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
                  {tabs.map(({ key, label, count, color }) => {
                    const active = typeFilter === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setTypeFilter(key)}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                          height: 34, borderRadius: 10,
                          backgroundColor: active ? `${color}22` : 'rgba(255,255,255,0.05)',
                          borderWidth: 1,
                          borderColor: active ? `${color}88` : 'rgba(255,255,255,0.1)',
                        }}
                      >
                        <Text style={{ color: active ? color : '#64748B', fontSize: 12, fontWeight: active ? '800' : '500' }}>{label}</Text>
                        {count > 0 && (
                          <View style={{ minWidth: 16, height: 16, borderRadius: 8, backgroundColor: active ? color : 'rgba(148,163,184,0.25)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                            <Text style={{ color: active ? '#fff' : '#94A3B8', fontSize: 9, fontWeight: '800' }}>{count}</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              );
            })()}

            {/* 结果列表 */}
            <FlatList
              data={typeFilter === 'all' ? results : results.filter((v) => v._type === typeFilter)}
              keyExtractor={(item) => `${item._type}-${item.id}`}
              contentContainerStyle={{ padding: 14, paddingBottom: 16 }}
              contentInsetAdjustmentBehavior="automatic"
              style={{ maxHeight: '100%' }}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={async () => {
                    if (!lastQueryRef.current) return;
                    setRefreshing(true);
                    await searchVehicles(lastQueryRef.current);
                    setRefreshing(false);
                  }}
                  colors={['#3B82F6']}
                  tintColor="#3B82F6"
                />
              }
              ListHeaderComponent={
                searched && !loading ? (
                  <View style={{ marginBottom: 10, gap: 8 }}>
                    {/* 限行提示条 */}
                    {restrictionLoading ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(148,163,184,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(148,163,184,0.15)' }}>
                        <ActivityIndicator size="small" color="#94A3B8" style={{ transform: [{ scale: 0.75 }] }} />
                        <Text style={{ color: '#94A3B8', fontSize: 12 }}>限行数据加载中…</Text>
                      </View>
                    ) : restriction && !restriction.noRestriction ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(249,115,22,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(249,115,22,0.25)' }}>
                        <AlertTriangle size={14} color="#F97316" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#FB923C', fontSize: 12, fontWeight: '700' }}>
                            今日限行尾号：
                            <Text style={{ fontSize: 14, fontWeight: '900', letterSpacing: 1 }}>{restriction.number}</Text>
                            {'  '}
                            <Text style={{ fontWeight: '500', fontSize: 11 }}>{restriction.cityname}</Text>
                          </Text>
                          {restriction.time.length > 0 && (
                            <Text style={{ color: '#FDBA74', fontSize: 11, marginTop: 1 }}>
                              限行时段：{restriction.time.join(' / ')}
                            </Text>
                          )}
                        </View>
                        {results.length > 0 && (() => {
                          const cnt = results.filter((v) => checkPlateRestricted(v.plate_number, restriction.number)).length;
                          return cnt > 0 ? (
                            <View style={{ backgroundColor: 'rgba(239,68,68,0.85)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{cnt} 辆受限</Text>
                            </View>
                          ) : (
                            <View style={{ backgroundColor: 'rgba(22,163,74,0.85)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>均不受限</Text>
                            </View>
                          );
                        })()}
                      </View>
                    ) : restriction?.noRestriction ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(22,163,74,0.25)' }}>
                        <Car size={14} color="#4ADE80" />
                        <Text style={{ color: '#86EFAC', fontSize: 12, fontWeight: '600' }}>今日{restriction.cityname}不限行，所有车辆均可正常出行</Text>
                      </View>
                    ) : null}
                    {/* 结果数量行 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
                      <View style={{ width: 3, height: 14, backgroundColor: '#3B82F6', borderRadius: 2 }} />
                      <Text style={{ color: '#CBD5E1', fontSize: 13, fontWeight: '600' }}>
                        {results.length > 0 ? `共找到 ${results.length} 辆匹配车辆` : '未找到该车牌号对应的车辆信息'}
                      </Text>
                    </View>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                loading ? (
                  <View style={{ paddingTop: 4 }}>
                    {[0,1,2,3,4].map((i) => <VehicleCardSkeleton key={i} />)}
                  </View>
                ) : searched ? (
                  <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: 10 }}>
                    <View style={{ width: 64, height: 64, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 32, alignItems: 'center', justifyContent: 'center' }}>
                      <Search size={28} color="rgba(239,68,68,0.6)" />
                    </View>
                    <Text style={{ color: '#94A3B8', fontSize: 15, fontWeight: '500', marginTop: 4 }}>未找到匹配的车辆</Text>
                    <Text style={{ color: '#64748B', fontSize: 13 }}>请检查车牌号后重新查询</Text>
                  </View>
                ) : null
              }
              renderItem={({ item, index }) => {
                const restricted: boolean | null =
                  restriction && !restriction.noRestriction
                    ? checkPlateRestricted(item.plate_number, restriction.number)
                    : null;
                return (
                  <Animated.View entering={FadeInDown.delay(index * 35).duration(220)}>
                    <VehicleCard item={item} restricted={restricted} onPress={() => { setResultModalVisible(false); goToDetail(item); }} />
                  </Animated.View>
                );
              }}
            />

            {/* 底部操作栏 */}
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' }}>
              <Pressable
                onPress={() => { setResultModalVisible(false); setSearchBallOpen(true); }}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  borderWidth: 1, borderColor: 'rgba(59,130,246,0.4)', borderRadius: 12, height: 44, backgroundColor: 'rgba(59,130,246,0.1)' }}
              >
                <Search size={15} color="#60A5FA" />
                <Text style={{ color: '#60A5FA', fontWeight: '700', fontSize: 14 }}>重新查询</Text>
              </Pressable>
              <Pressable
                onPress={() => setResultModalVisible(false)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: '#2563EB', borderRadius: 12, height: 44 }}
              >
                <X size={15} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>关闭</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 查询悬浮球（可拖拽）── */}
      <DraggableFloat
        initialRight={20}
        initialBottom={oilPrice ? ballBottomOil : ballBottomNoOil}
        floatWidth={52}
        floatHeight={52}
        onPositionChange={(x, y) => setSearchBallPos({ x, y })}
      >
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          {/* 主悬浮球 */}
          <Pressable
            onPress={() => setSearchBallOpen((v) => !v)}
            style={{
              width: 52, height: 52, borderRadius: 26,
              backgroundColor: searchBallOpen ? '#374151' : '#0052CC',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: searchBallOpen ? 'rgba(255,255,255,0.2)' : 'rgba(147,197,253,0.4)',
              shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
            }}
            android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}
          >
            {searchBallOpen ? <X size={22} color="#fff" /> : <Search size={22} color="#fff" />}
          </Pressable>
        </View>
      </DraggableFloat>

      {/* ── 查询展开面板（屏幕级绝对定位，始终在可视区域内）── */}
      {searchBallOpen && searchBallPos && (() => {
        const PANEL_WIDTH = 300;
        const PANEL_GAP = 10; // 面板与悬浮球的垂直间距
        const SCREEN_MARGIN = 12;
        // 面板水平位置：以球中心为基准，夹紧到屏幕左右边距内
        const ballCenterX = searchBallPos.x + 26;
        const rawLeft = ballCenterX - PANEL_WIDTH / 2;
        const panelLeft = Math.max(SCREEN_MARGIN, Math.min(rawLeft, screenWidth - PANEL_WIDTH - SCREEN_MARGIN));
        // 面板垂直位置：球上方展开（若空间不够则球下方）
        const panelAbove = searchBallPos.y - PANEL_GAP;
        const panelTop = panelAbove > 160 ? undefined : searchBallPos.y + 52 + PANEL_GAP;
        const panelBottom = panelAbove > 160 ? (screenHeight - searchBallPos.y + PANEL_GAP) : undefined;
        return (
          <View style={{ position: 'absolute', left: panelLeft, ...(panelTop !== undefined ? { top: panelTop } : { bottom: panelBottom }), width: PANEL_WIDTH, zIndex: 200 }}>
            <Animated.View entering={FadeInDown.duration(180)} style={{ gap: 8 }}>
              {/* 拍照识别按钮 */}
              <Pressable
                onPress={handleCamera}
                disabled={ocrLoading}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1D4ED8', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(147,197,253,0.4)',
                  shadowColor: '#1D4ED8', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
                android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
              >
                {ocrLoading ? <ActivityIndicator size="small" color="#fff" /> : <Camera size={16} color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{ocrLoading ? '识别中…' : '拍照识别'}</Text>
              </Pressable>
              {/* 手动输入查询 */}
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1.5, borderColor: '#C7D7F5',
                  shadowColor: '#1A3A8F', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
                  <TextInput
                    ref={searchInputRef}
                    style={{ flex: 1, color: '#1A2332', fontSize: 15, fontWeight: '600', paddingVertical: 3 }}
                    placeholder="输入车牌号…"
                    placeholderTextColor="#A8BFDC"
                    value={query}
                    onChangeText={setQuery}
                    autoCapitalize="characters"
                    returnKeyType="search"
                    onSubmitEditing={() => { searchVehicles(query); }}
                    autoFocus
                  />
                  {query.length > 0 && (
                    <Pressable onPress={handleClear} hitSlop={8} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#E2EAF8', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} color="#6B8BC3" />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => searchVehicles(query)}
                    disabled={loading}
                    style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#0052CC', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {loading ? <ActivityIndicator size="small" color="#fff" /> : <Search size={16} color="#fff" />}
                  </Pressable>
                </View>
                {!!error && (
                  <View style={{ marginTop: 6, backgroundColor: '#FFF1F2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#FECDD3' }}>
                    <Text style={{ color: '#DC2626', fontSize: 11 }}>{error}</Text>
                  </View>
                )}
              </View>
              {/* 近期搜索记录 */}
              {recentSearches.length > 0 && (
                <View style={{ backgroundColor: 'rgba(15,23,42,0.92)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 10, gap: 8 }}>
                  <Text style={{ color: 'rgba(148,163,184,0.7)', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 }}>近期查询</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {recentSearches.map((s) => (
                      <Pressable
                        key={s}
                        onPress={() => { setQuery(s); searchVehicles(s); }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)' }}
                      >
                        <Car size={10} color="#60A5FA" />
                        <Text style={{ color: '#93C5FD', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </Animated.View>
          </View>
        );
      })()}

      {/* 聊天悬浮入口：有油价时显示横条卡（调价胶囊+油价字幕+消息），无油价时退化为圆形按钮 */}
      {oilPrice ? (() => {
        // 调价窗口判断：今日 >= 调价日 且 当前数据仍是调价前的旧数据
        const todayLocal = new Date();
        const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}`;
        const nextAdj  = oilPrice.nextAdjustDate ?? '';
        const updateDt = oilPrice.updateDate ?? '';
        // 调价日24:00后（即次日0:00起）才开窗，与 triggerOilPriceBackgroundUpdate 逻辑一致
        const isWindowOpen = nextAdj && todayStr > nextAdj && updateDt < nextAdj;
        // 颜色主题（模拟模式优先：紫色主题；调价窗口：橙色；常态：蓝色）
        const isSimul     = oilPrice.isSimul ?? false;
        const cardBg      = isSimul ? '#1A0F2E' : isWindowOpen ? '#2A1208' : '#0E1E33';
        const cardBorder  = isSimul ? 'rgba(167,139,250,0.55)' : isWindowOpen ? 'rgba(251,146,60,0.50)' : 'rgba(96,165,250,0.30)';
        const dividerC    = isSimul ? 'rgba(167,139,250,0.20)' : isWindowOpen ? 'rgba(251,146,60,0.20)' : 'rgba(96,165,250,0.15)';
        const accentColor = isSimul ? '#A78BFA' : isWindowOpen ? '#FB923C' : '#60A5FA';
        const msgColor    = isSimul ? '#C4B5FD' : isWindowOpen ? '#FCA5A5' : '#93C5FD';
        const badgeBorder = cardBg;

        // 倒计时天数（今天=0，明天=1，已过=-N）
        const daysLeft = nextAdj
          ? Math.round((new Date(nextAdj).getTime() - new Date(todayStr).getTime()) / 86400000)
          : null;
        const daysLabel = daysLeft === null ? null
          : daysLeft > 0  ? `还剩 ${daysLeft} 天`
          : daysLeft === 0 ? '今日24:00调价'
          : null; // 已过期 → 不显示（窗口已开逻辑接管）
        const daysUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
        const daysBg     = daysUrgent ? 'rgba(249,115,22,0.18)' : 'rgba(251,191,36,0.13)';
        const daysBorder = daysUrgent ? 'rgba(249,115,22,0.40)' : 'rgba(251,191,36,0.30)';
        const daysTextC  = daysUrgent ? '#FDBA74' : 'rgba(251,191,36,0.85)';

        // 走势内容
        // 优先使用原油卡片同源计算（deltaPerLiter92 / rateByAvg），不受 AI nextTrend 影响
        const sc = sharedCrude;
        const useCrudeCalc = !!(sc && (sc.willTrigger || Math.abs(sc.rateByAvg) > 0));
        // nt 仅在原油数据不足时作兜底
        const nt = oilPrice.nextTrend ?? 0;
        const ntIsUp = useCrudeCalc ? sc!.isUp  : nt > 0;
        const ntIsDn = useCrudeCalc ? sc!.isDn  : nt < 0;
        const ntArrow = ntIsUp ? '▲' : ntIsDn ? '▼' : '—';
        // 更饱和的走势颜色
        const ntColor  = ntIsUp ? '#FCA070' : ntIsDn ? '#6EE7B7' : '#7DD3FC';
        const ntBg     = ntIsUp ? 'rgba(251,146,60,0.18)' : ntIsDn ? 'rgba(52,211,153,0.16)' : 'rgba(125,211,252,0.10)';
        const ntBorder = ntIsUp ? 'rgba(251,146,60,0.42)' : ntIsDn ? 'rgba(52,211,153,0.38)' : 'rgba(125,211,252,0.24)';
        // 走势标签：有原油计算数据时直接用 deltaPerLiter92，否则降级到 nextTrendText/nextTrend
        const ntLabel = (() => {
          if (useCrudeCalc && sc) {
            const d = sc.deltaPerLiter92;
            if (Math.abs(d) >= 0.005) {
              return `${d > 0 ? '+' : ''}${d.toFixed(2)}元/升`;
            }
            return '持平';
          }
          // 降级：读 AI/EF 写入的 nextTrendText / nextTrend
          const txt = oilPrice.nextTrendText ?? '';
          if (txt) {
            const rangeM = txt.match(/([\d.]+)[~～]([\d.]+)\s*元\/升/);
            if (rangeM) {
              const lo = rangeM[1], hi = rangeM[2];
              return nt > 0 ? `+${lo}~+${hi}元/升` : nt < 0 ? `-${lo}~-${hi}元/升` : `${lo}~${hi}元/升`;
            }
            if (/持平/.test(txt)) return '持平';
            const numM = txt.match(/([+\-＋－]?[\d.]+)\s*元\/升/);
            if (numM) return numM[0];
          }
          if (Math.abs(nt) >= 0.01) return `${nt > 0 ? '+' : ''}${nt.toFixed(2)}元/升`;
          return '待预测';
        })();

        // 今天调价 — 脉冲光晕
        const isTodayAdjust = daysLeft === 0 && !isWindowOpen;

        return (
          <>
          {/* ── 今天调价脉冲光晕（叠在底部卡外层，向上扩散）── */}
          {isTodayAdjust && <PulseGlow />}

          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setBottomBarH(h);
            }}
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 99,
              backgroundColor: cardBg,
              borderTopLeftRadius: 18, borderTopRightRadius: 18,
              borderWidth: 1, borderBottomWidth: 0, borderColor: cardBorder,
              overflow: 'hidden',
              paddingBottom: safeBottom,
              shadowColor: isSimul ? '#7C3AED' : isWindowOpen ? '#F97316' : '#3B82F6',
              shadowOpacity: isSimul ? 0.50 : isWindowOpen ? 0.40 : isTodayAdjust ? 0.35 : 0.20,
              shadowRadius: 12, shadowOffset: { width: 0, height: -4 },
            }}
          >
            {/* ── 顶部高亮条（颜色提示线）── */}
            <LinearGradient
              colors={isSimul
                ? ['rgba(167,139,250,0.0)', 'rgba(167,139,250,0.70)', 'rgba(167,139,250,0.0)']
                : isWindowOpen
                ? ['rgba(251,146,60,0.0)', 'rgba(251,146,60,0.55)', 'rgba(251,146,60,0.0)']
                : ['rgba(96,165,250,0.0)',  'rgba(96,165,250,0.40)',  'rgba(96,165,250,0.0)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ height: 1.5 }}
            />

            {/* ── 主体：全宽信息区 ── */}
            <View style={{ paddingTop: 6, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, gap: 4 }}>

              {/* ── 信息行：模拟模式下显示倒计时+模拟胶囊，否则显示正常调价窗口信息 ── */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: '100%' }}>

                {simulSecsLeft !== null ? (
                  /* ── 模拟模式：单条胶囊，左倒计时｜右模拟中｜右侧退出按钮 + 下方四格油价 ── */
                  <View style={{ gap: 6 }}>
                    {/* 顶行：倒计时胶囊 + 退出按钮 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <LinearGradient
                        colors={['rgba(109,40,217,0.60)', 'rgba(79,22,189,0.75)']}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1,
                          borderRadius: 9, overflow: 'hidden',
                          borderWidth: 1, borderColor: 'rgba(196,165,253,0.50)' }}>
                        {/* 左：倒计时 */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                          paddingHorizontal: 10, paddingVertical: 5 }}>
                          <Timer size={10} color="#DDD6FE" />
                          <Text style={{ color: '#F5F3FF', fontSize: 12, fontWeight: '900',
                            letterSpacing: 1.5, fontVariant: ['tabular-nums'] }}>
                            {`${String(Math.floor(simulSecsLeft / 60)).padStart(2, '0')}:${String(simulSecsLeft % 60).padStart(2, '0')}`}
                          </Text>
                        </View>
                        {/* 竖线分隔 */}
                        <View style={{ width: 1, height: 16, backgroundColor: 'rgba(196,165,253,0.35)' }} />
                        {/* 右：模拟中 */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                          paddingHorizontal: 10, paddingVertical: 5 }}>
                          <FlaskConical size={10} color="#C4B5FD" />
                          <Text style={{ color: '#DDD6FE', fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }}>模拟测试中</Text>
                        </View>
                      </LinearGradient>
                      {/* 退出按钮 */}
                      <Pressable
                        onPress={exitSimulMode}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                          backgroundColor: 'rgba(239,68,68,0.20)', borderRadius: 9,
                          paddingHorizontal: 10, paddingVertical: 5,
                          borderWidth: 1, borderColor: 'rgba(239,68,68,0.48)' }}
                      >
                        <X size={10} color="#FCA5A5" />
                        <Text style={{ color: '#FCA5A5', fontSize: 11, fontWeight: '800' }}>退出</Text>
                      </Pressable>
                    </View>
                    {/* 模拟油价四格（紧凑横排） */}
                    {oilPrice && (
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        {[
                          { label: '92#', value: oilPrice.p92, prev: oilPrice.prevP92, color: '#FBBF24' },
                          { label: '95#', value: oilPrice.p95, prev: oilPrice.prevP95, color: '#F87171' },
                          { label: '98#', value: oilPrice.p98, prev: oilPrice.prevP98, color: '#94A3B8' },
                          { label: '柴油', value: oilPrice.p0,  prev: oilPrice.prevP0,  color: '#34D399' },
                        ].map(({ label, value, prev, color }) => {
                          const delta = (prev && prev !== '' && value && value !== '--')
                            ? parseFloat(value) - parseFloat(prev) : null;
                          const deltaStr = delta !== null && Math.abs(delta) > 0.001
                            ? (delta >= 0 ? `+${delta.toFixed(2)}` : `${delta.toFixed(2)}`) : null;
                          const deltaColor = delta !== null
                            ? (delta > 0.001 ? '#F87171' : delta < -0.001 ? '#34D399' : 'rgba(255,255,255,0.30)') : null;
                          return (
                            <View key={label} style={{ flex: 1, alignItems: 'center', gap: 1,
                              backgroundColor: `${color}12`, borderRadius: 8, paddingVertical: 5,
                              borderWidth: 1, borderColor: `${color}30` }}>
                              <Text style={{ color: `${color}CC`, fontSize: 8.5, fontWeight: '800' }}>{label}</Text>
                              <Text style={{ color: value === '--' ? 'rgba(255,255,255,0.20)' : color,
                                fontSize: 13, fontWeight: '900', letterSpacing: -0.3 }}>
                                {value}
                              </Text>
                              {deltaStr ? (
                                <Text style={{ color: deltaColor!, fontSize: 7.5, fontWeight: '800' }}>{deltaStr}</Text>
                              ) : (
                                <Text style={{ color: 'rgba(255,255,255,0.15)', fontSize: 7 }}>元/升</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                ) : (
                  /* ── 正常模式：调价窗口完整信息，管理员/助手可点击设置日期 ── */
                  <Pressable
                    onPress={(isAdmin || isAssistant) ? () => {
                      const initDate = oilPrice?.nextAdjustDate ?? '';
                      setAdjustDateMsg('');
                      if (initDate && /^\d{4}-\d{2}-\d{2}$/.test(initDate)) {
                        const [iy, im, id] = initDate.split('-').map(Number);
                        setCalSelectedDate(new Date(iy, im - 1, id));
                        setAdjustDateInput(initDate);
                      } else {
                        setCalSelectedDate(undefined);
                        setAdjustDateInput('');
                      }
                      setAdjustDateVisible(true);
                    } : undefined}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                    android_ripple={(isAdmin || isAssistant) ? { color: 'rgba(251,191,36,0.15)', borderless: false } : undefined}
                  >
                    {/* Timer图标 */}
                    <Timer size={12} color={isWindowOpen ? '#FB923C' : '#60A5FA'} />

                    {/* 「调价窗口」竖排标签 */}
                    <View style={{ alignItems: 'center', gap: 0 }}>
                      <Animated.Text
                        entering={FadeInDown.delay(0).duration(320).springify()}
                        style={{ color: isWindowOpen ? 'rgba(251,146,60,0.90)' : 'rgba(147,197,253,0.90)',
                          fontSize: 10, fontWeight: '800', letterSpacing: 0.5, lineHeight: 13 }}>
                        调价
                      </Animated.Text>
                      <Animated.Text
                        entering={FadeInDown.delay(120).duration(320).springify()}
                        style={{ color: isWindowOpen ? 'rgba(251,146,60,0.80)' : 'rgba(147,197,253,0.80)',
                          fontSize: 10, fontWeight: '800', letterSpacing: 0.5, lineHeight: 13 }}>
                        窗口
                      </Animated.Text>
                    </View>

                    {/* 分隔点 */}
                    <View style={{ width: 3, height: 3, borderRadius: 1.5,
                      backgroundColor: isWindowOpen ? 'rgba(251,146,60,0.32)' : 'rgba(96,165,250,0.28)', flexShrink: 0 }} />

                    {/* 调价日期 */}
                    {oilPrice.nextAdjustDate ? (
                      <Text style={{ color: isWindowOpen ? '#FED7AA' : '#BAE6FD',
                        fontSize: 13, fontWeight: '900', letterSpacing: 0.3, flexShrink: 0 }} numberOfLines={1}>
                        {oilPrice.nextAdjustDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}年${parseInt(m)}月${parseInt(d)}日`)}
                      </Text>
                    ) : (
                      <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 11, flexShrink: 0 }}>待定</Text>
                    )}

                    {/* 倒计时badge */}
                    {!isWindowOpen && daysLabel && (
                      <View style={{
                        backgroundColor: daysUrgent ? 'rgba(249,115,22,0.20)' : 'rgba(251,191,36,0.13)',
                        borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
                        borderWidth: 1, borderColor: daysUrgent ? 'rgba(249,115,22,0.55)' : 'rgba(251,191,36,0.38)', flexShrink: 0 }}>
                        <Text style={{ color: daysUrgent ? '#FB923C' : '#FCD34D',
                          fontSize: 10, fontWeight: '900', letterSpacing: 0.2 }}>
                          {daysLeft === 0 ? '🔔今天调价' : daysLabel}
                        </Text>
                      </View>
                    )}

                    {/* 窗口已开启 */}
                    {isWindowOpen && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                        backgroundColor: 'rgba(239,68,68,0.20)', borderRadius: 5,
                        paddingHorizontal: 6, paddingVertical: 2,
                        borderWidth: 1, borderColor: 'rgba(239,68,68,0.55)', flexShrink: 0 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#EF4444' }} />
                        <Text style={{ color: '#FCA5A5', fontSize: 10, fontWeight: '900', letterSpacing: 0.4 }}>窗口已开</Text>
                      </View>
                    )}

                    {/* 管理员/助手：编辑提示点 */}
                    {(isAdmin || isAssistant) && (
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(251,191,36,0.55)', flexShrink: 0 }} />
                    )}
                  </Pressable>
                )}

              </ScrollView>

              {/* ── 原油变化率进度条（底部调价区）── */}
              {(oilPrice.crudeBrent ?? 0) > 0 && (() => {
                // 直接复用 sharedCrude（与上方原油测算卡完全同源）：
                // 一揽子均价 > EIA10日 > 布伦特盘价，对比上期基准得出变化率
                // 避免底部单独计算时因字段优先级不一致导致符号/数值错误
                const rate = sharedCrude?.rateByAvg ?? oilPrice.crudeChangeRate ?? 0;
                const brent = oilPrice.crudeBrent!;
                const pct = Math.min(Math.abs(rate) / 4.0, 1.0);
                const triggered = Math.abs(rate) >= 4.0;
                const barColor = triggered ? '#EF4444' : Math.abs(rate) >= 2.5 ? '#F97316' : accentColor;
                const isUp = rate > 0;
                const rateStr = `${isUp ? '+' : ''}${rate.toFixed(1)}%`;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    {/* 左：布伦特价格 + 变化率 badge */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <TrendingUp size={9} color={barColor} />
                      <Text style={{ color: 'rgba(255,255,255,0.38)', fontSize: 8.5, fontWeight: '700' }}>
                        布伦特 <Text style={{ color: '#FB923C', fontWeight: '900' }}>${brent.toFixed(1)}</Text>
                      </Text>
                      <View style={{ backgroundColor: `${barColor}20`, borderRadius: 4,
                        paddingHorizontal: 5, paddingVertical: 1,
                        borderWidth: 0.5, borderColor: `${barColor}50` }}>
                        <Text style={{ color: barColor, fontSize: 8, fontWeight: '900' }}>{rateStr}</Text>
                      </View>
                    </View>
                    {/* 中：进度条（flex 撑开）*/}
                    <View style={{ flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ height: 4, borderRadius: 2,
                        width: `${pct * 100}%` as `${number}%`,
                        backgroundColor: barColor, opacity: 0.88 }} />
                    </View>
                    {/* 右：门槛状态 */}
                    <Text style={{ color: triggered ? barColor : 'rgba(255,255,255,0.25)', fontSize: 8, fontWeight: triggered ? '800' : '600', flexShrink: 0 }}>
                      {triggered ? '🔴 超门槛' : `差${(4.0 - Math.abs(rate)).toFixed(1)}%`}
                    </Text>
                  </View>
                );
              })()}

              {/* ── 字幕行：全宽滚动油价信息 ── */}
              <OilTickerBar
                trend={oilPrice.trend}
                deltaPerLiter={sharedCrude?.deltaPerLiter92}
                nextTrend={sharedCrude?.deltaPerLiter92 ?? oilPrice.nextTrend}
                nextTrendText={sharedCrude ? undefined : oilPrice.nextTrendText}
                p92={oilPrice.p92}
                p95={oilPrice.p95}
                p0={oilPrice.p0}
                prevP92={oilPrice.prevP92}
                updateDate={oilPrice.updateDate}
                crudeUpdatedAt={oilPrice.crudeUpdatedAt}
              />
            </View>
          </View>
          </>
        );
      })() : (
        <DraggableFloat initialRight={20} initialBottom={chatBallBottom} floatWidth={52} floatHeight={116}>
          <View style={{ gap: 10 }}>
            {/* 通知铃铛悬浮球 */}
            <Pressable
              onPress={() => { setUnreadNotif(0); router.push('/(app)/notifications' as never); }}
              style={{
                width: 48, height: 48, borderRadius: 24,
                backgroundColor: unreadNotif > 0 ? '#C2410C' : '#1E3A5F',
                alignItems: 'center', justifyContent: 'center',
                shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}
            >
              <Bell size={20} color="#FDBA74" />
              {unreadNotif > 0 && (
                <View style={{
                  position: 'absolute', top: -2, right: -2,
                  width: 16, height: 16, borderRadius: 8,
                  backgroundColor: '#F97316',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: '#0A0F1E',
                }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', lineHeight: 12 }}>
                    {unreadNotif > 9 ? '9+' : String(unreadNotif)}
                  </Text>
                </View>
              )}
            </Pressable>
            {/* 聊天悬浮球 */}
            <Pressable
              onPress={() => router.push('/(app)/chat' as never)}
              style={{
                width: 52, height: 52, borderRadius: 26,
                backgroundColor: '#2563EB',
                alignItems: 'center', justifyContent: 'center',
                shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}
            >
              <MessageCircle size={22} color="#fff" />
              {(unreadDm + unreadChat) > 0 && (
                <View style={{
                  position: 'absolute', top: -2, right: -2,
                  minWidth: 18, height: 18, borderRadius: 9,
                  backgroundColor: '#EF4444',
                  alignItems: 'center', justifyContent: 'center',
                  paddingHorizontal: 4,
                  borderWidth: 2, borderColor: '#fff',
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 14 }}>
                    {(unreadDm + unreadChat) > 99 ? '99+' : String(unreadDm + unreadChat)}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </DraggableFloat>
      )}

    </KeyboardAvoidingView>
  );
}
