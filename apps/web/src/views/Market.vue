<template>
  <el-card shadow="never">
    <template #header>
      <div class="toolbar">
        <span class="title">K 线行情</span>
        <el-select v-model="symbol" style="width: 130px" @change="load(true)">
          <el-option v-for="s in symbols" :key="s" :value="s" :label="s" />
        </el-select>
        <el-select v-model="market" style="width: 130px" @change="load(true)">
          <el-option v-for="m in marketOptions" :key="m.value" :value="m.value" :label="m.label" />
        </el-select>
        <el-select v-model="interval" style="width: 112px" @change="load(true)">
          <el-option v-for="i in intervalOptions" :key="i.value" :value="i.value" :label="i.label" />
        </el-select>
        <el-input-number v-model="limit" :min="50" :max="1000" :step="50" size="small" style="width: 128px" @change="load()" />
        <el-button size="small" @click="load()">刷新</el-button>
        <span class="dim">自动刷新</span>
        <el-switch v-model="autoRefresh" size="small" />
      </div>
    </template>

    <div class="ind-bar">
      <span class="dim">均线周期（MA 实线 · EMA 虚线，可编辑、支持小数）</span>
      <span v-for="(p, i) in periods" :key="p.id" class="chip">
        <i class="dot" :style="{ background: periodColor(i) }" />
        <el-input :model-value="fmtPeriod(p.value)" size="small" style="width: 78px" title="周期（支持小数，如 62.8）" @change="(v: string | number) => setPeriod(p, v)" />
        <el-checkbox v-model="p.ma" size="small" @change="render">MA</el-checkbox>
        <el-checkbox v-model="p.ema" size="small" @change="render">EMA</el-checkbox>
        <button v-if="periods.length > 1" class="del" title="删除该周期" @click="removePeriod(i)">×</button>
      </span>
      <el-button size="small" text type="primary" @click="addPeriod">+ 添加周期</el-button>
      <el-divider direction="vertical" />
      <span class="dim">指标</span>
      <el-checkbox v-model="volOn" size="small" @change="render">成交量</el-checkbox>
      <el-checkbox v-model="macdOn" size="small" @change="render">MACD</el-checkbox>
      <el-checkbox v-model="rsiOn" size="small" @change="render">RSI</el-checkbox>
      <el-checkbox v-model="vpvrOn" size="small" @change="render">VPVR</el-checkbox>
      <span v-if="lastPrice != null" class="px">
        最新价 <b :class="lastUp ? 'up' : 'down'">{{ fmtPrice(lastPrice) }}</b>
        <span class="dim">· {{ intervalLabel }} · {{ candles.length }} 根</span>
      </span>
    </div>

    <div ref="chartEl" v-loading="loading" class="chart"></div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api } from '../api.ts';
import {
  aggregateCandles,
  ema,
  fmtAxisTime,
  fmtPrice,
  fmtVol,
  macd,
  rsi,
  sma,
  volumeProfile,
  type CandleView,
} from '../lib/indicators.ts';

