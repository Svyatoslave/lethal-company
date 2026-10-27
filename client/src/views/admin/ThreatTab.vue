<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Game } from '../../lib/game';
import type { MonsterActionType } from '@shared/types';
import { clock } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';

const props = defineProps<{ game: Game }>();
const { state, act, busy } = props.game;
const m = computed(() => state.value?.mission ?? null);
const monsters = computed(() => state.value?.players.filter((p) => p.role === 'monster') ?? []);
const crew = computed(() =>
  [...(state.value?.players.filter((p) => p.role === 'crew') ?? [])].sort(
    (a, b) => Number(b.status !== 'AT_BASE') - Number(a.status !== 'AT_BASE'),
  ),
);
const monsterId = ref<number | null>(null);
const targetId = ref<number | null>(null);
const text = ref('');

// Effects are deliberately static and safe: standing still, silence, walking — never running or contact.
const EFFECTS = [
  'ЗАМРИ на 15 секунд',
  'ВЫКЛЮЧИ ФОНАРЬ на 20 секунд и стой на месте',
  'ТИШИНА: молчи 1 минуту',
  'СБРОС ГРУЗА: оставь один найденный предмет на месте',
  'ДЕЗОРИЕНТАЦИЯ: медленно повернись 3 раза',
  'ОТХОД: вернись к последнему ориентиру шагом',
];
const ORDERS = ['Займи позицию у сарая', 'Издай звук и замри', 'Медленно пройди мимо группы', 'Спрячься и жди 2 минуты', 'Вернись на исходную'];

function fire(action: MonsterActionType) {
  void act(`m-${action}`, 'POST', '/admin/monster', {
    action,
    monsterId: monsterId.value ?? undefined,
    targetPlayerId: targetId.value ?? undefined,
    text: text.value || undefined,
  }, 'Событие отправлено').then((r) => {
    if (r) text.value = '';
  });
}

const pending = computed(() => state.value?.purchases.filter((p) => ['scanner', 'extraction'].includes(p.itemKey) && !p.fulfilledAt) ?? []);
const hints = reactive<Record<number, string>>({});
const LABEL: Record<string, string> = { warning: 'WARNING', spawn: 'SPAWN', effect: 'EFFECT', false_alarm: 'FALSE ALARM', order: 'ORDER' };
</script>

