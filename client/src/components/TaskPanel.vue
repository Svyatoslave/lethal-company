<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { Game } from '../lib/game';
import { toast } from '../lib/toast';
import { cr } from '../lib/format';
import TPanel from './ui/TPanel.vue';
import TButton from './ui/TButton.vue';
import TChip from './ui/TChip.vue';

const props = defineProps<{ game: Game; employee?: boolean }>();
const { state, act, busy } = props.game;
const tasks = computed(() => state.value?.tasks ?? []);
const answers = reactive<Record<number, string>>({});
const labels = { available: 'ОЖИДАНИЕ СКАНА', active: 'НА СВЯЗИ', completed: 'ВЫПОЛНЕНО' };

async function submit(id: number) {
  const r = await act<{ correct: boolean; already: boolean }>(`task${id}`, 'POST', `/tasks/${id}/answer`, { answer: answers[id] });
  if (!r) return;
  if (r.correct) { answers[id] = ''; toast(r.already ? 'Задание уже выполнено' : 'Терминал разблокирован', 'ok'); }
  else toast('Код не принят. Уточните ответ у оператора.', 'warn');
}
</script>

<template>
  <TPanel title="TERMINAL LINK" code="T-01">
    <p class="note">{{ employee ? 'Сканируйте QR терминала. Свяжитесь с оператором и вместе найдите код.' : 'После сканирования терминала сотрудником здесь появится ваша часть задания. Передайте решение по связи.' }}</p>
    <div v-if="!tasks.length" class="empty">// НЕТ ЗАДАНИЙ</div>
    <article v-for="t in tasks" :key="t.id" class="task">
      <div class="row wrap">
        <b class="mono grow">{{ t.name }}</b>
        <TChip :label="labels[t.status]" :tone="t.status === 'completed' ? 'ok' : t.status === 'active' ? 'warn' : 'mute'" />
      </div>
      <div class="mono small dim">{{ t.callsign ?? 'ТЕРМИНАЛ СВОБОДЕН' }} · {{ cr(t.reward) }} CR</div>
      <template v-if="t.status !== 'available'">
        <p class="text">{{ employee ? t.employeeText : t.operatorText }}</p>
      </template>
      <form v-if="employee && t.status === 'active'" class="row" @submit.prevent="submit(t.id)">
        <input v-model="answers[t.id]" class="input grow" maxlength="80" autocomplete="off" placeholder="КОД ТЕРМИНАЛА" :aria-label="`Ответ: ${t.name}`" />
        <TButton :disabled="state?.mission?.status !== 'active' || !answers[t.id]?.trim()" :busy="busy.has(`task${t.id}`)" @click="submit(t.id)">ВВЕСТИ</TButton>
      </form>
    </article>
  </TPanel>
</template>

<style scoped>
.note { margin: 0 0 12px; color: var(--text-dim); font-size: 13px; }
.task { display: flex; flex-direction: column; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); }
.text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
