<script setup lang="ts">
import { computed } from 'vue';
import type { Alert } from '../lib/game';

const props = defineProps<{ alerts: Alert[] }>();
defineEmits<{ dismiss: [id: number] }>();
const critical = computed(() => props.alerts.some((a) => a.level === 'crit'));
</script>

<template>
  <div class="layer" aria-live="assertive">
    <div v-if="critical" class="frame" />
    <TransitionGroup name="al" tag="div" class="stack">
      <button v-for="a in alerts" :key="a.id" type="button" class="alert" :class="a.level" @click="$emit('dismiss', a.id)">
        <span class="sig">{{ a.level === 'crit' ? '▲' : a.level === 'warn' ? '◆' : a.level === 'ok' ? '✓' : '●' }}</span>
        <span class="txt">
          <strong>{{ a.title }}</strong>
          <span v-if="a.text">{{ a.text }}</span>
        </span>
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 800;
}
.frame {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 0 4px var(--red), inset 0 0 120px rgba(216, 70, 60, 0.35);
  animation: blink 0.6s steps(2) infinite;
}
.stack {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(620px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.alert {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  color: var(--text);
  background: rgba(8, 11, 10, 0.96);
  border: 1px solid var(--acc-2);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), var(--acc-glow);
}
.alert.warn {
  border-color: var(--amber);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 18px rgba(255, 182, 39, 0.35);
}
.alert.crit {
  border-color: var(--red);
  background: #1a0806;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 26px rgba(216, 70, 60, 0.55);
}
.sig {
  font-size: 26px;
  color: var(--acc);
  flex: none;
}
.warn .sig {
  color: var(--amber);
}
.crit .sig {
  color: var(--red);
  animation: blink 0.5s steps(2) infinite;
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
strong {
  font-family: var(--mono);
  font-size: 17px;
  letter-spacing: 0.14em;
}
.crit strong {
  color: #ff7a6e;
}
.warn strong {
  color: var(--amber);
}
.txt span {
  font-size: 14px;
  color: var(--text-dim);
}
.al-enter-active {
  animation: line-in 0.25s ease-out;
}
.al-leave-active {
  transition: opacity 0.3s;
}
.al-leave-to {
  opacity: 0;
}
</style>
