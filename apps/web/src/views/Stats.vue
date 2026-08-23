<template>
  <div class="stats aw-page">
    <div class="stats-head">
      <h2>统计分析</h2>
      <span class="dim">基于所选账户的实际成交（{{ acctLabelText }}）</span>
    </div>

    <div class="aw-card filter-bar">
      <div class="row">
        <span class="label">账户：</span>
        <el-select :model-value="accountStore.selectedId" style="width: 200px" @change="onAccountChange">
          <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
        </el-select>
        <span class="label">时间范围：</span>
        <el-date-picker v-model="range" type="daterange" value-format="x" :clearable="false" @change="load" />
        <span class="label">市场：</span>
        <el-select v-model="market" style="width: 140px" clearable placeholder="全部" @change="load">
          <el-option v-for="(label, m) in MARKET_LABELS" :key="m" :value="m" :label="label" />
        </el-select>
        <el-button size="small" @click="load">刷新</el-button>
      </div>
    </div>

    <!-- 指标卡 -->
    <div class="metric-grid">
      <div v-for="c in cards" :key="c.label" class="metric-card aw-card">
        <div class="mlabel">{{ c.label }}</div>
        <div class="mvalue mono" :class="c.cls">{{ c.text }}</div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="aw-card"><div class="ch-title">按品种盈亏</div><div ref="symChart" class="chart"></div></div>
      <div class="aw-card"><div class="ch-title">按市场盈亏</div><div ref="mktChart" class="chart"></div></div>
      <div class="aw-card"><div class="ch-title">按方向盈亏</div><div ref="dirChart" class="chart"></div></div>
      <div class="aw-card wide"><div class="ch-title">每日盈亏</div><div ref="dayChart" class="chart"></div></div>
      <div class="aw-card wide"><div class="ch-title">累计净收益（实际成交）</div><div ref="cumChart" class="chart"></div></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { api, MARKET_LABELS, type TradeAgg } from '../api.ts';
import { accountLabel, accountStore, loadAccounts, selectAccount } from '../store.ts';

interface Fill { id: string; symbol: string; market: string; side: string; qty: number; price: number; fee: number; realizedPnl?: number; tradedAt: number }

const range = ref<[number, number]>([Date.now() - 30 * 86400000, Date.now()]);
const market = ref('');
const agg = ref<TradeAgg | null>(null);
const fills = ref<Fill[]>([]);
const symChart = ref<HTMLDivElement | null>(null);
const mktChart = ref<HTMLDivElement | null>(null);
const dirChart = ref<HTMLDivElement | null>(null);
const dayChart = ref<HTMLDivElement | null>(null);
const cumChart = ref<HTMLDivElement | null>(null);
const charts: echarts.ECharts[] = [];

const acctLabelText = computed(() => {
  const a = accountStore.accounts.find((x) => x.id === accountStore.selectedId) ?? null;
  return accountLabel(a);
});

const cards = computed(() => {
  const a = agg.value;
  if (!a) return [];
  const pf = a.profitFactor === Infinity ? '∞' : a.profitFactor.toFixed(2);
  const n = a.totalTrades || 0;
  return [
    { label: '净盈亏', text: a.netPnl.toFixed(2), cls: a.netPnl >= 0 ? 'up' : 'down' },
    { label: '胜率', text: (a.winRate * 100).toFixed(1) + '%', cls: '' },
    { label: '盈亏比', text: pf, cls: '' },
    { label: '交易数', text: String(n), cls: '' },
    { label: '手续费', text: a.feesPaid.toFixed(2), cls: '' },
    { label: '毛盈利', text: a.grossProfit.toFixed(2), cls: 'up' },
  ];
});

function init(el: HTMLDivElement | null): echarts.ECharts | null {
  if (!el) return null;
  const c = echarts.init(el);
  charts.push(c);
  return c;
}

function bar(el: HTMLDivElement | null, labels: string[], values: number[], colors?: (v: number) => string) {
  const c = init(el);
  if (!c) return;
  c.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 12, top: 12, bottom: 28 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 5 ? 30 : 0, fontSize: 10, color: '#6b7280' } },
    yAxis: { type: 'value', axisLabel: { color: '#6b7280', fontSize: 10 } },
    series: [{ type: 'bar', data: values, itemStyle: colors ? { color: (p: any) => colors(p.value) } : { color: '#06b6d4' }, barMaxWidth: 40 }],
  });
}

