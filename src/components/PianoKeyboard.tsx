/**
 * PianoKeyboard — 琴键风格功能按键
 * 真实钢琴键感：竖向长条/高度错落/渐变光泽/按下下沉+反光变化
 */
import { useRef } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export type PianoKey = {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgTop: string;
  bgBottom: string;
  heightRatio?: number;  // 键高比例，模拟琴键高低错落
  onPress: () => void;
};

type Props = {
  keys: PianoKey[];
  centerIndex?: number;
  columns?: number;
  baseHeight?: number;
};

// 每个键的渐变色
const GRAD: Record<string, [string, string, string]> = {
  '#34D399': ['#065F46', '#059669', '#34D399'],
  '#A78BFA': ['#4C1D95', '#7C3AED', '#A78BFA'],
  '#F87171': ['#7F1D1D', '#DC2626', '#F87171'],
  '#818CF8': ['#312E81', '#4338CA', '#818CF8'],
  '#6EE7B7': ['#064E3B', '#047857', '#6EE7B7'],
  '#60A5FA': ['#1E3A8A', '#1D4ED8', '#60A5FA'],
  '#FBBF24': ['#78350F', '#B45309', '#FBBF24'],
  '#F1F5F9': ['#1E293B', '#334155', '#94A3B8'],
  '#F97316': ['#7C2D12', '#C2410C', '#F97316'],
};

// 琴键高度错落模式（循环使用）
const HEIGHT_PATTERN = [1.0, 0.88, 1.05, 0.92, 1.0, 0.85, 1.08];

export default function PianoKeyboard({ keys, centerIndex: _ci, columns: _c, baseHeight: _bh }: Props) {
  const BASE = 110; // 基础键高
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
      {keys.map((k, i) => {
        const ratio = k.heightRatio ?? HEIGHT_PATTERN[i % HEIGHT_PATTERN.length];
        const height = Math.round(BASE * ratio);
        return <PianoKeyItem key={i} item={k} height={height} index={i} total={keys.length} />;
      })}
    </View>
  );
}

function PianoKeyItem({
  item: k, height, index, total,
}: {
  item: PianoKey; height: number; index: number; total: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const onPressIn  = () => Animated.spring(anim, { toValue: 1, useNativeDriver: false, speed: 100, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(anim, { toValue: 0, useNativeDriver: false, speed: 50,  bounciness: 4 }).start();

  const [g0, g1, g2] = GRAD[k.color] ?? ['#1E293B', '#334155', '#94A3B8'];

  // 按下动画插值
  const translateY    = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 4] });
  const shimmerOpacity= anim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.08] });
  const topGlow       = anim.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.05] });
  const shadowOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.15] });

  // 两端键加圆角
  const isFirst = index === 0;
  const isLast  = index === total - 1;

  return (
    <Pressable onPress={k.onPress} onPressIn={onPressIn} onPressOut={onPressOut} style={{ flex: 1 }}>
      <Animated.View style={{
        height,
        transform: [{ translateY }],
        borderRadius: 0,
        shadowColor: g1,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity,
        shadowRadius: 10,
        elevation: 8,
      }}>
        <LinearGradient
          colors={[g0, g1, g2]}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={{
            flex: 1,
            height,
            borderTopLeftRadius:  isFirst ? 10 : 6,
            borderTopRightRadius: isLast  ? 10 : 6,
            borderBottomLeftRadius:  isFirst ? 12 : 8,
            borderBottomRightRadius: isLast  ? 12 : 8,
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 12,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: `${g2}30`,
          }}
        >
          {/* 顶部反光高光 */}
          <Animated.View style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: height * 0.42,
            borderTopLeftRadius:  isFirst ? 10 : 6,
            borderTopRightRadius: isLast  ? 10 : 6,
            backgroundColor: 'rgba(255,255,255,1)',
            opacity: topGlow,
          }} />

          {/* 中央竖向亮条（模拟键面反光） */}
          <Animated.View style={{
            position: 'absolute', top: 8, bottom: 8,
            left: '35%', right: '35%',
            borderRadius: 4,
            backgroundColor: 'rgba(255,255,255,1)',
            opacity: shimmerOpacity,
          }} />

          {/* 底部左侧棱边高光 */}
          <View style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 1.5,
            backgroundColor: 'rgba(255,255,255,0.20)',
            borderTopLeftRadius: isFirst ? 10 : 6,
          }} />

          {/* 图标 */}
          <View style={{ marginBottom: 6 }}>
            {k.icon}
          </View>

          {/* 标签 */}
          <Text style={{
            color: 'rgba(255,255,255,0.90)',
            fontSize: 9.5,
            fontWeight: '800',
            textAlign: 'center',
            letterSpacing: 0.3,
            paddingHorizontal: 2,
          }} numberOfLines={2}>
            {k.label}
          </Text>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}
