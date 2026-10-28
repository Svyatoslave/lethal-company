<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useGame } from '../lib/game';
import { api, requestId } from '../lib/api';
import { toast } from '../lib/toast';
import { setToken } from '../lib/session';
import {
  audioReady, beep, keepAwake, keepAwakeSupported, muted, startKeepAwake, toggleKeepAwake, toggleMuted, unlockAudio, vibrate,
} from '../lib/sound';

import { useBodyCamPublisher } from '../lib/bodycam';

const canVibrate = 'vibrate' in navigator;
function testSignal() {
  unlockAudio();
  if (muted.value) toggleMuted();
  beep('radio');
  vibrate(300);
}
import { CREW_LABEL, CREW_TONE, GATE_TONE, LOOT_TONE, MISSION_LABEL, MISSION_TONE, clock, cr } from '../lib/format';
import AlertLayer from '../components/AlertLayer.vue';
import Logo from '../components/Logo.vue';
import MessageList from '../components/MessageList.vue';
import Scanner from '../components/Scanner.vue';
import TaskPanel from '../components/TaskPanel.vue';
import TButton from '../components/ui/TButton.vue';
import TChip from '../components/ui/TChip.vue';
import Countdown from '../components/ui/Countdown.vue';
import Meter from '../components/ui/Meter.vue';
import HpBar from '../components/ui/HpBar.vue';

const route = useRoute();
const router = useRouter();

const game = useGame('crew', (name, fx, s) => {
  const me = s?.me;
  if (name === 'monster:event' && me?.role === 'monster') return 'ignore';
  if (name === 'gate:closed' || name === 'mission:updated') return 'toast';
  return 'alert';
});
const { state, now, authed, connected, alerts, dismiss, connect, logout, act, busy } = game;
const cam = useBodyCamPublisher(game.socket);
const camPreview = ref<HTMLVideoElement | null>(null);
watch([camPreview, cam.stream], ([el, s]) => {
  if (el && el.srcObject !== s) el.srcObject = s;
});
// The gate opened while the scanner was up: close it, scanning is locked during a raid.
watch(
  () => state.value?.raidActive,
  (active) => {
    if (active) scanning.value = false;
  },
);
// Cameras revoked by the field admin: stop streaming immediately.
watch(
  () => state.value?.mission?.camsUnlocked,
  (on) => {
    if (on === false && cam.stream.value) cam.stop();
  },
);

const PENDING = 'olnr.pendingClaim';
const code = ref('');
const joinError = ref('');
const joining = ref(false);
const scanning = ref(false);
interface ClaimResult {
  result: 'identified' | 'duplicate';
  item: { code: string; name: string; description: string; value: number; status: string; foundBy: string | null; foundAt: number | null };
}
const scan = ref<{ ok: boolean; title: string; data?: ClaimResult; error?: string } | null>(null);

