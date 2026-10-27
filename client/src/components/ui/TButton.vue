<script setup lang="ts">
import { onUnmounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'solid' | 'warn' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg' | 'xl';
    block?: boolean;
    busy?: boolean;
    disabled?: boolean;
    /** Require a second tap within 3 s. A string replaces the "confirm?" label. */
    confirm?: boolean | string;
  }>(),
  { variant: 'primary', size: 'md' },
);
const emit = defineEmits<{ click: [] }>();

const armed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function onClick() {
  if (props.disabled || props.busy) return;
  if (props.confirm && !armed.value) {
    armed.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (armed.value = false), 3000);
    return;
  }
  armed.value = false;
  clearTimeout(timer);
  emit('click');
}
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <button type="button" class="btn" :class="[variant, size, { block, armed, busy }]" :disabled="disabled" @click="onClick">
    <span v-if="armed" class="lbl">{{ typeof confirm === 'string' ? confirm : 'ПОДТВЕРДИТЬ?' }}</span>
    <span v-else-if="busy" class="lbl">ОБРАБОТКА<span class="blink">_</span></span>
    <span v-else class="lbl"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  --c: var(--acc);
  --bgc: var(--acc-dim);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--c);
  border-radius: 2px;
  background: var(--bgc);
  color: var(--c);
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  transition: background 0.12s, color 0.12s, box-shadow 0.12s;
}
.btn:hover:not(:disabled) {
  background: var(--c);
  color: #050605;
  box-shadow: 0 0 16px color-mix(in srgb, var(--c) 40%, transparent);
}
.btn:active:not(:disabled) {
  transform: translateY(1px);
}
.btn:focus-visible {
  outline: 2px solid var(--c);
  outline-offset: 2px;
}
.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.solid {
  background: var(--acc);
  color: #050605;
}
.solid:hover:not(:disabled) {
  background: #b8ff6e;
}
.warn {
  --c: var(--amber);
  --bgc: var(--amber-dim);
}
.danger {
  --c: var(--red);
  --bgc: var(--red-dim);
}
.ghost {
  --c: var(--text-dim);
  --bgc: transparent;
  border-color: var(--line-2);
}
.ghost:hover:not(:disabled) {
  background: var(--panel-3);
  color: var(--text);
  box-shadow: none;
}
.sm {
  min-height: 32px;
  padding: 0 10px;
  font-size: 11px;
}
.lg {
  min-height: 52px;
  font-size: 14px;
  padding: 0 18px;
}
.xl {
  min-height: 72px;
  font-size: 17px;
  letter-spacing: 0.16em;
  padding: 0 20px;
}
.block {
  display: flex;
  width: 100%;
}
.armed {
  --c: var(--amber);
  background: var(--amber);
  color: #050605;
  animation: blink 0.5s steps(2) infinite;
}
.busy {
  opacity: 0.75;
  cursor: progress;
}
.lbl {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
