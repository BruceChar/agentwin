<template>
  <div class="shell">
    <!-- 左侧固定侧边栏 200px -->
    <aside class="sidebar">
      <div class="side-brand">
        <span class="logo-dot"></span>
        <span class="brand-name">AgentWin</span>
        <span class="brand-sub">久赌必赢</span>
      </div>

      <nav class="side-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: isActive(item) }"
        >
          <el-icon class="nav-ic"><component :is="item.icon" /></el-icon>
          <span class="nav-label">{{ item.label }}</span>
          <span v-if="badgeOf(item) > 0" class="nav-badge">{{ badgeOf(item) }}</span>
        </router-link>
      </nav>

      <!-- 设置固定左下角 -->
      <router-link to="/settings" class="nav-item settings-pin" :class="{ active: route.path === '/settings' }">
        <el-icon class="nav-ic"><Setting /></el-icon>
        <span class="nav-label">设置</span>
      </router-link>
    </aside>

    <!-- 右侧弹性内容区 -->
    <div class="main">
      <header class="topbar">
        <div class="crumb">
          <b>{{ crumbTitle }}</b>
        </div>
        <div class="top-right">
          <!-- 全站统一：BTCUSDT 实时价格（含设置页） -->
          <div class="btc-chip" title="BTCUSDT 现货 · 24h 涨跌幅">
            <span class="btc-sym">BTCUSDT</span>
            <span class="btc-px mono" :class="btcUp ? 'up' : 'down'">{{ fmtBtc(btcPrice) }}</span>
            <span class="btc-chg mono" :class="btcUp ? 'up' : 'down'">{{ fmtBtcChg(btcChg) }}</span>
          </div>
          <!-- 代理连接状态：直连 / 已连接 / 受限 / 异常（随 /health + /binance/status + /binance/proxy-status 实时检测） -->
          <button class="proxy-chip" :class="proxyCls" :title="proxyMsg">
            <span class="proxy-dot"></span>
            <span class="proxy-text">{{ proxyText }}</span>
          </button>
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

    <!-- 全局 AI 聊天浮窗（右下角） -->
    <Transition name="chat-pop">
      <div v-if="chatVisible" class="ai-chat-panel">
        <div class="ai-chat-head">
          <b>AI 策略顾问</b>
          <button class="ai-chat-close" title="收起" @click="chatVisible = false">×</button>
        </div>
        <div class="ai-chat-body"><AiChat /></div>
      </div>
    </Transition>
    <button class="ai-bubble" :class="{ open: chatVisible }" :title="chatVisible ? '收起 AI 顾问' : '打开 AI 顾问'" @click="chatVisible = !chatVisible">AI</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from './api.ts';
import AiChat from './components/AiChat.vue';
import { loadAccounts } from './store.ts';
import { deriveStatus, type TradeJournal } from './lib/journal.ts';

const route = useRoute();

type NavItem = { path: string; label: string; icon: string; badgeKey?: string };
// 导航平铺（无分组），设置固定在左下角
const navItems: NavItem[] = [
  { path: '/', label: '仪表盘', icon: 'Odometer' },
  { path: '/journal', label: '日志中心', icon: 'Notebook', badgeKey: 'journal' },
  { path: '/strategies', label: '策略中心', icon: 'SetUp', badgeKey: 'strategies' },
  { path: '/data', label: '数据中心', icon: 'DataLine' },
];

const counts = ref<Record<string, number>>({ plan: 0, holding: 0, pending: 0, done: 0 });
const journalRecords = ref<TradeJournal[]>([]);
/** 代理连接状态：''=默认 'ok'=已连接 'warn'=受限/不可达 'err'=异常 'off'=直连/未配置 */
const proxyCls = ref('');
const proxyText = ref('检测中…');
const proxyMsg = ref('');
const chatVisible = ref(false);

const btcPrice = ref<number | null>(null);
const btcChg = ref(0);

function badgeOf(item: NavItem): number {
  if (!item.badgeKey) return 0;
  if (item.badgeKey === 'journal') return (counts.value.pending ?? 0) + (counts.value.holding ?? 0);
  if (item.badgeKey === 'strategies') return stratTodoCount.value;
  return counts.value[item.badgeKey] ?? 0;
}

