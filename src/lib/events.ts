// 轻量全局事件总线（无依赖）
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export const appEvents = {
  emit(event: string) {
    listeners.get(event)?.forEach((fn) => fn());
  },
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    return () => listeners.get(event)?.delete(fn); // 返回取消订阅函数
  },
};

// 事件名常量
export const EVT_OIL_IMPORTED = 'oilprice_imported';
