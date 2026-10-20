<template>
  <div class="shell">
    <!-- 主体行：侧边栏 + 内容区 -->
    <div class="body-row">
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
            :title="item.label"
            :class="{ active: isActive(item) }"
          >
            <el-icon class="nav-ic"><component :is="item.icon" /></el-icon>
            <span v-if="badgeOf(item) > 0" class="nav-badge">{{ badgeOf(item) }}</span>
          </router-link>
        </nav>
      </aside>

      <!-- 右侧弹性内容区（主页面顶部不再显示菜单 title，侧边栏即为导航） -->
      <div class="main">
        <main class="content">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <!-- KeepAlive 缓存行情/舆情两页：行情↔舆情切换保留 K 线状态（缩放/拖拽/数据），避免重载 -->
              <keep-alive :include="['DataCenter', 'Sentiment']">
                <component :is="Component" />
              </keep-alive>
            </transition>
          </router-view>
        </main>
      </div>
    </div>

    <!-- 底部固定 bar（贯穿整个页面）：版本 + 入口（左）；BTC 实时价格 + 代理/直连切换（含延迟）+ AI（右） -->
    <footer class="bottom-bar">
      <div class="bar-left">
        <!-- 设置（进入设置页后切换为「返回」） -->
        <router-link
          v-if="route.path !== '/settings'"
          to="/settings"
          class="bar-item"
          :class="{ active: route.path === '/settings' }"
        >
          <el-icon class="nav-ic"><Setting /></el-icon>
          <span>设置</span>
        </router-link>
        <button v-else class="bar-item" @click="goBackFromSettings">
          <el-icon class="nav-ic"><ArrowLeft /></el-icon>
          <span>返回</span>
        </button>
        <span class="bar-ver mono">v{{ appVersion }}</span>
        <!-- 全站统一：BTCUSDT 实时价格（无边框文本，前面空出侧边栏宽度，不与入口组挤最左） -->
        <div class="btc-chip" title="BTCUSDT 现货 · 24h 涨跌幅">
          <span class="btc-sym">BTCUSDT</span>
          <span class="btc-px mono" :class="btcUp ? 'up' : 'down'">{{ fmtBtc(btcPrice) }}</span>
          <span class="btc-chg mono" :class="btcUp ? 'up' : 'down'">{{ fmtBtcChg(btcChg) }}</span>
        </div>
        <!-- 已生效启动的策略（运行中，来自 /strategy-runtime） -->
        <div v-if="activeRuntimes.length" class="bar-strategies" title="已生效启动的策略">
          <span class="bs-badge">策略 {{ activeRuntimes.length }}</span>
          <span v-for="r in activeRuntimes" :key="r.id" class="bs-item">{{ stratLabel(r) }}</span>
        </div>
      </div>

      <div class="bar-right">
        <!-- 代理/直连：点击直接切换（直连 / 走代理），小绿点 + 现货行情延迟（<100ms 绿 / <1s 橙 / 以上红） -->
        <el-dropdown trigger="click" @command="onProxyCommand">
          <button class="conn-chip" :class="connCls" :title="connTitle">
            <span class="conn-dot"></span>
            <span class="conn-lat mono">{{ latencyText }}</span>
            <span class="conn-mode">{{ proxyModeText }}</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="off">直连（不走代理）</el-dropdown-item>
              <el-dropdown-item command="on">走代理（{{ proxyUrl || '127.0.0.1:7890' }}）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <!-- AI 策略顾问（随底部 bar，不再悬浮右下角） -->
        <button
          class="ai-bubble"
          :class="{ open: chatVisible }"
          :title="chatVisible ? '收起 AI 顾问' : '打开 AI 顾问'"
          @click="chatVisible = !chatVisible"
        >AI</button>
      </div>
    </footer>

    <!-- 全局 AI 聊天浮窗 -->
    <Transition name="chat-pop">
      <div v-if="chatVisible" class="ai-chat-panel">
        <div class="ai-chat-head">
          <b>AI 策略顾问</b>
          <button class="ai-chat-close" title="收起" @click="chatVisible = false">×</button>
        </div>
        <div class="ai-chat-body"><AiChat /></div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api.ts';
