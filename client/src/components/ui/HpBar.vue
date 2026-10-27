<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ hp: number; size?: 'sm' | 'md' | 'lg'; label?: boolean }>(), { size: 'md', label: true });
const tone = computed(() => (props.hp <= 0 ? 'dead' : props.hp <= 50 ? 'hurt' : 'ok'));
</script>

<template>
  <span class="hpbar" :class="[size, tone]" role="meter" :aria-valuenow="hp" aria-valuemin="0" aria-valuemax="100" :title="`HP ${hp}%`">
    <span class="track"><i :style="{ width: `${hp}%` }" /></span>
    <b v-if="label" class="mono tnum">{{ hp <= 0 ? 'DOWN' : `${hp}%` }}</b>
  </span>
</template>

<style scoped>
.hpbar {
  --c: var(--acc);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.hurt {
  --c: var(--amber);
}
.dead {
  --c: var(--red);
}
.track {
  position: relative;
  flex: 1;
  min-width: 48px;
  height: 8px;
  background: var(--line);
  /* 10 segments, like an old health meter. */
  -webkit-mask: repeating-linear-gradient(90deg, #000 0 calc(10% - 2px), transparent calc(10% - 2px) 10%);
  mask: repeating-linear-gradient(90deg, #000 0 calc(10% - 2px), transparent calc(10% - 2px) 10%);
}
.track i {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--c);
  box-shadow: 0 0 6px var(--c);
  transition: width 0.4s ease-out;
}
b {
  font-size: 11.5px;
  color: var(--c);
  min-width: 38px;
  text-align: right;
}
.sm .track {
  min-width: 40px;
  height: 6px;
}
.sm b {
  font-size: 10.5px;
  min-width: 32px;
}
.lg .track {
  height: 16px;
}
.lg b {
  font-size: 22px;
  font-weight: 800;
  min-width: 70px;
}
.dead b {
  animation: blink 0.8s steps(2) infinite;
}
</style>