const me = computed(() => state.value?.me ?? null);
const m = computed(() => state.value?.mission ?? null);
const myRow = computed(() => state.value?.players.find((p) => p.id === me.value?.playerId) ?? null);
const infected = computed(() => !!myRow.value?.infected);
const threat = computed(() => me.value?.role === 'monster' || infected.value);
const status = computed(() => myRow.value?.status ?? 'AT_BASE');
const exp = computed(() => state.value?.expedition ?? null);
const myHp = computed(() => myRow.value?.hp ?? 100);
const myHealth = computed(() => state.value?.health.slice(0, 3) ?? []);
const radio = computed(() => !!m.value?.commsRadio);
const radioUp = computed(() => radio.value && !m.value?.commsDisabled);
const notices = computed(() => {
  const ev = (state.value?.events ?? []).slice(-12).map((e) => ({ id: `e${e.id}`, at: e.createdAt, tag: e.type, text: e.text, level: e.level }));
  const sys = (state.value?.messages ?? [])
    .filter((x) => x.channel === 'system')
    .map((x) => ({ id: `m${x.id}`, at: x.createdAt, tag: 'COMPANY', text: x.body, level: 'warn' as const }));
  return [...ev, ...sys].sort((a, b) => b.at - a.at).slice(0, 14);
});
/** Why the scan button is locked (null = scanning allowed). The server enforces the same rules. */
const scanLock = computed(() => {
  if (!m.value || m.value.status === 'draft') return 'МИССИЯ НЕ ЗАПУЩЕНА';
  if (m.value.status === 'paused') return 'ИГРА НА ПАУЗЕ';
  if (m.value.status === 'ended') return 'МИССИЯ ЗАВЕРШЕНА';
  if (myHp.value <= 0) return 'ВЫ ВЫВЕДЕНЫ ИЗ СТРОЯ. СКАНИРОВАНИЕ НЕДОСТУПНО ДО ЛЕЧЕНИЯ.';
  if (state.value?.raidActive) return 'СКАНИРОВАНИЕ ЗАБЛОКИРОВАНО ВО ВРЕМЯ ВЫЛАЗКИ. ДОСТУПНО МЕЖДУ ВЫЛАЗКАМИ.';
  return null;
});
const fieldCrew = computed(() => state.value?.players.filter((p) => p.role === 'crew' && p.status !== 'AT_BASE') ?? []);
const targets = computed(() => fieldCrew.value.filter((p) => p.id !== me.value?.playerId && !p.infected && ['OUTSIDE', 'RETURNING', 'OVERDUE'].includes(p.status)));
const rage = computed(() => (m.value?.monsterDamage ?? 0) >= 100);
async function hit(playerId: number) {
  const r = await act<{ hp: number; duplicate: boolean; infected: boolean; hits?: number; hitsRequired?: number }>(`hit${playerId}`, 'POST', '/monster/hit', { targetPlayerId: playerId, requestId: requestId() });
  if (r) {
    vibrate(200);
    toast(r.infected
      ? 'Контакт подтверждён. Связь с целью потеряна.'
      : m.value?.infectionMode
        ? `Контакт подтверждён: ${r.hits ?? 0}/${r.hitsRequired ?? m.value.infectionHitsRequired}`
        : `Удар засчитан. Здоровье цели: ${r.hp}%`, 'warn');
  }
}

async function joinWith(c: string) {
  joining.value = true;
  joinError.value = '';
  try {
    const r = await api<{ token: string }>('crew', 'POST', '/auth/join', { code: c });
    setToken('crew', r.token);
    connect();
    await runPendingClaim();
  } catch (e) {
    joinError.value = (e as Error).message;
  } finally {
    joining.value = false;
  }
}

async function claim(token: string) {
  scanning.value = false;
  if (token.startsWith('terminal:')) {
    const r = await act('terminal', 'POST', `/terminals/${encodeURIComponent(token.slice(9))}/activate`);
    if (r) { scan.value = { ok: true, title: 'ТЕРМИНАЛ ПОДКЛЮЧЁН · СВЯЖИТЕСЬ С ОПЕРАТОРОМ' }; beep('ok'); }
    return;
  }
  try {
    const r = await api<ClaimResult>('crew', 'POST', `/loot/${encodeURIComponent(token)}/claim`);
    if (r.result === 'identified') {
      beep('ok');
      vibrate([60, 40, 160]);
      scan.value = { ok: true, title: 'SCRAP IDENTIFIED', data: r };
    } else {
      beep('info');
      scan.value = { ok: false, title: 'ОБЪЕКТ УЖЕ ЗАРЕГИСТРИРОВАН', data: r };
    }
  } catch (e) {
    beep('warn');
    vibrate([200, 80, 200]);
    scan.value = { ok: false, title: 'СКАНИРОВАНИЕ ОТКЛОНЕНО', error: (e as Error).message };
  }
}

async function runPendingClaim() {
  let t: string | null = null;
  try {
    t = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
  } catch {
    /* ignore */
  }
  if (t) await claim(t);
}

