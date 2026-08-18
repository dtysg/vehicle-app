import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 返回 dateStr 的下一个工作日（跳过周末） */
export function nextWorkday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 判断是否为工作日 */
export function isWorkday(ds: string): boolean {
  const day = new Date(ds + 'T12:00:00Z').getUTCDay();
  return day !== 0 && day !== 6;
}

/** 从 from 到 to（含）的工作日天数 */
export function countWorkdays(from: string, to: string): number {
  const cur = new Date(from + 'T12:00:00Z');
  const end = new Date(to + 'T12:00:00Z');
  let count = 0;
  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10);
    if (isWorkday(ds)) count += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
