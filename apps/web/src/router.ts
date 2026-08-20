import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./views/Dashboard.vue'), meta: { title: '总览' } },
    { path: '/market', component: () => import('./views/Market.vue'), meta: { title: '行情' } },
    { path: '/strategies', component: () => import('./views/Strategies.vue'), meta: { title: '策略与回测' } },
    { path: '/paper', component: () => import('./views/Paper.vue'), meta: { title: '模拟交易' } },
    { path: '/trades', component: () => import('./views/Trades.vue'), meta: { title: '交易与盈亏' } },
    { path: '/llm', component: () => import('./views/LlmChat.vue'), meta: { title: 'AI 策略顾问' } },
    { path: '/sentiment', component: () => import('./views/Sentiment.vue'), meta: { title: '舆情' } },
    { path: '/journal', component: () => import('./views/Journal.vue'), meta: { title: '交易日志' } },
  ],
});
