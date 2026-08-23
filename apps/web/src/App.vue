<template>
  <div class="shell">
    <!-- 左侧固定侧边栏 200px -->
    <aside class="sidebar">
      <div class="side-brand">
        <span class="logo-dot"></span>
        <span class="brand-name">AgentWin</span>
        <span class="brand-sub">交易日志系统</span>
      </div>

      <nav class="side-nav">
        <div v-for="group in navGroups" :key="group.title" class="nav-group">
          <div class="nav-group-title">{{ group.title }}</div>
          <router-link
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item) }"
          >
            <el-icon class="nav-ic"><component :is="item.icon" /></el-icon>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="badgeOf(item) > 0" class="nav-badge">{{ badgeOf(item) }}</span>
          </router-link>
        </div>
      </nav>

      <div class="side-bottom">
        <div class="side-account">
          <span class="acct-dot" :class="acct?.type ?? ''"></span>
          <span class="acct-name">{{ acctLabel }}</span>
          <span class="acct-caret">▾</span>
        </div>
        <router-link to="/settings" class="nav-item flat" :class="{ active: $route.path === '/settings' }">
          <el-icon class="nav-ic"><Setting /></el-icon>
          <span class="nav-label">设置</span>
        </router-link>
      </div>
    </aside>

    <!-- 右侧弹性内容区 -->
    <div class="main">
      <header class="topbar">
        <div class="crumb">
          <span class="crumb-sep" v-if="crumbGroup">/</span>
          <span class="crumb-dim" v-if="crumbGroup">{{ crumbGroup }}</span>
          <b>{{ crumbTitle }}</b>
        </div>
        <div class="top-right">
          <div class="search-box">
            <el-icon class="s-ic"><Search /></el-icon>
            <input v-model="searchText" placeholder="搜索品种 / 日志 / 计划…" @keyup.enter="doSearch" />
            <kbd class="s-kbd">↵</kbd>
          </div>
          <el-tag size="small" :type="syncOk ? 'success' : 'warning'" effect="dark" class="sync-tag">
            <span class="sync-dot" :class="{ ok: syncOk }"></span>{{ syncOk ? '已连接' : '同步中' }}
          </el-tag>
          <button class="icon-btn" title="AI 助手" @click="go('/llm')"><el-icon><ChatDotRound /></el-icon></button>
          <button class="icon-btn" title="新建计划" @click="go('/plans?new=1')"><el-icon><Plus /></el-icon></button>
          <el-popover trigger="click" placement="bottom-end" :width="300">
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
            </div>
          </el-popover>
        </div>
      </header>

      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <!-- AI 顾问悬浮窗 -->
    <el-drawer v-model="chatVisible" size="440px" :with-header="false" destroy-on-close>
      <div class="chat-wrap"><AiChat /></div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api.ts';
import AiChat from './components/AiChat.vue';
import { accountLabel, accountStore, loadAccounts, selectAccount } from './store.ts';
import { deriveStatus, type TradeJournal } from './lib/journal.ts';

const route = useRoute();
const router = useRouter();

type NavItem = { path: string; label: string; icon: string; badgeKey?: string };
const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: '核心工作流',
    items: [
      { path: '/', label: '仪表盘', icon: 'Odometer' },
      { path: '/journal', label: '交易日志', icon: 'Notebook', badgeKey: 'holding' },
      { path: '/plans', label: '交易计划', icon: 'Calendar', badgeKey: 'plan' },
      { path: '/review', label: '复盘中心', icon: 'DataAnalysis', badgeKey: 'pending' },
    ],
  },
  {
    title: '策略与数据',
    items: [
      { path: '/strategies', label: '策略管理', icon: 'SetUp' },
      { path: '/stats', label: '统计分析', icon: 'TrendCharts' },
      { path: '/market', label: '行情', icon: 'DataLine' },
    ],
  },
  {
    title: '工具',
    items: [
      { path: '/paper', label: '模拟交易', icon: 'Money' },
      { path: '/sentiment', label: '舆情', icon: 'ChatDotRound' },
      { path: '/llm', label: 'AI 助手', icon: 'MagicStick' },
    ],
  },
];

const counts = ref<Record<string, number>>({ plan: 0, holding: 0, pending: 0, done: 0 });
const syncOk = ref(false);
const searchText = ref('');
const chatVisible = ref(false);

const acct = computed(() => accountStore.accounts.find((a) => a.id === accountStore.selectedId) ?? null);
const acctLabel = computed(() => accountLabel(acct.value));

function badgeOf(item: NavItem): number {
  if (!item.badgeKey) return 0;
  return counts.value[item.badgeKey] ?? 0;
}

function isActive(item: NavItem): boolean {
  if (item.path === '/') return route.path === '/';
  return route.path.startsWith(item.path);
}

const crumbGroup = computed(() => {
  const p = route.path;
  if (p.startsWith('/journal') || p.startsWith('/plans') || p.startsWith('/review')) return '核心工作流';
  if (p.startsWith('/strategies') || p.startsWith('/stats') || p.startsWith('/market')) return '策略与数据';
  if (p.startsWith('/paper') || p.startsWith('/sentiment') || p.startsWith('/llm')) return '工具';
  return '';
});
const crumbTitle = computed(() => (route.meta.title as string) ?? '仪表盘');

function go(path: string) { router.push(path); }