// ---------- 常量 ----------
const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const marketOptions = [
  { value: 'SPOT', label: '现货' },
  { value: 'USDT_M', label: 'U本位合约' },
];
const intervalOptions = [
  { value: '1m', label: '1分钟' }, { value: '5m', label: '5分钟' }, { value: '15m', label: '15分钟' },
  { value: '30m', label: '30分钟' }, { value: '1h', label: '1小时' }, { value: '2h', label: '2小时' },
  { value: '4h', label: '4小时' }, { value: '8h', label: '8小时' }, { value: '12h', label: '12小时' },
  { value: '1d', label: '1天' }, { value: '1w', label: '1周' }, { value: '2w', label: '2周' },
  { value: '1M', label: '1月' },
];
/** 每行周期一条色：MA 实线、EMA 虚线（同色） */
const PERIOD_COLORS = ['#e6a23c', '#409eff', '#9254de', '#14b8a6', '#ec4899', '#06b6d4', '#f59e0b', '#7c8cf8'];
interface PeriodRow { id: number; value: number; ma: boolean; ema: boolean }
const periods = ref<PeriodRow[]>([
  { id: 1, value: 20, ma: true, ema: true },
  { id: 2, value: 62.8, ma: true, ema: true },
  { id: 3, value: 144, ma: true, ema: true },
  { id: 4, value: 169, ma: true, ema: true },
]);
let periodSeq = 5;
function periodColor(i: number): string {
  return PERIOD_COLORS[i % PERIOD_COLORS.length]!;
}
function fmtPeriod(v: number): string {
  return String(Math.round(v * 100) / 100);
}
function addPeriod() {
  periods.value.push({ id: periodSeq++, value: 60, ma: true, ema: true });
  render();
}
function removePeriod(i: number) {
  periods.value.splice(i, 1);
  render();
}
function setPeriod(row: PeriodRow, raw: string | number) {
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(v) || v <= 0) return;
  row.value = Math.max(1, Math.min(999, Math.round(v * 100) / 100));
  render();
}
const UP = '#f56c6c';
const DOWN = '#67c23a';
const GRID_GAP = 14;
const PANEL_H = 86;
const SLIDER_H = 26;
const TOTAL_H = 660;

// ---------- 状态 ----------
const symbol = ref('BTCUSDT');
const market = ref('SPOT');
const interval = ref('1h');
const limit = ref(300);
const autoRefresh = ref(false);
const volOn = ref(true);
const macdOn = ref(true);
const rsiOn = ref(true);
const vpvrOn = ref(true);
const loading = ref(false);
const candles = ref<CandleView[]>([]);
const lastPrice = ref<number | null>(null);
const lastUp = ref(true);
const chartEl = ref<HTMLDivElement | null>(null);

const intervalLabel = computed(() => intervalOptions.find((i) => i.value === interval.value)?.label ?? interval.value);

// ---------- 图表实例 ----------
let chart: echarts.ECharts | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let resizeHandler: (() => void) | null = null;
let zoomStart = 0;
let zoomEnd = 100;
let mainGridH = 300;

