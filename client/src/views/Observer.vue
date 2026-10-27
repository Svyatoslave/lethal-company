<script setup lang="ts">
import { ref } from 'vue';
import StaffLogin from '../components/StaffLogin.vue';
import CameraPanel from '../components/CameraPanel.vue';
import { clearToken, tokenOf } from '../lib/session';
import { api } from '../lib/api';
const authed = ref(!!tokenOf('observer'));
function logout() {
  void api('observer', 'POST', '/auth/logout').catch(() => undefined);
  clearToken('observer'); authed.value = false;
}
</script>
<template>
  <StaffLogin v-if="!authed" role="observer" @authed="authed = true" />
  <main v-else class="observer">
    <header><h1>НАБЛЮДАТЕЛЬ</h1><button class="input" @click="logout">ВЫЙТИ</button></header>
    <CameraPanel app="observer" />
  </main>
</template>
<style scoped>
.observer { max-width: 960px; margin: auto; padding: 20px; }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
h1 { font-size: 20px; }
</style>
