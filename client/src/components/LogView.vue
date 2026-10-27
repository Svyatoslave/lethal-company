<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { EventView } from '@shared/types';
import { clock } from '../lib/format';

const props = defineProps<{ events: EventView[]; showActor?: boolean; dense?: boolean }>();
const box = ref<HTMLElement | null>(null);
const stick = ref(true);

function onScroll() {
  const el = box.value;
  if (el) stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

watch(
  () => props.events.at(-1)?.id,
  async () => {
    if (!stick.value) return;
    await nextTick();
    box.value?.scrollTo({ top: box.value.scrollHeight });
  },
  { immediate: true },
);
</script>

<template>
  <div ref="box" class="log" :class="{ dense }" @scroll="onScroll">
    <div v-if="!events.length" class="empty">// NO SIGNAL. AWAITING EVENTS<span class="blink">_</span></div>
    <div v-for="e in events" :key="e.id" class="ln" :class="e.level">
      <span class="t">{{ clock(e.createdAt) }}</span>
      <span class="tag">[{{ e.type }}]</span>
      <span class="msg">
        {{ e.text }}
        <span v-if="showActor && e.actor !== 'SYSTEM'" class="who">· {{ e.actor }}</span>
        <span v-if="showActor && e.visibility !== 'all'" class="vis">{{ e.visibility }}</span>
      </span>
    </div>
    <div class="cursor">&gt; <span class="blink">█</span></div>
  </div>
</template>

<style scoped>
.log {
  height: 100%;
  overflow-y: auto;
  padding: 8px 10px 4px;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.55;
  background: #040605;
}
.dense {
  font-size: 11.5px;
}
.ln {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 8px;
  padding: 1px 0;
  color: var(--text-dim);
  animation: line-in 0.35s ease-out;
}
.t {
  color: var(--text-mute);
}
.tag {
  color: var(--acc-2);
  font-weight: 600;
}
.msg {
  color: var(--text);
  word-break: break-word;
}
.ok .msg {
  color: var(--acc);
}
.warn .tag,
.warn .msg {
  color: var(--amber);
}
.crit .tag,
.crit .msg {
  color: #ff6a5e;
}
.crit {
  background: linear-gradient(90deg, var(--red-dim), transparent);
}
.who {
  color: var(--text-mute);
}
.vis {
  margin-left: 6px;
  padding: 0 4px;
  border: 1px solid var(--line-2);
  color: var(--text-mute);
  font-size: 10px;
  text-transform: uppercase;
}
.cursor {
  color: var(--acc);
  padding: 2px 0 6px;
}
@media (max-width: 520px) {
  .ln {
    grid-template-columns: auto 1fr;
  }
  .t {
    display: none;
  }
}
</style>
