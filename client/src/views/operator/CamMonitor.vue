<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '../../lib/game';
import { CREW_LABEL, CREW_TONE } from '../../lib/format';
import CamFeed from '../../components/CamFeed.vue';
import TChip from '../../components/ui/TChip.vue';

const props = defineProps<{ game: Game; focus: number | null }>();
const emit = defineEmits<{ close: [] }>();
const { state, now, socket } = props.game;

const m = computed(() => state.value?.mission ?? null);
const crew = computed(() => state.value?.players.filter((p) => p.role === 'crew') ?? []);
/** Channel numbers stay stable for the whole game: they follow the roster order, not who is live. */
const channels = computed(() => crew.value.map((p, i) => ({ ...p, channel: i + 1 })));
const live = computed(() => channels.value.filter((c) => c.camOn));
const jammed = computed(() => !!m.value?.commsDisabled);

const mode = ref<'single' | 'grid'>('single');
const selected = ref<number | null>(props.focus ?? live.value[0]?.id ?? null);
const current = computed(() => channels.value.find((c) => c.id === selected.value) ?? null);

watch(() => props.focus, (f) => {
  if (f) {
    selected.value = f;
    mode.value = 'single';
  }
});
// If nothing is selected yet, jump to the first camera that comes online.
watch(live, (l) => {
  if (!selected.value && l[0]) selected.value = l[0].id;
});

function pick(id: number) {
  selected.value = id;
  mode.value = 'single';
}
function step(d: 1 | -1) {
  const list = live.value.length ? live.value : channels.value;
  if (!list.length) return;
  const i = list.findIndex((c) => c.id === selected.value);
  selected.value = list[(i + d + list.length) % list.length].id;
  mode.value = 'single';
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && channels.value[n - 1]) pick(channels.value[n - 1].id);
}
</script>

