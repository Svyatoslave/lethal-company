import { reactive } from 'vue';
import type { Level } from '@shared/types';

export interface Toast { id: number; text: string; level: Level }
export const toasts = reactive<Toast[]>([]);
let seq = 0;

export function toast(text: string, level: Level = 'info', ms = 3800) {
  const id = ++seq;
  toasts.push({ id, text, level });
  if (toasts.length > 5) toasts.shift();
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}
