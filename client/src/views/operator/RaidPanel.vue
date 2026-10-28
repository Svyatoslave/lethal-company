<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '../../lib/game';
import { GATE_TONE } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';
import Countdown from '../../components/ui/Countdown.vue';

const props = defineProps<{ game: Game }>();
const { state, now, act, busy } = props.game;

const m = computed(() => state.value?.mission ?? null);
const exp = computed(() => state.value?.expedition ?? null);
const live = computed(() => m.value?.status === 'active' || m.value?.status === 'paused');
const crew = computed(() => state.value?.players.filter((p) => p.role === 'crew') ?? []);
const outside = computed(() => crew.value.filter((p) => ['OUTSIDE', 'RETURNING', 'OVERDUE'].includes(p.status)).length);
const overdue = computed(() => crew.value.filter((p) => p.status === 'OVERDUE').length);
const atBase = computed(() => crew.value.length - outside.value);

const headline = computed(() => {
  if (!m.value) return 'NO MISSION LOADED';
  if (m.value.status === 'draft') return 'MISSION STANDBY';
  if (m.value.status === 'ended') return 'MISSION TERMINATED';
  if (!exp.value || exp.value.status === 'cancelled') return 'NO EXPEDITION';
  const n = `EXPEDITION #${exp.value.number}`;
  if (exp.value.status === 'preparing') return `${n} · READY TO DEPLOY`;
  if (exp.value.status === 'completed') return `${n} · COMPLETE`;
  return `${n}${exp.value.emergency ? ' · EVAC' : ' · IN PROGRESS'}`;
});
const timer = computed(() => {
  if (!m.value || !exp.value) return { deadline: null, staticMs: null };
  if (exp.value.status === 'active') return { deadline: exp.value.deadlineAt, staticMs: null };
  if (exp.value.status === 'preparing') return { deadline: null, staticMs: (m.value.durationSec + m.value.timeBonusSec) * 1000 };
  return { deadline: null, staticMs: null };
});
const hint = computed(() => {
  if (!m.value) return 'Ведущий должен создать миссию.';
  if (m.value.status === 'draft') return 'Ожидание запуска миссии ведущим.';
  if (m.value.status === 'ended') return 'Миссия завершена.';
  if (!exp.value || exp.value.status === 'completed' || exp.value.status === 'cancelled') return 'Выберите сотрудников в CREW STATUS и сформируйте группу.';
  if (exp.value.status === 'preparing') return 'Группа сформирована. Откройте шлюз для выхода.';
  return '';
});
</script>

<template>
  <TPanel title="RAID STATUS" code="R-01" :tone="overdue ? 'crit' : m?.gate === 'closing' ? 'warn' : undefined">
    <div class="raid">
      <div class="head mono">{{ headline }}</div>
      <div class="timer">
        <Countdown size="xl" :deadline="timer.deadline" :static-ms="timer.staticMs" :now="now" :paused-at="m?.pausedAt" />
        <div v-if="m?.status === 'paused'" class="frozen mono blink">‖ TIME FROZEN</div>
      </div>
      <div v-if="hint" class="hint">{{ hint }}</div>
      <div v-if="m && m.timeBonusSec" class="bonus mono">+{{ Math.round(m.timeBonusSec / 60) }} МИН К СЛЕДУЮЩЕЙ ВЫЛАЗКЕ</div>

      <div class="gate">
        <span class="label">AIRLOCK</span>
        <TChip big :label="m?.gate ?? 'offline'" :tone="m ? GATE_TONE[m.gate] : 'mute'" :pulse="m?.gate === 'closing'" />
      </div>
      <div class="gate-btns">
        <TButton variant="solid" size="lg" :disabled="m?.status !== 'active'" :busy="busy.has('gate')" @click="act('gate', 'POST', '/gate/open')">OPEN GATE</TButton>
        <TButton variant="warn" size="lg" :disabled="!live || m?.gate === 'closed'" :busy="busy.has('gate')" @click="act('gate', 'POST', '/gate/closing')">GATE CLOSING</TButton>
        <TButton variant="ghost" size="lg" :disabled="!live || m?.gate === 'closed'" :busy="busy.has('gate')" @click="act('gate', 'POST', '/gate/close')">CLOSE</TButton>
      </div>

      <div class="stats">
        <div class="stat"><span class="label">OUTSIDE</span><b :class="{ amber: outside }">{{ outside }}</b></div>
        <div class="stat"><span class="label">AT BASE</span><b>{{ atBase }}</b></div>
        <div class="stat"><span class="label">FOUND</span><b>{{ state?.lootStats.found ?? 0 }}<small>/{{ state?.lootStats.total ?? '?' }}</small></b></div>
        <div class="stat"><span class="label">EXTRACTED</span><b class="acc">{{ state?.lootStats.extracted ?? 0 }}</b></div>
      </div>
      <div v-if="overdue" class="overdue mono">▲ OVERDUE: {{ overdue }} — СОТРУДНИК НЕ ВЕРНУЛСЯ ВОВРЕМЯ</div>

      <div class="threat">
        <span class="label">THREAT LEVEL</span>
        <div class="bars">
          <i v-for="i in 5" :key="i" :class="{ on: i <= (m?.threatLevel ?? 0), hot: (m?.threatLevel ?? 0) >= 4 }" />
        </div>
        <span class="mono lvl" :class="{ red: (m?.threatLevel ?? 0) >= 4, amber: (m?.threatLevel ?? 0) >= 2 && (m?.threatLevel ?? 0) < 4 }">
          {{ m?.threatLevel ? `${m.threatLevel}/5` : 'NONE' }}
        </span>
      </div>
    </div>
  </TPanel>
</template>

<style scoped>
.raid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--text-dim);
}
.timer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 6px 0 2px;
}
.timer :deep(.xl) {
  font-size: clamp(60px, 6vw, 96px);
}
.frozen {
  color: var(--red);
  font-size: 12px;
  letter-spacing: 0.2em;
  margin-top: 4px;
}
.hint {
  font-size: 13.5px;
  color: var(--text-dim);
  border-left: 2px solid var(--line-2);
  padding-left: 8px;
}
.bonus {
  font-size: 11.5px;
  color: var(--acc);
  letter-spacing: 0.08em;
}
.gate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.gate-btns {
  display: grid;
  grid-template-columns: 1.3fr 1.3fr 0.8fr;
  gap: 6px;
}
.gate-btns :deep(.btn) {
  padding: 0 6px;
  font-size: 12px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid var(--line);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-right: 1px solid var(--line);
}
.stat:last-child {
  border-right: 0;
}
.stat .label {
  font-size: 9.5px;
}
.stat b {
  font-family: var(--mono);
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
}
.stat small {
  font-size: 13px;
  color: var(--text-mute);
  font-weight: 400;
}
.overdue {
  color: #ff7a6e;
  font-size: 12px;
  background: var(--red-dim);
  padding: 8px;
  animation: blink 1.2s steps(2) infinite;
}
.threat {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bars {
  display: flex;
  gap: 3px;
  flex: 1;
}
.bars i {
  flex: 1;
  height: 12px;
  background: var(--line);
  transform: skewX(-20deg);
}
.bars i.on {
  background: var(--amber);
  box-shadow: 0 0 8px rgba(255, 182, 39, 0.5);
}
.bars i.on.hot {
  background: var(--red);
  box-shadow: 0 0 8px rgba(216, 70, 60, 0.6);
}
.lvl {
  font-size: 13px;
  min-width: 44px;
  text-align: right;
}
</style>
