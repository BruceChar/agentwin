<template>
  <div>
    <el-card shadow="never">
      <div class="row">
        <span class="label">账户：</span>
        <el-select v-model="accountId" style="width: 220px" @change="load">
          <el-option v-for="a in accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
        </el-select>
        <el-button v-if="isReal" type="primary" size="small" :loading="syncing" @click="syncNow">从币安同步</el-button>
        <el-button v-else size="small" @click="load">刷新</el-button>
        <el-tag v-if="binanceStatus" size="small" :type="binanceStatus.reachable ? 'success' : 'warning'" class="ml">
          {{ keyStatusText }}
        </el-tag>
      </div>
      <div class="row mt-sm">
        <span class="label">代理：</span>
        <el-switch v-model="proxyEnabled" active-text="走代理" inactive-text="直连" @change="applyProxy" />
        <el-input v-model="proxyUrl" placeholder="代理地址，如 http://127.0.0.1:7890" style="width: 260px" @keyup.enter="applyProxy" />
        <el-button size="small" type="primary" @click="applyProxy">应用</el-button>
        <span class="dim">切换即时生效（REST + WebSocket）；受限地区报错时建议直连或换非美区节点</span>
      </div>
    </el-card>
    <el-alert v-if="isReal && binanceStatus && !binanceStatus.reachable" type="warning" :closable="false" class="mt"
      :title="'无法连接币安官方账户接口：' + (binanceStatus.message ?? '请检查网络 / BINANCE_API_KEY 配置') + '。建议：1) 用上方代理开关切换 直连/代理 试试；2) 按 docs/hosts-binance.txt 配置 hosts 绕过污染 DNS；3) 更换系统 DNS（如 223.5.5.5 或 1.1.1.1）'" />
    <el-alert v-if="isReal && binanceStatus?.lastSync && !binanceStatus.lastSync.ok" type="error" :closable="false" class="mt"
      :title="'最近一次同步失败：' + (binanceStatus.lastSync.message ?? '未知原因')" />
    <el-row :gutter="16" class="mt">
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">总权益</div><div class="value">{{ fmt(equity) }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">净盈亏</div><div class="value" :class="netPnl >= 0 ? 'up' : 'down'">{{ fmt(netPnl) }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">胜率</div><div class="value">{{ (winRate * 100).toFixed(1) }}%</div></div></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">总交易</div><div class="value">{{ totalTrades }}</div></div></el-card></el-col>
    </el-row>
    <el-row :gutter="16" class="mt">
      <el-col :span="16">
        <el-card shadow="never">
          <template #header>权益曲线</template>
          <div ref="chartEl" class="chart"></div>
          <el-empty v-if="!curvePoints.length" description="暂无权益数据（真实账户请先点击「从币安同步」）" :image-size="60" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>各市场概览</template>
          <el-table :data="marketSummary" size="small" max-height="300">
            <el-table-column label="市场"><template #default="{ row }">{{ row.label }}</template></el-table-column>
            <el-table-column label="余额项" width="70"><template #default="{ row }">{{ row.balanceCount }}</template></el-table-column>
            <el-table-column label="持仓" width="70"><template #default="{ row }">{{ row.positionCount }}</template></el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" class="mt">
      <template #header>持仓与余额（按市场）</template>
      <el-tabs v-model="activeMarket">
        <el-tab-pane v-for="m in marketKeys" :key="m" :label="MARKET_LABELS[m]" :name="m">
          <el-table :data="markets[m]?.positions ?? []" size="small" class="mb-sm">
            <el-table-column prop="symbol" label="币种" />
            <el-table-column prop="side" label="方向" width="80"><template #default="{ row }"><el-tag :type="row.side === 'LONG' ? 'danger' : 'success'" size="small">{{ row.side }}</el-tag></template></el-table-column>
            <el-table-column prop="quantity" label="数量" />
            <el-table-column prop="avgEntryPrice" label="均价" />
            <el-table-column label="浮动盈亏"><template #default="{ row }"><span :class="row.unrealizedPnl >= 0 ? 'up' : 'down'">{{ fmt(row.unrealizedPnl) }}</span></template></el-table-column>
          </el-table>
          <el-table :data="markets[m]?.balances ?? []" size="small">
            <el-table-column prop="asset" label="资产" width="110" />
            <el-table-column prop="free" label="可用" />
            <el-table-column prop="locked" label="锁定" width="100" />
          </el-table>
          <el-empty v-if="!markets[m]?.positions?.length && !markets[m]?.balances?.length" description="该市场无数据" :image-size="50" />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api, MARKET_LABELS, type AccountSummary, type EquityPoint, type TradeAgg } from '../api.ts';

const accounts = ref<AccountSummary[]>([]);
const accountId = ref('');
const equity = ref(0);
const netPnl = ref(0);
const winRate = ref(0);
const totalTrades = ref(0);
const positions = ref<AccountSummary['positions']>([]);
const balances = ref<{ market: string; asset: string; free: number; locked: number }[]>([]);
const markets = ref<AccountSummary['markets']>({});
const activeMarket = ref('SPOT');