<template>
  <div class="mon" tabindex="0" @keydown="onKey">
    <header class="mh">
      <span class="tt mono">BODY CAM MONITOR</span>
      <span class="mono dim small">{{ live.length }} / {{ channels.length }} ONLINE</span>
      <div class="modes">
        <button type="button" class="mb mono" :class="{ on: mode === 'single' }" @click="mode = 'single'">ОДНА КАМЕРА</button>
        <button type="button" class="mb mono" :class="{ on: mode === 'grid' }" @click="mode = 'grid'">ВСЕ КАМЕРЫ</button>
      </div>
      <button type="button" class="mb mono close" @click="emit('close')">✕ ЗАКРЫТЬ</button>
    </header>

    <div class="body">
      <nav class="chans">
        <div class="label">КАНАЛЫ · 1–9 / ← →</div>
        <button
          v-for="c in channels" :key="c.id" type="button" class="chan"
          :class="{ on: mode === 'single' && c.id === selected, off: !c.camOn }" @click="pick(c.id)"
        >
          <span class="num mono">{{ String(c.channel).padStart(2, '0') }}</span>
          <span class="cs mono">{{ c.callsign }}</span>
          <span class="st">
            <i class="dot" :class="{ live: c.camOn }" />
            <TChip :label="c.linkLost ? 'SIGNAL LOST' : CREW_LABEL[c.status]" :tone="c.linkLost ? 'crit' : CREW_TONE[c.status]" />
          </span>
        </button>
        <p class="hint">Камера появляется, когда сотрудник включает BODY CAM на своём телефоне. Звук слышен только у выбранного канала.</p>
      </nav>

      <main class="screen">
        <div v-if="!m?.camsUnlocked" class="jam mono">BODY CAM ОТКЛЮЧЕНЫ<br /><small>КАМЕРЫ НЕ КУПЛЕНЫ ИЛИ ОТОЗВАНЫ ВЕДУЩИМ</small></div>
        <div v-else-if="jammed" class="jam mono">▲ SIGNAL LOST<br /><small>ЭФИР ЗАГЛУШЁН ВЕДУЩИМ</small></div>
        <template v-else-if="!socket">
          <div class="jam mono">НЕТ СВЯЗИ С СЕРВЕРОМ</div>
        </template>
        <template v-else-if="mode === 'single'">
          <div v-if="!current" class="jam mono">ВЫБЕРИТЕ КАНАЛ</div>
          <div v-else-if="current.linkLost" class="jam mono">▲ SIGNAL LOST<br /><small>СВЯЗЬ С {{ current.callsign }} ПОТЕРЯНА</small></div>
          <div v-else-if="!current.camOn" class="jam mono">CAM-{{ String(current.channel).padStart(2, '0') }} · {{ current.callsign }}<br /><small>КАМЕРА ВЫКЛЮЧЕНА</small></div>
          <CamFeed
            v-else :key="current.id" class="big" :socket="socket" :player-id="current.id" :callsign="current.callsign"
            :channel="current.channel" :now="now" audible
          />
        </template>
        <div v-else class="grid" :class="{ many: live.length > 4 }">
          <div v-if="!live.length" class="jam mono">НИ ОДНА КАМЕРА НЕ ВКЛЮЧЕНА</div>
          <CamFeed
            v-for="c in live" :key="c.id" small class="tile" :socket="socket" :player-id="c.id" :callsign="c.callsign"
            :channel="c.channel" :now="now" @click="pick(c.id)"
          />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.mon {
  position: fixed;
  inset: 0;
  z-index: 600;
  display: flex;
  flex-direction: column;
  background: #030504;
  outline: none;
}
.mh {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-2);
}
.tt {
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.18em;
  color: var(--acc);
  text-shadow: var(--acc-glow);
}
.small {
  font-size: 11px;
}
.modes {
  display: flex;
  margin-left: auto;
}
.mb {
  min-height: 36px;
  padding: 0 14px;
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  color: var(--text-dim);
  font-size: 11.5px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.mb.on {
  border-color: var(--acc);
  color: var(--acc);
  background: var(--acc-dim);
}
.close:hover {
  border-color: var(--red);
  color: var(--red);
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px 1fr;
}
.chans {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  overflow-y: auto;
  border-right: 1px solid var(--line);
}
.chan {
  display: grid;
  grid-template-columns: 30px 1fr;
  grid-template-rows: auto auto;
  gap: 2px 8px;
  padding: 8px 10px;
  text-align: left;
  background: var(--panel);
  border: 1px solid var(--line);
  color: var(--text);
  cursor: pointer;
}
.chan:hover {
  border-color: var(--line-2);
}
.chan.on {
  border-color: var(--acc);
  background: var(--acc-dim);
}
.chan.off {
  opacity: 0.55;
}
.num {
  grid-row: span 2;
  align-self: center;
  font-size: 18px;
  font-weight: 800;
  color: var(--acc-2);
}
.cs {
  font-weight: 700;
  letter-spacing: 0.08em;
}
.st {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line-2);
}
.dot.live {
  background: var(--red);
  box-shadow: 0 0 6px var(--red);
  animation: blink 1.2s steps(2) infinite;
}
.hint {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--text-mute);
}
.screen {
  min-height: 0;
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.big {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
}
.big :deep(video) {
  object-fit: contain;
}
.grid {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-auto-rows: minmax(0, 1fr);
  gap: 10px;
}
.grid.many {
  grid-template-columns: repeat(3, 1fr);
}
.tile {
  cursor: pointer;
  aspect-ratio: auto;
  min-height: 0;
}
.jam {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 26px;
  letter-spacing: 0.2em;
  color: var(--red);
  line-height: 1.6;
}
.jam small {
  font-size: 13px;
  color: var(--text-dim);
  letter-spacing: 0.12em;
}
@media (max-width: 820px) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .chans {
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .hint,
  .chans .label {
    display: none;
  }
}
</style>
