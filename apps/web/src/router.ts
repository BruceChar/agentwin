import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./views/Home.vue'), meta: { title: '仪表盘' } },
    { path: '/journal', component: () => import('./views/Journal.vue'), meta: { title: '交易日志' } },
    { path: '/plans', redirect: (to) => ({ path: '/journal', query: { tab: 'plan', ...(to.query.new ? { new: '1' } : {}) } }) },
    { path: '/review', component: () => import('./views/Review.vue'), meta: { title: '复盘中心' } },
    { path: '/strategies', component: () => import('./views/Strategies.vue'), meta: { title: '策略管理' } },
    { path: '/stats', component: () => import('./views/Stats.vue'), meta: { title: '统计分析' } },
    { path: '/settings', component: () => import('./views/Settings.vue'), meta: { title: '设置' } },
    { path: '/market', component: () => import('./views/Market.vue'), meta: { title: '行情' } },
    { path: '/paper', component: () => import('./views/Paper.vue'), meta: { title: '模拟交易' } },
    { path: '/trades', component: () => import('./views/Trades.vue'), meta: { title: '交易与盈亏' } },
    { path: '/llm', component: () => import('./views/LlmChat.vue'), meta: { title: 'AI 助手' } },
    { path: '/sentiment', component: () => import('./views/Sentiment.vue'), meta: { title: '舆情' } },
  ],
});