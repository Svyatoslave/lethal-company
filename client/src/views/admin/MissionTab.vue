<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Game } from '../../lib/game';
import { MISSION_LABEL, clock, cr, missionElapsed, mmss } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';

const props = defineProps<{ game: Game }>();
const { state, now, act, busy } = props.game;
const m = computed(() => state.value?.mission ?? null);

const draft = reactive({ name: 'NIGHT RAID', quota: 1000, startBalance: 300, durationMin: 15, overdueDamage: 50, monsterDamage: 50, crewSize: 4, copyLoot: true });
const settings = reactive({ name: '', quota: 0, durationMin: 0, overdueDamage: 50, crewSize: 4 });
const showNew = ref(false);

watch(
  m,
  (v) => {
    if (!v) return;
    settings.name = v.name;
    settings.quota = v.quota;
    settings.durationMin = Math.round((v.durationSec / 60) * 10) / 10;
    settings.overdueDamage = v.overdueDamage;
    settings.crewSize = v.crewSize;
  },
  { immediate: true },
);

async function create() {
  const r = await act('create', 'POST', '/missions', {
    name: draft.name,
    quota: draft.quota,
    startBalance: draft.startBalance,
    durationSec: Math.round(draft.durationMin * 60),
    overdueDamage: draft.overdueDamage,
    monsterDamage: draft.monsterDamage,
    crewSize: draft.crewSize,
    copyLoot: draft.copyLoot,
  }, 'Миссия создана');
  if (r) showNew.value = false;
}
function save() {
  void act('save', 'PATCH', '/missions/current', {
    name: settings.name,
    quota: settings.quota,
    durationSec: Math.round(settings.durationMin * 60),
    overdueDamage: settings.overdueDamage,
    crewSize: settings.crewSize,
  }, 'Настройки сохранены');
}
</script>

<template>
  <TPanel v-if="m" title="MISSION CONTROL" code="M-01">
    <div class="a-kv"><span>Миссия</span><span>{{ m.code }} · {{ m.name }}</span></div>
    <div class="a-kv"><span>Статус</span><span>{{ MISSION_LABEL[m.status] }}</span></div>
    <div class="a-kv"><span>Время рейда</span><span>{{ mmss(missionElapsed(m, now)) }}</span></div>
    <div class="a-kv"><span>Старт</span><span>{{ clock(m.startedAt) }}</span></div>
    <div class="a-kv"><span>Квота</span><span>{{ cr(state?.quotaProgress ?? 0) }} / {{ cr(m.quota) }} CR</span></div>
    <div class="a-kv"><span>Предметы</span><span>{{ state?.lootStats.found }} найдено · {{ state?.lootStats.extracted }} извлечено · {{ state?.lootStats.total ?? '?' }} всего</span></div>
    <div class="stack top">
      <TButton v-if="m.status === 'draft'" variant="solid" size="xl" block :busy="busy.has('start')" @click="act('start', 'POST', '/missions/current/start', undefined, 'Миссия запущена')">
        ▶ ЗАПУСТИТЬ МИССИЮ
      </TButton>
      <TButton v-if="m.status !== 'ended'" variant="danger" size="lg" block confirm="ЗАВЕРШИТЬ МИССИЮ?" :busy="busy.has('end')" @click="act('end', 'POST', '/missions/current/end')">
        ЗАВЕРШИТЬ МИССИЮ
      </TButton>
      <div class="a-grid2">
        <RouterLink to="/print" class="lnk mono" target="_blank">▤ ПЕЧАТЬ QR</RouterLink>
        <RouterLink to="/operator" class="lnk mono" target="_blank">▣ ТЕРМИНАЛ</RouterLink>
      </div>
    </div>
  </TPanel>

  <TPanel v-if="m && m.status !== 'ended'" title="ПАРАМЕТРЫ" code="M-02">
    <form class="stack" @submit.prevent="save">
      <label class="field"><span class="label">Название</span><input v-model="settings.name" class="input" /></label>
      <div class="a-grid2">
        <label class="field"><span class="label">Квота, CR</span><input v-model.number="settings.quota" class="input" type="number" min="0" /></label>
        <label class="field"><span class="label">Вылазка, мин</span><input v-model.number="settings.durationMin" class="input" type="number" min="0.5" step="0.5" /></label>
        <label class="field"><span class="label">Опоздание, −% HP</span><input v-model.number="settings.overdueDamage" class="input" type="number" min="0" max="100" /></label>
        <label class="field"><span class="label">Размер группы</span><input v-model.number="settings.crewSize" class="input" type="number" min="1" max="12" /></label>
      </div>
      <TButton block :busy="busy.has('save')" @click="save">СОХРАНИТЬ</TButton>
      <p class="a-note">Длительность применяется к следующей сформированной группе. Награды за предметы — во вкладке SCRAP, цены — в ECONOMY.</p>
    </form>
  </TPanel>

  <TPanel v-if="!m || m.status === 'ended' || showNew" title="НОВАЯ МИССИЯ" code="M-00" :tone="m && m.status !== 'ended' ? 'warn' : undefined">
    <form class="stack" @submit.prevent="create">
      <p v-if="m && m.status !== 'ended'" class="a-note a-warn">Текущая миссия {{ m.code }} будет архивирована.</p>
      <label class="field"><span class="label">Название</span><input v-model="draft.name" class="input" /></label>
      <div class="a-grid2">
        <label class="field"><span class="label">Квота, CR</span><input v-model.number="draft.quota" class="input" type="number" min="0" /></label>
        <label class="field"><span class="label">Стартовый баланс</span><input v-model.number="draft.startBalance" class="input" type="number" min="0" /></label>
        <label class="field"><span class="label">Вылазка, мин</span><input v-model.number="draft.durationMin" class="input" type="number" min="0.5" step="0.5" /></label>
        <label class="field"><span class="label">Опоздание, −% HP</span><input v-model.number="draft.overdueDamage" class="input" type="number" min="0" max="100" /></label>
        <label class="field"><span class="label">Удар монстра, −% HP</span><input v-model.number="draft.monsterDamage" class="input" type="number" min="0" max="100" /></label>
        <label class="field"><span class="label">Размер группы</span><input v-model.number="draft.crewSize" class="input" type="number" min="1" max="12" /></label>
      </div>
      <label v-if="m" class="check"><input v-model="draft.copyLoot" type="checkbox" /> Перенести предметы (те же QR-метки)</label>
      <TButton variant="solid" size="lg" block :busy="busy.has('create')" @click="create">СОЗДАТЬ МИССИЮ</TButton>
    </form>
  </TPanel>
  <TButton v-if="m && m.status !== 'ended' && !showNew" variant="ghost" block @click="showNew = true">+ НОВАЯ МИССИЯ…</TButton>
</template>

<style scoped>
.top {
  margin-top: 14px;
}
.lnk {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  border: 1px solid var(--line-2);
  color: var(--text-dim);
  text-decoration: none;
  font-size: 12.5px;
  letter-spacing: 0.1em;
}
</style>
