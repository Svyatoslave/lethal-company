<script setup lang="ts">
import { ref } from 'vue';
import Logo from '../components/Logo.vue';
import { pref, setPref } from '../lib/session';

const crt = ref(pref('crt', '1') === '1');
function toggleCrt() {
  crt.value = !crt.value;
  setPref('crt', crt.value ? '1' : '0');
  document.documentElement.classList.toggle('fx-off', !crt.value);
}

const boot = [
  'COMPANY OS v4.17 — EXPEDITION MANAGEMENT SUITE',
  'MEMORY CHECK ........................ OK',
  'AIRLOCK CONTROLLER .................. OK',
  'SCRAP VALUATION MODULE .............. OK',
  'EMPLOYEE LIFE INSURANCE ............. NOT FOUND',
];
</script>

<template>
  <main class="home">
    <div class="boot mono">
      <div v-for="(l, i) in boot" :key="i" class="bl" :style="{ animationDelay: `${i * 0.12}s` }">{{ l }}</div>
    </div>
    <Logo />
    <nav class="doors">
      <RouterLink to="/operator" class="door">
        <span class="k">01</span>
        <span class="t">OPERATOR TERMINAL</span>
        <span class="d">Ноутбук на базе: рейд, экипаж, шлюз, лут, магазин, связь.</span>
      </RouterLink>
      <RouterLink to="/admin" class="door">
        <span class="k">02</span>
        <span class="t">FIELD ADMIN</span>
        <span class="d">Телефон ведущего: миссия, монстры, события, экономика, пауза.</span>
      </RouterLink>
      <RouterLink to="/crew" class="door">
        <span class="k">03</span>
        <span class="t">CREW DEVICE</span>
        <span class="d">Телефон сотрудника: статус, таймер, сканер лута, рация.</span>
      </RouterLink>
    </nav>
    <RouterLink to="/observer">НАБЛЮДАТЕЛЬ · КАМЕРЫ МОНСТРОВ</RouterLink>
    <footer class="foot mono">
      <span>ПРИ РЕАЛЬНОЙ ОПАСНОСТИ ИГРА ОСТАНАВЛИВАЕТСЯ. БЕЗОПАСНОСТЬ ВАЖНЕЕ ПРАВИЛ.</span>
      <button type="button" class="crt" @click="toggleCrt">CRT FX: {{ crt ? 'ON' : 'OFF' }}</button>
    </footer>
  </main>
</template>

<style scoped>
.home {
  min-height: 100dvh;
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.boot {
  font-size: 12px;
  color: var(--text-mute);
  line-height: 1.7;
}
.bl {
  opacity: 0;
  animation: line-in 0.3s ease-out forwards;
}
.bl:last-child {
  color: var(--amber);
}
.doors {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.door {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 170px;
  padding: 18px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  color: var(--text);
  text-decoration: none;
  transition: border-color 0.15s, background 0.15s;
}
.door:hover,
.door:focus-visible {
  border-color: var(--acc);
  background: var(--panel-2);
  outline: none;
}
.k {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-mute);
  letter-spacing: 0.2em;
}
.t {
  font-family: var(--mono);
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--acc);
}
.d {
  color: var(--text-dim);
  font-size: 14.5px;
}
.foot {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--amber);
  letter-spacing: 0.08em;
}
.crt {
  background: none;
  border: 1px solid var(--line-2);
  color: var(--text-dim);
  font: inherit;
  padding: 4px 8px;
  cursor: pointer;
}
@media (max-width: 760px) {
  .doors {
    grid-template-columns: 1fr;
  }
  .door {
    min-height: 0;
  }
}
</style>
