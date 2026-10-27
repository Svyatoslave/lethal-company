<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Game } from '../../lib/game';
import { clock, cr } from '../../lib/format';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';

const props = defineProps<{ game: Game }>();
const { state, act, busy } = props.game;
const m = computed(() => state.value?.mission ?? null);

const amount = ref<number | null>(null);
const reason = ref('');
async function adjust(sign: 1 | -1) {
  if (!amount.value) return;
  const r = await act('adj', 'POST', '/economy/adjust', { amount: sign * Math.abs(amount.value), reason: reason.value }, 'Операция записана');
  if (r) {
    amount.value = null;
    reason.value = '';
  }
}

const edits = reactive<Record<number, { price: number; effectValue: number; maxPurchases: number; enabled: boolean }>>({});
watch(
  () => state.value?.shop,
  (shop) => {
    for (const i of shop ?? []) {
      if (!edits[i.id]) edits[i.id] = { price: i.price, effectValue: i.effectValue, maxPurchases: i.maxPurchases, enabled: i.enabled };
    }
  },
  { immediate: true },
);
function resetEdit(id: number) {
  const i = state.value?.shop.find((s) => s.id === id);
  if (i) edits[id] = { price: i.price, effectValue: i.effectValue, maxPurchases: i.maxPurchases, enabled: i.enabled };
}
async function saveItem(id: number) {
  const r = await act(`shop${id}`, 'PATCH', `/shop/${id}`, edits[id], 'Товар обновлён');
  if (r) delete edits[id];
}

const KIND: Record<string, string> = { start: 'СТАРТ', loot: 'ЛУТ', purchase: 'ПОКУПКА', penalty: 'ШТРАФ', manual: 'ВРУЧНУЮ', correction: 'КОРРЕКТ.' };
const EFFECT_HINT: Record<string, string> = { time_ext: 'секунд', medkit: '—', radio: '—', scanner: '—', extraction: '—' };
</script>

<template>
  <TPanel title="БАЛАНС" code="$-01">
    <div class="bal mono">{{ cr(state?.balance ?? 0) }} <small>CR</small></div>
    <div class="a-kv"><span>Квота</span><span>{{ cr(state?.quotaProgress ?? 0) }} / {{ cr(m?.quota ?? 0) }}</span></div>
    <div class="stack top">
      <div class="a-grid2">
        <input v-model.number="amount" class="input" type="number" min="1" placeholder="СУММА" />
        <input v-model="reason" class="input" maxlength="120" placeholder="ПРИЧИНА" />
      </div>
      <div class="a-grid2">
        <TButton variant="solid" size="lg" :disabled="!amount || !reason.trim()" :busy="busy.has('adj')" @click="adjust(1)">+ НАЧИСЛИТЬ</TButton>
        <TButton variant="danger" size="lg" :disabled="!amount || !reason.trim()" :busy="busy.has('adj')" @click="adjust(-1)">− СПИСАТЬ</TButton>
      </div>
      <p class="a-note">Баланс меняется только операциями в журнале. Ошибку исправляйте кнопкой «ОТМЕНИТЬ» — создаётся корректировка.</p>
    </div>
  </TPanel>

  <TPanel title="МАГАЗИН" code="$-02">
    <div v-for="i in state?.shop ?? []" :key="i.id" class="a-item">
      <div class="row">
        <span class="a-title grow">{{ i.name }}</span>
        <span class="a-sub">куплено {{ i.bought }}</span>
      </div>
      <template v-if="edits[i.id]">
        <div class="a-grid3">
          <label class="field"><span class="label">Цена</span><input v-model.number="edits[i.id].price" class="input" type="number" min="0" /></label>
          <label class="field"><span class="label">Эффект ({{ EFFECT_HINT[i.key] ?? '' }})</span><input v-model.number="edits[i.id].effectValue" class="input" type="number" min="0" /></label>
          <label class="field"><span class="label">Лимит (0=∞)</span><input v-model.number="edits[i.id].maxPurchases" class="input" type="number" min="0" /></label>
        </div>
        <div class="row">
          <label class="check grow"><input v-model="edits[i.id].enabled" type="checkbox" /> доступен</label>
          <TButton size="sm" variant="ghost" @click="resetEdit(i.id)">СБРОС</TButton>
          <TButton size="sm" :busy="busy.has(`shop${i.id}`)" @click="saveItem(i.id)">СОХРАНИТЬ</TButton>
        </div>
      </template>
    </div>
  </TPanel>

  <TPanel title="ИСТОРИЯ ОПЕРАЦИЙ" code="$-03">
    <div v-for="t in state?.transactions ?? []" :key="t.id" class="tx" :class="{ rev: t.reversedById }">
      <span class="amt mono" :class="t.amount >= 0 ? 'acc' : 'red'">{{ t.amount >= 0 ? '+' : '' }}{{ cr(t.amount) }}</span>
      <span class="grow d">
        {{ t.description }}
        <span class="a-sub">#{{ t.id }} · {{ KIND[t.kind] ?? t.kind }} · {{ t.actor }} · {{ clock(t.createdAt, false) }}<template v-if="t.reversedById"> · ОТМЕНЕНА (#{{ t.reversedById }})</template></span>
      </span>
      <TButton
        v-if="!t.reversedById && !t.reversesId" size="sm" variant="ghost" confirm="ОТМЕНИТЬ?"
        :busy="busy.has(`rv${t.id}`)" @click="act(`rv${t.id}`, 'POST', `/economy/${t.id}/reverse`, { reason: 'ошибочная операция' }, 'Корректировка записана')"
      >ОТМЕНИТЬ</TButton>
    </div>
  </TPanel>
</template>

<style scoped>
.top {
  margin-top: 10px;
}
.bal {
  font-size: 44px;
  font-weight: 800;
  color: var(--acc);
  text-shadow: var(--acc-glow);
  margin-bottom: 6px;
}
.bal small {
  font-size: 16px;
  color: var(--text-mute);
}
.tx {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13.5px;
}
.tx.rev {
  opacity: 0.5;
}
.tx.rev .amt {
  text-decoration: line-through;
}
.amt {
  min-width: 64px;
  text-align: right;
  font-weight: 700;
}
.d {
  display: flex;
  flex-direction: column;
}
</style>
