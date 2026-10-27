<script setup lang="ts">
defineProps<{ title: string; code?: string; tone?: 'warn' | 'crit' | 'ok'; flush?: boolean }>();
</script>

<template>
  <section class="panel" :class="tone">
    <header class="panel-h">
      <span class="panel-tab" aria-hidden="true" />
      <span v-if="code" class="panel-code">{{ code }}</span>
      <h2>{{ title }}</h2>
      <div class="panel-actions"><slot name="actions" /></div>
    </header>
    <div class="panel-b" :class="{ flush }"><slot /></div>
  </section>
</template>

<style scoped>
.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, var(--panel-2), var(--panel) 120px);
  border: 1px solid var(--line);
}
.panel::before,
.panel::after {
  content: '';
  position: absolute;
  width: 9px;
  height: 9px;
  pointer-events: none;
  border-color: var(--acc-2);
  border-style: solid;
  opacity: 0.7;
}
.panel::before {
  top: -1px;
  left: -1px;
  border-width: 1px 0 0 1px;
}
.panel::after {
  bottom: -1px;
  right: -1px;
  border-width: 0 1px 1px 0;
}
.panel.warn {
  border-color: rgba(255, 182, 39, 0.45);
}
.panel.crit {
  border-color: var(--red);
  animation: pulse-red 1.6s ease-in-out infinite;
}
.panel-h {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px 0 0;
  border-bottom: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.25);
}
.panel-tab {
  align-self: stretch;
  width: 4px;
  background: var(--acc);
  box-shadow: var(--acc-glow);
}
.warn .panel-tab {
  background: var(--amber);
}
.crit .panel-tab {
  background: var(--red);
}
.panel-code {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-mute);
  letter-spacing: 0.1em;
}
h2 {
  margin: 0;
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--text);
  white-space: nowrap;
}
.panel-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.panel-b {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow: auto;
}
.panel-b.flush {
  padding: 0;
}
</style>