const msg = ref('');
const QUICK = ['НАШЁЛ ЛУТ', 'ВОЗВРАЩАЮСЬ', 'ВИЖУ УГРОЗУ', 'НУЖНА ПОМОЩЬ', 'ЗАБЛУДИЛСЯ'];
const MONSTER_QUICK = ['ВЫШЕЛ НА ОХОТУ', 'ИДУ К ГРУППЕ', 'УДАРИЛ', 'НУЖНА ПАУЗА', 'ВОЗВРАЩАЮСЬ'];
async function sendMsg(text = msg.value) {
  const body = text.trim();
  if (!body) return;
  // Monsters talk only to the field admin; crew talk to the operator over the radio.
  const r = await act('msg', 'POST', '/messages', { toType: me.value?.role === 'monster' ? 'admin' : 'operator', body });
  if (r && text === msg.value) msg.value = '';
}

onMounted(async () => {
  startKeepAwake();
  const qCode = typeof route.query.code === 'string' ? route.query.code : '';
  const qClaim = typeof route.query.claim === 'string' ? route.query.claim : '';
  if (qClaim) {
    try {
      sessionStorage.setItem(PENDING, qClaim);
    } catch {
      /* ignore */
    }
  }
  if (qCode || qClaim) void router.replace({ path: '/crew' });
  if (qCode) return joinWith(qCode);
  if (authed.value) {
    connect();
    await runPendingClaim();
  }
});
</script>

