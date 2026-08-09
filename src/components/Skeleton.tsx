/**
 * 通用骨架屏组件
 * 基于 react-native-reanimated 的 shimmer 闪光动画，无需第三方库
 */
import { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

// ── 单个骨架块 ────────────────────────────────────────────────────────────
interface SkeletonBoxProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
  /** 亮色主题（白色背景页面） */
  light?: boolean;
}

export function SkeletonBox({ width = '100%', height = 16, borderRadius = 8, style, light = true }: SkeletonBoxProps) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const baseColor = light ? '#E2E8F0' : 'rgba(255,255,255,0.1)';

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: baseColor },
        animStyle,
        style,
      ]}
    />
  );
}

// ── 车辆卡片骨架（home.tsx） ───────────────────────────────────────────────
export function VehicleCardSkeleton() {
  return (
    <View style={{
      backgroundColor: '#fff', borderRadius: 12, marginBottom: 10,
      padding: 14, borderWidth: 1, borderColor: '#EEF2F7',
      shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
      gap: 10,
    }}>
      {/* 顶行：色块 + 车牌 + 序号 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SkeletonBox width={36} height={36} borderRadius={10} />
        <SkeletonBox width={100} height={20} borderRadius={6} />
        <View style={{ flex: 1 }} />
        <SkeletonBox width={44} height={20} borderRadius={6} />
      </View>
      {/* 信息行 */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SkeletonBox width={80} height={14} borderRadius={4} />
        <SkeletonBox width={60} height={14} borderRadius={4} />
        <SkeletonBox width={70} height={14} borderRadius={4} />
      </View>
      {/* 底行 */}
      <SkeletonBox width="60%" height={13} borderRadius={4} />
    </View>
  );
}

// ── 员工卡片骨架（employee-manage.tsx） ──────────────────────────────────
export function EmployeeCardSkeleton() {
  return (
    <View style={{
      backgroundColor: '#1E293B', borderRadius: 16, marginBottom: 12,
      padding: 14, borderWidth: 1, borderColor: 'rgba(59,130,246,0.12)',
      shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
      gap: 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SkeletonBox light={false} width={48} height={48} borderRadius={16} />
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBox light={false} width="50%" height={15} borderRadius={6} />
          <SkeletonBox light={false} width="70%" height={12} borderRadius={4} />
        </View>
        <SkeletonBox light={false} width={56} height={28} borderRadius={8} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SkeletonBox light={false} width={80} height={32} borderRadius={10} style={{ flex: 1 }} />
        <SkeletonBox light={false} width={80} height={32} borderRadius={10} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

// ── 审计日志卡片骨架（audit-log.tsx） ─────────────────────────────────────
export function LogCardSkeleton() {
  return (
    <View style={{
      backgroundColor: '#fff', marginHorizontal: 14, marginBottom: 10,
      borderRadius: 14, borderWidth: 1, borderColor: '#EEF2F7',
      borderLeftWidth: 3, borderLeftColor: '#E2E8F0',
      shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    }}>
      {/* 顶行 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
        <SkeletonBox width={64} height={15} borderRadius={6} />
        <SkeletonBox width={40} height={20} borderRadius={10} />
        <View style={{ flex: 1 }} />
        <SkeletonBox width={80} height={12} borderRadius={4} />
      </View>
      {/* 分隔线 */}
      <View style={{ height: 1, backgroundColor: '#F4F6FA', marginHorizontal: 14 }} />
      {/* 内容行 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 12 }}>
        <SkeletonBox width={52} height={24} borderRadius={8} />
        <SkeletonBox width="55%" height={14} borderRadius={4} />
      </View>
    </View>
  );
}

// ── 消息气泡骨架（chat / private-chat） ──────────────────────────────────
export function BubbleSkeleton({ isMine }: { isMine: boolean }) {
  return (
    <View style={{
      flexDirection: isMine ? 'row-reverse' : 'row',
      alignItems: 'flex-end', gap: 8,
      marginHorizontal: 14, marginBottom: 14,
    }}>
      {/* 头像 */}
      <SkeletonBox
        light={false}
        width={38} height={38} borderRadius={19}
        style={{ backgroundColor: 'rgba(148,163,184,0.15)' }}
      />
      <View style={{ maxWidth: '65%', gap: 6 }}>
        {/* 名字行 */}
        <SkeletonBox light={false} width={72} height={12} borderRadius={4} style={{ backgroundColor: 'rgba(148,163,184,0.15)', alignSelf: isMine ? 'flex-end' : 'flex-start' }} />
        {/* 气泡 */}
        <SkeletonBox
          light={false}
          width={isMine ? 160 : 140} height={40} borderRadius={16}
          style={{ backgroundColor: isMine ? 'rgba(37,99,235,0.18)' : 'rgba(148,163,184,0.12)' }}
        />
      </View>
    </View>
  );
}
