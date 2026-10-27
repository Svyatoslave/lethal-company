<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useGame } from '../lib/game';
import { clock, cr, missionElapsed, mmss } from '../lib/format';
import { muted, toggleMuted } from '../lib/sound';
import StaffLogin from '../components/StaffLogin.vue';
import AlertLayer from '../components/AlertLayer.vue';
import LogView from '../components/LogView.vue';
import Logo from '../components/Logo.vue';
import Meter from '../components/ui/Meter.vue';
import TPanel from '../components/ui/TPanel.vue';
import RaidPanel from './operator/RaidPanel.vue';
import CrewPanel from './operator/CrewPanel.vue';
import ScrapPanel from './operator/ScrapPanel.vue';
import StorePanel from './operator/StorePanel.vue';
import CommsPanel from './operator/CommsPanel.vue';
import CamMonitor from './operator/CamMonitor.vue';

const camOpen = ref(false);
const camFocus = ref<number | null>(null);
function openCams(playerId: number | null = null) {
  camFocus.value = playerId;
  camOpen.value = true;
}

const game = useGame('operator', (name) => {
  if (name === 'economy:updated' || name === 'loot:extracted') return 'ignore';
  if (name === 'loot:found' || name === 'message:received') return 'toast';
  return 'alert';
});
const { state, now, authed, connected, alerts, dismiss, connect, logout } = game;
onMounted(connect);

const m = computed(() => state.value?.mission ?? null);
const sys = computed(() => {
  if (!connected.value) return { label: 'OFFLINE', tone: 'crit' };
  if (!m.value) return { label: 'NO MISSION', tone: 'warn' };
  const overdue = state.value!.players.some((p) => p.status === 'OVERDUE');
  if (m.value.status === 'paused' || overdue || m.value.gate === 'closing') return { label: 'CRITICAL', tone: 'crit' };
  if (m.value.threatLevel >= 3 || m.value.commsDisabled) return { label: 'WARNING', tone: 'warn' };
  return { label: 'ONLINE', tone: 'ok' };
});
const camsLive = computed(() => state.value?.players.filter((p) => p.camOn).length ?? 0);
const quotaPct = computed(() => (m.value?.quota ? Math.min(100, Math.round(((state.value?.quotaProgress ?? 0) / m.value.quota) * 100)) : 0));
</script>

<template>
  <StaffLogin v-if="!authed" role="operator" @authed="connect" />
  <div v-else class="term" :class="{ paused: m?.status === 'paused' }">
    <header class="top">
      <Logo compact />
      <div class="cell">
        <span class="label">MISSION</span>
        <b class="mono">{{ m?.code ?? '----' }}</b>
      </div>
      <div class="cell">
        <span class="label">SYSTEM</span>
        <b class="mono sys" :class="sys.tone"><i />{{ sys.label }}</b>
      </div>
      <div class="cell">
        <span class="label">BALANCE</span>
        <b class="mono acc big">{{ cr(state?.balance ?? 0) }} <small>CR</small></b>
      </div>
      <div class="cell quota">
        <span class="label">QUOTA · {{ quotaPct }}%</span>
        <Meter :value="state?.quotaProgress ?? 0" :max="m?.quota ?? 1" :segments="24" :tone="quotaPct >= 100 ? 'acc' : 'amber'" />
        <span class="mono qv">{{ cr(state?.quotaProgress ?? 0) }} / {{ cr(m?.quota ?? 0) }}</span>
      </div>
      <div class="cell">
        <span class="label">RAID TIME</span>
        <b class="mono">{{ m ? mmss(missionElapsed(m, now)) : '--:--' }}</b>
      </div>
      <div class="cell">
        <span class="label">LOCAL</span>
        <b class="mono dim">{{ clock(now) }}</b>
      </div>
      <button v-if="m?.camsUnlocked" type="button" class="camsbtn mono" @click="openCams()">
        <i :class="{ live: camsLive }" />BODY CAMS<b>{{ camsLive }}</b>
      </button>
      <div class="tools">
        <button type="button" class="tool" :title="muted ? 'звук выключен' : 'звук включён'" @click="toggleMuted">{{ muted ? 'SND OFF' : 'SND ON' }}</button>
        <button type="button" class="tool" @click="logout">EXIT</button>
      </div>
    </header>

    <div v-if="m?.status === 'paused'" class="pausebar mono">
      ▲ ИГРА ПРИОСТАНОВЛЕНА ВЕДУЩИМ — {{ m.pauseReason }} · ТАЙМЕРЫ ЗАМОРОЖЕНЫ · ОСТАВАЙТЕСЬ НА МЕСТЕ
    </div>
    <div v-if="!connected" class="pausebar mono off">● СВЯЗЬ С СЕРВЕРОМ ПОТЕРЯНА — ПЕРЕПОДКЛЮЧЕНИЕ…</div>

    <main class="grid">
      <div class="col">
        <RaidPanel :game="game" />
        <StorePanel :game="game" class="fill" />
      </div>
      <div class="col">
        <CrewPanel :game="game" @watch="openCams" />
        <ScrapPanel :game="game" class="fill" />
      </div>
      <div class="col">
        <TPanel title="SYSTEM LOG" code="L-05" flush class="fill">
          <LogView :events="state?.events ?? []" />
        </TPanel>
        <CommsPanel :game="game" class="comms" />
      </div>
    </main>
    <CamMonitor v-if="camOpen" :game="game" :focus="camFocus" @close="camOpen = false" />
    <AlertLayer :alerts="alerts" @dismiss="dismiss" />
  </div>
