<script setup lang="ts">
import type { Tone } from '../../lib/format';

defineProps<{ label: string; tone?: Tone; pulse?: boolean; big?: boolean }>();
</script>

<template>
  <span class="chip" :class="[tone ?? 'mute', { pulse, big }]"><i />{{ label }}</span>
</template>

<style scoped>
.chip {
  --c: var(--text-mute);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  background: color-mix(in srgb, var(--c) 10%, transparent);
  color: var(--c);
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  white-space: nowrap;
  text-transform: uppercase;
}
.chip i {
  width: 6px;
  height: 6px;
  background: var(--c);
  box-shadow: 0 0 6px var(--c);
  flex: none;
}
.big {
  height: 34px;
  padding: 0 14px;
  font-size: 14px;
  gap: 10px;
}
.big i {
  width: 9px;
  height: 9px;
}
.ok {
  --c: var(--acc);
}
.acc {
  --c: var(--acc);
}
.warn {
  --c: var(--amber);
}
.crit {
  --c: var(--red);
}
.info {
  --c: var(--blue);
}
.mute {
  --c: var(--text-mute);
}
.pulse i {
  animation: blink 0.9s steps(2) infinite;
}
.pulse.crit {
  animation: pulse-red 1.2s ease-in-out infinite;
}
</style>