/** 策略中心角标：待处理优化任务数（净盈亏为负的策略视为待优化） */
const stratTodoCount = computed(() => {
  const byKey = new Map<string, number>();
  for (const r of journalRecords.value) {
    const st = deriveStatus(r);
    if (st !== 'done' && st !== 'pending') continue;
    const key = r.strategyName || r.strategyVersion;
    if (!key) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + (r.netPnl ?? 0));
  }
  return [...byKey.values()].filter((net) => net < 0).length;
});

function isActive(item: NavItem): boolean {
  if (item.path === '/') return route.path === '/';
  return route.path.startsWith(item.path);
}

const crumbTitle = computed(() => (route.meta.title as string) ?? '仪表盘');

/** 顶栏 BTCUSDT 实时价格 */
const btcUp = computed(() => btcChg.value >= 0);
function fmtBtc(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : v.toFixed(2);
}
function fmtBtcChg(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
async function refreshPrice() {
  try {
    const r = await api.get<{ tickers: { symbol: string; lastPrice: number; priceChangePercent?: number }[] }>('/market/tickers?market=SPOT').catch(() => null);
    const b = r?.tickers.find((t) => t.symbol === 'BTCUSDT');
    if (b) {
      btcPrice.value = b.lastPrice;
      btcChg.value = b.priceChangePercent ?? 0;
    }
  } catch { /* 保留上一次价格 */ }
}

interface BinanceStatusLite { configured?: boolean; reachable?: boolean; message?: string; proxy?: { enabled?: boolean } }
interface ProxyExitLite { success?: boolean; country?: string; countryCode?: string; restricted?: boolean; error?: string }
interface ProxyStatusLite { enabled?: boolean; exit?: ProxyExitLite | null }

/**
 * 代理连接状态：以真实数据判定，而非单看行情源 ping——
 * - /health            → 服务与行情源可达；
 * - /binance/status    → 私有 API（api.binance.com）探活 + 是否配置 Key + 代理开关；
 * - /binance/proxy-status → 代理出口地区检测（美国/中国等币安封锁区 → 受限）。
 * 服务不可达则判定异常。
 */
async function refreshStatus() {
  try {
    await api.get<{ ok?: boolean }>('/health');
    const [st, ps] = await Promise.all([
      api.get<BinanceStatusLite>('/binance/status').catch(() => null),
      api.get<ProxyStatusLite>('/binance/proxy-status').catch(() => null),
    ]);
    const exit = ps?.exit;
    if (!st) {
      proxyCls.value = 'err';
      proxyText.value = '状态未知';
      proxyMsg.value = '币安状态检测失败';
    } else if (!st.configured) {
      proxyCls.value = 'off';
      proxyText.value = '未配置';
      proxyMsg.value = '币安未配置 API Key/Secret';
    } else if (!st.proxy?.enabled) {
      proxyCls.value = 'off';
      proxyText.value = '直连';
      proxyMsg.value = st.reachable
        ? '直连模式，币安可达'
        : '直连模式，币安不可达（建议开启代理）：' + (st.message ?? '');
    } else if (!exit || exit.success === false) {
      proxyCls.value = 'err';
      proxyText.value = '代理异常';
      proxyMsg.value = '代理连接异常：' + (exit?.error ?? '代理出口检测失败');
    } else if (st.reachable) {
      proxyCls.value = 'ok';
      proxyText.value = '代理已连接';
      proxyMsg.value = '代理已连接（出口 ' + (exit.country ?? '未知') + '），币安可达';
    } else if (exit.restricted) {
      proxyCls.value = 'warn';
      proxyText.value = '代理受限';
      proxyMsg.value = '代理出口受限（' + (exit.country ?? '未知') + '），币安不可达——请更换代理出口地区';
    } else {
      proxyCls.value = 'warn';
      proxyText.value = '币安不可达';
      proxyMsg.value = '代理已开启但币安不可达：' + (st.message ?? '');
    }
  } catch {
    proxyCls.value = 'err';
    proxyText.value = '服务异常';
    proxyMsg.value = '服务不可达，请检查后端';
  }
  // 角标与账户数据（独立于连接状态，失败不影响连接判断）
  await loadAccounts().catch(() => null);
  const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => null);
  if (j) {
    journalRecords.value = j.records;
    const c = { plan: 0, holding: 0, pending: 0, done: 0 };
    for (const r of j.records) c[deriveStatus(r)]++;
    counts.value = c;
  }
}