import AiChat from './components/AiChat.vue';
import { loadAccounts } from './store.ts';
import { deriveStatus, type TradeJournal } from './lib/journal.ts';
import { latestPrice, subscribePrice } from './lib/prices.ts';

const route = useRoute();
const router = useRouter();
/** 在设置页时，左下角入口切换为「返回」，回到进入设置前的页面（无历史则回仪表盘） */
const goBackFromSettings = () => {
  if (window.history.length > 1) router.back();
  else router.push('/');
};

type NavItem = { path: string; label: string; icon: string; badgeKey?: string };
// 导航平铺（无分组），设置固定在左下角
const navItems: NavItem[] = [
  { path: '/', label: '仪表盘', icon: 'Odometer' },
  { path: '/journal', label: '日志中心', icon: 'Notebook', badgeKey: 'journal' },
  { path: '/strategies', label: '策略中心', icon: 'SetUp', badgeKey: 'strategies' },
  { path: '/data', label: '行情', icon: 'DataLine' },
  { path: '/sentiment', label: '舆情', icon: 'ChatDotRound' },
];

const counts = ref<Record<string, number>>({ plan: 0, holding: 0, pending: 0, done: 0 });
const journalRecords = ref<TradeJournal[]>([]);
/** 代理连接状态：''=默认 'ok'=已连接 'warn'=受限/不可达 'err'=异常 'off'=直连/未配置 */
const proxyCls = ref('');
const proxyText = ref('检测中…');
const proxyMsg = ref('');
const chatVisible = ref(false);

/** 应用版本（底部 bar 展示，来自 /health） */
const appVersion = ref('');
/** 已生效启动的策略（运行中，来自 /strategy-runtime；底部 bar 展示） */
interface RuntimeLite { id: string; running: boolean; strategyId: string; symbol: string; interval: string }
const activeRuntimes = ref<RuntimeLite[]>([]);
function stratLabel(r: RuntimeLite): string {
  const name = r.strategyId?.includes('-') ? r.strategyId.split('-')[0] : (r.strategyId || '策略');
  return name + ' ' + r.symbol + ' ' + (r.interval || '');
}
/** 现货行情联通性延迟（ms，以 data-api.binance.vision 为准）；null = 检测中/不可达 */
const latencyMs = ref<number | null>(null);
/** 当前代理模式（直连 off / 代理 on / 自动 auto） */
const proxyMode = ref<'off' | 'on' | 'auto' | null>(null);
const proxyUrl = ref('');

/** 延迟文本：检测中显示 --，否则 xx ms */
const latencyText = computed(() => (latencyMs.value == null ? '--' : latencyMs.value + 'ms'));
/** 联通性颜色：<100ms 绿（ok）/ <1s 橙（warn）/ ≥1s 或失败红（err） */
const connCls = computed(() => {
  const ms = latencyMs.value;
  if (ms == null) return 'err';
  if (ms < 100) return 'ok';
  if (ms < 1000) return 'warn';
  return 'err';
});
/** 代理模式文本（下拉/展示用） */
const proxyModeText = computed(() => (proxyMode.value === 'off' ? '直连' : proxyMode.value === 'on' ? '代理' : proxyMode.value === 'auto' ? '自动' : '检测中…'));
const connTitle = computed(() => {
  const lat = latencyMs.value == null ? '不可达/检测中' : '现货行情延迟 ' + latencyMs.value + 'ms';
  return proxyModeText.value + ' · ' + lat + '（点击切换直连/代理）';
});

