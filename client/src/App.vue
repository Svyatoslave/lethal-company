<script setup lang="ts">
import { toasts } from './lib/toast';
</script>

<template>
  <RouterView />
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="t">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.level">
        <span class="mark">{{ t.level === 'crit' ? '▲' : t.level === 'warn' ? '◆' : t.level === 'ok' ? '✓' : '›' }}</span>
        {{ t.text }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 12px;
  bottom: calc(12px + var(--safe-b));
  z-index: 850;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  width: min(420px, calc(100vw - 24px));
  pointer-events: none;
}
.toast {
  padding: 10px 14px;
  background: rgba(8, 11, 10, 0.97);
  border: 1px solid var(--line-2);
  border-left: 3px solid var(--acc);
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
}
.toast.warn {
  border-left-color: var(--amber);
}
.toast.crit {
  border-left-color: var(--red);
  color: #ffb3ab;
}
.mark {
  color: var(--acc);
  margin-right: 6px;
}
.warn .mark {
  color: var(--amber);
}
.crit .mark {
  color: var(--red);
}
.t-enter-active {
  animation: line-in 0.25s ease-out;
}
.t-leave-active {
  transition: opacity 0.25s;
}
.t-leave-to {
  opacity: 0;
}
@media (max-width: 760px) {
  .toasts {
    top: 10px;
    bottom: auto;
    right: 50%;
    transform: translateX(50%);
    align-items: stretch;
  }
}
</style>
