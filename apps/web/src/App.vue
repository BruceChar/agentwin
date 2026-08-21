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
        <el-popover trigger="click" placement="bottom-end" :width="320">
          <template #reference>
            <button class="acct-btn">{{ acctLabel }} <span class="caret">▾</span></button>
          </template>
          <div class="pop">
            <div class="pop-title">账户（各页面数据跟随所选账户）</div>
            <div class="acct-list">
              <div
                v-for="a in accountStore.accounts"
                :key="a.id"
                class="acct-item"
                :class="{ active: a.id === accountStore.selectedId }"
                @click="pickAccount(a.id)"
              >
                <span class="acct-dot" :class="a.type"></span>
                <span class="acct-name">{{ a.type === 'real' ? '真实' : '模拟' }} · {{ a.name }}</span>
                <span v-if="a.id === accountStore.selectedId" class="acct-check">✓</span>
              </div>
              <div v-if="!accountStore.accounts.length" class="pop-line dim">暂无账户</div>
            </div>
            <div class="pop-row">
              <span class="dim">所选账户数据</span>
              <el-button size="small" text type="danger" @click="resetAccountData">清除成交/权益</el-button>
            </div>
            <el-divider />
            <div class="pop-row">
              <span>代理</span>
              <el-switch v-model="proxyEnabled" size="small" @change="applyProxy" />
            </div>
            <div class="pop-row">
              <span>主题</span>
              <el-segmented v-model="themeMode" :options="['深色', '浅色']" size="small" @change="toggleTheme" />
            </div>
            <el-divider />
            <div class="pop-row">
              <el-button size="small" text @click="go('/settings')">设置</el-button>
              <el-button size="small" text @click="chatVisible = true">AI 顾问</el-button>
              <el-button size="small" text @click="go('/journal?new=1')">新建日志</el-button>
            </div>
          </div>
        </el-popover>
      </div>
    </header>
    <main class="content"><router-view /></main>
    <footer class="statusbar">
      <span>Agent 运行中</span>
      <span>存储: JSONL + SQLite</span>
      <span>最后更新: {{ lastSyncText }}</span>
    </footer>

    <!-- AI 顾问悬浮窗 -->
    <el-tooltip content="AI 策略顾问" placement="left">
      <button class="ai-fab" @click="chatVisible = true">AI</button>
    </el-tooltip>
    <el-drawer v-model="chatVisible" size="420px" :with-header="false" destroy-on-close>
      <div class="chat-wrap"><AiChat /></div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from './api.ts';
import AiChat from './components/AiChat.vue';
import { accountLabel, accountStore, loadAccounts, selectAccount } from './store.ts';

const router = useRouter();

const primaryNav = [
  { path: '/', label: '首页' },
  { path: '/journal', label: '交易日志' },
  { path: '/stats', label: '统计分析' },
  { path: '/strategies', label: '策略管理' },
];
const secondaryNav = [
  { path: '/market', label: '行情' },
  { path: '/paper', label: '模拟交易' },
  { path: '/sentiment', label: '舆情' },
];

const syncOk = ref(false);
const proxyTag = ref('');
const proxyEnabled = ref(false);
const proxyUrl = ref('');
const lastSyncText = ref('-');
const acctLabel = computed(() => {
  const sel = accountStore.accounts.find((a) => a.id === accountStore.selectedId) ?? null;
  return accountLabel(sel);
});
function pickAccount(id: string) {
  selectAccount(id);
}