<template>
  <!-- JOIN -->
  <div v-if="!authed" class="join">
    <form class="jbox" @submit.prevent="joinWith(code)">
      <Logo />
      <div class="hr" />
      <div class="label">CREW DEVICE // РЕГИСТРАЦИЯ СОТРУДНИКА</div>
      <p class="dim">Отсканируйте свой бейдж или введите личный код сотрудника.</p>
      <input v-model="code" class="input codein" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="XXXXXX" />
      <div v-if="joinError" class="err mono">▲ {{ joinError }}</div>
      <TButton variant="solid" size="xl" block :busy="joining" :disabled="code.trim().length < 4" @click="joinWith(code)">ЗАСТУПИТЬ НА СМЕНУ</TButton>
      <p class="mute small">Подписывая контракт, вы соглашаетесь с тем, что Компания не несёт ответственности ни за что.</p>
    </form>
  </div>

  <!-- DEVICE -->
  <div v-else class="dev" :class="{ monster: threat }">
    <header class="hd">
      <div class="who">
        <span class="label">{{ infected ? 'SIGNAL LOST' : me?.role === 'monster' ? 'THREAT UNIT' : 'EMPLOYEE' }}</span>
        <b class="mono">{{ me?.callsign ?? '…' }}</b>
      </div>
      <span class="link mono" :class="{ on: connected }"><i />{{ connected ? 'LINK' : 'NO LINK' }}</span>
      <button type="button" class="out mono" :class="{ off: muted }" @click="muted ? testSignal() : toggleMuted()">{{ muted ? 'ЗВУК ✕' : 'ЗВУК' }}</button>
      <button type="button" class="out mono" @click="logout">ВЫЙТИ</button>
    </header>

    <button v-if="!audioReady || muted" type="button" class="unlock mono" @click="testSignal">
      🔊 НАЖМИТЕ, ЧТОБЫ ВКЛЮЧИТЬ ЗВУК СИГНАЛОВ
      <small>Без этого телефон не пискнет при сообщении. На iPhone выключите беззвучный режим.</small>
    </button>

    <div class="strip mono">
      <span>{{ m?.code ?? 'NO MISSION' }}</span>
      <TChip v-if="m" :label="MISSION_LABEL[m.status]" :tone="MISSION_TONE[m.status]" />
      <TChip v-if="m" :label="`GATE ${m.gate}`" :tone="GATE_TONE[m.gate]" :pulse="m.gate === 'closing'" />
      <span v-if="m?.threatLevel" class="thr" :class="{ hot: m.threatLevel >= 4 }">THREAT {{ m.threatLevel }}</span>
    </div>

    <!-- MONSTER -->
    <template v-if="threat">
      <section class="card dmg" :class="{ rage }">
        <div class="row">
          <span class="label grow">{{ infected ? 'СТАТУС: ЗАРАЖЁН' : 'ВАШ УРОН' }}</span>
          <b class="mono dmgv">{{ m?.infectionMode ? 'РАСПРОСТРАНЕНИЕ' : `${m?.monsterDamage ?? 0}% HP ЗА УДАР` }}</b>
        </div>
        <p v-if="rage && !m?.infectionMode" class="raget mono blink">ЯРОСТЬ: ОДИН УДАР СМЕРТЕЛЕН</p>
        <p class="mute small">{{ infected ? 'Связь с оператором потеряна. Коснитесь другого сотрудника за шлюзом и сразу отметьте контакт.' : 'Вы действуете сами. Коснулись сотрудника — сразу отметьте удар. Отмечайте только реальное касание.' }}</p>
      </section>

      <section class="card">
        <div class="label">ОТМЕТИТЬ УДАР · ЭКИПАЖ ЗА ШЛЮЗОМ</div>
        <div v-if="!targets.length" class="empty">// ЗА ШЛЮЗОМ НИКОГО</div>
        <div v-for="p in targets" :key="p.id" class="target">
          <div class="tinfo">
            <b class="mono">{{ p.callsign }}</b>
            <HpBar :hp="p.hp" size="sm" />
          </div>
          <TButton
            variant="danger" size="lg" :disabled="p.hp <= 0 || m?.status !== 'active'" :confirm="`УДАР: ${p.callsign}?`"
            :busy="busy.has(`hit${p.id}`)" @click="hit(p.id)"
          >УДАР</TButton>
        </div>
      </section>

      <section v-if="!infected" class="card comms">
        <div class="label">ЧАТ С ВЕДУЩИМ</div>
        <div class="mlist"><MessageList :messages="state?.messages ?? []" role="player" :now="now" /></div>
        <div class="quick">
          <button v-for="q in MONSTER_QUICK" :key="q" type="button" class="qb mono" :disabled="busy.has('msg')" @click="sendMsg(q)">{{ q }}</button>
        </div>
        <form class="row" @submit.prevent="sendMsg()">
          <input v-model="msg" class="input grow" maxlength="300" placeholder="СООБЩЕНИЕ ВЕДУЩЕМУ" />
          <TButton :disabled="!msg.trim()" :busy="busy.has('msg')" @click="sendMsg()">TX</TButton>
        </form>
      </section>

      <section class="safety">
        ПРАВИЛА УГРОЗЫ: двигайтесь шагом · удар — лёгкое касание, без силы · не выходите за границы территории · при реальной опасности — стоп игра.
      </section>
    </template>

    <!-- CREW -->
    <template v-else>
      <section class="card status" :class="status.toLowerCase()">
        <div class="row">
          <span class="label grow">ВАШ СТАТУС</span>
          <TChip big :label="CREW_LABEL[status]" :tone="CREW_TONE[status]" :pulse="status === 'OVERDUE'" />
        </div>
        <div class="tmr">
          <Countdown
            size="xl"
            :deadline="status === 'AT_BASE' || status === 'READY' ? null : myRow?.deadlineAt ?? null"
            :static-ms="status === 'READY' && m ? (m.durationSec + m.timeBonusSec) * 1000 : null"
            :now="now" :paused-at="m?.pausedAt"
          />
          <div class="tl mono">
            <template v-if="status === 'OUTSIDE' || status === 'RETURNING'">ДО ЗАКРЫТИЯ ОКНА ВОЗВРАТА · ВЫХОД {{ clock(myRow?.exitAt, false) }}</template>
            <template v-else-if="status === 'OVERDUE'">ВЫ ОПОЗДАЛИ. ВОЗВРАЩАЙТЕСЬ НА БАЗУ ШАГОМ.</template>
            <template v-else-if="status === 'READY'">ВЫ В ГРУППЕ #{{ exp?.number }}. ЖДИТЕ ОТКРЫТИЯ ШЛЮЗА.</template>
            <template v-else>НА БАЗЕ. ОЖИДАЙТЕ НАЗНАЧЕНИЯ.</template>
          </div>
        </div>
        <div v-if="exp && exp.status !== 'completed' && exp.players.length > 1" class="mates mono">
          ГРУППА: {{ exp.players.map((p) => p.callsign).join(' · ') }}
        </div>
      </section>

      <section class="card hpc" :class="{ down: myHp <= 0 }">
        <span class="label">ЗДОРОВЬЕ</span>
        <HpBar :hp="myHp" size="lg" />
        <p v-if="myHp <= 0" class="downt mono">ВЫ ВЫВЕДЕНЫ ИЗ СТРОЯ. ЕСЛИ ВЫ ЗА ШЛЮЗОМ — ВОЗВРАЩАЙТЕСЬ НА БАЗУ ШАГОМ. ДО ЛЕЧЕНИЯ НЕЛЬЗЯ ВЫХОДИТЬ ЗА ШЛЮЗ И СКАНИРОВАТЬ ЛУТ. ВЕРНУТЬ В СТРОЙ МОЖЕТ ТОЛЬКО АПТЕЧКА.</p>
        <p v-else class="mute small">Здоровье не восстанавливается само — лечит только MEDKIT.</p>
        <p class="mute small mono">ОПОЗДАНИЕ −{{ m?.overdueDamage ?? 0 }}% · УДАР МОНСТРА −{{ m?.monsterDamage ?? 0 }}%</p>
        <div v-for="h in myHealth" :key="h.id" class="hlog mono" :class="h.delta < 0 ? 'neg' : 'pos'">
          <span class="mute">{{ clock(h.createdAt, false) }}</span> {{ h.delta > 0 ? '+' : '' }}{{ h.delta }}% · {{ h.reason }}
        </div>
      </section>

      <TButton variant="solid" size="xl" block :disabled="!!scanLock" @click="scan = null; scanning = true">◎ СКАНИРОВАТЬ ЛУТ</TButton>
      <div v-if="scanLock" class="scanlock mono">⊘ {{ scanLock }}</div>
      <TButton size="lg" block :disabled="m?.status !== 'active'" @click="scan = null; scanning = true">◎ СКАНИРОВАТЬ ТЕРМИНАЛ</TButton>
      <TaskPanel :game="game" employee />
      <TButton
        v-if="status === 'OUTSIDE'" variant="warn" size="lg" block
        :busy="busy.has('ret')" @click="act('ret', 'POST', '/expeditions/current/returning', {}, 'Оператор уведомлён')"
      >ВОЗВРАЩАЮСЬ НА БАЗУ</TButton>

      <section v-if="m?.camsUnlocked" class="card cam" :class="{ live: cam.stream.value }">
        <div class="row">
          <span class="label grow">BODY CAM</span>
          <span v-if="cam.stream.value && cam.viewers.value" class="rec mono"><i />В ЭФИРЕ · СМОТРЯТ {{ cam.viewers.value }}</span>
          <span v-else-if="cam.stream.value" class="mono small acc">КАМЕРА ГОТОВА</span>
        </div>
        <template v-if="cam.stream.value">
          <video ref="camPreview" class="preview" autoplay playsinline muted />
          <p class="mute small">
            Оператор может видеть<template v-if="cam.hasAudio.value"> и слышать</template> вас, когда подключается. Вы его не слышите.
            Держите телефон камерой вперёд и не блокируйте экран.
          </p>
          <TButton v-if="cam.torchAvailable.value" :variant="cam.torchOn.value ? 'solid' : 'warn'" size="lg" block @click="cam.toggleTorch">
            {{ cam.torchOn.value ? '◉ ФОНАРИК ВКЛ' : '○ ВКЛЮЧИТЬ ФОНАРИК' }}
          </TButton>
          <p v-else class="mute small">Фонарик (вспышка) на этом телефоне из браузера недоступен — пользуйтесь обычным фонарём.</p>
          <TButton variant="ghost" block @click="cam.stop">ВЫКЛЮЧИТЬ КАМЕРУ</TButton>
        </template>
        <template v-else>
          <p class="dim locked">Компания купила камеры. Включите BODY CAM — оператор сможет смотреть и слушать прямой эфир с вашего телефона.</p>
          <div v-if="cam.error.value" class="err mono">▲ {{ cam.error.value }}</div>
          <TButton variant="warn" size="lg" block :busy="cam.starting.value" @click="cam.start">◉ ВКЛЮЧИТЬ BODY CAM</TButton>
        </template>
      </section>

      <section v-if="scan" class="card result" :class="{ ok: scan.ok, bad: !scan.ok }" @click="scan = null">
        <div class="rt mono">{{ scan.ok ? '✓' : '◆' }} {{ scan.title }}</div>
        <template v-if="scan.data">
          <div class="rn">{{ scan.data.item.name }}</div>
          <div v-if="scan.data.item.description" class="rd">{{ scan.data.item.description }}</div>
          <div class="rm mono">
            [{{ scan.data.item.code }}] · ОЦЕНКА {{ cr(scan.data.item.value) }} CR
            <template v-if="!scan.ok"> · {{ scan.data.item.status.toUpperCase() }}{{ scan.data.item.foundBy ? ` · ${scan.data.item.foundBy}` : '' }}</template>
          </div>
          <div v-if="scan.ok" class="rh">Доставьте предмет на базу. Кредиты начисляются после подтверждения оператором.</div>
        </template>
        <div v-else class="rh">{{ scan.error }}</div>
      </section>



      <section class="card comms">
        <div class="row">
          <span class="label grow">СВЯЗЬ</span>
          <TChip :label="!radio ? 'НЕТ РАЦИИ' : radioUp ? 'RADIO ONLINE' : 'SIGNAL LOST'" :tone="!radio ? 'mute' : radioUp ? 'ok' : 'crit'" :pulse="radio && !radioUp" />
        </div>
        <template v-if="radio">
          <div class="mlist"><MessageList :messages="state?.messages ?? []" role="player" :now="now" /></div>
          <div class="quick">
            <button v-for="q in QUICK" :key="q" type="button" class="qb mono" :disabled="!radioUp || busy.has('msg')" @click="sendMsg(q)">{{ q }}</button>
          </div>
          <form class="row" @submit.prevent="sendMsg()">
            <input v-model="msg" class="input grow" maxlength="300" placeholder="СООБЩЕНИЕ ОПЕРАТОРУ" :disabled="!radioUp" />
            <TButton :disabled="!radioUp || !msg.trim()" :busy="busy.has('msg')" @click="sendMsg()">TX</TButton>
          </form>
        </template>
        <p v-else class="dim locked">Прямой связи нет. Указания передаёт курьер. Когда команда купит RADIO, здесь откроется эфир.</p>
      </section>

      <section class="card">
        <div class="row">
          <span class="label grow">КВОТА КОМПАНИИ</span>
          <span class="mono small dim">{{ cr(state?.quotaProgress ?? 0) }} / {{ cr(m?.quota ?? 0) }} CR</span>
        </div>
        <Meter :value="state?.quotaProgress ?? 0" :max="m?.quota ?? 1" :segments="16" tone="amber" />
      </section>

      <section v-if="m?.scrapRadar" class="card">
        <div class="row">
          <span class="label grow">SCRAP RADAR · ОБЪЕКТЫ МИССИИ</span>
          <span class="mono small dim">{{ state?.manifest.filter((l) => l.status === 'available').length ?? 0 }} НЕ НАЙДЕНО</span>
        </div>
        <div v-for="l in state?.manifest ?? []" :key="l.id" class="find mono" :class="{ gone: l.status !== 'available' }">
          <span>{{ l.code }}</span><span class="grow ellipsis">{{ l.name }}</span>
          <span class="acc">{{ cr(l.value) }}</span>
          <TChip :label="l.status" :tone="LOOT_TONE[l.status]" />
        </div>
      </section>
      <p v-else class="mute small radarhint">Сколько металлолома на объекте и где он — неизвестно. Компания продаёт SCRAP RADAR.</p>

      <section v-if="state?.loot.length" class="card">
        <div class="label">МОИ НАХОДКИ</div>
        <div v-for="l in state.loot" :key="l.id" class="find mono">
          <span>{{ l.code }}</span><span class="grow ellipsis">{{ l.name }}</span>
          <TChip :label="l.status" :tone="l.status === 'extracted' ? 'ok' : 'warn'" />
        </div>
      </section>
    </template>

    <section class="card">
      <div class="label">УВЕДОМЛЕНИЯ</div>
      <div v-if="!notices.length" class="empty">// ТИШИНА</div>
      <div v-for="n in notices" :key="n.id" class="nt mono" :class="n.level">
        <span class="mute">{{ clock(n.at, false) }}</span> <b>[{{ n.tag }}]</b> {{ n.text }}
      </div>
    </section>

    <section class="card">
      <div class="label">СИГНАЛЫ УСТРОЙСТВА</div>
      <div class="setup">
        <TButton size="sm" variant="ghost" @click="testSignal">ПРОВЕРИТЬ СИГНАЛ</TButton>
        <TButton v-if="keepAwakeSupported" size="sm" :variant="keepAwake ? 'primary' : 'ghost'" @click="toggleKeepAwake">
          ЭКРАН НЕ ГАСНЕТ: {{ keepAwake ? 'ВКЛ' : 'ВЫКЛ' }}
        </TButton>
      </div>
      <p class="mute small">
        Звук и вибрация срабатывают, пока страница открыта на экране.
        <template v-if="!canVibrate"> Этот браузер не поддерживает вибрацию (iPhone) — будет только звук.</template>
      </p>
    </section>

    <footer class="safety">
      ПРИ РЕАЛЬНОЙ ОПАСНОСТИ ИГРА ОСТАНАВЛИВАЕТСЯ. НЕ БЕГАЙТЕ В ТЕМНОТЕ. НЕ ПОКИДАЙТЕ ТЕРРИТОРИЮ.
    </footer>

    <Scanner v-if="scanning" :stream="cam.stream.value" @detected="claim" @close="scanning = false" />

    <div v-if="m?.status === 'paused'" class="curtain">
      <div class="cbox">
        <div class="ct mono blink">▲ ИГРА ПРИОСТАНОВЛЕНА</div>
        <div class="cr">{{ m.pauseReason }}</div>
        <p>Оставайтесь на месте. Включите фонарик. Ждите указаний ведущего.</p>
        <p class="mute mono small">ТАЙМЕРЫ ЗАМОРОЖЕНЫ — ВРЕМЯ НЕ ИДЁТ</p>
      </div>
    </div>
    <AlertLayer :alerts="alerts" @dismiss="dismiss" />
  </div>
