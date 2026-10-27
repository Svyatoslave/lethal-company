import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import './styles/theme.css';
import App from './App.vue';
import { pref } from './lib/session';

if (pref('crt', '1') === '0') document.documentElement.classList.add('fx-off');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/Home.vue') },
    { path: '/operator', component: () => import('./views/Operator.vue') },
    { path: '/admin', component: () => import('./views/Admin.vue') },
    { path: '/crew', component: () => import('./views/Crew.vue') },
    { path: '/print', component: () => import('./views/Print.vue') },
    { path: '/observer', component: () => import('./views/Observer.vue') },
    // QR targets: scrap tag and personnel badge. Both resolve inside the crew device.
    { path: '/s/:token', redirect: (to) => ({ path: '/crew', query: { claim: String(to.params.token) } }) },
    { path: '/join/:code', redirect: (to) => ({ path: '/crew', query: { code: String(to.params.code) } }) },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

createApp(App).use(router).mount('#app');