/** 清除所选账户的成交/权益脏数据（并暂停自动同步成交） */
async function resetAccountData() {
  const sel = accountStore.accounts.find((a) => a.id === accountStore.selectedId);
  if (!sel) return;
  try {
    await ElMessageBox.confirm(
      '确认清除「' + (sel.type === 'real' ? '真实' : '模拟') + ' · ' + sel.name + '」的成交记录与权益曲线？' +
      '\n清除后该账户自动同步成交将暂停（手动同步可恢复）。',
      '清除账户数据',
      { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消' },
    );
  } catch {
    return; // 用户取消
  }
  try {
    const res = await api.post<{ cleared: { trades: number; equity: number } }>('/accounts/' + sel.id + '/reset', { trades: true, equity: true });
    ElMessage.success('已清除成交 ' + res.cleared.trades + ' 条、权益 ' + res.cleared.equity + ' 点');
  } catch (err) {
    ElMessage.error('清除失败：' + (err instanceof Error ? err.message : String(err)));
  }
}
const chatVisible = ref(false);
const themeMode = ref(localStorage.getItem('aw-theme') === 'light' ? '浅色' : '深色');

function go(path: string) {
  router.push(path);
}

function toggleTheme(mode: string | number | boolean) {
  const light = String(mode) === '浅色';
  document.documentElement.classList.toggle('dark', !light);
  localStorage.setItem('aw-theme', light ? 'light' : 'dark');
}

async function applyProxy() {
  try {
    const cfg = await api.post<{ enabled: boolean; url?: string }>('/binance/proxy', { mode: proxyEnabled.value ? 'on' : 'off', url: proxyUrl.value });
    proxyEnabled.value = cfg.enabled;
    proxyTag.value = cfg.enabled ? '代理开' : '直连';
    ElMessage.success(cfg.enabled ? '代理已开启' : '已切换直连');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

async function refreshStatus() {
  try {
    await api.get('/health').catch(() => null);
    syncOk.value = true;
    const bs = await api.get<{ lastSync?: { at?: number }; proxy?: { enabled?: boolean; url?: string } }>('/binance/status').catch(() => null);
    if (bs?.lastSync?.at) lastSyncText.value = new Date(bs.lastSync.at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (bs?.proxy) {
      proxyEnabled.value = bs.proxy.enabled ?? false;
      proxyUrl.value = bs.proxy.url ?? '';
      proxyTag.value = bs.proxy.enabled ? '代理开' : '直连';
    }
    await loadAccounts().catch(() => null);
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
/* 浅色主题 */
html:not(.dark) {
  --bg: #f3f5f8;
  --bg-card: #ffffff;
  --bg-elev: #eef1f5;
  --border: #e3e7ec;
  --text: #1c2733;
  --text-dim: #7a8694;
  --accent: #2563eb;
  --up: #d9551f;
  --down: #14805f;
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
.acct-btn { display: flex; align-items: center; gap: 4px; background: var(--bg-elev); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: var(--mono); }
.acct-btn:hover { border-color: var(--accent); }
.caret { font-size: 9px; }
.content { flex: 1; overflow-y: auto; padding: 16px; }
.statusbar { display: flex; gap: 20px; height: 30px; align-items: center; padding: 0 20px; background: var(--bg-card); border-top: 1px solid var(--border); color: var(--text-dim); font-size: 11px; font-family: var(--mono); }
.ai-fab { position: fixed; right: 20px; bottom: 44px; width: 48px; height: 48px; border-radius: 50%; border: none; background: var(--accent); color: #fff; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(77,163,255,0.4); z-index: 100; font-size: 14px; }
.ai-fab:hover { filter: brightness(1.1); }
.chat-wrap { height: calc(100vh - 40px); }
.pop-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.pop-line { font-size: 12px; margin-bottom: 4px; }
.pop-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.acct-list { display: flex; flex-direction: column; gap: 2px; }
.acct-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--text); }
.acct-item:hover { background: var(--bg-elev); }
.acct-item.active { background: rgba(77,163,255,0.12); color: var(--accent); }
.acct-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.acct-dot.real { background: #f0a35e; box-shadow: 0 0 6px #f0a35e; }
.acct-dot.paper { background: #4fbf9f; }
.acct-name { flex: 1; }
.acct-check { color: var(--accent); font-weight: 700; }
.up { color: var(--up); }
.down { color: var(--down); }
.el-card { --el-card-border-color: var(--border); background: var(--bg-card); border-radius: 8px; }
</style>
