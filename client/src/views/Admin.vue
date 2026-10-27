<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useGame } from '../lib/game';
import { MISSION_LABEL, MISSION_TONE, cr } from '../lib/format';
import { muted, toggleMuted } from '../lib/sound';
import StaffLogin from '../components/StaffLogin.vue';
import AlertLayer from '../components/AlertLayer.vue';
import TButton from '../components/ui/TButton.vue';
import TChip from '../components/ui/TChip.vue';
import Countdown from '../components/ui/Countdown.vue';
import MissionTab from './admin/MissionTab.vue';
import CrewTab from './admin/CrewTab.vue';
import GateTab from './admin/GateTab.vue';
import ThreatTab from './admin/ThreatTab.vue';
import CommsTab from './admin/CommsTab.vue';
import EconomyTab from './admin/EconomyTab.vue';
import ScrapTab from './admin/ScrapTab.vue';
import LogTab from './admin/LogTab.vue';
import CameraPanel from '../components/CameraPanel.vue';
import { pref, setPref } from '../lib/session';
import '../styles/admin.css';

const game = useGame('admin', (name, fx) => {
  if (name === 'system:alert' || name === 'player:overdue') return 'alert';
  if (name === 'message:received' || name === 'loot:found' || (name === 'monster:event' && fx.type !== 'order')) return 'toast';
  if (name === 'gate:closing' || name === 'mission:updated') return 'toast';
  return 'ignore';
});
const { state, now, authed, connected, alerts, dismiss, connect, logout, act, busy } = game;
onMounted(connect);

const TABS = [
  ['mission', 'MISSION'],
  ['crew', 'CREW'],
  ['gate', 'AIRLOCK'],
  ['threat', 'THREAT'],
  ['cameras', 'КАМЕРЫ'],
  ['comms', 'COMMS'],
  ['econ', 'ECONOMY'],
  ['scrap', 'SCRAP'],
  ['log', 'LOG'],
] as const;
type Tab = (typeof TABS)[number][0];
const tab = ref<Tab>((pref('adminTab', 'mission') as Tab) ?? 'mission');
function go(t: Tab) {
  tab.value = t;
  setPref('adminTab', t);
  window.scrollTo({ top: 0 });
}

const m = computed(() => state.value?.mission ?? null);
const exp = computed(() => state.value?.expedition ?? null);
const overdue = computed(() => state.value?.players.filter((p) => p.status === 'OVERDUE').length ?? 0);
const pendingReq = computed(() => state.value?.purchases.filter((p) => ['scanner', 'extraction'].includes(p.itemKey) && !p.fulfilledAt).length ?? 0);
const badges = computed<Partial<Record<Tab, number>>>(() => ({ crew: overdue.value, threat: pendingReq.value }));
const pauseReason = ref('');
</script>