</template>

<style scoped>
.term {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 10px;
}
.term.paused {
  box-shadow: inset 0 0 0 3px var(--red);
}
.top {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid var(--line-2);
  background: linear-gradient(180deg, #111715, #0b0f0e);
  min-height: 58px;
}
.top > :first-child {
  padding: 0 16px;
  border-right: 1px solid var(--line);
}
.cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 6px 16px;
  border-right: 1px solid var(--line);
  white-space: nowrap;
}
.cell b {
  font-size: 16px;
  letter-spacing: 0.06em;
}
.cell b.big {
  font-size: 20px;
  text-shadow: var(--acc-glow);
}
.cell small {
  font-size: 11px;
  color: var(--text-mute);
}
.quota {
  flex: 1;
  min-width: 200px;
}
.qv {
  font-size: 11.5px;
  color: var(--text-dim);
}
.sys {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.sys i {
  width: 8px;
  height: 8px;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}
.sys.ok {
  color: var(--acc);
}
.sys.warn {
  color: var(--amber);
}
.sys.crit {
  color: var(--red);
}
.sys.crit i {
  animation: blink 0.7s steps(2) infinite;
}
.camsbtn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  background: none;
  border: 0;
  border-right: 1px solid var(--line);
  color: var(--text);
  font-size: 12px;
  letter-spacing: 0.12em;
  cursor: pointer;
}
.camsbtn:hover {
  background: var(--panel-3);
}
.camsbtn i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--line-2);
}
.camsbtn i.live {
  background: var(--red);
  box-shadow: 0 0 8px var(--red);
  animation: blink 1.2s steps(2) infinite;
}
.camsbtn b {
  color: var(--acc);
  font-size: 15px;
}
.tools {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 6px 10px;
}
.tool {
  background: none;
  border: 1px solid var(--line-2);
  color: var(--text-mute);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  cursor: pointer;
}
.tool:hover {
  color: var(--text);
  border-color: var(--text-mute);
}
.pausebar {
  padding: 9px 14px;
  background: var(--red);
  color: #120302;
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.1em;
  animation: blink 1.4s steps(2) infinite;
}
.pausebar.off {
  background: var(--amber);
}
.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(330px, 0.9fr) minmax(460px, 1.45fr) minmax(340px, 1fr);
  gap: 10px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.col > * {
  flex: none;
  max-height: 62%;
}
.col > .fill {
  flex: 1 1 0;
  max-height: none;
}
.col > .comms {
  flex: 0 0 auto;
  height: 42%;
}

@media (max-width: 1280px) {
  .term {
    height: auto;
  }
  .grid {
    grid-template-columns: 1fr 1fr;
  }
  .col > *,
  .col > .fill,
  .col > .comms {
    max-height: 620px;
    height: auto;
    flex: none;
  }
  .col:nth-child(3) {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .col:nth-child(3) > * {
    height: 460px;
  }
  .top {
    flex-wrap: wrap;
  }
}
@media (max-width: 820px) {
  .grid,
  .col:nth-child(3) {
    grid-template-columns: 1fr;
  }
  .cell {
    padding: 6px 10px;
  }
}
</style>