onMounted(() => {
  refreshStatus();
  refreshPrice();
  setInterval(refreshStatus, 15000);   // 15s：连接状态快速同步
  setInterval(refreshPrice, 5000);
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
.settings-pin { border-top: 1px solid var(--aw-border); }
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


/* ---------- 主区 ---------- */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar {
  height: var(--aw-topbar-h); display: flex; align-items: center; gap: 14px;
  padding: 0 20px; border-bottom: 1px solid var(--aw-border); background: var(--aw-bg);
}
.crumb { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.crumb b { color: var(--aw-text-title); font-weight: 600; }
.top-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
/* 代理连接状态（文字 chip：直连/已连接/受限/异常） */
.proxy-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 8px;
  font-size: 12px; color: var(--aw-text-dim); cursor: default; white-space: nowrap;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.proxy-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--aw-text-disabled); flex: none; }
.proxy-chip.ok { color: var(--aw-up); border-color: rgba(16,185,129,0.4); }
.proxy-chip.ok .proxy-dot { background: var(--aw-up); box-shadow: 0 0 6px rgba(16,185,129,0.5); }
.proxy-chip.warn { color: var(--aw-todo); border-color: rgba(245,158,11,0.4); }
.proxy-chip.warn .proxy-dot { background: var(--aw-todo); box-shadow: 0 0 6px rgba(245,158,11,0.5); }
.proxy-chip.err { color: var(--aw-down); border-color: rgba(239,68,68,0.4); }
.proxy-chip.err .proxy-dot { background: var(--aw-down); box-shadow: 0 0 6px rgba(239,68,68,0.5); }
.icon-btn {
  width: 30px; height: 30px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: var(--aw-text-dim); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; font-size: 15px;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.icon-btn:hover { background: var(--aw-bg-card); color: var(--aw-accent); border-color: var(--aw-border); }


.content { flex: 1; overflow-y: auto; padding: 16px 20px; }

/* 路由过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity var(--aw-dur-fast) var(--aw-ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }



/* ---------- 顶栏 BTC 实时价格 ---------- */
.btc-chip {
  display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 8px;
  font-size: 12px;
}
.btc-sym { color: var(--aw-text-dim); font-size: 11px; font-weight: 600; }
.btc-px { font-size: 13px; font-weight: 700; }
.btc-chg { font-size: 11px; }

/* ---------- 全局 AI 聊天浮窗（右下角） ---------- */
.ai-chat-panel {
  position: fixed; right: 20px; bottom: 76px; z-index: 2000;
  width: 360px; height: 520px; max-height: calc(100vh - 120px);
  display: flex; flex-direction: column;
  background: var(--aw-bg-elev); border: 1px solid var(--aw-border); border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45); overflow: hidden;
}
.ai-chat-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--aw-border);
  font-size: 13px; color: var(--aw-text-title);
}
.ai-chat-close {
  width: 24px; height: 24px; border-radius: 6px; border: none; background: transparent;
  color: var(--aw-text-dim); font-size: 16px; cursor: pointer; line-height: 1;
}
.ai-chat-close:hover { background: var(--aw-bg-hover); color: var(--aw-text-body); }
.ai-chat-body { flex: 1; min-height: 0; padding: 10px 14px 12px; }
.ai-bubble {
  position: fixed; right: 20px; bottom: 20px; z-index: 2000;
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--aw-accent); color: #06202a; border: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; letter-spacing: 0.5px; line-height: 1;
  box-shadow: 0 6px 20px rgba(6, 182, 212, 0.45);
  transition: all 200ms var(--aw-ease);
}
.ai-bubble:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(6, 182, 212, 0.6); }
.ai-bubble.open { background: var(--aw-bg-elev); color: var(--aw-accent); border: 1px solid var(--aw-accent); box-shadow: none; }
.chat-pop-enter-active, .chat-pop-leave-active { transition: opacity 200ms var(--aw-ease), transform 200ms var(--aw-ease); }
.chat-pop-enter-from, .chat-pop-leave-to { opacity: 0; transform: translateY(12px); }
</style>
