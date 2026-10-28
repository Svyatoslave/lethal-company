<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Game } from '../../lib/game';
import { LOOT_TONE, clock, cr } from '../../lib/format';
import { toast } from '../../lib/toast';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';

const props = defineProps<{ game: Game }>();
const { state, act, busy } = props.game;
const m = computed(() => state.value?.mission ?? null);
const loot = computed(() => state.value?.loot ?? []);
const total = computed(() => loot.value.reduce((s, l) => s + l.value, 0));

const gen = reactive({ count: 10, min: 20, max: 120 });
const one = reactive({ name: '', value: 50, description: '' });
const list = ref('');
const open = ref<number | null>(null);
const edit = reactive({ name: '', value: 0, description: '' });

const IMPORT_EXAMPLE = 'Медный самовар; 120; Пыхтит, даже когда холодный.\nКлюч от бани; 40; Не подходит ни к одной двери.\nДедушкин баян; 200';
const parsedCount = computed(() => list.value.split(/\r?\n/).filter((l) => l.trim()).length);

function toggle(id: number) {
  const l = loot.value.find((x) => x.id === id);
  if (!l) return;
  open.value = open.value === id ? null : id;
  edit.name = l.name;
  edit.value = l.value;
  edit.description = l.description;
}
async function addOne() {
  const r = await act('one', 'POST', '/loot', { ...one }, 'Предмет добавлен');
  if (r) {
    one.name = '';
    one.description = '';
  }
}
async function importList() {
  const r = await act<{ count: number }>('imp', 'POST', '/loot/import', { list: list.value });
  if (r) {
    list.value = '';
    toast(`Добавлено предметов: ${r.count}`, 'ok');
  }
}
async function saveEdit(id: number, extracted: boolean) {
  const body = extracted ? { name: edit.name, description: edit.description } : { ...edit };
  const r = await act(`ed${id}`, 'PATCH', `/loot/${id}`, body, 'Сохранено');
  if (r) open.value = null;
}
</script>

