<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Game } from '../../lib/game';
import type { MonsterActionType } from '@shared/types';
import { clock } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import MessageList from '../../components/MessageList.vue';

const props = defineProps<{ game: Game }>();
const { state, now, act, busy } = props.game;
const m = computed(() => state.value?.mission ?? null);
const monsters = computed(() => state.value?.players.filter((p) => p.role === 'monster') ?? []);
const crew = computed(() =>
  [...(state.value?.players.filter((p) => p.role === 'crew') ?? [])].sort(
    (a, b) => Number(b.status !== 'AT_BASE') - Number(a.status !== 'AT_BASE'),
  ),
);

// ---- monster damage / rage
const rage = computed(() => (m.value?.monsterDamage ?? 0) >= 100);
const customDamage = ref(50);
watch(() => m.value?.monsterDamage, (d) => d !== undefined && (customDamage.value = d), { immediate: true });
const setDamage = (d: number, ok: string) => act('dmg', 'PATCH', '/missions/current', { monsterDamage: d }, ok);
const infectionHits = ref(1);
watch(() => m.value?.infectionHitsRequired, (n) => n !== undefined && (infectionHits.value = n), { immediate: true });
const setInfectionHits = () => act('ihits', 'PATCH', '/missions/current', { infectionHitsRequired: infectionHits.value }, `Контактов до заражения: ${infectionHits.value}`);

// ---- overdue damage (same idea: a % of HP, announced to everyone when changed)
const customOverdue = ref(50);
watch(() => m.value?.overdueDamage, (d) => d !== undefined && (customOverdue.value = d), { immediate: true });
const setOverdue = (d: number) => act('odmg', 'PATCH', '/missions/current', { overdueDamage: d }, `Урон за опоздание: ${d}%`);

// ---- private chat with monsters (monsters act on their own; this is their only line)
const chatWith = ref<number | null>(null);
watch(monsters, (list) => {
  if (!list.some((x) => x.id === chatWith.value)) chatWith.value = list[0]?.id ?? null;
}, { immediate: true });
const chat = computed(() =>
  (state.value?.messages ?? []).filter(
    (x) => (x.toType === 'player' && x.toPlayerId === chatWith.value) || (x.fromRole === 'player' && x.toType === 'admin' && x.fromCallsign === monsters.value.find((mo) => mo.id === chatWith.value)?.callsign),
  ),
);
const reply = ref('');
async function sendReply() {
  if (!chatWith.value || !reply.value.trim()) return;
  const r = await act('mchat', 'POST', '/messages', { toType: 'player', toPlayerId: chatWith.value, body: reply.value });
  if (r) reply.value = '';
}

// ---- atmospheric threat events (not orders: monsters decide for themselves)
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
function fire(action: MonsterActionType) {
  void act(`m-${action}`, 'POST', '/admin/monster', {
    action,
    targetPlayerId: targetId.value ?? undefined,
    text: text.value || undefined,
  }, 'Событие отправлено').then((r) => {
    if (r) text.value = '';
  });
}

const pending = computed(() => state.value?.purchases.filter((p) => ['scanner', 'extraction'].includes(p.itemKey) && !p.fulfilledAt) ?? []);
const hints = reactive<Record<number, string>>({});
const LABEL: Record<string, string> = { warning: 'WARNING', spawn: 'SPAWN', effect: 'EFFECT', false_alarm: 'FALSE ALARM', order: 'ORDER' };
const KIND: Record<string, string> = { hit: 'УДАР', overdue: 'ОПОЗДАНИЕ', medkit: 'MEDKIT', admin: 'ВЕДУЩИЙ' };
</script>

