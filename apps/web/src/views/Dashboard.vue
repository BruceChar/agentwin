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
          {{ binanceStatus.configured ? (binanceStatus.reachable ? '币安账户已连接' : '币安账户不可达') : '未配置币安 Key' }}
        </el-tag>
        <el-tag v-if="binanceStatus?.proxy" size="small" type="info" effect="plain">
          代理：{{ binanceStatus.proxy.enabled ? '开 (' + (binanceStatus.proxy.url ?? '') + ')' : '关（直连）' }}
        </el-tag>
      </div>
    </el-card>
    <el-alert v-if="isReal && binanceStatus && !binanceStatus.reachable" type="warning" :closable="false" class="mt"
      :title="'无法连接币安官方账户接口：' + (binanceStatus.message ?? '请检查网络 / BINANCE_API_KEY 配置')" />
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
          <template #header>资产余额</template>
          <el-table :data="balances" size="small" max-height="300">
            <el-table-column prop="asset" label="资产" width="90" />
            <el-table-column prop="free" label="可用" />
            <el-table-column prop="locked" label="锁定" width="90" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" class="mt">
      <template #header>当前持仓</template>
      <el-table :data="positions" size="small">
        <el-table-column prop="symbol" label="币种" />
        <el-table-column prop="side" label="方向"><template #default="{ row }"><el-tag :type="row.side === 'LONG' ? 'danger' : 'success'" size="small">{{ row.side }}</el-tag></template></el-table-column>
        <el-table-column prop="quantity" label="数量" />
        <el-table-column prop="avgEntryPrice" label="均价" />
        <el-table-column label="浮动盈亏"><template #default="{ row }"><span :class="row.unrealizedPnl >= 0 ? 'up' : 'down'">{{ fmt(row.unrealizedPnl) }}</span></template></el-table-column>
      </el-table>
      <el-empty v-if="!positions.length" description="暂无持仓" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api, type AccountSummary, type EquityPoint, type TradeAgg } from '../api.ts';

const accounts = ref<AccountSummary[]>([]);
const accountId = ref('');
const equity = ref(0);
const netPnl = ref(0);
const winRate = ref(0);
const totalTrades = ref(0);
const positions = ref<AccountSummary['positions']>([]);
const balances = ref<{ asset: string; free: number; locked: number }[]>([]);
const curvePoints = ref<EquityPoint[]>([]);
const syncing = ref(false);
const binanceStatus = ref<{ configured: boolean; reachable: boolean; message?: string; proxy?: { enabled: boolean; url?: string; mode: string; source: string } } | null>(null);
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
  accounts.value = await api.get<AccountSummary[]>('/accounts');
  if (!accountId.value) accountId.value = accounts.value.find((a) => a.type === 'real')?.id ?? accounts.value[0]?.id ?? '';
  const cur = accounts.value.find((a) => a.id === accountId.value);
  if (!cur) return;
  equity.value = cur.equity ?? 0;
  winRate.value = cur.winRate;
  netPnl.value = cur.netPnl;
  totalTrades.value = cur.totalTrades;
  positions.value = cur.positions;
  balances.value = cur.balances;
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
  await load();
  binanceStatus.value = await api.get<{ configured: boolean; reachable: boolean; message?: string }>('/binance/status').catch(() => null);
});
</script>

<style scoped>
.mt { margin-top: 16px; }
.row { display: flex; align-items: center; gap: 8px; }
.label { font-weight: 600; }
.ml { margin-left: auto; }
.chart { height: 300px; }
.stat .label { color: #999; font-size: 13px; }
.stat .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
.up { color: #f56c6c; }
.down { color: #67c23a; }
</style>
