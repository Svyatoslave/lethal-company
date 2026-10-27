<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Game } from '../../lib/game';
import type { EpStatus } from '@shared/types';
import { CREW_LABEL, CREW_TONE, EP_TO_CREW, clock } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';
import Countdown from '../../components/ui/Countdown.vue';
import HpBar from '../../components/ui/HpBar.vue';

const props = defineProps<{ game: Game }>();
const { state, now, act, busy } = props.game;

const m = computed(() => state.value?.mission ?? null);
const exp = computed(() => state.value?.expedition ?? null);
const live = computed(() => !!exp.value && (exp.value.status === 'preparing' || exp.value.status === 'active'));
const players = computed(() => state.value?.players ?? []);
const crew = computed(() => players.value.filter((p) => p.role === 'crew'));
const overdue = computed(() => crew.value.filter((p) => p.status === 'OVERDUE'));
const free = computed(() => crew.value.filter((p) => !exp.value?.players.some((x) => x.playerId === p.id && x.status !== 'returned') || !live.value));

const picked = reactive(new Set<number>());
function toggle(id: number) {
  if (picked.has(id)) picked.delete(id);
  else if (picked.size < (m.value?.crewSize ?? 4)) picked.add(id);
}
async function form() {
  const r = await act('form', 'POST', '/expeditions', { playerIds: [...picked] }, 'Группа сформирована');
  if (r) picked.clear();
}

const fix = reactive<Record<number, EpStatus | ''>>({});
const STATUSES: EpStatus[] = ['ready', 'outside', 'returning', 'overdue', 'returned'];
const addId = ref<number | ''>('');

const newP = reactive({ callsign: '', role: 'crew' as 'crew' | 'monster' });
async function addPlayer() {
  const r = await act('addp', 'POST', '/players', { ...newP });
  if (r) newP.callsign = '';
}
const open = ref<number | null>(null);
const rename = ref('');
</script>