function pickAccount(id: string) { selectAccount(id); }

function doSearch() {
  const q = searchText.value.trim();
  if (!q) return;
  router.push({ path: '/journal', query: { search: q } });
}

async function refreshStatus() {
  try {
    await api.get('/health').catch(() => null);
    syncOk.value = true;
    await loadAccounts().catch(() => null);
    const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => null);
    if (j) {
      const c = { plan: 0, holding: 0, pending: 0, done: 0 };
      for (const r of j.records) c[deriveStatus(r)]++;
      counts.value = c;
    }
  } catch {
    syncOk.value = false;
  }
}

onMounted(() => {
  refreshStatus();
  setInterval(refreshStatus, 60000);
});
</script>

<style scoped>
.shell { display: flex; height: 100%; }

/* ---------- 侧边栏 ---------- */
.sidebar {
  width: var(--aw-sidebar-w);
  flex: none;
  background: var(--aw-bg-sidebar);
  border-right: 1px solid var(--aw-border);
  display: flex;
  flex-direction: column;
}
.side-brand { display: flex; align-items: baseline; gap: 6px; padding: 16px 16px 12px; }
.logo-dot { width: 9px; height: 9px; border-radius: 2px; background: var(--aw-accent); box-shadow: 0 0 8px var(--aw-accent); align-self: center; }
.brand-name { font-size: 15px; font-weight: 700; color: var(--aw-text-title); letter-spacing: 0.5px; }
.brand-sub { font-size: 10px; color: var(--aw-text-dim); }

.side-nav { flex: 1; overflow-y: auto; padding: 4px 0; }
.nav-group { margin-bottom: 14px; }
.nav-group-title { padding: 6px 16px 4px; font-size: 10px; color: var(--aw-text-disabled); letter-spacing: 1px; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px; color: var(--aw-text-dim); text-decoration: none;
  font-size: 13px; border-left: 3px solid transparent; position: relative;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.nav-item:hover { color: var(--aw-text-body); background: rgba(255,255,255,0.03); }
.nav-item.active {
  color: var(--aw-accent);
  background: rgba(6, 182, 212, 0.08);
  border-left-color: var(--aw-accent);
}
.nav-ic { font-size: 16px; }
.nav-label { flex: 1; }
.nav-badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--aw-todo); color: #1a1205; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--aw-mono);
}
.side-bottom { border-top: 1px solid var(--aw-border); padding: 8px 0; }
.side-account {
  display: flex; align-items: center; gap: 8px; padding: 8px 16px;
  cursor: pointer; font-size: 12px; color: var(--aw-text-body);
}
.side-account:hover { background: rgba(255,255,255,0.03); }
.acct-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.acct-dot.real { background: #f0a35e; box-shadow: 0 0 6px #f0a35e; }
.acct-dot.paper { background: var(--aw-up); }
.acct-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-caret { font-size: 9px; color: var(--aw-text-dim); }
.nav-item.flat { border-left: 3px solid transparent; }

/* ---------- 主区 ---------- */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar {
  height: var(--aw-topbar-h); display: flex; align-items: center; gap: 14px;
  padding: 0 20px; border-bottom: 1px solid var(--aw-border); background: var(--aw-bg);
}
.crumb { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.crumb-sep { color: var(--aw-text-disabled); }
.crumb-dim { color: var(--aw-text-dim); font-size: 12px; }
.crumb b { color: var(--aw-text-title); font-weight: 600; }
.top-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.search-box {
  display: flex; align-items: center; gap: 6px;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 8px;
  padding: 0 10px; height: 30px; width: 220px; color: var(--aw-text-dim); font-size: 12px;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.search-box:focus-within { border-color: var(--aw-accent); width: 260px; }
.s-ic { font-size: 13px; }
.search-box input { background: transparent; border: none; outline: none; color: var(--aw-text-body); font-size: 12px; flex: 1; font-family: inherit; }
.s-kbd { font-size: 10px; color: var(--aw-text-disabled); border: 1px solid var(--aw-border); border-radius: 4px; padding: 0 4px; font-family: var(--aw-mono); }
.sync-tag { border: none; }
.sync-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--aw-todo); display: inline-block; margin-right: 5px; }
.sync-dot.ok { background: var(--aw-up); }
.icon-btn {
  width: 30px; height: 30px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: var(--aw-text-dim); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; font-size: 15px;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.icon-btn:hover { background: var(--aw-bg-card); color: var(--aw-accent); border-color: var(--aw-border); }
.acct-btn {
  display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border); color: var(--aw-text-body);
  border-radius: 8px; font-size: 12px; cursor: pointer; font-family: var(--aw-mono);
}
.acct-btn:hover { border-color: var(--aw-accent); }
.caret { font-size: 9px; }

.content { flex: 1; overflow-y: auto; padding: 16px 20px; }

/* 路由过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity var(--aw-dur-fast) var(--aw-ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.chat-wrap { height: calc(100vh - 40px); }
.pop-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.pop-line { font-size: 12px; margin-bottom: 4px; }
.acct-list { display: flex; flex-direction: column; gap: 2px; }
.acct-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--aw-text-body); }
.acct-item:hover { background: var(--aw-bg-card); }
.acct-item.active { background: var(--aw-accent-dim); color: var(--aw-accent); }
.acct-check { color: var(--aw-accent); font-weight: 700; }
</style>