// ---------- 数据加载 ----------
async function load(resetZoom = false) {
  if (resetZoom) {
    zoomStart = 0;
    zoomEnd = 100;
  }
  loading.value = true;
  try {
    // 币安无 2w 周期：拉 1w 数据前端两两聚合
    const iv = interval.value === '2w' ? '1w' : interval.value;
    const n = interval.value === '2w' ? Math.min(limit.value * 2, 1000) : limit.value;
    const res = await api.get<{ candles: CandleView[] }>(
      '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + iv + '&limit=' + n,
    );
    let cs = res.candles;
    if (interval.value === '2w') cs = aggregateCandles(cs, 2);
    cs = cs.slice(-limit.value);
    candles.value = cs;
    if (cs.length) {
      const last = cs[cs.length - 1]!;
      const prev = cs.length > 1 ? cs[cs.length - 2]!.close : last.open;
      lastPrice.value = last.close;
      lastUp.value = last.close >= prev;
    }
    render();
  } catch (e) {
    ElMessage.error('行情加载失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    loading.value = false;
  }
}

// ---------- 渲染 ----------
function render() {
  if (!chartEl.value) return;
  if (!chart) {
    chart = echarts.init(chartEl.value);
    chart.on('datazoom', onZoom);
    chart.on('restore', onZoom);
    chart.on('axisareaselected', onZoom);
  }
  const cs = candles.value;
  if (!cs.length) return;

  const closes = cs.map((c) => c.close);
  const times = cs.map((c) => fmtAxisTime(c.openTime, interval.value));

  // 可见范围（VPVR 只统计可见 K 线）
  const from = Math.max(0, Math.floor((cs.length * zoomStart) / 100));
  const to = Math.min(cs.length, Math.max(from + 1, Math.ceil((cs.length * zoomEnd) / 100)));
  const visible = cs.slice(from, to);

  // 指标
  const macdRes = macd(closes);
  const rsiRes = rsi(closes, 14);
  const volMa = sma(cs.map((c) => c.volume), 5);
  const buckets = Math.max(16, Math.min(48, Math.round(visible.length / 4)));
  const profile = volumeProfile(visible, buckets);
  const maxVol = Math.max(1e-9, profile.reduce((m, b) => (b.volume > m ? b.volume : m), 0));

  // 面板布局（成交量 / MACD / RSI 可开关）
  const panels: { key: 'vol' | 'macd' | 'rsi' }[] = [];
  if (volOn.value) panels.push({ key: 'vol' });
  if (macdOn.value) panels.push({ key: 'macd' });
  if (rsiOn.value) panels.push({ key: 'rsi' });

  const gridTop: { top: number; height: number }[] = [];
  const gridIdx: Record<string, number> = {};
  const mainH = TOTAL_H - 8 - SLIDER_H - panels.length * (PANEL_H + GRID_GAP);
  gridTop.push({ top: 4, height: mainH });
  mainGridH = mainH;
  let top = 4 + mainH + GRID_GAP;
  for (let i = 0; i < panels.length; i++) {
    gridTop.push({ top, height: PANEL_H });
    gridIdx[panels[i]!.key] = i + 1;
    top += PANEL_H + GRID_GAP;
  }

  const catAxisIdx = [0, ...panels.map((_, i) => i + 1)];

  // 坐标轴
  const xAxes: Record<string, unknown>[] = [];
  const yAxes: Record<string, unknown>[] = [];
  const mkCatAxis = (gi: number, showLabel: boolean) => ({
    type: 'category',
    gridIndex: gi,
    data: times,
    boundaryGap: true,
    axisLine: { lineStyle: { color: 'rgba(128,140,155,0.25)' } },
    axisTick: { show: false },
    axisLabel: showLabel ? { color: '#8a94a3', hideOverlap: true } : { show: false },
    splitLine: { show: false },
  });
  xAxes.push(mkCatAxis(0, true));
  yAxes.push({
    gridIndex: 0,
    scale: true,
    axisLine: { show: false },
    axisLabel: { color: '#8a94a3', formatter: fmtPrice },
    splitLine: { lineStyle: { color: 'rgba(128,140,155,0.10)' } },
    axisPointer: { label: { formatter: (p: { value: number }) => fmtPrice(p.value) } },
  });
  for (const p of panels) {
    const gi = gridIdx[p.key]!;
    xAxes.push(mkCatAxis(gi, false));
    // 注意：yAxis 必须显式指定 gridIndex（默认 0 会导致跨 grid 报错）
    if (p.key === 'vol') {
      yAxes.push({ gridIndex: gi, scale: true, axisLine: { show: false }, axisLabel: { color: '#8a94a3', formatter: fmtVol }, splitLine: { show: false } });
    } else if (p.key === 'macd') {
      yAxes.push({ gridIndex: gi, scale: true, axisLine: { show: false }, axisLabel: { color: '#8a94a3', formatter: (v: number) => fmtPrice(v) }, splitLine: { show: false } });
    } else {
      yAxes.push({
        gridIndex: gi,
        min: 0, max: 100, interval: 25,
        axisLine: { show: false },
        axisLabel: { color: '#8a94a3' },
        splitLine: { lineStyle: { color: 'rgba(128,140,155,0.08)' } },
      });
    }
  }
  // 序列
  const series: Record<string, unknown>[] = [];

  series.push({
    name: 'K线',
    type: 'candlestick',
    xAxisIndex: 0,
    yAxisIndex: 0,
    data: cs.map((c) => [c.open, c.close, c.low, c.high]),
    itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
    valueFormatter: (v: unknown) =>
      Array.isArray(v)
        ? '开 ' + fmtPrice(v[0] as number) + ' 收 ' + fmtPrice(v[1] as number) + ' 低 ' + fmtPrice(v[2] as number) + ' 高 ' + fmtPrice(v[3] as number)
        : fmtPrice(v as number),
  });

  // MA 实线 / EMA 虚线（同色系，周期可编辑）
  for (let i = 0; i < periods.value.length; i++) {
    const row = periods.value[i]!;
    const color = periodColor(i);
    const label = fmtPeriod(row.value);
    if (row.ma) {
      series.push({
        name: 'MA(' + label + ')',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: sma(closes, row.value),
        symbol: 'none',
        connectNulls: false,
        z: 2,
        lineStyle: { width: 1.2, color },
        emphasis: { disabled: true },
        valueFormatter: (v: unknown) => fmtPrice(v as number),
      });
    }
    if (row.ema) {
      series.push({
        name: 'EMA(' + label + ')',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ema(closes, row.value),
        symbol: 'none',
        connectNulls: false,
        z: 2,
        lineStyle: { width: 1.2, color, type: 'dashed' },
        emphasis: { disabled: true },
        valueFormatter: (v: unknown) => fmtPrice(v as number),
      });
    }
  }

  // VPVR：右侧竖版量分布 —— 用 custom 系列按像素精确绘制，
  // 柱锚定主图右边缘、与价格轴严格对齐、随可见区间重算
  if (vpvrOn.value && profile.length) {
    series.push({
      id: 'vpvr',
      name: 'VPVR',
      type: 'custom',
      xAxisIndex: 0,
      yAxisIndex: 0,
      clip: true,
      silent: true,
      tooltip: { show: false },
      z: 1,
      data: profile.map((b) => [b.volume / maxVol, b.lo, b.hi]),
      renderItem: (
        params: { coordSys: { x: number; y: number; width: number; height: number }; dataIndex: number },
        api: { value: (dim: number) => number; coord: (v: number[]) => number[] },
      ) => {
        // api.value(dim)：custom 系列按维度取值（默认只返回第 0 维）
        const frac = api.value(0);
        const lo = api.value(1);
        const hi = api.value(2);
        const right = params.coordSys.x + params.coordSys.width;
        const yHi = api.coord([0, hi])[1];
        const yLo = api.coord([0, lo])[1];
        const yTop = Math.min(yHi, yLo);
        const h = Math.max(1, Math.abs(yHi - yLo));
        const w = Math.max(0.5, frac * params.coordSys.width * 0.3);
        return {
          type: 'rect',
          shape: { x: right - w, y: yTop, width: w, height: h },
          style: { fill: 'rgba(77,163,255,0.45)' },
        };
      },
    });
  }

  if (gridIdx.vol !== undefined) {
    const gi = gridIdx.vol;
    series.push({
      name: '成交量',
      type: 'bar',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: cs.map((c) => ({ value: c.volume, itemStyle: { color: c.close >= c.open ? 'rgba(245,108,108,0.5)' : 'rgba(103,194,58,0.5)' } })),
      barMaxWidth: 8,
      valueFormatter: (v: unknown) => fmtVol(v as number),
    });
    series.push({
      name: 'VOL MA5',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: volMa,
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1, color: '#409eff' },
      emphasis: { disabled: true },
      valueFormatter: (v: unknown) => fmtVol(v as number),
    });
  }

  if (gridIdx.macd !== undefined) {
    const gi = gridIdx.macd;
    series.push({
      name: 'MACD',
      type: 'bar',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: macdRes.hist.map((h) => (h == null ? null : { value: h, itemStyle: { color: h >= 0 ? 'rgba(245,108,108,0.55)' : 'rgba(103,194,58,0.55)' } })),
      barMaxWidth: 6,
      valueFormatter: (v: unknown) => fmtPrice(v as number),
    });
    series.push({
      name: 'DIF',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: macdRes.dif,
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1, color: '#f0a35e' },
      emphasis: { disabled: true },
      valueFormatter: (v: unknown) => fmtPrice(v as number),
    });
    series.push({
      name: 'DEA',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: macdRes.dea,
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1, color: '#4da3ff' },
      emphasis: { disabled: true },
      valueFormatter: (v: unknown) => fmtPrice(v as number),
    });
  }

  if (gridIdx.rsi !== undefined) {
    const gi = gridIdx.rsi;
    series.push({
      name: 'RSI14',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: rsiRes,
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1.2, color: '#4da3ff' },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: true, formatter: '{b}', color: '#8a94a3', fontSize: 10, position: 'insideEndTop' },
        lineStyle: { color: 'rgba(128,140,155,0.4)', type: 'dashed', width: 1 },
        data: [{ yAxis: 70, name: '70' }, { yAxis: 50, name: '50' }, { yAxis: 30, name: '30' }],
      },
      valueFormatter: (v: unknown) => (v == null ? '-' : Number(v).toFixed(2)),
    });
  }

  const grids = gridTop.map((g, i) => ({ left: 64, right: i === 0 ? 44 : 14, top: g.top, height: g.height }));

  chart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(17,22,29,0.92)',
        borderColor: 'rgba(128,140,155,0.3)',
        textStyle: { color: '#d7dde4', fontSize: 12 },
      },
      axisPointer: { link: [{ xAxisIndex: catAxisIdx }] },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      dataZoom: [
        { type: 'inside', xAxisIndex: catAxisIdx, start: zoomStart, end: zoomEnd },
        {
          type: 'slider',
          xAxisIndex: catAxisIdx,
          bottom: 4,
          height: 18,
          start: zoomStart,
          end: zoomEnd,
          borderColor: 'rgba(128,140,155,0.25)',
          backgroundColor: 'rgba(128,140,155,0.08)',
          fillerColor: 'rgba(77,163,255,0.18)',
          handleStyle: { color: '#4da3ff' },
          textStyle: { color: '#8a94a3', fontSize: 10 },
        },
      ],
      series,
    },
    true,
  );
}