<template>
  <StaffLogin v-if="!authed" role="admin" @authed="connect" />
  <div v-else class="adm" :class="{ paused: m?.status === 'paused' }">
    <header class="hd">
      <div class="r1">
        <div class="id">
          <span class="label">FIELD ADMIN</span>
          <b class="mono">{{ m?.code ?? 'NO MISSION' }}</b>
        </div>
        <TChip v-if="m" :label="MISSION_LABEL[m.status]" :tone="MISSION_TONE[m.status]" :pulse="m.status === 'paused'" />
        <span class="link" :class="{ on: connected }" :title="connected ? 'online' : 'offline'" />
        <button type="button" class="mini mono" @click="toggleMuted">{{ muted ? 'SND✕' : 'SND' }}</button>
        <button type="button" class="mini mono" @click="logout">EXIT</button>
      </div>
      <div class="r2 mono">
        <span class="acc">{{ cr(state?.balance ?? 0) }} CR</span>
        <span class="dim">Q {{ cr(state?.quotaProgress ?? 0) }}/{{ cr(m?.quota ?? 0) }}</span>
        <span v-if="exp?.status === 'active'" class="grow t">
          #{{ exp.number }} <Countdown size="sm" :deadline="exp.deadlineAt" :now="now" :paused-at="m?.pausedAt" />
        </span>
        <span v-else class="grow t dim">{{ exp?.status === 'preparing' ? `#${exp.number} READY` : 'NO EXPEDITION' }}</span>
        <span v-if="overdue" class="red blink">▲{{ overdue }}</span>
      </div>
      <div v-if="m?.status === 'active'" class="estop">
        <input v-model="pauseReason" class="input reason" placeholder="причина (необязательно)" />
        <TButton variant="danger" size="lg" :busy="busy.has('pause')" @click="act('pause', 'POST', '/missions/current/pause', { reason: pauseReason || undefined }).then(() => (pauseReason = ''))">
          ■ ЭКСТРЕННАЯ ПАУЗА
        </TButton>
      </div>
      <div v-else-if="m?.status === 'paused'" class="estop">
        <TButton variant="solid" size="lg" block :busy="busy.has('pause')" confirm="ПРОДОЛЖИТЬ ИГРУ?" @click="act('pause', 'POST', '/missions/current/resume')">
          ▶ ВОЗОБНОВИТЬ ИГРУ
        </TButton>
      </div>
    </header>

    <main class="body">
      <MissionTab v-if="tab === 'mission'" :game="game" />
      <CrewTab v-else-if="tab === 'crew'" :game="game" />
      <GateTab v-else-if="tab === 'gate'" :game="game" />
      <ThreatTab v-else-if="tab === 'threat'" :game="game" />
      <CameraPanel v-else-if="tab === 'cameras'" app="admin" />
      <CommsTab v-else-if="tab === 'comms'" :game="game" />
      <EconomyTab v-else-if="tab === 'econ'" :game="game" />
      <ScrapTab v-else-if="tab === 'scrap'" :game="game" />
      <LogTab v-else :game="game" />
    </main>

    <nav class="tabs">
      <button v-for="[k, l] in TABS" :key="k" type="button" class="tb mono" :class="{ on: tab === k }" @click="go(k)">
        {{ l }}<i v-if="badges[k]">{{ badges[k] }}</i>
      </button>
    </nav>
    <AlertLayer :alerts="alerts" @dismiss="dismiss" />
  </div>
</template>

<style scoped>
.adm {
  max-width: 720px;
  margin: 0 auto;
  min-height: 100dvh;
  padding-bottom: calc(108px + var(--safe-b));
}
.adm.paused .hd {
  border-bottom-color: var(--red);
  background: linear-gradient(180deg, #2a0805, #0b0e0d);
}
.hd {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(180deg, #111715, #0b0e0d);
  border-bottom: 1px solid var(--line-2);
}
.r1 {
  display: flex;
  align-items: center;
  gap: 8px;
}
.id {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.id b {
  font-size: 18px;
  color: var(--acc);
  letter-spacing: 0.08em;
}
.link {
  width: 10px;
  height: 10px;
  background: var(--red);
}
.link.on {
  background: var(--acc);
  box-shadow: 0 0 6px var(--acc);
}
.mini {
  min-height: 34px;
  padding: 0 9px;
  background: none;
  border: 1px solid var(--line-2);
  color: var(--text-mute);
  font-size: 10.5px;
}
.r2 {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
}
.r2 .t {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}
.estop {
  display: flex;
  gap: 8px;
}
.reason {
  flex: 1;
  min-height: 52px;
  font-size: 13px;
}
.body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tabs {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding-bottom: var(--safe-b);
  background: #080b0a;
  border-top: 1px solid var(--line-2);
}
.tb {
  position: relative;
  min-height: 48px;
  padding: 0 4px;
  background: none;
  border: 0;
  border-top: 2px solid transparent;
  color: var(--text-mute);
  font-size: 11px;
  letter-spacing: 0.1em;
}
.tb.on {
  color: var(--acc);
  border-top-color: var(--acc);
  background: var(--acc-dim);
}
.tb i {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: var(--red);
  color: #fff;
  font-style: normal;
  font-size: 10.5px;
  line-height: 18px;
}
@media (min-width: 721px) {
  .tabs {
    max-width: 720px;
    margin: 0 auto;
  }
}
</style>
