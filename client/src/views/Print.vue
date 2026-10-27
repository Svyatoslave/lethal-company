<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import JSZip from 'jszip';
import { api } from '../lib/api';
import { tokenOf } from '../lib/session';
import { qrDataUrl, renderLabel, safeName, saveBlob, type LabelSpec } from '../lib/label';
import type { PlayerView } from '@shared/types';

interface PrintLoot { id: number; code: string; name: string; description: string; value: number; token: string; status: string }
const loot = ref<(PrintLoot & { qr: string })[]>([]);
const badges = ref<(PlayerView & { qr: string })[]>([]);
const error = ref('');
const showNames = ref(true);
const showDesc = ref(false);
const what = ref<'loot' | 'badges'>('loot');
const origin = ref(window.location.origin);
const zipping = ref(false);

const base = () => origin.value.replace(/\/$/, '');

async function load() {
  error.value = '';
  if (!tokenOf('admin')) {
    error.value = 'Нужен вход в FIELD ADMIN на этом устройстве.';
    return;
  }
  try {
    const r = await api<{ loot: PrintLoot[]; players: PlayerView[] }>('admin', 'GET', '/print');
    loot.value = await Promise.all(r.loot.map(async (l) => ({ ...l, qr: await qrDataUrl(`${base()}/s/${l.token}`) })));
    badges.value = await Promise.all(r.players.map(async (p) => ({ ...p, qr: await qrDataUrl(`${base()}/join/${p.joinCode}`) })));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const isLocal = computed(() => /localhost|127\.0\.0\.1/.test(origin.value));
const printPage = () => window.print();

function lootSpec(l: PrintLoot): LabelSpec {
  return {
    header: 'COMPANY ASSET',
    code: l.code,
    url: `${base()}/s/${l.token}`,
    title: showNames.value ? l.name : 'SCRAP — HANDLE WITH CARE',
    subtitle: showDesc.value && l.description ? l.description : undefined,
    footer: 'OPERATION: LAST NIGHT · СКАНИРУЙ И НЕСИ НА БАЗУ',
  };
}
function badgeSpec(p: PlayerView): LabelSpec {
  return {
    header: p.role === 'monster' ? 'THREAT UNIT' : 'EMPLOYEE ID',
    code: p.joinCode ?? '',
    url: `${base()}/join/${p.joinCode}`,
    title: p.callsign,
    footer: `КОД ВХОДА: ${p.joinCode} · LIFE INSURANCE: N/A`,
  };
}

async function downloadOne(spec: LabelSpec, name: string) {
  saveBlob(await renderLabel(spec), `${name}.png`);
}

async function downloadAll() {
  if (zipping.value) return;
  zipping.value = true;
  try {
    const zip = new JSZip();
    if (what.value === 'loot') {
      for (const l of loot.value) zip.file(`${l.code}_${safeName(l.name)}.png`, await renderLabel(lootSpec(l)));
      // Keeps the token ↔ item mapping so labels can be re-made after the database is lost.
      const csv = ['code;name;value;description;url', ...loot.value.map((l) => [l.code, l.name, l.value, l.description, `${base()}/s/${l.token}`].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))];
      zip.file('items.csv', '﻿' + csv.join('\n'));
    } else {
      for (const p of badges.value) zip.file(`${safeName(p.callsign)}_${p.joinCode}.png`, await renderLabel(badgeSpec(p)));
    }
    saveBlob(await zip.generateAsync({ type: 'blob' }), what.value === 'loot' ? 'night-raid-scrap-qr.zip' : 'night-raid-badges.zip');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    zipping.value = false;
  }
}
</script>

<template>
  <div class="print">
    <div class="ctl no-print">
      <h1 class="mono">ПЕЧАТЬ МЕТОК</h1>
      <div class="row wrap">
        <button type="button" class="t" :class="{ on: what === 'loot' }" @click="what = 'loot'">ЛУТ ({{ loot.length }})</button>
        <button type="button" class="t" :class="{ on: what === 'badges' }" @click="what = 'badges'">БЕЙДЖИ ({{ badges.length }})</button>
        <template v-if="what === 'loot'">
          <label class="check"><input v-model="showNames" type="checkbox" /> название на метке</label>
          <label class="check"><input v-model="showDesc" type="checkbox" /> описание на метке</label>
        </template>
      </div>
      <label class="field">
        <span class="label">Адрес сервера в QR (должен открываться с телефонов)</span>
        <div class="row">
          <input v-model="origin" class="input grow" />
          <button type="button" class="t" @click="load">ОБНОВИТЬ</button>
        </div>
      </label>
      <p v-if="isLocal" class="warn">⚠ В QR будет localhost — телефоны его не откроют. Откройте эту страницу по IP-адресу сервера в локальной сети или исправьте адрес выше.</p>
      <p v-if="error" class="warn">▲ {{ error }}</p>
      <div class="row wrap">
        <button type="button" class="t big" @click="printPage">🖶 ПЕЧАТЬ</button>
        <button type="button" class="t big alt" :disabled="zipping" @click="downloadAll">
          {{ zipping ? 'СБОРКА АРХИВА…' : '⭳ СКАЧАТЬ ВСЕ (ZIP)' }}
        </button>
      </div>
      <p class="mute small">Каждую метку можно скачать отдельно — кнопка PNG под ней. В архив с лутом входит таблица items.csv со ссылками.</p>
    </div>

    <div v-if="what === 'loot'" class="sheet">
      <div v-for="l in loot" :key="l.id" class="cell">
        <div class="tag">
          <div class="th"><span>COMPANY ASSET</span><span>{{ l.code }}</span></div>
          <img :src="l.qr" :alt="l.code" />
          <div class="tn">{{ showNames ? l.name : 'SCRAP — HANDLE WITH CARE' }}</div>
          <div v-if="showDesc && l.description" class="td">{{ l.description }}</div>
          <div class="tf">OPERATION: LAST NIGHT · СКАНИРУЙ И НЕСИ НА БАЗУ</div>
        </div>
        <div class="meta no-print">
          <span class="ellipsis">{{ l.value }} CR · {{ l.description || 'без описания' }}</span>
          <button type="button" class="dl" @click="downloadOne(lootSpec(l), `${l.code}_${safeName(l.name)}`)">PNG</button>
        </div>
      </div>
    </div>
    <div v-else class="sheet">
      <div v-for="p in badges" :key="p.id" class="cell">
        <div class="tag badge">
          <div class="th"><span>{{ p.role === 'monster' ? 'THREAT UNIT' : 'EMPLOYEE ID' }}</span><span>{{ p.joinCode }}</span></div>
          <img :src="p.qr" :alt="p.callsign" />
          <div class="tn big">{{ p.callsign }}</div>
          <div class="tf">КОД ВХОДА: {{ p.joinCode }} · LIFE INSURANCE: N/A</div>
        </div>
        <div class="meta no-print">
          <span class="grow" />
          <button type="button" class="dl" @click="downloadOne(badgeSpec(p), `${safeName(p.callsign)}_${p.joinCode}`)">PNG</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.print {
  padding: 16px;
}
.ctl {
  max-width: 820px;
  margin: 0 auto 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.14em;
  color: var(--acc);
}
.t {
  min-height: 40px;
  padding: 0 14px;
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  cursor: pointer;
}
.t.on {
  border-color: var(--acc);
  color: var(--acc);
}
.t.big {
  flex: 1;
  min-height: 52px;
  font-size: 15px;
  background: var(--acc);
  color: #000;
  border-color: var(--acc);
}
.t.big.alt {
  background: var(--amber-dim);
  color: var(--amber);
  border-color: var(--amber);
}
.t:disabled {
  opacity: 0.6;
  cursor: progress;
}
.warn {
  margin: 0;
  color: var(--amber);
  font-size: 14px;
}
.small {
  margin: 0;
  font-size: 12.5px;
}
.sheet {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  max-width: 1100px;
  margin: 0 auto;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  break-inside: avoid;
}
.tag {
  background: #fff;
  color: #000;
  border: 2px solid #000;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-family: var(--mono);
}
.th {
  width: 100%;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  background: #000;
  color: #fff;
  padding: 2px 5px;
}
.tag img {
  width: 100%;
  max-width: 200px;
  image-rendering: pixelated;
}
.tn {
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  font-family: var(--sans);
}
.tn.big {
  font-family: var(--mono);
  font-size: 20px;
  letter-spacing: 0.1em;
}
.td {
  font-family: var(--sans);
  font-size: 10px;
  text-align: center;
  color: #333;
}
.tf {
  font-size: 7.5px;
  letter-spacing: 0.06em;
  text-align: center;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-dim);
}
.meta span {
  flex: 1;
  min-width: 0;
}
.dl {
  min-height: 30px;
  padding: 0 10px;
  background: none;
  border: 1px solid var(--acc-2);
  color: var(--acc);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
}
@media print {
  .no-print {
    display: none !important;
  }
  .print {
    padding: 0;
  }
  .sheet {
    grid-template-columns: repeat(4, 1fr);
    gap: 4mm;
  }
}
</style>

<style>
@media print {
  html,
  body {
    background: #fff !important;
  }
  body::before,
  body::after {
    display: none !important;
  }
}
</style>
