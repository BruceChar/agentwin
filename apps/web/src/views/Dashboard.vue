<template>
  <div>
    <el-row :gutter="16">
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">总权益</div><div class="value">{{ fmt(equity) }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">净盈亏</div><div class="value" :class="netPnl >= 0 ? 'up' : 'down'">{{ fmt(netPnl) }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">胜率</div><div class="value">{{ (winRate * 100).toFixed(1) }}%</div></div></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><div class="stat"><div class="label">总交易</div><div class="value">{{ totalTrades }}</div></div></el-card></el-col>
    </el-row>
    <el-card shadow="never" class="mt">
      <template #header>模拟账户权益曲线</template>
      <div ref="chartEl" class="chart"></div>
    </el-card>
    <el-card shadow="never" class="mt">
      <template #header>当前持仓</template>
      <el-table :data="positions" size="small">
        <el-table-column prop="symbol" label="币种" />
        <el-table-column prop="side" label="方向"><template #default="{ row }"><el-tag :type="row.side === 'LONG' ? 'danger' : 'success'" size="small">{{ row.side }}</el-tag></template></el-table-column>
        <el-table-column prop="quantity" label="数量" />
        <el-table-column prop="avgEntryPrice" label="均价" />
        <el-table-column label="浮动盈亏"><template #default="{ row }"><span :class="row.unrealizedPnl >= 0 ? 'up' : 'down'">{{ fmt(row.unrealizedPnl) }}</span></template></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { api, type AccountSummary, type EquityPoint, type TradeAgg } from '../api.ts';

const equity = ref(0);
const netPnl = ref(0);
const winRate = ref(0);
const totalTrades = ref(0);
const positions = ref<AccountSummary['positions']>([]);
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function fmt(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderCurve(points: EquityPoint[]) {
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
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
  const accounts = await api.get<AccountSummary[]>('/accounts');
  const paper = accounts.find((a) => a.type === 'paper') ?? accounts[0];
  if (!paper) return;
  equity.value = paper.equity ?? 0;
  winRate.value = paper.winRate;
  netPnl.value = paper.netPnl;
  totalTrades.value = paper.totalTrades;
  positions.value = paper.positions;
  const detail = await api.get<{ equityCurve: EquityPoint[] }>('/accounts/' + paper.id);
  renderCurve(detail.equityCurve);
}

onMounted(load);
watch(equity, () => {});
</script>

<style scoped>
.mt { margin-top: 16px; }
.chart { height: 320px; }
.stat .label { color: #999; font-size: 13px; }
.stat .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
.up { color: #f56c6c; }
.down { color: #67c23a; }
</style>
