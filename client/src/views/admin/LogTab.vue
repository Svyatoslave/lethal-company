<script setup lang="ts">
import { reactive } from 'vue';
import type { Game } from '../../lib/game';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import LogView from '../../components/LogView.vue';

const props = defineProps<{ game: Game }>();
const { state, act, busy } = props.game;

const ev = reactive({ type: 'SYSTEM', level: 'warn', visibility: 'all', text: '' });
const PRESETS = [
  { type: 'THREAT', level: 'warn', text: 'Unidentified movement detected near the greenhouse.' },
  { type: 'WARNING', level: 'crit', text: 'Atmospheric anomaly. Visibility reduced.' },
  { type: 'SYSTEM', level: 'info', text: 'Company reminder: productivity is mandatory.' },
  { type: 'COMMS', level: 'warn', text: 'Interference detected on all channels.' },
];
async function send() {
  const r = await act('ev', 'POST', '/admin/events', { ...ev }, 'Событие опубликовано');
  if (r) ev.text = '';
}
</script>

<template>
  <TPanel title="ИГРОВОЕ СОБЫТИЕ" code="L-01">
    <form class="stack" @submit.prevent="send">
      <div class="a-grid3">
        <select v-model="ev.type" class="select">
          <option v-for="t in ['SYSTEM', 'THREAT', 'WARNING', 'COMMS', 'GATE', 'CREW', 'SCRAP']" :key="t">{{ t }}</option>
        </select>
        <select v-model="ev.level" class="select">
          <option value="info">INFO</option>
          <option value="ok">OK</option>
          <option value="warn">WARN</option>
          <option value="crit">CRIT</option>
        </select>
        <select v-model="ev.visibility" class="select">
          <option value="all">ВСЕМ</option>
          <option value="staff">ПЕРСОНАЛУ</option>
          <option value="admin">ТОЛЬКО МНЕ</option>
        </select>
      </div>
      <input v-model="ev.text" class="input" maxlength="300" placeholder="ТЕКСТ СОБЫТИЯ" />
      <div class="a-chips">
        <button v-for="p in PRESETS" :key="p.text" type="button" class="a-chip pr" @click="Object.assign(ev, p)">{{ p.text }}</button>
      </div>
      <TButton variant="solid" block :disabled="!ev.text.trim()" :busy="busy.has('ev')" @click="send">ОПУБЛИКОВАТЬ</TButton>
      <p class="a-note">WARN и CRIT появляются как тревога на экранах. Видимость «ВСЕМ» включает телефоны экипажа.</p>
    </form>
  </TPanel>
  <TPanel title="EVENT LOG" code="L-02" flush>
    <div class="log"><LogView :events="state?.events ?? []" show-actor dense /></div>
  </TPanel>
</template>

<style scoped>
.pr {
  min-height: 36px;
  font-size: 11px;
  font-family: var(--sans);
  letter-spacing: 0;
  text-align: left;
}
.log {
  height: 62vh;
}
</style>
