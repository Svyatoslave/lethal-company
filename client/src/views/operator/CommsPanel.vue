<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Game } from '../../lib/game';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';
import MessageList from '../../components/MessageList.vue';

const props = defineProps<{ game: Game }>();
const { state, now, act, busy } = props.game;

const m = computed(() => state.value?.mission ?? null);
const radio = computed(() => !!m.value?.commsRadio && !m.value.commsDisabled);
const mode = computed(() => {
  if (!m.value?.commsRadio) return { label: 'COURIER MODE', tone: 'warn' as const };
  if (m.value.commsDisabled) return { label: 'SIGNAL LOST', tone: 'crit' as const };
  return { label: 'RADIO ONLINE', tone: 'ok' as const };
});
const crew = computed(() => state.value?.players.filter((p) => p.role === 'crew') ?? []);
const to = ref<string>('admin');
const body = ref('');

async function send() {
  const text = body.value.trim();
  if (!text) return;
  const payload = to.value === 'admin' || to.value === 'crew' ? { toType: to.value } : { toType: 'player', toPlayerId: Number(to.value) };
  const r = await act('msg', 'POST', '/messages', { ...payload, body: text });
  if (r) body.value = '';
}
</script>

<template>
  <TPanel title="COMMUNICATIONS" code="X-06">
    <template #actions>
      <TChip :label="mode.label" :tone="mode.tone" :pulse="mode.tone === 'crit'" />
    </template>
    <div class="comms">
      <div v-if="!m?.commsRadio" class="note">
        Прямой связи нет. Сообщения от ведущего передавайте экипажу через <b>курьера</b>. Купите RADIO в магазине, чтобы открыть эфир.
      </div>
      <div v-else-if="m.commsDisabled" class="note crit">Эфир заглушён ведущим. Используйте курьера.</div>
      <div v-else-if="m.messageDelaySec" class="note">Задержка эфира: {{ m.messageDelaySec }} с.</div>
      <div class="list"><MessageList :messages="state?.messages ?? []" role="operator" :now="now" /></div>
      <form class="composer" @submit.prevent="send">
        <select v-model="to" class="select to">
          <option value="admin">→ FIELD ADMIN</option>
          <option value="crew" :disabled="!radio">→ ВЕСЬ ЭКИПАЖ</option>
          <option v-for="p in crew" :key="p.id" :value="String(p.id)" :disabled="!radio">→ {{ p.callsign }}</option>
        </select>
        <div class="row">
          <input v-model="body" class="input grow" maxlength="500" placeholder="ТЕКСТ ПЕРЕДАЧИ…" />
          <TButton :busy="busy.has('msg')" :disabled="!body.trim()" @click="send">TX</TButton>
        </div>
      </form>
    </div>
  </TPanel>
</template>

<style scoped>
.comms {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 220px;
  gap: 8px;
}
.note {
  font-size: 13px;
  color: var(--text-dim);
  padding: 6px 8px;
  border-left: 2px solid var(--amber);
  background: var(--amber-dim);
}
.note.crit {
  border-color: var(--red);
  background: var(--red-dim);
  color: #ffb3ab;
}
.list {
  flex: 1;
  min-height: 90px;
  border: 1px solid var(--line);
  background: #040605;
}
.list :deep(.msgs) {
  padding: 6px;
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.to {
  min-height: 34px;
  padding: 4px 8px;
  font-size: 12.5px;
}
.composer .input {
  min-height: 40px;
}
</style>