/** 点击底部连接 chip：直接切换代理模式（直连 / 走代理），切换后立即重新检测 */
async function onProxyCommand(cmd: string) {
  try {
    const res = await api.post<{ enabled: boolean; mode: string; url?: string | null }>('/binance/proxy', { mode: cmd });
    proxyMode.value = res.mode as 'off' | 'on' | 'auto';
    proxyUrl.value = res.url ?? '';
    refreshStatus();
  } catch (e) {
    ElMessage.error('切换失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

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

/** 底部 bar BTCUSDT 实时价格 */
const btcUp = computed(() => btcChg.value >= 0);
/** 顶栏价格：统一两位小数（与行情页 fmtPrice 一致） */
function fmtBtc(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtBtcChg(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
/** 初始价格（一次性）：后续由共享 WebSocket（/api/ws/prices）实时推送 */
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

interface BinanceStatusLite { configured?: boolean; reachable?: boolean; message?: string; proxy?: { enabled?: boolean; mode?: string; url?: string | null } }
interface ProxyExitLite { success?: boolean; country?: string; countryCode?: string; restricted?: boolean; error?: string }
interface ProxyStatusLite { enabled?: boolean; exit?: ProxyExitLite | null }
interface LatencyLite { ok?: boolean; latencyMs?: number | null; host?: string }

/**
 * 代理连接状态：以真实数据判定，而非单看行情源 ping——
 * - /health            → 服务与行情源可达；
 * - /binance/status    → 私有 API（api.binance.com）探活 + 是否配置 Key + 代理开关；
 * - /binance/proxy-status → 代理出口地区检测（美国/中国等币安封锁区 → 受限）。
 * 服务不可达则判定异常。
 */
async function refreshStatus() {
  try {
    const h = await api.get<{ ok?: boolean; version?: string }>('/health').catch(() => null);
    if (h?.version) appVersion.value = h.version;
    const [st, ps, lat, rt] = await Promise.all([
      api.get<BinanceStatusLite>('/binance/status').catch(() => null),
      api.get<ProxyStatusLite>('/binance/proxy-status').catch(() => null),
      api.get<LatencyLite>('/market/latency').catch(() => null),
      api.get<{ runtimes?: RuntimeLite[] }>('/strategy-runtime').catch(() => null),
    ]);
    activeRuntimes.value = (rt?.runtimes ?? []).filter((r) => r.running);
    // 代理模式与现货行情延迟（底部 bar 展示，以现货行情联通性为准）
    proxyMode.value = (st?.proxy?.mode as 'off' | 'on' | 'auto' | null) ?? proxyMode.value;
    if (st?.proxy?.url) proxyUrl.value = st.proxy.url;
    latencyMs.value = lat?.latencyMs ?? null;
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
      // 出口地区检测失败时，若币安探活明确返回受限地区（Restricted Location），仍归类为"代理受限"而非模糊的"代理异常"
      if ((st.message ?? '').includes('Restricted Location')) {
        proxyCls.value = 'warn';
        proxyText.value = '代理受限';
        proxyMsg.value = st.message ?? '代理出口被币安限制，请更换代理节点地区（如香港/新加坡/日本等）';
      } else {
        proxyCls.value = 'err';
        proxyText.value = '代理异常';
        proxyMsg.value = '代理连接异常：' + (exit?.error ?? '代理出口检测失败');
      }
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

let unsubPrice: (() => void) | null = null;
onMounted(() => {
  refreshStatus();
  refreshPrice(); // 初始值（一次性拉取）
  // 实时价格：全站共享的 WebSocket 推送（单一连接，多订阅者），替代轮询
  const t0 = latestPrice('BTCUSDT');
  if (t0) {
    btcPrice.value = t0.lastPrice;
    btcChg.value = t0.priceChangePercent;
  }
  unsubPrice = subscribePrice('BTCUSDT', (t) => {
    btcPrice.value = t.lastPrice;
    btcChg.value = t.priceChangePercent;
  });
  setInterval(refreshStatus, 15000);   // 15s：连接状态快速同步
});

onBeforeUnmount(() => {
  unsubPrice?.();
});
</script>

<style scoped>
/* 主体行（侧边栏 + 内容） + 底部贯穿 bar */
.shell { display: flex; flex-direction: column; height: 100%; }
.body-row { flex: 1; display: flex; min-height: 0; }

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
.nav-item {
  display: flex; align-items: center; justify-content: center; gap: 0;
  padding: 8px 0; margin: 2px 10px; color: var(--aw-text-dim); text-decoration: none;
  font-size: 13px; border-left: 3px solid transparent; position: relative;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}

/* ---------- 底部贯穿 bar ---------- */
.bottom-bar {
  height: 46px; flex: none;
  border-top: 1px solid var(--aw-border);
  background: var(--aw-bg-sidebar);
  display: flex; align-items: center; gap: 12px;
  padding: 0 14px;
}
.bar-left { display: flex; align-items: center; gap: 4px; }
.bar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.bar-ver { font-size: 11px; color: var(--aw-text-disabled); opacity: 0.8; padding-left: 4px; }
.bar-item {
  display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 12px; border-radius: 8px;
  border: 1px solid transparent; background: transparent;
  color: var(--aw-text-dim); font-size: 13px; text-decoration: none; cursor: pointer;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
button.bar-item { font: inherit; }
.bar-item:hover { color: var(--aw-accent); background: rgba(255, 255, 255, 0.04); }
.bar-item.active { color: var(--aw-accent); background: rgba(6, 182, 212, 0.08); }

/* 代理/直连 + 联通性（小绿点 + 现货行情延迟，<100ms 绿 / <1s 橙 / 以上红） */
.conn-chip {
  display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 12px; border-radius: 8px;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border);
  font-size: 12px; color: var(--aw-text-dim); cursor: pointer; white-space: nowrap;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.conn-chip:hover { border-color: var(--aw-accent); }
.conn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--aw-text-disabled); flex: none; }
.conn-chip.ok { color: var(--aw-up); border-color: rgba(16, 185, 129, 0.4); }
.conn-chip.ok .conn-dot { background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.5); }
.conn-chip.warn { color: var(--aw-todo); border-color: rgba(245, 158, 11, 0.4); }
.conn-chip.warn .conn-dot { background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.5); }
.conn-chip.err { color: var(--aw-down); border-color: rgba(239, 68, 68, 0.4); }
.conn-chip.err .conn-dot { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); }
.conn-lat { font-family: var(--aw-mono); font-weight: 600; }
.conn-mode { opacity: 0.85; }

/* AI 按钮随底部 bar（覆盖原悬浮样式） */
.bottom-bar .ai-bubble {
  position: static; width: 36px; height: 30px; border-radius: 8px;
  font-size: 13px; box-shadow: none;
}
.nav-item:hover { color: var(--aw-text-body); background: rgba(255,255,255,0.03); }
button.nav-item { background: none; border: none; cursor: pointer; font: inherit; width: 100%; text-align: left; }
.nav-item.active {
  color: var(--aw-accent);
  background: rgba(6, 182, 212, 0.08);
  border-left-color: var(--aw-accent);
}
.nav-ic { font-size: 16px; }
.nav-badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--aw-todo); color: #1a1205; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--aw-mono);
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
}


/* ---------- 主区 ---------- */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
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
/* 行情页（含 .tv-card.fullbleed）：图表高度自适应——不滚动，内容弹性撑满视口剩余高度 */
.content:has(.tv-card.fullbleed) { overflow: hidden; display: flex; flex-direction: column; }

/* 路由过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity var(--aw-dur-fast) var(--aw-ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }



/* 底部 bar：BTC 实时价格（无边框文本，margin 侧边栏宽度，视觉上从侧边栏右缘开始） */
.btc-chip { display: flex; align-items: baseline; gap: 7px; margin-left: var(--aw-sidebar-w); }
.btc-sym { color: var(--aw-text-dim); font-size: 11px; font-weight: 600; }
.btc-px { font-size: 13px; font-weight: 700; }
.btc-chg { font-size: 11px; }

/* ---------- 底部 bar：已生效启动的策略 ---------- */
.bar-strategies {
  display: flex; align-items: center; gap: 8px;
  margin-left: 16px; padding-left: 16px; border-left: 1px solid var(--aw-border);
  font-size: 12px; color: var(--aw-text-dim); overflow: hidden; white-space: nowrap;
}
.bs-badge {
  flex: none; padding: 2px 8px; border-radius: 10px; font-size: 11px;
  background: rgba(16, 185, 129, 0.14); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);
}
.bs-item { font-family: var(--aw-mono); font-size: 11px; }
.bs-item + .bs-item::before { content: '·'; margin-right: 8px; color: var(--aw-text-disabled); }

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
