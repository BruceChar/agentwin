<template>
  <div>
    <el-card shadow="never" class="mb">
      <div class="row">
        <span class="label">时间范围：</span>
        <el-date-picker v-model="range" type="daterange" value-format="x" :clearable="false" @change="load" />
        <span class="label">市场：</span>
        <el-select v-model="market" style="width: 140px" clearable placeholder="全部" @change="load">
          <el-option v-for="m in ['现货','U本位合约','币本位合约','全仓杠杆','逐仓杠杆']" :key="m" :value="m" :label="m" />
        </el-select>
        <el-button size="small" @click="load">刷新</el-button>
      </div>
    </el-card>
    <el-row :gutter="12">
      <el-col :span="8"><el-card shadow="never"><template #header>R 倍数分布</template><div ref="rChart" class="chart"></div></el-card></el-col>
      <el-col :span="8"><el-card shadow="never"><template #header>按品种 / 方向 / 策略盈亏</template>
        <el-radio-group v-model="groupBy" size="small" class="mb"><el-radio-button value="market">市场</el-radio-button><el-radio-button value="strategy">策略</el-radio-button><el-radio-button value="direction">方向</el-radio-button></el-radio-group>
        <div ref="gChart" class="chart"></div>
      </el-card></el-col>
      <el-col :span="8"><el-card shadow="never"><template #header>计划 vs 实际执行</template><div ref="pChart" class="chart"></div></el-card></el-col>
    </el-row>
    <el-row :gutter="12" class="mt">
      <el-col :span="12"><el-card shadow="never"><template #header>规则符合度趋势</template><div ref="dChart" class="chart"></div></el-card></el-col>
      <el-col :span="12"><el-card shadow="never"><template #header>净收益累计（R）</template><div ref="cChart" class="chart"></div></el-card></el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import { api } from '../api.ts';

const range = ref<[number, number]>([Date.now() - 30 * 86400000, Date.now()]);
const market = ref('');
const groupBy = ref('market');
const records = ref<any[]>([]);
const rChart = ref<HTMLDivElement | null>(null);
const gChart = ref<HTMLDivElement | null>(null);
const pChart = ref<HTMLDivElement | null>(null);
const dChart = ref<HTMLDivElement | null>(null);
const cChart = ref<HTMLDivElement | null>(null);
const charts: echarts.ECharts[] = [];

function init(el: HTMLDivElement | null): echarts.ECharts | null {
  if (!el) return null;
  const c = echarts.init(el);
  charts.push(c);
  return c;
}

async function load() {
  const params = new URLSearchParams();
  if (range.value?.[0]) params.set('from', String(range.value[0]));
  if (range.value?.[1]) params.set('to', String(range.value[1]));
  if (market.value) params.set('market', market.value);
  const res = await api.get<{ records: any[] }>('/journal/trades?' + params.toString());
  records.value = res.records;
  render();
}

function render() {
  const r = records.value;
  // R 分布直方图
  const rs = r.map((x) => x.rMultiple).filter((v): v is number => v !== undefined && Number.isFinite(v));
  const max = Math.max(2, ...rs.map((v) => Math.abs(v)));
  const bins = new Array(9).fill(0);
  for (const v of rs) {
    const idx = Math.min(8, Math.max(0, Math.floor((v + max) / (2 * max / 9))));
    bins[idx]++;
  }
  const labels = Array.from({ length: 9 }, (_, i) => (-max + (2 * max / 9) * (i + 0.5)).toFixed(1) + 'R');
  let c = init(rChart.value);
  c?.setOption({ grid: { left: 30, right: 10, top: 10, bottom: 24 }, xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 9 } }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: bins, itemStyle: { color: '#4da3ff' } }] });

  // 分组盈亏
  const groups: Record<string, { sum: number; count: number }> = {};
  for (const x of r) {
    const key = groupBy.value === 'strategy' ? (x.strategyVersion || '未标注') : groupBy.value === 'direction' ? (x.direction === 'LONG' ? '做多' : '做空') : (x.market || '未标注');
    const g = groups[key] ?? { sum: 0, count: 0 };
    g.sum += x.netPnl ?? 0;
    g.count++;
    groups[key] = g;
  }
  const keys = Object.keys(groups);
  c = init(gChart.value);
  c?.setOption({ grid: { left: 60, right: 10, top: 10, bottom: 24 }, xAxis: { type: 'category', data: keys }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: keys.map((k) => groups[k]!.sum), itemStyle: { color: (p: any) => (p.value >= 0 ? '#f0a35e' : '#4fbf9f') } }] });

  // 计划 vs 实际
  const pd: Record<string, number> = { complete: 0, partial: 0, none: 0 };
  for (const x of r) {
    const key = String(x.planExecution) as 'complete' | 'partial' | 'none';
    pd[key] = (pd[key] ?? 0) + 1;
  }
  c = init(pChart.value);
  c?.setOption({ tooltip: { trigger: 'item' }, series: [{ type: 'pie', radius: ['40%', '68%'], data: (['完全执行', '部分执行', '未执行'] as const).map((name, i) => ({ name, value: pd[['complete', 'partial', 'none'][i]!] ?? 0 })).filter((d) => d.value > 0) }] });

  // 符合度趋势
  const disc = r.filter((x) => x.disciplineScore !== undefined).map((x) => ({ t: x.closeTime ?? x.createdAt, v: x.disciplineScore })).sort((a, b) => a.t - b.t);
  c = init(dChart.value);
  c?.setOption({ grid: { left: 30, right: 10, top: 10, bottom: 24 }, xAxis: { type: 'category', data: disc.map((d) => new Date(d.t).toLocaleDateString('zh-CN')) }, yAxis: { type: 'value', min: 0, max: 10 }, series: [{ type: 'line', data: disc.map((d) => d.v), lineStyle: { color: '#4da3ff' }, symbol: 'circle', symbolSize: 4 }] });

  // 累计 R
  const sorted = r.slice().sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0));
  let cum = 0;
  const cumData = sorted.map((x) => { cum += x.rMultiple ?? 0; return { t: x.closeTime ?? x.createdAt, v: cum }; });
  c = init(cChart.value);
  c?.setOption({ grid: { left: 40, right: 10, top: 10, bottom: 24 }, xAxis: { type: 'category', data: cumData.map((d) => new Date(d.t).toLocaleDateString('zh-CN')) }, yAxis: { type: 'value' }, series: [{ type: 'line', data: cumData.map((d) => d.v), lineStyle: { color: '#4da3ff' }, areaStyle: { color: 'rgba(77,163,255,0.08)' } }] });
}

onMounted(async () => {
  await load();
  window.addEventListener('resize', () => charts.forEach((c) => c.resize()));
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.mt { margin-top: 12px; }
.row { display: flex; align-items: center; gap: 10px; }
.label { font-size: 13px; color: var(--text-dim); }
.chart { height: 260px; }
</style>
