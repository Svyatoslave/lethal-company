<script setup lang="ts">
import { computed } from 'vue';
import { mmss } from '../../lib/format';

const props = defineProps<{
  deadline: number | null;
  now: number;
  pausedAt?: number | null;
  /** Shown frozen when there is no running deadline (e.g. planned expedition length). */
  staticMs?: number | null;
  size?: 'xl' | 'lg' | 'md' | 'sm';
}>();

const ms = computed(() => {
  if (props.deadline) return props.deadline - (props.pausedAt ?? props.now);
  return props.staticMs ?? null;
});
const text = computed(() => (ms.value === null ? '--:--' : mmss(ms.value)));
const tone = computed(() => {
  if (ms.value === null) return 'idle';
  if (!props.deadline) return 'idle';
  if (ms.value < 0) return 'over';
  if (ms.value < 60_000) return 'low';
  if (ms.value < 180_000) return 'mid';
  return 'ok';
});
</script>

<template>
  <span class="cd tnum" :class="[size ?? 'md', tone, { paused: !!pausedAt && !!deadline }]">
    <span :class="{ long: text.length > 6 }">{{ text }}</span>
  </span>
</template>

<style scoped>
.cd {
  font-family: var(--mono);
  font-weight: 800;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--acc);
  text-shadow: var(--acc-glow);
}
.xl {
  font-size: clamp(56px, 7.5vw, 112px);
}
.lg {
  font-size: 54px;
}
.md {
  font-size: 22px;
}
.sm {
  font-size: 13px;
  font-weight: 600;
  text-shadow: none;
}
/* Hours or overtime ("+1:12:02") are wider: shrink so the big timer never overflows a phone card. */
.xl .long,
.lg .long {
  font-size: 0.66em;
}
.idle {
  color: var(--text-dim);
  text-shadow: none;
}
.mid {
  color: #d6ff3a;
}
.low {
  color: var(--amber);
  text-shadow: 0 0 14px rgba(255, 182, 39, 0.45);
  animation: blink 1s steps(2) infinite;
}
.over {
  color: var(--red);
  text-shadow: 0 0 14px rgba(216, 70, 60, 0.5);
  animation: blink 0.7s steps(2) infinite;
}
.paused {
  color: var(--text-dim);
  text-shadow: none;
  animation: none;
}
</style>
