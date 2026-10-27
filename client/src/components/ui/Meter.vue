<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ value: number; max: number; segments?: number; tone?: 'acc' | 'amber' | 'red' }>(), {
  segments: 20,
  tone: 'acc',
});
const filled = computed(() => (props.max > 0 ? Math.min(props.segments, Math.floor((props.value / props.max) * props.segments)) : 0));
</script>

<template>
  <div class="meter" :class="tone" role="meter" :aria-valuenow="value" :aria-valuemax="max">
    <i v-for="i in segments" :key="i" :class="{ on: i <= filled }" />
  </div>
</template>

<style scoped>
.meter {
  --c: var(--acc);
  display: flex;
  gap: 2px;
  height: 10px;
}
.amber {
  --c: var(--amber);
}
.red {
  --c: var(--red);
}
i {
  flex: 1;
  background: var(--line);
}
i.on {
  background: var(--c);
  box-shadow: 0 0 6px color-mix(in srgb, var(--c) 55%, transparent);
}
</style>