// ---------- 缩放：仅重算 VPVR（可见区间） ----------
function onZoom() {
  if (!chart) return;
  const dz = (chart.getOption() as { dataZoom?: unknown }).dataZoom;
  const arr = (Array.isArray(dz) ? dz : dz ? [dz] : []) as Array<{ start?: number; end?: number }>;
  const s = arr[0]?.start;
  const e = arr[0]?.end;
  if (s == null || e == null) return;
  zoomStart = s;
  zoomEnd = e;
  if (!vpvrOn.value || !candles.value.length) return;
  const cs = candles.value;
  const from = Math.max(0, Math.floor((cs.length * s) / 100));
  const to = Math.min(cs.length, Math.max(from + 1, Math.ceil((cs.length * e) / 100)));
  const visible = cs.slice(from, to);
  const buckets = Math.max(16, Math.min(48, Math.round(visible.length / 4)));
  const profile = volumeProfile(visible, buckets);
  const maxVol = Math.max(1e-9, profile.reduce((m, b) => (b.volume > m ? b.volume : m), 0));
  chart.setOption({
    series: [{ id: 'vpvr', data: profile.map((b) => [b.volume / maxVol, b.lo, b.hi]) }],
  });
}

// ---------- 生命周期 ----------
watch(autoRefresh, (on) => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (on) timer = setInterval(() => load(), 30_000);
});

onMounted(() => {
  resizeHandler = () => chart?.resize();
  window.addEventListener('resize', resizeHandler);
  load();
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.chart { height: 668px; width: 100%; }
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.title { font-weight: 600; margin-right: 4px; }
.dim { color: var(--text-dim); font-size: 12px; }
.ind-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 2px 2px 10px; }
.ind-bar :deep(.el-checkbox) { margin-right: 0; }
.chip { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px 2px 8px; }
.chip :deep(.el-input__wrapper) { box-shadow: none; }
.dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex: none; }
.del { border: none; background: none; color: var(--text-dim); cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; }
.del:hover { color: #f56c6c; }
.px { margin-left: auto; font-size: 13px; font-family: var(--mono); }
.up { color: #f56c6c; }
.down { color: #67c23a; }
</style>
