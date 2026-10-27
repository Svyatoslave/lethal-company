<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../lib/api';
import { setToken } from '../lib/session';
import TButton from './ui/TButton.vue';
import Logo from './Logo.vue';

const props = defineProps<{ role: 'admin' | 'operator' | 'observer' }>();
const emit = defineEmits<{ authed: [] }>();
const pin = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  if (!pin.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const r = await api<{ token: string }>(props.role, 'POST', '/auth/login', { role: props.role, pin: pin.value });
    setToken(props.role, r.token);
    emit('authed');
  } catch (e) {
    error.value = (e as Error).message;
    pin.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="gate">
    <form class="box" @submit.prevent="submit">
      <Logo />
      <div class="hr" />
      <div class="label">{{ role === 'admin' ? 'FIELD ADMIN' : role === 'observer' ? 'НАБЛЮДАТЕЛЬ' : 'OPERATOR TERMINAL' }} // AUTHORIZATION</div>
      <p class="dim">Введите PIN доступа. Он выводится в консоли сервера при запуске.</p>
      <input v-model="pin" class="input pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" autofocus />
      <div v-if="error" class="err">▲ {{ error }}</div>
      <TButton variant="solid" size="lg" block :busy="busy" @click="submit">ВОЙТИ В СИСТЕМУ</TButton>
      <RouterLink to="/" class="back mono">← ВЫБОР ТЕРМИНАЛА</RouterLink>
    </form>
  </div>
</template>

<style scoped>
.gate {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 16px;
}
.box {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  border: 1px solid var(--line-2);
  background: var(--panel);
}
p {
  margin: 0;
  font-size: 14px;
}
.pin {
  font-size: 28px;
  letter-spacing: 0.4em;
  text-align: center;
  min-height: 60px;
}
.err {
  font-family: var(--mono);
  color: var(--red);
  font-size: 13px;
}
.back {
  font-size: 12px;
  color: var(--text-mute);
  text-decoration: none;
  text-align: center;
  letter-spacing: 0.1em;
}
</style>
