import { createRouter, createWebHashHistory } from 'vue-router';

// ================= 五页极简架构（设计规范 v4.2） =================
// 仪表盘（计划入口） → 日志中心（实盘四态流转） → 策略中心（策略+回归+模拟+迭代）
// 数据中心（行情+舆情） → 设置
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./views/Home.vue'), meta: { title: '仪表盘', group: '核心工作流' } },
    { path: '/journal', component: () => import('./views/Journal.vue'), meta: { title: '日志中心', group: '核心工作流' } },
    { path: '/strategies', component: () => import('./views/Strategies.vue'), meta: { title: '策略中心', group: '核心工作流' } },
    { path: '/data', component: () => import('./views/DataCenter.vue'), meta: { title: '数据中心', group: '数据' } },
    { path: '/settings', component: () => import('./views/Settings.vue'), meta: { title: '设置', group: '系统' } },

    // ---- 旧路由重定向（收敛到五页） ----
    { path: '/plans', redirect: (to) => ({ path: '/journal', query: { tab: 'plan', ...(to.query.new ? { new: '1' } : {}) } }) },
    { path: '/review', redirect: () => ({ path: '/journal', query: { tab: 'pending' } }) },
    { path: '/market', redirect: () => ({ path: '/data', query: { tab: 'market' } }) },
    { path: '/sentiment', redirect: () => ({ path: '/data', query: { tab: 'sentiment' } }) },
    { path: '/paper', redirect: () => ({ path: '/strategies', query: { tab: 'paper' } }) },
    { path: '/stats', redirect: '/' },
    { path: '/trades', redirect: '/' },
    // AI 助手：不进主导航，作为顶栏/悬浮工具保留
    { path: '/llm', component: () => import('./views/LlmChat.vue'), meta: { title: 'AI 助手' } },
  ],
});