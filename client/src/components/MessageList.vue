<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { MessageView, Role } from '@shared/types';
import { clock } from '../lib/format';

const props = defineProps<{ messages: MessageView[]; role: Role; now: number }>();
const box = ref<HTMLElement | null>(null);

function mine(m: MessageView) {
  return m.fromRole === props.role;
}
function dest(m: MessageView) {
  if (m.toType === 'crew') return 'ВСЕМ';
  if (m.toType === 'player') return m.toCallsign ?? '?';
  if (m.toType === 'admin') return 'FIELD ADMIN';
  return 'OPERATOR';
}
const CH: Record<string, string> = { relay: 'RELAY', radio: 'RADIO', system: 'SYS' };

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    box.value?.scrollTo({ top: box.value.scrollHeight });
  },
  { immediate: true },
);
</script>

<template>
  <div ref="box" class="msgs">
    <div v-if="!messages.length" class="empty">// ЭФИР ПУСТ</div>
    <div v-for="m in messages" :key="m.id" class="m" :class="[m.channel, { mine: mine(m), pending: !m.delivered }]">
      <div class="meta">
        <span class="ch">{{ CH[m.channel] }}</span>
        <span class="from">{{ m.fromCallsign }}</span>
        <span class="arrow">→</span>
        <span>{{ dest(m) }}</span>
        <span class="t">{{ clock(m.createdAt, false) }}</span>
      </div>
      <div class="body">{{ m.body }}</div>
      <div v-if="!m.delivered" class="eta">В ПУТИ · {{ Math.max(0, Math.ceil((m.deliverAt - now) / 1000)) }} c</div>
    </div>
  </div>
</template>

<style scoped>
.msgs {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
.m {
  max-width: 92%;
  padding: 7px 10px 8px;
  border-left: 2px solid var(--line-2);
  background: var(--panel-2);
}
.m.mine {
  align-self: flex-end;
  border-left: none;
  border-right: 2px solid var(--acc-2);
  background: rgba(156, 255, 58, 0.05);
}
.m.system {
  border-color: var(--amber);
  background: var(--amber-dim);
}
.m.relay {
  border-color: var(--blue);
}
.m.pending {
  opacity: 0.6;
}
.meta {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-mute);
  letter-spacing: 0.06em;
}
.ch {
  color: var(--acc-2);
  font-weight: 600;
}
.system .ch {
  color: var(--amber);
}
.relay .ch {
  color: var(--blue);
}
.from {
  color: var(--text-dim);
  font-weight: 600;
}
.t {
  margin-left: auto;
}
.body {
  margin-top: 3px;
  font-family: var(--mono);
  font-size: 13.5px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.eta {
  margin-top: 4px;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--amber);
}
</style>