<template>
  <TPanel v-for="p in pending" :key="p.id" :title="p.itemName" code="REQ" tone="warn">
    <template v-if="p.itemKey === 'scanner'">
      <p class="a-note">Оператор купил сканер. Дайте подсказку: где опасность или где искать лут.</p>
      <textarea v-model="hints[p.id]" class="textarea top" maxlength="300" placeholder="Напр.: «Сильный сигнал металла у бани. Движение за теплицей.»" />
      <TButton class="top" variant="warn" block :disabled="!hints[p.id]?.trim()" :busy="busy.has(`sc${p.id}`)" @click="act(`sc${p.id}`, 'POST', `/purchases/${p.id}/scanner`, { hint: hints[p.id] }, 'Подсказка отправлена оператору')">ОТПРАВИТЬ РЕЗУЛЬТАТ СКАНА</TButton>
    </template>
    <template v-else>
      <p class="a-note">Куплена экстренная эвакуация. Все за шлюзом получат приказ вернуться шагом, штрафы за опоздание в этой вылазке отменяются.</p>
      <TButton class="top" variant="danger" size="lg" block confirm="ЭВАКУАЦИЯ?" :busy="busy.has(`ev${p.id}`)" @click="act(`ev${p.id}`, 'POST', `/purchases/${p.id}/extraction`)">ИНИЦИИРОВАТЬ ЭВАКУАЦИЮ</TButton>
    </template>
  </TPanel>

  <TPanel title="THREAT LEVEL" code="T-01">
    <div class="lvls">
      <button
        v-for="l in 6" :key="l" type="button" class="lv mono" :class="{ on: (m?.threatLevel ?? 0) === l - 1, hot: l - 1 >= 4 }"
        :disabled="busy.has('lvl')" @click="act('lvl', 'POST', '/admin/threat', { level: l - 1 })"
      >{{ l - 1 }}</button>
    </div>
  </TPanel>

  <TPanel title="THREAT CONTROL" code="T-02">
    <div class="stack">
      <div class="field">
        <span class="label">Активный монстр</span>
        <div class="a-chips">
          <button type="button" class="a-chip" :class="{ on: monsterId === null }" @click="monsterId = null">—</button>
          <button v-for="mo in monsters" :key="mo.id" type="button" class="a-chip red" :class="{ on: monsterId === mo.id }" @click="monsterId = mo.id">
            {{ mo.callsign }}{{ mo.online ? '' : ' ✕' }}
          </button>
        </div>
        <span v-if="!monsters.length" class="a-sub">Нет монстров: назначьте роль MONSTER во вкладке CREW.</span>
      </div>
      <div class="field">
        <span class="label">Цель</span>
        <div class="a-chips">
          <button type="button" class="a-chip" :class="{ on: targetId === null }" @click="targetId = null">ВСЕ</button>
          <button v-for="c in crew" :key="c.id" type="button" class="a-chip" :class="{ on: targetId === c.id }" @click="targetId = c.id">
            {{ c.callsign }}{{ c.status !== 'AT_BASE' ? ' •' : '' }}
          </button>
        </div>
      </div>
      <label class="field">
        <span class="label">Текст / эффект</span>
        <input v-model="text" class="input" maxlength="300" placeholder="необязательно" />
      </label>
      <div class="a-chips">
        <button v-for="e in EFFECTS" :key="e" type="button" class="a-chip preset" @click="text = e">{{ e }}</button>
      </div>
      <div class="a-grid2 acts">
        <TButton variant="warn" size="lg" :busy="busy.has('m-warning')" @click="fire('warning')">ДВИЖЕНИЕ</TButton>
        <TButton variant="danger" size="lg" :busy="busy.has('m-spawn')" @click="fire('spawn')">ПОЯВЛЕНИЕ</TButton>
        <TButton variant="danger" size="lg" :disabled="!targetId" :busy="busy.has('m-effect')" @click="fire('effect')">ЭФФЕКТ НА ЦЕЛЬ</TButton>
        <TButton variant="ghost" size="lg" :busy="busy.has('m-false_alarm')" @click="fire('false_alarm')">ЛОЖНАЯ ТРЕВОГА</TButton>
      </div>
      <div class="hr" />
      <div class="field">
        <span class="label">Приказ монстру (виден только ему)</span>
        <div class="a-chips">
          <button v-for="o in ORDERS" :key="o" type="button" class="a-chip preset" @click="text = o">{{ o }}</button>
        </div>
      </div>
      <TButton size="lg" block :disabled="!monsterId || !text.trim()" :busy="busy.has('m-order')" @click="fire('order')">ОТПРАВИТЬ ПРИКАЗ</TButton>
      <p class="a-note a-warn">Только безопасные игровые эффекты: шагом, без физического контакта, в пределах территории.</p>
    </div>
  </TPanel>

  <TPanel title="ЖУРНАЛ УГРОЗ" code="T-03">
    <div v-if="!state?.monsterActions.length" class="empty">// ПУСТО</div>
    <div v-for="a in state?.monsterActions ?? []" :key="a.id" class="ma mono">
      <span class="mute">{{ clock(a.createdAt, false) }}</span>
      <b>{{ LABEL[a.action] }}</b>
      <span v-if="a.monster" class="red">{{ a.monster }}</span>
      <span v-if="a.target">→ {{ a.target }}</span>
      <span class="dim">{{ a.text }}</span>
    </div>
  </TPanel>
</template>

<style scoped>
.top {
  margin-top: 10px;
}
.lvls {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.lv {
  min-height: 60px;
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  color: var(--text-dim);
  font-size: 22px;
  font-weight: 800;
}
.lv.on {
  background: var(--amber);
  border-color: var(--amber);
  color: #000;
}
.lv.on.hot {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
}
.acts :deep(.btn) {
  padding: 0 6px;
  letter-spacing: 0.03em;
}
.preset {
  min-height: 36px;
  font-size: 11.5px;
  font-family: var(--sans);
  letter-spacing: 0;
  text-align: left;
}
.ma {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  padding: 5px 0;
  border-bottom: 1px solid var(--line);
}
</style>