</template>

<style scoped>
.join {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 16px;
}
.jbox {
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.jbox p {
  margin: 0;
}
.codein {
  font-size: 34px;
  min-height: 72px;
  text-align: center;
  letter-spacing: 0.35em;
  text-transform: uppercase;
}
.err {
  color: var(--red);
  font-size: 13px;
}
.small {
  font-size: 11.5px;
}

.dev {
  max-width: 560px;
  margin: 0 auto;
  padding: 10px 12px calc(24px + var(--safe-b));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0 6px;
  border-bottom: 1px solid var(--line);
}
.who {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.who b {
  font-size: 24px;
  letter-spacing: 0.1em;
  color: var(--acc);
  text-shadow: var(--acc-glow);
}
.monster .who b {
  color: var(--red);
  text-shadow: 0 0 12px rgba(216, 70, 60, 0.5);
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--red);
}
.link i {
  width: 8px;
  height: 8px;
  background: currentColor;
}
.link.on {
  color: var(--acc);
}
.out.off {
  color: var(--red);
  border-color: var(--red);
}
.hpc.down {
  border-color: var(--red);
  background: linear-gradient(180deg, var(--red-dim), var(--panel));
  animation: pulse-red 1.4s ease-in-out infinite;
}
.hpc p {
  margin: 0;
}
.downt {
  color: #ff7a6e;
  font-size: 12.5px;
  letter-spacing: 0.06em;
}
.hlog {
  font-size: 11.5px;
  padding: 2px 0;
}
.hlog.neg {
  color: #ff7a6e;
}
.hlog.pos {
  color: var(--acc);
}
.dmg {
  border-color: rgba(216, 70, 60, 0.5);
}
.dmg.rage {
  border-color: var(--red);
  background: linear-gradient(180deg, rgba(216, 70, 60, 0.25), var(--panel));
  animation: pulse-red 1s ease-in-out infinite;
}
.dmg p {
  margin: 0;
}
.dmgv {
  font-size: 16px;
  color: var(--red);
}
.raget {
  font-size: 15px;
  font-weight: 800;
  color: #ff7a6e;
  letter-spacing: 0.12em;
}
.target {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.tinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tinfo b {
  font-size: 16px;
  letter-spacing: 0.08em;
}
.target :deep(.btn) {
  min-width: 110px;
}
.find.gone {
  opacity: 0.5;
}
.radarhint {
  margin: 0;
  padding: 0 4px;
}
.scanlock {
  margin-top: -4px;
  padding: 8px 10px;
  border: 1px dashed rgba(255, 182, 39, 0.5);
  color: var(--amber);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  text-align: center;
}
.cam.live {
  border-color: var(--red);
}
.preview {
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  background: #000;
  filter: grayscale(0.6) contrast(1.1);
}
.rec {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--red);
  letter-spacing: 0.08em;
}
.rec i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--red);
  animation: blink 1s steps(2) infinite;
}
.unlock {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-height: 64px;
  padding: 12px;
  background: var(--amber);
  color: #120900;
  border: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-align: left;
  animation: blink 1.6s steps(2) infinite;
}
.unlock small {
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 400;
  letter-spacing: 0;
}
.setup {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.out {
  background: none;
  border: 1px solid var(--line-2);
  color: var(--text-mute);
  font-size: 11px;
  min-height: 34px;
  padding: 0 10px;
}
.strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.thr {
  color: var(--amber);
  font-weight: 600;
}
.thr.hot {
  color: var(--red);
  animation: blink 0.8s steps(2) infinite;
}
.card {
  padding: 12px;
  border: 1px solid var(--line);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status.outside {
  border-color: rgba(255, 182, 39, 0.5);
}
.status.overdue {
  border-color: var(--red);
  animation: pulse-red 1.4s ease-in-out infinite;
}
.tmr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0 4px;
}
.tmr :deep(.xl) {
  font-size: clamp(64px, 22vw, 110px);
}
.tl {
  font-size: 11.5px;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  text-align: center;
}
.mates {
  font-size: 11.5px;
  color: var(--text-mute);
  text-align: center;
}
.result {
  cursor: pointer;
  animation: line-in 0.3s ease-out;
}
.result.ok {
  border-color: var(--acc);
  box-shadow: var(--acc-glow);
}
.result.bad {
  border-color: var(--amber);
}
.rt {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: var(--acc);
}
.bad .rt {
  color: var(--amber);
}
.rn {
  font-size: 22px;
  font-weight: 600;
}
.rd {
  font-size: 16px;
  font-style: italic;
  color: var(--text);
  border-left: 2px solid var(--acc-2);
  padding-left: 10px;
}
.rm {
  font-size: 12px;
  color: var(--text-dim);
}
.rh {
  font-size: 14px;
  color: var(--text-dim);
}
.mlist {
  height: 240px;
  border: 1px solid var(--line);
  background: #040605;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.qb {
  min-height: 40px;
  padding: 0 12px;
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-size: 12px;
  letter-spacing: 0.06em;
}
.qb:active {
  background: var(--acc);
  color: #000;
}
.qb:disabled {
  opacity: 0.4;
}
.locked {
  margin: 0;
  font-size: 14px;
}
.find {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line);
}
.nt {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-dim);
  padding: 3px 0;
  border-bottom: 1px dashed var(--line);
}
.nt b {
  color: var(--acc-2);
  font-weight: 600;
}
.nt.warn b,
.nt.warn {
  color: var(--amber);
}
.nt.crit b,
.nt.crit {
  color: #ff7a6e;
}
.fc {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.fc b {
  flex: 1;
}
.safety {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--amber);
  text-align: center;
  padding: 10px 4px;
  border-top: 1px dashed rgba(255, 182, 39, 0.35);
}
.curtain {
  position: fixed;
  inset: 0;
  z-index: 750;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(20, 3, 2, 0.94);
}
.cbox {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ct {
  font-size: 22px;
  font-weight: 800;
  color: var(--red);
  letter-spacing: 0.12em;
}
.cr {
  font-size: 20px;
}
.cbox p {
  margin: 0;
  font-size: 16px;
  color: var(--text-dim);
}
</style>
