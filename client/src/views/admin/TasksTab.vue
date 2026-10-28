<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Game } from '../../lib/game';
import type { TaskView } from '@shared/types';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';
import { renderLabel, safeName, saveBlob } from '../../lib/label';
import { toast } from '../../lib/toast';

const props = defineProps<{ game: Game }>();
const { state, act, busy } = props.game;
const tasks = computed(() => state.value?.tasks ?? []);
const edit = ref<number | null>(null);
const blank = () => ({ name: '', employeeText: '', operatorText: '', answer: '', reward: 100, maxAttempts: 3 });
const form = reactive(blank());
const downloading = ref<number | null>(null);
const labels = { available: 'СВОБОДЕН', active: 'ЗАНЯТ', completed: 'ВЫПОЛНЕНО', locked: 'ЗАБЛОКИРОВАН' };
const tones = { available: 'mute', active: 'warn', completed: 'ok', locked: 'crit' } as const;

function reset() { edit.value = null; Object.assign(form, blank()); }
function example() {
  edit.value = null;
  Object.assign(form, { name: 'ЩИТОК B-12', employeeText: 'На щитке горит жёлтый индикатор. Сообщите цвет оператору и введите код разблокировки.',
    operatorText: 'Справочник B-12: красный → 2194; жёлтый → 7316; синий → 4082. Уточните цвет индикатора у сотрудника.', answer: '7316', reward: 100, maxAttempts: 3 });
}
function open(t: TaskView) {
  edit.value = t.id;
  Object.assign(form, { name: t.name, employeeText: t.employeeText, operatorText: t.operatorText ?? '', answer: t.answer ?? '', reward: t.reward, maxAttempts: t.maxAttempts });
  window.scrollTo({ top: 0 });
}
async function save() {
  const r = await act('taskSave', edit.value === null ? 'POST' : 'PATCH', edit.value === null ? '/tasks' : `/tasks/${edit.value}`, { ...form }, 'Задание сохранено');
  if (r) reset();
}
async function download(t: TaskView) {
  if (!t.token || downloading.value !== null) return;
  downloading.value = t.id;
  try {
    const url = `${window.location.origin}/t/${t.token}`;
    saveBlob(await renderLabel({ header: 'COMPANY TERMINAL', code: `T-${t.id}`, title: t.name, url,
      footer: 'СВЯЖИТЕСЬ С ОПЕРАТОРОМ · ВВЕДИТЕ КОД' }), `terminal_${t.id}_${safeName(t.name)}.png`);
  } catch (e) { toast((e as Error).message, 'crit'); }
  finally { downloading.value = null; }
}
</script>

<template>
  <TPanel :title="edit === null ? 'НОВЫЙ ТЕРМИНАЛ' : 'ИЗМЕНИТЬ ТЕРМИНАЛ'" code="T-01">
    <p class="a-note">Один QR — одно общее задание на миссию. Сотрудник видит свою инструкцию, оператор получает справочник после сканирования. Правильный ответ виден только ведущему.</p>
    <div class="stack top">
      <input v-model="form.name" class="input" maxlength="60" placeholder="НАЗВАНИЕ ТЕРМИНАЛА" aria-label="Название терминала" />
      <label class="field"><span class="label">ИНСТРУКЦИЯ СОТРУДНИКУ</span><textarea v-model="form.employeeText" class="textarea" maxlength="600" /></label>
      <label class="field"><span class="label">СПРАВОЧНИК ОПЕРАТОРА</span><textarea v-model="form.operatorText" class="textarea" maxlength="600" /></label>
      <div class="a-grid2">
        <label class="field"><span class="label">ПРАВИЛЬНЫЙ ОТВЕТ</span><input v-model="form.answer" class="input" maxlength="80" autocomplete="off" /></label>
        <label class="field"><span class="label">НАГРАДА, CR</span><input v-model.number="form.reward" class="input" type="number" min="0" max="1000000" /></label>
        <label class="field"><span class="label">ЛИМИТ ПОПЫТОК (0 = БЕЗ ЛИМИТА)</span><input v-model.number="form.maxAttempts" class="input" type="number" min="0" max="99" /></label>
      </div>
      <p class="a-note">Неверные ответы считаются на терминал. Когда попытки кончились, терминал блокируется: награды нет, пока вы его не разблокируете.</p>
      <TButton variant="solid" block :busy="busy.has('taskSave')" :disabled="!state?.mission || state.mission.status === 'ended' || !form.name.trim() || !form.employeeText.trim() || !form.operatorText.trim() || !form.answer.trim()" @click="save">СОХРАНИТЬ</TButton>
      <div class="row"><TButton variant="ghost" class="grow" @click="example">ЗАПОЛНИТЬ ПРИМЕР</TButton><TButton v-if="edit !== null" variant="ghost" @click="reset">ОТМЕНА</TButton></div>
    </div>
  </TPanel>
  <TPanel title="ТЕРМИНАЛЫ МИССИИ" code="T-02">
    <p class="a-note">Скачайте QR в PNG и разместите на площадке. Открывайте админку по адресу, доступному с телефонов: этот адрес попадёт в QR. Награда начисляется в баланс, а не в квоту лута.</p>
    <div v-if="!tasks.length" class="empty">// НЕТ ТЕРМИНАЛОВ</div>
    <article v-for="t in tasks" :key="t.id" class="a-item">
      <div class="row wrap"><b class="grow mono">{{ t.name }}</b><TChip :label="labels[t.status]" :tone="tones[t.status]" :pulse="t.status === 'locked'" /></div>
      <span class="a-sub">{{ t.callsign ?? 'НЕТ СОТРУДНИКА' }} · {{ t.reward }} CR · ОТВЕТ: {{ t.answer }} · ПОПЫТКИ {{ t.attempts }}/{{ t.maxAttempts || '∞' }}</span>
      <p class="text">{{ t.employeeText }}</p><p class="text dim">ОПЕРАТОР: {{ t.operatorText }}</p>
      <div class="row wrap">
        <TButton :busy="downloading === t.id" @click="download(t)">QR · PNG</TButton>
        <TButton v-if="t.status === 'available'" variant="ghost" @click="open(t)">ИЗМЕНИТЬ</TButton>
        <TButton v-if="t.status === 'available'" variant="danger" confirm="УДАЛИТЬ ТЕРМИНАЛ?" :busy="busy.has(`delTask${t.id}`)" @click="act(`delTask${t.id}`, 'DELETE', `/tasks/${t.id}`)">УДАЛИТЬ</TButton>
        <TButton v-if="t.status === 'locked'" variant="warn" confirm="РАЗБЛОКИРОВАТЬ?" :busy="busy.has(`releaseTask${t.id}`)" @click="act(`releaseTask${t.id}`, 'POST', `/tasks/${t.id}/release`, undefined, 'Терминал разблокирован, попытки сброшены')">РАЗБЛОКИРОВАТЬ</TButton>
        <TButton v-if="t.status === 'active'" variant="warn" confirm="ОСВОБОДИТЬ ТЕРМИНАЛ?" :busy="busy.has(`releaseTask${t.id}`)" @click="act(`releaseTask${t.id}`, 'POST', `/tasks/${t.id}/release`)">ОСВОБОДИТЬ</TButton>
      </div>
    </article>
  </TPanel>
</template>

<style scoped>
.top { margin-top: 12px; }
.text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
