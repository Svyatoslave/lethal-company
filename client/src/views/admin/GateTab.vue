<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { Game } from '../../lib/game';
import { CREW_LABEL, CREW_TONE, EP_TO_CREW, GATE_TONE, clock } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';
import Countdown from '../../components/ui/Countdown.vue';

const props = defineProps<{ game: Game }>();
const { state, now, act, busy } = props.game;
const m = computed(() => state.value?.mission ?? null);
const exp = computed(() => state.value?.expedition ?? null);
const live = computed(() => m.value?.status === 'active' || m.value?.status === 'paused');

const cfg = reactive({ durationMin: 15, damage: 50 });
watch(m, (v) => {
  if (!v) return;
  cfg.durationMin = Math.round((v.durationSec / 60) * 10) / 10;
  cfg.damage = v.overdueDamage;
}, { immediate: true });
</script>

<template>
  <TPanel title="AIRLOCK CONTROL" code="G-01" :tone="m?.gate === 'closing' ? 'crit' : undefined">
    <div class="state">
      <span class="label">ШЛЮЗ</span>
      <TChip big :label="m?.gate ?? 'offline'" :tone="m ? GATE_TONE[m.gate] : 'mute'" :pulse="m?.gate === 'closing'" />
    </div>
    <div class="stack">
      <TButton variant="solid" size="xl" block :disabled="m?.status !== 'active'" :busy="busy.has('gate')" @click="act('gate', 'POST', '/gate/open')">OPEN GATE</TButton>
      <TButton variant="warn" size="xl" block :disabled="!live || m?.gate === 'closed'" :busy="busy.has('gate')" @click="act('gate', 'POST', '/gate/closing')">WARNING: GATE CLOSING</TButton>
      <TButton variant="ghost" size="lg" block :disabled="!live || m?.gate === 'closed'" :busy="busy.has('gate')" @click="act('gate', 'POST', '/gate/close')">CLOSE GATE</TButton>
    </div>
    <p class="a-note top">OPEN GATE выпускает всю сформированную группу: сервер фиксирует время выхода и дедлайн каждого.</p>
  </TPanel>

  <TPanel :title="exp ? `ВЫЛАЗКА #${exp.number}` : 'ВЫЛАЗКА'" code="G-02">
    <div v-if="!exp || exp.status === 'cancelled'" class="empty">// НЕТ ВЫЛАЗКИ</div>
    <template v-else>
      <div class="a-kv"><span>Статус</span><span>{{ exp.status.toUpperCase() }}{{ exp.emergency ? ' · EVAC' : '' }}</span></div>
      <div class="a-kv"><span>Открыта</span><span>{{ clock(exp.openedAt) }}</span></div>
      <div class="a-kv"><span>Дедлайн группы</span><span><Countdown v-if="exp.status === 'active'" size="sm" :deadline="exp.deadlineAt" :now="now" :paused-at="m?.pausedAt" /><template v-else>{{ clock(exp.deadlineAt) }}</template></span></div>
      <div v-for="ep in exp.players" :key="ep.id" class="a-item">
        <div class="row">
          <span class="a-title grow">{{ ep.callsign }}</span>
          <TChip :label="CREW_LABEL[EP_TO_CREW[ep.status]]" :tone="CREW_TONE[EP_TO_CREW[ep.status]]" :pulse="ep.status === 'overdue'" />
        </div>
        <div class="row a-sub">
          <span class="grow">выход {{ clock(ep.exitAt) }} → дедлайн {{ clock(ep.deadlineAt) }}</span>
          <Countdown v-if="['outside', 'returning', 'overdue'].includes(ep.status)" size="sm" :deadline="ep.deadlineAt" :now="now" :paused-at="m?.pausedAt" />
          <span v-else-if="ep.returnedAt">вернулся {{ clock(ep.returnedAt) }}</span>
        </div>
      </div>
    </template>
  </TPanel>

  <TPanel title="ПРАВИЛА ВОЗВРАТА" code="G-03">
    <div class="a-grid2">
      <label class="field"><span class="label">Вылазка, мин</span><input v-model.number="cfg.durationMin" class="input" type="number" min="0.5" step="0.5" /></label>
      <label class="field"><span class="label">Урон за опоздание, % HP</span><input v-model.number="cfg.damage" class="input" type="number" min="0" max="100" /></label>
    </div>
    <TButton class="top" block :busy="busy.has('cfg')" @click="act('cfg', 'PATCH', '/missions/current', { durationSec: Math.round(cfg.durationMin * 60), overdueDamage: cfg.damage }, 'Сохранено')">СОХРАНИТЬ</TButton>
    <p class="a-note top">
      Опоздавший получает статус OVERDUE и теряет здоровье один раз за вылазку. Он не исключается из следующих вылазок.
      <template v-if="m?.timeBonusSec"> Бонус к следующей вылазке: +{{ Math.round(m.timeBonusSec / 60) }} мин.</template>
    </p>
  </TPanel>
</template>

<style scoped>
.state {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.top {
  margin-top: 10px;
}
</style>