const marketKeys = ['SPOT', 'MARGIN', 'MARGIN_ISOLATED', 'USDT_M', 'COIN_M'];
const marketSummary = computed(() => marketKeys.map((m) => ({
  label: MARKET_LABELS[m] ?? m,
  balanceCount: markets.value[m]?.balances?.length ?? 0,
  positionCount: markets.value[m]?.positions?.length ?? 0,
})));
const curvePoints = ref<EquityPoint[]>([]);
const syncing = ref(false);
const proxyEnabled = ref(false);
const proxyUrl = ref('');
const binanceStatus = ref<{
  configured: boolean;
  hasKey?: boolean;
  hasSecret?: boolean;
  missing?: string[];
  reachable: boolean;
  message?: string;
  proxy?: { enabled: boolean; url?: string; mode: string; source: string };
  lastSync?: { at: number; ok: boolean; message?: string; balancesUpserted: number; futuresPositions: number; tradesSynced: number } | null;
} | null>(null);

const keyStatusText = computed(() => {
  const s = binanceStatus.value;
  if (!s) return '';
  if (s.configured) return s.reachable ? '币安账户已连接' : '币安账户不可达';
  if (s.hasKey && !s.hasSecret) return '已配置 Key，缺少 BINANCE_API_SECRET';
  if (!s.hasKey && s.hasSecret) return '已配置 Secret，缺少 BINANCE_API_KEY';
  return '未配置币安 Key（.env 中填 BINANCE_API_KEY + BINANCE_API_SECRET）';
});

async function applyProxy() {
  try {
    const cfg = await api.post<{ enabled: boolean; url?: string; mode: string }>('/binance/proxy', {
      mode: proxyEnabled.value ? 'on' : 'off',
      url: proxyUrl.value,
    });
    proxyEnabled.value = cfg.enabled;
    proxyUrl.value = cfg.url ?? '';
    ElMessage.success('代理已切换：' + (cfg.enabled ? '走 ' + cfg.url : '直连'));
    binanceStatus.value = await api.get<{ configured: boolean; reachable: boolean; message?: string; proxy?: { enabled: boolean; url?: string; mode: string; source: string } }>('/binance/status').catch(() => null);
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

const isReal = computed(() => accounts.value.find((a) => a.id === accountId.value)?.type === 'real');

function fmt(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderCurve(points: EquityPoint[]) {
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
  if (points.length === 0) { chart.clear(); return; }
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: points.map((p) => new Date(p.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })) },
    yAxis: { type: 'value', scale: true },
    series: [{
      type: 'line', smooth: true, showSymbol: false, data: points.map((p) => p.equity),
      lineStyle: { color: '#1677ff', width: 2 },
      areaStyle: { color: 'rgba(22,119,255,0.08)' },
    }],
  });
}

async function load() {
  const res = await api.get<{ accounts: AccountSummary[] }>('/accounts');
  accounts.value = res.accounts;
  if (!accountId.value) accountId.value = accounts.value.find((a) => a.type === 'real')?.id ?? accounts.value[0]?.id ?? '';
  const cur = accounts.value.find((a) => a.id === accountId.value);
  if (!cur) return;
  equity.value = cur.equity ?? 0;
  winRate.value = cur.winRate;
  netPnl.value = cur.netPnl;
  totalTrades.value = cur.totalTrades;
  positions.value = cur.positions;
  balances.value = cur.balances;
  markets.value = cur.markets ?? {};
  if (cur.markets?.['USDT_M']?.positions?.length) activeMarket.value = 'USDT_M';
  else if (cur.markets?.['MARGIN_ISOLATED']?.positions?.length) activeMarket.value = 'MARGIN_ISOLATED';
  else if (cur.markets?.['COIN_M']?.positions?.length) activeMarket.value = 'COIN_M';
  else if (cur.markets?.['MARGIN']?.balances?.length) activeMarket.value = 'MARGIN';
  else activeMarket.value = 'SPOT';
  const detail = await api.get<{ equityCurve: EquityPoint[] }>('/accounts/' + accountId.value);
  curvePoints.value = detail.equityCurve;
  renderCurve(detail.equityCurve);
}

async function syncNow() {
  syncing.value = true;
  try {
    const res = await api.post<{ ok: boolean; balancesUpserted: number; tradesSynced: number; message?: string }>('/binance/sync');
    if (res.ok) {
      ElMessage.success('已同步：余额 ' + res.balancesUpserted + ' 项，成交 ' + res.tradesSynced + ' 条');
    } else {
      ElMessage.error('同步失败：' + (res.message ?? '未知错误'));
    }
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    syncing.value = false;
  }
}

onMounted(async () => {
  await load().catch(() => { /* 账户加载失败不阻断状态查询 */ });
  binanceStatus.value = await api.get<{ configured: boolean; reachable: boolean; message?: string; proxy?: { enabled: boolean; url?: string; mode: string; source: string } }>('/binance/status').catch(() => null);
  if (binanceStatus.value?.proxy) {
    proxyEnabled.value = binanceStatus.value.proxy.enabled;
    proxyUrl.value = binanceStatus.value.proxy.url ?? '';
  }
});
</script>

<style scoped>
.mt { margin-top: 16px; }
.mt-sm { margin-top: 10px; }
.row { display: flex; align-items: center; gap: 8px; }
.dim { color: #999; font-size: 12px; }
.label { font-weight: 600; }
.ml { margin-left: auto; }
.chart { height: 300px; }
.stat .label { color: #999; font-size: 13px; }
.stat .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
.up { color: #67c23a; }
.down { color: #f56c6c; }
</style>
