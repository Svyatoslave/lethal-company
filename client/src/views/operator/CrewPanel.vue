<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { Game } from '../../lib/game';
import { CREW_LABEL, CREW_TONE, clock } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';
import Countdown from '../../components/ui/Countdown.vue';
import HpBar from '../../components/ui/HpBar.vue';

const props = defineProps<{ game: Game }>();
const emit = defineEmits<{ watch: [playerId: number] }>();
const { state, now, act, busy } = props.game;

const m = computed(() => state.value?.mission ?? null);
const exp = computed(() => state.value?.expedition ?? null);
const crew = computed(() => state.value?.players.filter((p) => p.role === 'crew') ?? []);
const live = computed(() => m.value?.status === 'active' || m.value?.status === 'paused');
const canForm = computed(() => live.value && (!exp.value || ['preparing', 'completed', 'cancelled'].includes(exp.value.status)));
const size = computed(() => m.value?.crewSize ?? 4);
const picked = reactive(new Set<number>());

// Mirror an already formed (not yet deployed) roster into the selection.
watch(
  () => (exp.value?.status === 'preparing' ? exp.value.players.map((p) => p.playerId).join(',') : ''),
  (ids) => {
    picked.clear();
    if (ids) ids.split(',').forEach((id) => picked.add(Number(id)));
  },
  { immediate: true },
);

function toggle(id: number) {
  if (picked.has(id)) picked.delete(id);
  else if (picked.size < size.value) picked.add(id);
}

const order = { OVERDUE: 0, RETURNING: 1, OUTSIDE: 2, READY: 3, AT_BASE: 4 } as const;
const rows = computed(() => [...crew.value].sort((a, b) => order[a.status] - order[b.status] || a.callsign.localeCompare(b.callsign)));

async function form() {
  await act('form', 'POST', '/expeditions', { playerIds: [...picked] }, 'Группа сформирована');
}
</script>

<template>
  <TPanel title="CREW STATUS" code="C-02">
    <template #actions>
      <span class="mono dim small">{{ crew.length }} PERSONNEL</span>
    </template>
    <div class="wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-if="canForm" class="sel" />
            <th>CALLSIGN</th>
            <th>STATUS</th>
            <th>EXIT</th>
            <th>DEADLINE</th>
            <th>HP</th>
            <th class="act" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="!crew.length">
            <td colspan="7" class="empty">// ПЕРСОНАЛ НЕ ЗАРЕГИСТРИРОВАН. ДОБАВЬТЕ СОТРУДНИКОВ В FIELD ADMIN.</td>
          </tr>
          <tr v-for="p in rows" :key="p.id" :class="[p.status.toLowerCase(), { picked: picked.has(p.id) }]" @click="canForm && toggle(p.id)">
            <td v-if="canForm" class="sel">
              <span class="box" :class="{ on: picked.has(p.id) }">{{ picked.has(p.id) ? '■' : '' }}</span>
            </td>
            <td class="cs">
              <span class="dot" :class="{ on: p.online }" :title="p.online ? 'device online' : 'device offline'" />
              {{ p.callsign }}
              <button v-if="p.camOn" type="button" class="cam mono" title="Смотреть BODY CAM" @click.stop="emit('watch', p.id)">◉ CAM</button>
            </td>
            <td><TChip :label="CREW_LABEL[p.status]" :tone="CREW_TONE[p.status]" :pulse="p.status === 'OVERDUE'" /></td>
            <td class="mono dim">{{ p.exitAt ? clock(p.exitAt, false) : '—' }}</td>
            <td>
              <Countdown v-if="p.deadlineAt && p.status !== 'AT_BASE' && p.status !== 'READY'" size="sm" :deadline="p.deadlineAt" :now="now" :paused-at="m?.pausedAt" />
              <span v-else class="mute mono">—</span>
            </td>
            <td>
              <HpBar :hp="p.hp" size="sm" />
            </td>
            <td class="act" @click.stop>
              <TButton
                v-if="['OUTSIDE', 'RETURNING', 'OVERDUE'].includes(p.status)"
                size="sm" :variant="p.status === 'OVERDUE' ? 'danger' : 'solid'" confirm="НА БАЗЕ?"
                :busy="busy.has(`ret${p.id}`)"
                @click="act(`ret${p.id}`, 'POST', '/expeditions/current/return', { playerId: p.id })"
              >ВЕРНУЛСЯ</TButton>
              <TButton
                v-else-if="p.status === 'READY' && exp?.status === 'active'"
                size="sm" variant="warn" :busy="busy.has(`exit${p.id}`)"
                @click="act(`exit${p.id}`, 'POST', '/expeditions/current/exit', { playerId: p.id })"
              >ВЫПУСТИТЬ</TButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="canForm" class="former">
      <span class="mono dim">ВЫБРАНО {{ picked.size }}/{{ size }}</span>
      <TButton variant="solid" :disabled="!picked.size" :busy="busy.has('form')" @click="form">
        {{ exp?.status === 'preparing' ? 'ОБНОВИТЬ ГРУППУ' : 'СФОРМИРОВАТЬ ГРУППУ' }}
      </TButton>
    </div>
  </TPanel>
</template>

<style scoped>
.small {
  font-size: 10.5px;
  letter-spacing: 0.1em;
}
.wrap {
  overflow-x: auto;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th {
  text-align: left;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.14em;
  color: var(--text-mute);
  padding: 0 8px 6px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
tbody tr {
  transition: background 0.1s;
}
tbody tr:hover {
  background: var(--panel-3);
}
tr.picked {
  background: rgba(156, 255, 58, 0.06);
}
tr.overdue {
  background: var(--red-dim);
}
.sel {
  width: 28px;
  cursor: pointer;
}
.box {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--line-2);
  color: var(--acc);
  font-size: 12px;
}
.box.on {
  border-color: var(--acc);
}
.cs {
  font-family: var(--mono);
  font-weight: 600;
  letter-spacing: 0.06em;
}
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--line-2);
}
.dot.on {
  background: var(--acc);
  box-shadow: 0 0 5px var(--acc);
}
.cam {
  margin-left: 6px;
  padding: 1px 6px;
  background: var(--red-dim);
  border: 1px solid var(--red);
  color: #ff7a6e;
  font-size: 10px;
  letter-spacing: 0.08em;
  cursor: pointer;
  vertical-align: middle;
}
.cam:hover {
  background: var(--red);
  color: #fff;
}
.pen {
  color: var(--red);
  font-size: 12px;
}
.act {
  text-align: right;
  width: 1%;
}
.former {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  font-size: 12px;
}
</style>
