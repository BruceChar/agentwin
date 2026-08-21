<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="logo-dot"></span> AgentWin <span class="brand-sub">交易系统</span></div>
      <nav class="nav">
        <router-link v-for="item in primaryNav" :key="item.path" :to="item.path" class="nav-item" :class="{ active: $route.path === item.path }">{{ item.label }}</router-link>
        <span class="nav-divider" />
        <router-link v-for="item in secondaryNav" :key="item.path" :to="item.path" class="nav-item sec" :class="{ active: $route.path === item.path }">{{ item.label }}</router-link>
      </nav>
      <div class="top-right">
        <el-tag size="small" :type="syncOk ? 'success' : 'warning'" effect="plain">{{ syncOk ? '已连接' : '同步中' }}</el-tag>
        <el-tag v-if="proxyTag" size="small" type="info" effect="plain">{{ proxyTag }}</el-tag>
        <span class="acct">{{ acctLabel }}</span>
      </div>
    </header>
    <main class="content"><router-view /></main>
    <footer class="statusbar">
      <span>Agent 运行中</span>
      <span>存储: JSONL + SQLite</span>
      <span>最后更新: {{ lastSyncText }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from './api.ts';

const primaryNav = [
  { path: '/', label: '首页' },
  { path: '/journal', label: '交易日志' },
  { path: '/stats', label: '统计分析' },
  { path: '/strategies', label: '策略管理' },
  { path: '/settings', label: '设置' },
];
const secondaryNav = [
  { path: '/market', label: '行情' },
  { path: '/paper', label: '模拟交易' },
  { path: '/llm', label: 'AI 顾问' },
  { path: '/sentiment', label: '舆情' },
];

const syncOk = ref(false);
const proxyTag = ref('');
const acctLabel = ref('');
const lastSyncText = ref('-');

async function refreshStatus() {
  try {
    await api.get('/health').catch(() => null);
    syncOk.value = true;
    const bs = await api.get<{ lastSync?: { at?: number; ok?: boolean }; proxy?: { enabled?: boolean } }>('/binance/status').catch(() => null);
    if (bs?.lastSync?.at) lastSyncText.value = new Date(bs.lastSync.at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (bs?.proxy?.enabled !== undefined) proxyTag.value = bs.proxy.enabled ? '代理开' : '直连';
    const accounts = await api.get<{ accounts: { type: string; name: string }[] }>('/accounts').catch(() => null);
    const real = accounts?.accounts?.find((a) => a.type === 'real');
    acctLabel.value = real ? '真实 · ' + real.name : '模拟账户';
  } catch {
    syncOk.value = false;
  }
}

onMounted(() => {
  refreshStatus();
  setInterval(refreshStatus, 30000);
});
</script>

<style>
:root {
  --bg: #0b0f14;
  --bg-card: #11161d;
  --bg-elev: #161d26;
  --border: #232c37;
  --text: #d7dde4;
  --text-dim: #7b8794;
  --accent: #4da3ff;
  --up: #f0a35e;
  --down: #4fbf9f;
  --mono: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
}
html.dark {
  --el-bg-color: var(--bg-card);
  --el-bg-color-overlay: var(--bg-elev);
  --el-border-color: var(--border);
  --el-border-color-light: var(--border);
  --el-text-color-primary: var(--text);
  --el-text-color-regular: var(--text);
  --el-text-color-secondary: var(--text-dim);
  --el-fill-color-blank: var(--bg-card);
}
html, body, #app { height: 100%; margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif; }
.shell { display: flex; flex-direction: column; height: 100%; }
.topbar { display: flex; align-items: center; gap: 20px; height: 52px; padding: 0 20px; background: var(--bg-card); border-bottom: 1px solid var(--border); }
.brand { font-weight: 700; font-size: 15px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }
.logo-dot { width: 10px; height: 10px; border-radius: 2px; background: var(--accent); box-shadow: 0 0 8px var(--accent); }
.brand-sub { color: var(--text-dim); font-weight: 400; font-size: 12px; }
.nav { display: flex; align-items: center; gap: 4px; flex: 1; overflow-x: auto; }
.nav-item { padding: 6px 12px; border-radius: 6px; color: var(--text-dim); font-size: 13px; text-decoration: none; white-space: nowrap; }
.nav-item:hover { color: var(--text); background: var(--bg-elev); }
.nav-item.active { color: var(--accent); background: rgba(77,163,255,0.12); }
.nav-item.sec { font-size: 12px; opacity: 0.75; }
.nav-divider { width: 1px; height: 18px; background: var(--border); margin: 0 6px; }
.top-right { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-dim); }
.acct { font-family: var(--mono); }
.content { flex: 1; overflow-y: auto; padding: 16px; }
.statusbar { display: flex; gap: 20px; height: 30px; align-items: center; padding: 0 20px; background: var(--bg-card); border-top: 1px solid var(--border); color: var(--text-dim); font-size: 11px; font-family: var(--mono); }
.up { color: var(--up); }
.down { color: var(--down); }
.el-card { --el-card-border-color: var(--border); background: var(--bg-card); border-radius: 8px; }
</style>
