<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { Game } from '../../lib/game';
import type { ShopItemView } from '@shared/types';
import { requestId } from '../../lib/api';
import { cr } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';

const props = defineProps<{ game: Game }>();
const { state, act, busy } = props.game;

const m = computed(() => state.value?.mission ?? null);
const balance = computed(() => state.value?.balance ?? 0);
const items = computed(() => state.value?.shop ?? []);
const injured = computed(() => state.value?.players.filter((p) => p.role === 'crew' && p.hp < 100) ?? []);
const pending = computed(() => state.value?.purchases.filter((p) => ['scanner', 'extraction'].includes(p.itemKey) && !p.fulfilledAt) ?? []);
const target = reactive<Record<number, number | ''>>({});
// One idempotency key per intended purchase: retries reuse it, a completed purchase rotates it.
const rids = reactive<Record<number, string>>({});

function blocker(i: ShopItemView): string | null {
  if (!m.value || (m.value.status !== 'active' && m.value.status !== 'paused')) return 'OFFLINE';
  if (!i.enabled) return 'НЕДОСТУПНО';
  if (i.maxPurchases && i.bought >= i.maxPurchases) return i.key === 'radio' ? 'УСТАНОВЛЕНО' : 'ЛИМИТ';
  if (i.key === 'radio' && m.value.commsRadio) return 'УСТАНОВЛЕНО';
  if (i.key === 'bodycam' && m.value.camsUnlocked) return 'УСТАНОВЛЕНО';
  if (balance.value < i.price) return 'НЕТ CR';
  if (i.key === 'medkit' && !target[i.id]) return injured.value.length ? 'ВЫБЕРИТЕ' : 'ВСЕ ЗДОРОВЫ';
  return null;
}

async function buy(i: ShopItemView) {
  rids[i.id] ??= requestId();
  const r = await act<{ duplicate: boolean }>(`buy${i.id}`, 'POST', `/shop/${i.id}/purchase`, {
    requestId: rids[i.id],
    targetPlayerId: i.key === 'medkit' ? target[i.id] : undefined,
  }, `${i.name}: ПОКУПКА ПОДТВЕРЖДЕНА`);
  delete rids[i.id];
  if (r) target[i.id] = '';
}

const effectNote = (i: ShopItemView) =>
  i.key === 'time_ext' ? `+${Math.round(i.effectValue / 60)} мин` : i.maxPurchases ? `${i.bought}/${i.maxPurchases}` : i.bought ? `×${i.bought}` : '';
</script>

<template>
  <TPanel title="COMPANY STORE" code="$-04">
    <template #actions>
      <span class="bal mono">{{ cr(balance) }} CR</span>
    </template>
    <div class="store">
      <div v-for="i in items" :key="i.id" class="it" :class="{ off: !!blocker(i) && blocker(i) !== 'ВЫБЕРИТЕ' }">
        <div class="top">
          <span class="nm mono">{{ i.name }}</span>
          <span class="note mono">{{ effectNote(i) }}</span>
          <span class="pr mono">{{ cr(i.price) }} CR</span>
        </div>
        <div class="ds">{{ i.description }}</div>
        <div class="row">
          <select v-if="i.key === 'medkit'" v-model="target[i.id]" class="select grow sel">
            <option value="">— КОМУ —</option>
            <option v-for="p in injured" :key="p.id" :value="p.id">{{ p.callsign }} (HP {{ p.hp }}%)</option>
          </select>
          <span v-else class="grow" />
          <TButton
            size="sm" :variant="blocker(i) ? 'ghost' : 'primary'" :disabled="!!blocker(i)" :confirm="`−${i.price} CR?`"
            :busy="busy.has(`buy${i.id}`)" @click="buy(i)"
          >{{ blocker(i) ?? 'КУПИТЬ' }}</TButton>
        </div>
      </div>
      <div v-for="p in pending" :key="p.id" class="pending mono">
        <span class="blink">◆</span> {{ p.itemName }} — ОЖИДАЕТ FIELD ADMIN
      </div>
    </div>
  </TPanel>
</template>

<style scoped>
.bal {
  color: var(--acc);
  font-weight: 800;
  font-size: 14px;
  text-shadow: var(--acc-glow);
}
.store {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.it {
  padding: 9px 10px;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.it.off {
  opacity: 0.55;
}
.top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.nm {
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--text);
}
.note {
  font-size: 10.5px;
  color: var(--text-mute);
}
.pr {
  margin-left: auto;
  color: var(--amber);
  font-weight: 600;
  font-size: 13px;
}
.ds {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.3;
}
.sel {
  min-height: 32px;
  padding: 4px 8px;
  font-size: 12px;
}
.pending {
  font-size: 11.5px;
  color: var(--amber);
  padding: 6px 8px;
  border: 1px dashed rgba(255, 182, 39, 0.4);
}
</style>
