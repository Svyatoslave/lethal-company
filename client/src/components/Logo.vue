<script setup lang="ts">
defineProps<{ compact?: boolean }>();
</script>

<template>
  <div class="logo" :class="{ compact }">
    <svg viewBox="0 0 40 40" class="mark" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2.5" />
      <path d="M11 30V11l9 9 9-9v19" fill="none" stroke="currentColor" stroke-width="3.5" />
      <rect x="2" y="33" width="36" height="5" fill="var(--amber)" />
    </svg>
    <div class="words">
      <div class="name">OPERATION: LAST NIGHT</div>
      <div class="mode"><span>NIGHT RAID</span><em v-if="!compact">Компания ценит вашу жизнь. Но не выше стоимости металлолома.</em></div>
    </div>
  </div>
</template>

<style scoped>
.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--acc);
  min-width: 0;
}
.mark {
  width: 42px;
  height: 42px;
  flex: none;
  filter: drop-shadow(0 0 6px rgba(156, 255, 58, 0.45));
}
.compact .mark {
  width: 30px;
  height: 30px;
}
.words {
  min-width: 0;
}
.name {
  font-family: var(--mono);
  font-weight: 800;
  font-size: 17px;
  letter-spacing: 0.12em;
  text-shadow: var(--acc-glow);
  white-space: nowrap;
  animation: flicker 7s infinite;
}
.compact .name {
  font-size: 13.5px;
}
.mode {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
  margin-top: 2px;
}
.mode span {
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.3em;
  color: #050605;
  background: var(--amber);
  padding: 1px 6px;
}
.mode em {
  font-style: normal;
  font-size: 12.5px;
  color: var(--text-dim);
}
</style>