function line(el: HTMLDivElement | null, labels: string[], values: number[], fill = false) {
  const c = init(el);
  if (!c) return;
  c.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 12, top: 12, bottom: 28 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#6b7280' } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#6b7280', fontSize: 10 } },
    series: [{ type: 'line', data: values, showSymbol: false, lineStyle: { color: '#06b6d4', width: 1.5 }, areaStyle: fill ? { color: 'rgba(6,182,212,0.08)' } : undefined }],
  });
}

async function load() {
  await loadAccounts();
  const params = new URLSearchParams();
  if (accountStore.selectedId) params.set('accountId', accountStore.selectedId);
  if (range.value?.[0]) params.set('from', String(range.value[0]));
  if (range.value?.[1]) params.set('to', String(range.value[1]));
  if (market.value) params.set('market', market.value);
  const qs = params.toString();
  const [a, t] = await Promise.all([
    api.get<TradeAgg>('/pnl' + (qs ? '?' + qs : '')),
    api.get<{ trades: Fill[] }>('/trades?' + (qs ? qs + '&' : '') + 'limit=1000'),
  ]);
  agg.value = a;
  fills.value = t.trades;
  render();
}

function render() {
  const fs = fills.value;
  const bySym: Record<string, number> = {};
  for (const x of fs) bySym[x.symbol] = (bySym[x.symbol] ?? 0) + (x.realizedPnl ?? 0);
  const symKeys = Object.keys(bySym).sort((a, b) => (bySym[b] ?? 0) - (bySym[a] ?? 0));
  bar(symChart.value, symKeys, symKeys.map((k) => bySym[k] ?? 0), (v) => (v >= 0 ? '#10b981' : '#ef4444'));

  const byMkt: Record<string, number> = {};
  for (const x of fs) {
    const k = MARKET_LABELS[x.market] ?? x.market;
    byMkt[k] = (byMkt[k] ?? 0) + (x.realizedPnl ?? 0);
  }
  const mktKeys = Object.keys(byMkt);
  bar(mktChart.value, mktKeys, mktKeys.map((k) => byMkt[k] ?? 0), (v) => (v >= 0 ? '#10b981' : '#ef4444'));

  const byDir: Record<string, number> = { 做多: 0, 做空: 0 };
  for (const x of fs) byDir[x.side === 'BUY' ? '做多' : '做空'] += x.realizedPnl ?? 0;
  bar(dirChart.value, ['做多', '做空'], [byDir['做多'] ?? 0, byDir['做空'] ?? 0], (v) => (v >= 0 ? '#10b981' : '#ef4444'));

  const byDay: Record<string, number> = {};
  for (const x of fs) {
    const k = new Date(x.tradedAt).toLocaleDateString('zh-CN');
    byDay[k] = (byDay[k] ?? 0) + (x.realizedPnl ?? 0);
  }
  const dayKeys = Object.keys(byDay).sort();
  bar(dayChart.value, dayKeys, dayKeys.map((k) => byDay[k] ?? 0), (v) => (v >= 0 ? '#10b981' : '#ef4444'));

  const sorted = fs.slice().sort((a, b) => a.tradedAt - b.tradedAt);
  let cum = 0;
  const cumPts = sorted.map((x) => { cum += x.realizedPnl ?? 0; return { t: x.tradedAt, v: cum }; });
  line(cumChart.value, cumPts.map((p) => new Date(p.t).toLocaleDateString('zh-CN')), cumPts.map((p) => p.v), true);
}

function onAccountChange(id: string) {
  selectAccount(id);
  load();
}

watch(() => accountStore.selectedId, () => load());

onMounted(async () => {
  await load();
  window.addEventListener('resize', () => charts.forEach((c) => c.resize()));
});
</script>

<style scoped>
.stats { display: flex; flex-direction: column; gap: 12px; }
.stats-head { display: flex; align-items: baseline; gap: 12px; }
.stats-head h2 { margin: 0; font-size: 18px; color: var(--aw-text-title); }
.stats-head .dim { font-size: 12px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.label { font-size: 13px; color: var(--aw-text-dim); }
.filter-bar { padding: 12px 16px; }
.metric-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
@media (max-width: 1200px) { .metric-grid { grid-template-columns: repeat(3, 1fr); } }
.metric-card { text-align: center; padding: 14px 12px; }
.mlabel { color: var(--aw-text-dim); font-size: 12px; }
.mvalue { font-size: 20px; font-weight: 700; margin-top: 4px; }
.chart-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.chart-grid .aw-card { padding: 14px 16px; }
.chart-grid .aw-card.wide { grid-column: span 2; }
.ch-title { font-size: 13px; color: var(--aw-text-title); font-weight: 600; margin-bottom: 8px; }
.chart { height: 240px; }
</style>