<template>
  <TPanel v-if="overdue.length" title="ОПОЗДАВШИЕ" code="!!" tone="crit">
    <div v-for="p in overdue" :key="p.id" class="a-item">
      <div class="row">
        <span class="a-title grow">{{ p.callsign }}</span>
        <Countdown size="sm" :deadline="p.deadlineAt" :now="now" :paused-at="m?.pausedAt" />
      </div>
      <TButton variant="solid" block confirm="НА БАЗЕ?" :busy="busy.has(`ret${p.id}`)" @click="act(`ret${p.id}`, 'POST', '/expeditions/current/return', { playerId: p.id })">ПОДТВЕРДИТЬ ВОЗВРАЩЕНИЕ</TButton>
    </div>
  </TPanel>

  <TPanel :title="exp && live ? `ВЫЛАЗКА #${exp.number} · ${exp.status.toUpperCase()}` : 'ВЫЛАЗКА'" code="E-01">
    <template v-if="exp && live">
      <div v-for="ep in exp.players" :key="ep.id" class="a-item">
        <div class="row">
          <span class="a-title grow">{{ ep.callsign }}</span>
          <TChip :label="CREW_LABEL[EP_TO_CREW[ep.status]]" :tone="CREW_TONE[EP_TO_CREW[ep.status]]" />
        </div>
        <div class="a-sub">
          выход {{ clock(ep.exitAt, false) }} · дедлайн {{ clock(ep.deadlineAt, false) }}
          <template v-if="ep.penaltyExempt"> · без штрафа (эвакуация)</template>
        </div>
        <div class="a-grid2">
          <TButton v-if="ep.status === 'ready'" variant="warn" :disabled="exp.status !== 'active'" :busy="busy.has(`x${ep.playerId}`)" @click="act(`x${ep.playerId}`, 'POST', '/expeditions/current/exit', { playerId: ep.playerId })">ВЫПУСТИТЬ</TButton>
          <TButton v-if="ep.status === 'ready'" variant="ghost" :busy="busy.has(`rm${ep.playerId}`)" @click="act(`rm${ep.playerId}`, 'POST', '/expeditions/current/remove', { playerId: ep.playerId })">УБРАТЬ</TButton>
          <TButton v-if="ep.status === 'outside'" variant="ghost" :busy="busy.has(`rg${ep.playerId}`)" @click="act(`rg${ep.playerId}`, 'POST', '/expeditions/current/returning', { playerId: ep.playerId })">ВОЗВРАЩАЕТСЯ</TButton>
          <TButton v-if="['outside', 'returning', 'overdue'].includes(ep.status)" variant="solid" confirm="НА БАЗЕ?" :busy="busy.has(`ret${ep.playerId}`)" @click="act(`ret${ep.playerId}`, 'POST', '/expeditions/current/return', { playerId: ep.playerId })">ВЕРНУЛСЯ</TButton>
        </div>
        <div class="row">
          <select v-model="fix[ep.playerId]" class="select grow">
            <option value="">исправить статус…</option>
            <option v-for="s in STATUSES" :key="s" :value="s" :disabled="s === ep.status">{{ s.toUpperCase() }}</option>
          </select>
          <TButton variant="warn" :disabled="!fix[ep.playerId]" :busy="busy.has(`fx${ep.playerId}`)" @click="act(`fx${ep.playerId}`, 'POST', '/expeditions/current/status', { playerId: ep.playerId, status: fix[ep.playerId] }, 'Статус исправлен').then(() => (fix[ep.playerId] = ''))">ОК</TButton>
        </div>
      </div>
      <div class="row top">
        <select v-model="addId" class="select grow">
          <option value="">добавить в группу…</option>
          <option v-for="p in free" :key="p.id" :value="p.id">{{ p.callsign }}</option>
        </select>
        <TButton :disabled="!addId" :busy="busy.has('add')" @click="act('add', 'POST', '/expeditions/current/add', { playerId: addId }).then(() => (addId = ''))">+</TButton>
      </div>
      <TButton class="top" variant="danger" block confirm="ЗАКРЫТЬ ВЫЛАЗКУ?" :busy="busy.has('fc')" @click="act('fc', 'POST', '/expeditions/current/complete')">
        {{ exp.status === 'preparing' ? 'ОТМЕНИТЬ ГРУППУ' : 'ПРИНУДИТЕЛЬНО ЗАВЕРШИТЬ ВЫЛАЗКУ' }}
      </TButton>
    </template>
    <template v-else>
      <p class="a-note">Выберите до {{ m?.crewSize ?? 4 }} сотрудников для следующей вылазки.</p>
      <div class="a-chips top">
        <button v-for="p in crew" :key="p.id" type="button" class="a-chip" :class="{ on: picked.has(p.id) }" @click="toggle(p.id)">
          {{ p.callsign }}<template v-if="p.hp < 100"> · {{ p.hp }}%</template>
        </button>
      </div>
      <TButton class="top" variant="solid" size="lg" block :disabled="!picked.size || (m?.status !== 'active' && m?.status !== 'paused')" :busy="busy.has('form')" @click="form">
        СФОРМИРОВАТЬ ГРУППУ ({{ picked.size }}/{{ m?.crewSize ?? 4 }})
      </TButton>
    </template>
  </TPanel>

  <TPanel title="ПЕРСОНАЛ" code="P-01">
    <div v-if="!players.length" class="empty">// НЕТ СОТРУДНИКОВ</div>
    <div v-for="p in players" :key="p.id" class="a-item">
      <div class="row" @click="open = open === p.id ? null : p.id; rename = p.callsign">
        <span class="dot" :class="{ on: p.online }" />
        <span class="a-title grow">{{ p.callsign }}</span>
        <span v-if="p.role === 'monster'" class="mono red small">MONSTER</span>
        <TChip v-if="p.role === 'crew'" :label="CREW_LABEL[p.status]" :tone="CREW_TONE[p.status]" />
        <span class="mono code">{{ p.joinCode }}</span>
      </div>
      <HpBar v-if="p.role === 'crew'" :hp="p.hp" size="sm" />
      <div v-if="open === p.id" class="stack">
        <div v-if="p.role === 'crew'" class="row hpset">
          <span class="label grow">HP</span>
          <TButton v-for="v in [0, 50, 100]" :key="v" size="sm" :variant="p.hp === v ? 'solid' : 'ghost'" :busy="busy.has(`hp${p.id}`)" @click="act(`hp${p.id}`, 'POST', `/players/${p.id}/hp`, { hp: v }, `${p.callsign}: HP ${v}%`)">{{ v }}%</TButton>
        </div>
        <div class="row">
          <input v-model="rename" class="input grow" maxlength="24" />
          <TButton :busy="busy.has(`rn${p.id}`)" @click="act(`rn${p.id}`, 'PATCH', `/players/${p.id}`, { callsign: rename })">ИМЯ</TButton>
        </div>
        <div class="a-grid3">
          <TButton variant="ghost" :busy="busy.has(`rl${p.id}`)" @click="act(`rl${p.id}`, 'PATCH', `/players/${p.id}`, { role: p.role === 'crew' ? 'monster' : 'crew' })">
            → {{ p.role === 'crew' ? 'MONSTER' : 'CREW' }}
          </TButton>
          <TButton variant="warn" confirm="НОВЫЙ КОД?" :busy="busy.has(`rc${p.id}`)" @click="act(`rc${p.id}`, 'PATCH', `/players/${p.id}`, { regenerateCode: true }, 'Код обновлён, старые сессии закрыты')">НОВЫЙ КОД</TButton>
          <TButton variant="danger" confirm="УДАЛИТЬ?" :busy="busy.has(`del${p.id}`)" @click="act(`del${p.id}`, 'DELETE', `/players/${p.id}`)">УДАЛИТЬ</TButton>
        </div>
      </div>
    </div>
    <form class="stack top" @submit.prevent="addPlayer">
      <div class="row">
        <input v-model="newP.callsign" class="input grow" maxlength="24" placeholder="ПОЗЫВНОЙ" />
        <select v-model="newP.role" class="select role">
          <option value="crew">CREW</option>
          <option value="monster">MONSTER</option>
        </select>
      </div>
      <TButton block :disabled="!newP.callsign.trim()" :busy="busy.has('addp')" @click="addPlayer">+ ДОБАВИТЬ СОТРУДНИКА</TButton>
      <p class="a-note">Код справа — личный код входа. Бейджи с QR печатаются на странице «ПЕЧАТЬ QR».</p>
    </form>
  </TPanel>
</template>

<style scoped>
.top {
  margin-top: 10px;
}
.dot {
  width: 8px;
  height: 8px;
  background: var(--line-2);
  flex: none;
}
.dot.on {
  background: var(--acc);
  box-shadow: 0 0 5px var(--acc);
}
.small {
  font-size: 11px;
}
.code {
  font-size: 12px;
  color: var(--amber);
  letter-spacing: 0.12em;
}
.role {
  width: 130px;
}
.a-item > .row:first-child {
  cursor: pointer;
}
</style>
