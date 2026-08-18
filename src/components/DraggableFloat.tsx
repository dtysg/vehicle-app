/**
 * DraggableFloat —— 可自由拖拽的悬浮容器
 *
 * 特性：
 *  - PanGesture 拖拽，松手自动吸边（左/右边缘）
 *  - 上下方向自由移动，不超出安全边界（top/bottom margin）
 *  - 短暂拖拽后位移 < TAP_SLOP 视为点击，正常触发子组件 onPress
 *  - 位置用 useSharedValue 驱动，全程 UI 线程，无跳帧
 *  - onPositionChange 回调：每次位置变化通知父组件（JS 线程坐标）
 */
import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const SNAP_MARGIN   = 12;   // 吸边距屏幕边缘的间距
const TOP_SAFE      = 60;   // 顶部安全边界（避开状态栏）
const BOTTOM_SAFE   = 90;   // 底部安全边界（避开底部横条）
const TAP_SLOP      = 8;    // 移动超过此值才算拖拽，否则透传为点击
const SPRING_CONFIG = { damping: 22, stiffness: 240, mass: 0.8 };

type Props = {
  /** 初始右边距（默认 16） */
  initialRight?: number;
  /** 初始底部距离（默认 90） */
  initialBottom?: number;
  /** 悬浮球宽度（用于吸边计算，默认 56） */
  floatWidth?: number;
  /** 悬浮球高度（用于边界计算，默认 56） */
  floatHeight?: number;
  /** 位置变化回调，返回球左上角的屏幕坐标 */
  onPositionChange?: (x: number, y: number) => void;
  children: React.ReactNode;
};

export default function DraggableFloat({
  initialRight  = 16,
  initialBottom = 90,
  floatWidth    = 56,
  floatHeight   = 56,
  onPositionChange,
  children,
}: Props) {
  const { width, height } = useWindowDimensions();

  // 用绝对 x/y（左上角）定位
  const posX = useSharedValue(width - initialRight - floatWidth);
  const posY = useSharedValue(height - initialBottom - floatHeight);

  // 记录手势开始时的位置
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  // 是否触发了真实拖拽（超过 TAP_SLOP）
  const isDragging = useSharedValue(false);

  // 初始化时通知父组件位置
  useEffect(() => {
    onPositionChange?.(posX.value, posY.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 窗口尺寸变化时修正位置（横竖屏切换）
  useEffect(() => {
    const maxX = width  - floatWidth  - SNAP_MARGIN;
    const maxY = height - floatHeight - BOTTOM_SAFE;
    if (posX.value > maxX) posX.value = maxX;
    if (posY.value > maxY) posY.value = maxY;
    if (posY.value < TOP_SAFE) posY.value = TOP_SAFE;
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const notifyPosition = (x: number, y: number) => {
    onPositionChange?.(x, y);
  };

  const snap = () => {
    'worklet';
    // 吸左/右边
    const midX  = posX.value + floatWidth / 2;
    const snapX = midX < width / 2
      ? SNAP_MARGIN
      : width - floatWidth - SNAP_MARGIN;
    // 上下夹紧
    const clampedY = Math.max(TOP_SAFE, Math.min(posY.value, height - floatHeight - BOTTOM_SAFE));
    posX.value = withSpring(snapX, SPRING_CONFIG);
    posY.value = withSpring(clampedY, SPRING_CONFIG);
    runOnJS(notifyPosition)(snapX, clampedY);
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value    = posX.value;
      startY.value    = posY.value;
      isDragging.value = false;
    })
    .onUpdate((e) => {
      if (Math.abs(e.translationX) > TAP_SLOP || Math.abs(e.translationY) > TAP_SLOP) {
        isDragging.value = true;
      }
      posX.value = startX.value + e.translationX;
      posY.value = startY.value + e.translationY;
      runOnJS(notifyPosition)(posX.value, posY.value);
    })
    .onEnd(() => {
      if (isDragging.value) {
        snap();
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    position:  'absolute',
    left:      posX.value,
    top:       posY.value,
    zIndex:    100,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animStyle}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
