<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Game } from '../../lib/game';
import type { LootStatus } from '@shared/types';
import { LOOT_TONE, clock, cr } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';

const props = defineProps<{ game: Game }>();
const { state, act, busy } = props.game;

const filter = ref<'all' | LootStatus>('all');
const search = ref('');
const loot = computed(() => state.value?.loot ?? []);
const counts = computed(() => ({
  all: loot.value.length,
  found: loot.value.filter((l) => l.status === 'found').length,
  available: loot.value.filter((l) => l.status === 'available').length,
  extracted: loot.value.filter((l) => l.status === 'extracted').length,
}));
const rank: Record<LootStatus, number> = { found: 0, available: 1, extracted: 2 };
const rows = computed(() => {
  const s = search.value.trim().toUpperCase();
  return loot.value
    .filter((l) => filter.value === 'all' || l.status === filter.value)
    .filter((l) => !s || l.code.includes(s) || l.name.toUpperCase().includes(s))
    .sort((a, b) => rank[a.status] - rank[b.status] || (b.foundAt ?? 0) - (a.foundAt ?? 0) || a.code.localeCompare(b.code));
});
// Without SCRAP RADAR the server only sends scanned scrap, so the AVAILABLE tab would always be empty.
const radar = computed(() => !!state.value?.mission?.scrapRadar);
const tabs = computed(() =>
  ([['all', 'ALL'], ['found', 'FOUND'], ['available', 'AVAILABLE'], ['extracted', 'EXTRACTED']] as const)
    .filter(([k]) => radar.value || k !== 'available'),
);
</script>

<template>
  <TPanel title="SCRAP RECOVERY" code="S-03" flush>
    <template #actions>
      <input v-model="search" class="input search" placeholder="КОД / НАЗВАНИЕ" />
    </template>
    <div class="tabs">
      <button v-for="[k, l] in tabs" :key="k" type="button" :class="{ on: filter === k }" @click="filter = k">
        {{ l }} <span>{{ counts[k] }}</span>
      </button>
    </div>
    <div v-if="!radar" class="noradar mono">
      ◌ РАДАР НЕ УСТАНОВЛЕН — ВИДНЫ ТОЛЬКО ОТСКАНИРОВАННЫЕ ПРЕДМЕТЫ. ЗАСЧИТАТЬ МОЖНО ТОЛЬКО ПО QR-МЕТКЕ.
    </div>
    <div class="list">
      <div v-if="!rows.length" class="empty">// {{ loot.length ? 'НЕТ СОВПАДЕНИЙ' : radar ? 'ПРЕДМЕТЫ МИССИИ НЕ ЗАРЕГИСТРИРОВАНЫ' : 'НИЧЕГО НЕ ОТСКАНИРОВАНО. ПРИНЕСИТЕ ЛУТ НА БАЗУ.' }}</div>
      <div v-for="l in rows" :key="l.id" class="item" :class="l.status">
        <span class="code mono">{{ l.code }}</span>
        <span class="name" :title="l.description || undefined">
          <span class="ellipsis nm">{{ l.name }}</span>
          <span v-if="l.description" class="ellipsis ds">{{ l.description }}</span>
        </span>
        <span class="val mono">{{ cr(l.value) }}<small> CR</small></span>
        <TChip :label="l.status" :tone="LOOT_TONE[l.status]" />
        <span class="who mono ellipsis">
          <template v-if="l.foundBy">{{ l.foundBy }} · {{ clock(l.foundAt, false) }}</template>
          <template v-else>—</template>
        </span>
        <span class="act">
          <TButton
            v-if="l.status === 'found'" size="sm" variant="solid" confirm="НА БАЗЕ?"
            :busy="busy.has(`ex${l.id}`)" @click="act(`ex${l.id}`, 'POST', `/loot/${l.id}/extract`)"
          >EXTRACT</TButton>
          <span v-else-if="l.status === 'available'" class="mute mono small">ЖДЁТ QR</span>
          <span v-else class="ok mono">✓ {{ clock(l.extractedAt, false) }}</span>
        </span>
      </div>
    </div>
  </TPanel>
</template>

<style scoped>
.noradar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--amber);
  background: var(--amber-dim);
}
.small {
  font-size: 10.5px;
}
.search {
  min-height: 28px;
  height: 28px;
  width: 170px;
  padding: 2px 8px;
  font-size: 12px;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
}
.tabs button {
  flex: 1;
  padding: 8px 4px;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-mute);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.tabs button span {
  color: var(--text-dim);
  margin-left: 4px;
}
.tabs button.on {
  color: var(--acc);
  border-bottom-color: var(--acc);
}
.list {
  padding: 4px 0;
}
.item {
  display: grid;
  grid-template-columns: 64px minmax(80px, 1fr) 72px 96px minmax(80px, 140px) 104px;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.item.found {
  background: linear-gradient(90deg, var(--amber-dim), transparent 60%);
}
.item.extracted {
  opacity: 0.6;
}
.code {
  font-size: 12px;
  color: var(--text-dim);
}
.name {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.nm,
.ds {
  display: block;
}
.ds {
  font-size: 11.5px;
  color: var(--text-mute);
}
.val {
  text-align: right;
  font-weight: 600;
  color: var(--acc);
}
.val small {
  color: var(--text-mute);
  font-weight: 400;
}
.who {
  font-size: 11.5px;
  color: var(--text-dim);
}
.act {
  text-align: right;
}
.ok {
  font-size: 11px;
  color: var(--acc-2);
}
@media (max-width: 700px) {
  .item {
    grid-template-columns: 56px 1fr auto;
  }
  .item .who,
  .item :deep(.chip) {
    display: none;
  }
  .act {
    grid-column: 1 / -1;
  }
}
</style>