<template>
  <p v-if="m?.status === 'draft'" class="a-note">
    Миссия ещё не запущена — самое время завести предметы и распечатать метки. При создании следующей миссии
    включите «Перенести предметы», и распечатанные QR продолжат работать.
  </p>

  <TPanel title="СПИСОК ПРЕДМЕТОВ" code="S-01">
    <p class="a-note">По одному предмету в строке: <b class="mono">Название; ценность; описание</b>. Описание можно не писать.</p>
    <textarea v-model="list" class="textarea imp top" :placeholder="IMPORT_EXAMPLE" spellcheck="false" />
    <TButton class="top" variant="solid" block :disabled="!parsedCount" :busy="busy.has('imp')" @click="importList">
      ДОБАВИТЬ ИЗ СПИСКА{{ parsedCount ? ` (${parsedCount})` : '' }}
    </TButton>
  </TPanel>

  <TPanel title="ОДИН ПРЕДМЕТ" code="S-02">
    <div class="row">
      <input v-model="one.name" class="input grow" maxlength="60" placeholder="НАЗВАНИЕ" />
      <input v-model.number="one.value" class="input val" type="number" min="1" />
    </div>
    <textarea v-model="one.description" class="textarea top" maxlength="300" placeholder="Описание — игрок увидит его после сканирования" />
    <TButton class="top" block :disabled="!one.name.trim()" :busy="busy.has('one')" @click="addOne">+ ДОБАВИТЬ</TButton>
    <div class="hr" />
    <div class="label">Или сгенерировать случайные (с описаниями)</div>
    <div class="a-grid3 top">
      <label class="field"><span class="label">Кол-во</span><input v-model.number="gen.count" class="input" type="number" min="1" max="200" /></label>
      <label class="field"><span class="label">Мин CR</span><input v-model.number="gen.min" class="input" type="number" min="1" /></label>
      <label class="field"><span class="label">Макс CR</span><input v-model.number="gen.max" class="input" type="number" min="1" /></label>
    </div>
    <TButton class="top" variant="ghost" block :busy="busy.has('gen')" @click="act('gen', 'POST', '/loot', { count: gen.count, min: gen.min, max: gen.max }, 'Предметы созданы')">СГЕНЕРИРОВАТЬ</TButton>
  </TPanel>

  <TPanel title="ПРЕДМЕТЫ МИССИИ" code="S-03">
    <template #actions><span class="a-sub">{{ loot.length }} · {{ cr(total) }} CR</span></template>
    <RouterLink to="/print" target="_blank" class="print mono">▤ ПЕЧАТЬ И СКАЧИВАНИЕ QR-МЕТОК</RouterLink>
    <div class="row radar">
      <span class="grow a-sub">SCRAP RADAR: {{ state?.mission?.scrapRadar ? 'установлен — оператор и экипаж видят весь лут' : 'нет — оператор видит только отсканированное' }}</span>
      <TButton size="sm" variant="ghost" :confirm="state?.mission?.scrapRadar ? 'ОТКЛЮЧИТЬ?' : 'ВЫДАТЬ?'" :busy="busy.has('radar')" @click="act('radar', 'PATCH', '/missions/current', { scrapRadar: !state?.mission?.scrapRadar })">
        {{ state?.mission?.scrapRadar ? 'ЗАБРАТЬ' : 'ВЫДАТЬ' }}
      </TButton>
    </div>
    <p class="a-note">Оператор засчитывает только отсканированные предметы. Вы можете засчитать любой (кнопка EXTRACT у предмета), например если метка потерялась.</p>
    <div v-if="!loot.length" class="empty">// НЕТ ПРЕДМЕТОВ</div>
    <div v-for="l in loot" :key="l.id" class="a-item">
      <div class="row" @click="toggle(l.id)">
        <span class="mono code">{{ l.code }}</span>
        <span class="grow ellipsis">{{ l.name }}</span>
        <span class="mono acc">{{ l.value }}</span>
        <TChip :label="l.status" :tone="LOOT_TONE[l.status]" />
      </div>
      <div v-if="l.description && open !== l.id" class="desc" @click="toggle(l.id)">{{ l.description }}</div>
      <div v-if="l.foundBy" class="a-sub">найден: {{ l.foundBy }} · {{ clock(l.foundAt) }}<template v-if="l.extractedAt"> · извлечён {{ clock(l.extractedAt) }}</template></div>
      <div v-if="open === l.id" class="stack">
        <div class="row">
          <input v-model="edit.name" class="input grow" maxlength="60" />
          <input v-model.number="edit.value" class="input val" type="number" min="1" :disabled="l.status === 'extracted'" />
        </div>
        <textarea v-model="edit.description" class="textarea" maxlength="300" placeholder="Описание" />
        <div class="a-grid2">
          <TButton :busy="busy.has(`ed${l.id}`)" @click="saveEdit(l.id, l.status === 'extracted')">СОХРАНИТЬ</TButton>
          <TButton v-if="l.status !== 'extracted'" variant="solid" confirm="ИЗВЛЕЧЬ?" :busy="busy.has(`ex${l.id}`)" @click="act(`ex${l.id}`, 'POST', `/loot/${l.id}/extract`)">EXTRACT</TButton>
          <TButton v-if="l.status === 'found'" variant="warn" confirm="СБРОСИТЬ СКАН?" :busy="busy.has(`rs${l.id}`)" @click="act(`rs${l.id}`, 'POST', `/loot/${l.id}/reset`)">СБРОС СКАНА</TButton>
          <TButton v-if="l.status === 'extracted'" variant="warn" confirm="ОТМЕНИТЬ?" :busy="busy.has(`un${l.id}`)" @click="act(`un${l.id}`, 'POST', `/loot/${l.id}/undo`, undefined, 'Извлечение отменено, кредиты списаны')">ОТМЕНИТЬ ИЗВЛЕЧЕНИЕ</TButton>
          <TButton v-if="l.status !== 'extracted'" variant="danger" confirm="УДАЛИТЬ?" :busy="busy.has(`dl${l.id}`)" @click="act(`dl${l.id}`, 'DELETE', `/loot/${l.id}`)">УДАЛИТЬ</TButton>
        </div>
      </div>
    </div>
  </TPanel>
</template>

<style scoped>
.top {
  margin-top: 10px;
}
.val {
  width: 96px;
}
.imp {
  min-height: 150px;
  font-size: 13px;
  line-height: 1.5;
}
.code {
  font-size: 12px;
  color: var(--text-dim);
}
.desc {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.35;
  cursor: pointer;
}
.a-item > .row:first-child {
  cursor: pointer;
}
.radar {
  margin-bottom: 8px;
}
.print {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  min-height: 48px;
  border: 1px dashed var(--acc-2);
  color: var(--acc);
  text-decoration: none;
  font-size: 12.5px;
  letter-spacing: 0.1em;
}
</style>