<template>
  <TPanel v-for="p in pending" :key="p.id" :title="p.itemName" code="REQ" tone="warn">
    <template v-if="p.itemKey === 'scanner'">
      <p class="a-note">Оператор купил сканер. Дайте подсказку: где опасность или где искать лут.</p>
      <textarea v-model="hints[p.id]" class="textarea top" maxlength="300" placeholder="Напр.: «Сильный сигнал металла у бани. Движение за теплицей.»" />
      <TButton class="top" variant="warn" block :disabled="!hints[p.id]?.trim()" :busy="busy.has(`sc${p.id}`)" @click="act(`sc${p.id}`, 'POST', `/purchases/${p.id}/scanner`, { hint: hints[p.id] }, 'Подсказка отправлена оператору')">ОТПРАВИТЬ РЕЗУЛЬТАТ СКАНА</TButton>
    </template>
    <template v-else>
      <p class="a-note">Куплена экстренная эвакуация. Все за шлюзом получат приказ вернуться шагом, урон за опоздание в этой вылазке отменяется.</p>
      <TButton class="top" variant="danger" size="lg" block confirm="ЭВАКУАЦИЯ?" :busy="busy.has(`ev${p.id}`)" @click="act(`ev${p.id}`, 'POST', `/purchases/${p.id}/extraction`)">ИНИЦИИРОВАТЬ ЭВАКУАЦИЮ</TButton>
    </template>
  </TPanel>

  <TPanel title="УРОН МОНСТРОВ" code="T-00" :tone="rage ? 'crit' : undefined">
    <div v-if="m?.infectionMode" class="a-note a-warn">РЕЖИМ ЗАРАЖЕНИЯ: удар не снимает HP. Цель теряет связь с оператором и может заражать других.</div>
    <div class="dmg mono" :class="{ rage }">{{ m?.monsterDamage ?? 0 }}% <small>HP ЗА УДАР</small></div>
    <div class="a-grid2">
      <TButton :variant="!rage ? 'solid' : 'ghost'" size="lg" :disabled="!m || m.monsterDamage === 50" :busy="busy.has('dmg')" @click="setDamage(50, 'Урон монстров: 50%')">ОБЫЧНЫЙ 50%</TButton>
      <TButton variant="danger" size="lg" :disabled="!m || rage" confirm="ВСЕМ ПРИДЁТ ТРЕВОГА. ДА?" :busy="busy.has('dmg')" @click="setDamage(100, 'Ярость включена')">ЯРОСТЬ 100%</TButton>
    </div>
    <div class="row top">
      <input v-model.number="customDamage" class="input grow" type="number" min="0" max="100" />
      <TButton variant="ghost" :busy="busy.has('dmg')" @click="setDamage(customDamage, `Урон монстров: ${customDamage}%`)">ЗАДАТЬ %</TButton>
    </div>
    <p class="a-note top">Любое изменение урона объявляется всем устройствам. Ярость — для финала игры: один удар забирает всё здоровье.</p>
  </TPanel>

  <TPanel v-if="m?.infectionMode" title="ПОРОГ ЗАРАЖЕНИЯ" code="T-0H">
    <div class="row">
      <input v-model.number="infectionHits" class="input grow" type="number" min="1" max="20" />
      <TButton :busy="busy.has('ihits')" @click="setInfectionHits">СОХРАНИТЬ</TButton>
    </div>
    <p class="a-note top">Сколько подтверждённых касаний нужно одной цели до заражения. Уже нанесённые контакты сохраняются.</p>
  </TPanel>

  <TPanel v-if="m?.infectionMode" title="ЗАРАЖЁННЫЕ" code="T-0I" tone="crit">
    <div v-if="!crew.some((p) => p.infected)" class="empty">// ЗАРАЖЕНИЕ НЕ ОБНАРУЖЕНО</div>
    <div v-for="p in crew.filter((x) => x.infected)" :key="p.id" class="ma mono">
      <b class="red">INFECTED</b><span>{{ p.callsign }}</span><span class="dim">{{ p.status }}</span>
    </div>
  </TPanel>

  <TPanel title="УРОН ЗА ОПОЗДАНИЕ" code="T-0B" :tone="(m?.overdueDamage ?? 0) >= 100 ? 'crit' : undefined">
    <div class="dmg mono" :class="{ rage: (m?.overdueDamage ?? 0) >= 100 }">{{ m?.overdueDamage ?? 0 }}% <small>HP ЗА ОПОЗДАНИЕ</small></div>
    <div class="a-grid3">
      <TButton
        v-for="d in [25, 50, 100]" :key="d" size="lg" :variant="m?.overdueDamage === d ? 'solid' : d === 100 ? 'danger' : 'ghost'"
        :disabled="!m || m.overdueDamage === d" :confirm="d === 100 ? 'ВСЕМ ПРИДЁТ ТРЕВОГА. ДА?' : false"
        :busy="busy.has('odmg')" @click="setOverdue(d)"
      >{{ d }}%</TButton>
    </div>
    <div class="row top">
      <input v-model.number="customOverdue" class="input grow" type="number" min="0" max="100" />
      <TButton variant="ghost" :busy="busy.has('odmg')" @click="setOverdue(customOverdue)">ЗАДАТЬ %</TButton>
    </div>
    <p class="a-note top">Сколько здоровья теряет сотрудник, не вернувшийся к дедлайну (один раз за вылазку). Изменение объявляется всем устройствам. 0% — опоздание без урона.</p>
  </TPanel>

  <TPanel title="ЧАТ С МОНСТРАМИ" code="T-01">
    <div v-if="!monsters.length" class="empty">// НЕТ МОНСТРОВ. НАЗНАЧЬТЕ РОЛЬ MONSTER ВО ВКЛАДКЕ CREW.</div>
    <template v-else>
      <div class="a-chips">
        <button v-for="mo in monsters" :key="mo.id" type="button" class="a-chip red" :class="{ on: chatWith === mo.id }" @click="chatWith = mo.id">
          {{ mo.callsign }}{{ mo.online ? '' : ' ✕' }}
        </button>
      </div>
      <div class="chat top"><MessageList :messages="chat" role="admin" :now="now" /></div>
      <form class="row top" @submit.prevent="sendReply">
        <input v-model="reply" class="input grow" maxlength="500" placeholder="ЛИЧНОЕ СООБЩЕНИЕ МОНСТРУ" />
        <TButton :disabled="!reply.trim() || !chatWith" :busy="busy.has('mchat')" @click="sendReply">TX</TButton>
      </form>
      <p class="a-note top">Монстры действуют сами и сами отмечают удары. Этот чат видят только вы и монстр — оператор его не видит.</p>
    </template>
  </TPanel>

  <TPanel title="THREAT LEVEL" code="T-02">
    <div class="lvls">
      <button
        v-for="l in 6" :key="l" type="button" class="lv mono" :class="{ on: (m?.threatLevel ?? 0) === l - 1, hot: l - 1 >= 4 }"
        :disabled="busy.has('lvl')" @click="act('lvl', 'POST', '/admin/threat', { level: l - 1 })"
      >{{ l - 1 }}</button>
    </div>
  </TPanel>

  <TPanel title="СОБЫТИЯ УГРОЗЫ" code="T-03">
    <div class="stack">
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
      <p class="a-note a-warn">Только безопасные игровые эффекты: шагом, без физического контакта, в пределах территории.</p>
    </div>
  </TPanel>

  <TPanel title="ЖУРНАЛ ЗДОРОВЬЯ" code="T-04">
    <div v-if="!state?.health.length" class="empty">// ВСЕ ЗДОРОВЫ</div>
    <div v-for="h in state?.health ?? []" :key="h.id" class="ma mono">
      <span class="mute">{{ clock(h.createdAt, false) }}</span>
      <b :class="h.delta < 0 ? 'red' : 'acc'">{{ h.delta > 0 ? '+' : '' }}{{ h.delta }}%</b>
      <span>{{ h.callsign }} → {{ h.hpAfter }}%</span>
      <span class="dim">{{ KIND[h.kind] ?? h.kind }}<template v-if="h.kind === 'hit'"> · {{ h.actor }}</template></span>
    </div>
  </TPanel>

  <TPanel title="ЖУРНАЛ СОБЫТИЙ УГРОЗЫ" code="T-05">
    <div v-if="!state?.monsterActions.length" class="empty">// ПУСТО</div>
    <div v-for="a in state?.monsterActions ?? []" :key="a.id" class="ma mono">
      <span class="mute">{{ clock(a.createdAt, false) }}</span>
      <b>{{ LABEL[a.action] }}</b>
      <span v-if="a.target">→ {{ a.target }}</span>
      <span class="dim">{{ a.text }}</span>
    </div>
  </TPanel>
</template>

<style scoped>
.top {
  margin-top: 10px;
}
.dmg {
  font-size: 44px;
  font-weight: 800;
  color: var(--amber);
  margin-bottom: 10px;
}
.dmg small {
  font-size: 13px;
  color: var(--text-mute);
}
.dmg.rage {
  color: var(--red);
  animation: blink 1s steps(2) infinite;
}
.chat {
  height: 260px;
  border: 1px solid var(--line);
  background: #040605;
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
