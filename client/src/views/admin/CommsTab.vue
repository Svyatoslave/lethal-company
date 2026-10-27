<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '../../lib/game';
import TPanel from '../../components/ui/TPanel.vue';
import TButton from '../../components/ui/TButton.vue';
import TChip from '../../components/ui/TChip.vue';
import MessageList from '../../components/MessageList.vue';

const props = defineProps<{ game: Game }>();
const { state, now, act, busy } = props.game;
const m = computed(() => state.value?.mission ?? null);
const crew = computed(() => state.value?.players.filter((p) => p.role === 'crew') ?? []);
const monsters = computed(() => state.value?.players.filter((p) => p.role === 'monster') ?? []);
const to = ref('operator');
const body = ref('');
const delay = ref(0);
watch(m, (v) => v && (delay.value = v.messageDelaySec), { immediate: true });

const TEMPLATES = [
  'Передайте группе: квота под угрозой, ищите тщательнее.',
  'Передайте: у бани замечена активность.',
  'Компания напоминает: металлолом ценнее вас.',
  'Всем вернуться на базу. Шагом.',
];

async function send() {
  const payload = to.value === 'operator' || to.value === 'crew' ? { toType: to.value } : { toType: 'player', toPlayerId: Number(to.value) };
  const r = await act('msg', 'POST', '/messages', { ...payload, body: body.value }, 'Отправлено');
  if (r) body.value = '';
}
</script>

<template>
  <TPanel title="КАНАЛ СВЯЗИ" code="X-01">
    <div class="row wrap">
      <TChip :label="m?.commsRadio ? 'RADIO UNLOCKED' : 'COURIER ONLY'" :tone="m?.commsRadio ? 'ok' : 'warn'" />
      <TChip v-if="m?.commsDisabled" label="SIGNAL JAMMED" tone="crit" pulse />
    </div>
    <div class="a-grid2 top">
      <TButton :variant="m?.commsDisabled ? 'solid' : 'danger'" size="lg" :busy="busy.has('jam')" @click="act('jam', 'PATCH', '/missions/current', { commsDisabled: !m?.commsDisabled })">
        {{ m?.commsDisabled ? 'ВЕРНУТЬ СИГНАЛ' : 'ЗАГЛУШИТЬ ЭФИР' }}
      </TButton>
      <TButton variant="ghost" size="lg" :confirm="m?.commsRadio ? 'ОТКЛЮЧИТЬ РАЦИЮ?' : 'ВЫДАТЬ РАЦИЮ?'" :busy="busy.has('radio')" @click="act('radio', 'PATCH', '/missions/current', { commsRadio: !m?.commsRadio })">
        {{ m?.commsRadio ? 'ЗАБРАТЬ RADIO' : 'ВЫДАТЬ RADIO' }}
      </TButton>
    </div>
    <TButton class="top" variant="ghost" block :confirm="m?.camsUnlocked ? 'ОТКЛЮЧИТЬ КАМЕРЫ?' : 'ВЫДАТЬ КАМЕРЫ?'" :busy="busy.has('cams')" @click="act('cams', 'PATCH', '/missions/current', { camsUnlocked: !m?.camsUnlocked })">
      {{ m?.camsUnlocked ? 'ЗАБРАТЬ BODY CAM' : 'ВЫДАТЬ BODY CAM' }} · {{ state?.players.filter((p) => p.camOn).length ?? 0 }} В ЭФИРЕ
    </TButton>
    <div class="row top">
      <label class="field grow"><span class="label">Задержка эфира, сек</span><input v-model.number="delay" class="input" type="number" min="0" max="600" /></label>
      <TButton class="sv" :busy="busy.has('delay')" @click="act('delay', 'PATCH', '/missions/current', { messageDelaySec: delay }, 'Задержка сохранена')">OK</TButton>
    </div>
    <p class="a-note top">До покупки RADIO: ведущий → оператор → курьер → экипаж. Сообщения экипажу отсюда идут как системные уведомления Компании.</p>
  </TPanel>

  <TPanel title="ПЕРЕДАЧА" code="X-02">
    <form class="stack" @submit.prevent="send">
      <select v-model="to" class="select">
        <option value="operator">→ ОПЕРАТОР (relay)</option>
        <option value="crew">→ ВЕСЬ ЭКИПАЖ (system)</option>
        <option v-for="p in crew" :key="p.id" :value="String(p.id)">→ {{ p.callsign }} (system)</option>
        <option v-for="p in monsters" :key="p.id" :value="String(p.id)">→ {{ p.callsign }} (монстр, лично)</option>
      </select>
      <textarea v-model="body" class="textarea" maxlength="500" placeholder="ТЕКСТ" />
      <div class="a-chips">
        <button v-for="t in TEMPLATES" :key="t" type="button" class="a-chip tpl" @click="body = t">{{ t }}</button>
      </div>
      <TButton variant="solid" size="lg" block :disabled="!body.trim()" :busy="busy.has('msg')" @click="send">ОТПРАВИТЬ</TButton>
    </form>
  </TPanel>

  <TPanel title="ЖУРНАЛ СООБЩЕНИЙ" code="X-03" flush>
    <div class="log"><MessageList :messages="state?.messages ?? []" role="admin" :now="now" /></div>
  </TPanel>
</template>

<style scoped>
.top {
  margin-top: 10px;
}
.sv {
  align-self: flex-end;
  min-height: 44px;
}
.tpl {
  min-height: 36px;
  font-family: var(--sans);
  font-size: 12px;
  letter-spacing: 0;
  text-align: left;
}
.log {
  height: 420px;
}
</style>
