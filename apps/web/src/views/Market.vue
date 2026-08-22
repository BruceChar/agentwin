<template>
  <el-card shadow="never" class="tv-card">
    <!-- TradingView 风格顶栏：品种 + 周期标签页 -->
    <div class="tv-top">
      <div class="tv-symbol">
        <el-select :model-value="symbol" size="small" style="width: 118px" @change="onSymbol">
          <el-option v-for="s in symbols" :key="s" :value="s" :label="s" />
        </el-select>
        <el-select :model-value="market" size="small" style="width: 118px" @change="onMarket">
          <el-option v-for="m in marketOptions" :key="m.value" :value="m.value" :label="m.label" />
        </el-select>
        <span v-if="lastPrice != null" class="tv-px mono" :class="lastUp ? 'up' : 'down'">{{ fmtPrice(lastPrice) }}</span>
        <span class="tv-chg mono" :class="lastUp ? 'up' : 'down'">{{ lastChangePct }}</span>
      </div>
      <div class="tv-intervals">
        <button
          v-for="i in intervalOptions"
          :key="i.value"
          class="tv-tab"
          :class="{ active: interval === i.value }"
          @click="changeInterval(i.value)"
        >{{ i.short }}</button>
      </div>
      <div class="tv-actions">
        <el-input-number v-model="limit" :min="50" :max="1000" :step="50" size="small" style="width: 96px" @change="load()" />
        <span class="dim">自动</span>
        <el-switch v-model="autoRefresh" size="small" />
        <el-button size="small" @click="load()">刷新</el-button>
      </div>
    </div>

    <!-- 指标栏 -->
    <div class="ind-bar">
      <span class="dim">均线（MA 实线 · EMA 虚线）</span>
      <span v-for="(p, i) in periods" :key="p.id" class="chip">
        <i class="dot" :style="{ background: periodColor(i) }" />
        <el-input :model-value="fmtPeriod(p.value)" size="small" style="width: 68px" title="周期（支持小数，如 62.8）" @change="(v: string | number) => setPeriod(p, v)" />
        <el-checkbox v-model="p.ma" size="small" @change="render">MA</el-checkbox>
        <el-checkbox v-model="p.ema" size="small" @change="render">EMA</el-checkbox>
        <button v-if="periods.length > 1" class="del" title="删除该周期" @click="removePeriod(i)">×</button>
      </span>
      <el-button size="small" text type="primary" @click="addPeriod">+ 周期</el-button>
      <span class="dim" style="margin-left: 12px">指标</span>
      <el-checkbox v-model="volOn" size="small" @change="render">成交量</el-checkbox>
      <el-checkbox v-model="macdOn" size="small" @change="render">MACD</el-checkbox>
      <el-checkbox v-model="rsiOn" size="small" @change="render">RSI</el-checkbox>
      <el-checkbox v-model="vpvrOn" size="small" @change="render">VPVR</el-checkbox>
    </div>

    <!-- 图表 + 图例浮层 -->
    <div class="chart-wrap">
      <div ref="chartEl" v-loading="loading" class="chart"></div>
      <div class="legend">
        <span v-for="(it, idx) in legendItems" :key="idx" class="lg" :style="{ color: it.color }">{{ it.name }}<b>{{ it.value }}</b></span>
      </div>
    </div>

    <!-- TradingView 风格状态栏：最新 K 线 OHLC -->
    <div class="tv-status mono">
      <span class="dim">时间</span><span>{{ status.time }}</span>
      <span class="dim">开</span><span>{{ status.open }}</span>
      <span class="dim">高</span><span class="up">{{ status.high }}</span>
      <span class="dim">低</span><span class="down">{{ status.low }}</span>
      <span class="dim">收</span><span :class="status.cls">{{ status.close }}</span>
      <span class="dim">涨跌</span><span :class="status.cls">{{ status.change }} · {{ status.changePct }}</span>
      <span class="dim">量</span><span>{{ status.volume }}</span>
    </div>
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
  { value: '1m', label: '1分钟', short: '1m' }, { value: '5m', label: '5分钟', short: '5m' }, { value: '15m', label: '15分钟', short: '15m' },
  { value: '30m', label: '30分钟', short: '30m' }, { value: '1h', label: '1小时', short: '1h' }, { value: '2h', label: '2小时', short: '2h' },
  { value: '4h', label: '4小时', short: '4h' }, { value: '8h', label: '8小时', short: '8h' }, { value: '12h', label: '12小时', short: '12h' },
  { value: '1d', label: '1天', short: '1D' }, { value: '1w', label: '1周', short: '1W' }, { value: '2w', label: '2周', short: '2W' },
  { value: '1M', label: '1月', short: '1M' },
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
const UP = '#67c23a';
const DOWN = '#f56c6c';
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
const lastChangePct = ref('');
const chartEl = ref<HTMLDivElement | null>(null);

const intervalLabel = computed(() => intervalOptions.find((i) => i.value === interval.value)?.label ?? interval.value);

// TradingView 风格：图例浮层 + 状态栏
interface LegendItem { name: string; color: string; value: string }
const legendItems = ref<LegendItem[]>([]);
const status = ref<{ time: string; open: string; high: string; low: string; close: string; change: string; changePct: string; cls: string; volume: string }>({
  time: '-', open: '-', high: '-', low: '-', close: '-', change: '-', changePct: '-', cls: '', volume: '-',
});

function onSymbol(v: string) { symbol.value = v; load(true); }
function onMarket(v: string) { market.value = v; load(true); }
function changeInterval(v: string) {
  if (interval.value === v) return;
  interval.value = v;
  load(true);
}

/** 图例：最后一个可见 K 线的指标值（TradingView 左上角风格） */
function updateLegend(lastIdx: number, maLines: { name: string; color: string; vals: (number | null)[] }[], macdRes: { dif: (number | null)[]; dea: (number | null)[] }, rsiVals: (number | null)[]) {
  const items: LegendItem[] = [];
  for (const m of maLines) {
    const v = m.vals[lastIdx];
    if (v != null) items.push({ name: m.name, color: m.color, value: fmtPrice(v) });
  }
  if (macdOn.value) {
    const d = macdRes.dif[lastIdx], e = macdRes.dea[lastIdx];
    if (d != null) items.push({ name: 'DIF', color: '#f0a35e', value: fmtPrice(d) });
    if (e != null) items.push({ name: 'DEA', color: '#4da3ff', value: fmtPrice(e) });
  }
  if (rsiOn.value) {
    const r = rsiVals[lastIdx];
    if (r != null) items.push({ name: 'RSI', color: '#4da3ff', value: Number(r).toFixed(2) });
  }
  legendItems.value = items;
}

/** 状态栏：最新可见 K 线 OHLC + 涨跌幅 */
function updateStatus(c: CandleView | undefined, prev: CandleView | undefined) {
  if (!c) {
    status.value = { time: '-', open: '-', high: '-', low: '-', close: '-', change: '-', changePct: '-', cls: '', volume: '-' };
    return;
  }
  const up = c.close >= (prev?.close ?? c.open);
  const chg = c.close - (prev?.close ?? c.open);
  const pct = (prev?.close ?? c.open) > 0 ? (chg / (prev?.close ?? c.open)) * 100 : 0;
  status.value = {
    time: new Date(c.openTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    open: fmtPrice(c.open),
    high: fmtPrice(c.high),
    low: fmtPrice(c.low),
    close: fmtPrice(c.close),
    change: (chg >= 0 ? '+' : '') + fmtPrice(chg),
    changePct: (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%',
    cls: up ? 'up' : 'down',
    volume: fmtVol(c.volume),
  };
}

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
      lastChangePct.value = prev > 0 ? ((last.close - prev) / prev) * 100 >= 0 ? '+' + (((last.close - prev) / prev) * 100).toFixed(2) + '%' : (((last.close - prev) / prev) * 100).toFixed(2) + '%' : '';
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

  // 价格轴范围：可见 K 线高低 + 6% 边距（K 线不贴上下边框），VPVR 轴同步
  let yLo = Infinity, yHi = -Infinity;
  for (const c of visible) {
    if (c.low < yLo) yLo = c.low;
    if (c.high > yHi) yHi = c.high;
  }
  const yPad = (yHi - yLo) * 0.06;
  const priceMin = yLo - yPad;
  const priceMax = yHi + yPad;

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
  gridTop.push({ top: 4, height: mainH }); // 0: 价格区（K线+均线）
  gridTop.push({ top: 4, height: mainH }); // 1: VPVR 右侧竖版条（与价格区同高，间隔分开）
  mainGridH = mainH;
  let top = 4 + mainH + GRID_GAP;
  for (let i = 0; i < panels.length; i++) {
    gridTop.push({ top, height: PANEL_H });
    gridIdx[panels[i]!.key] = i + 2; // 面板从索引 2 开始
    top += PANEL_H + GRID_GAP;
  }

  const catAxisIdx = [0, ...panels.map((_, i) => i + 2)];

  // 坐标轴
  const xAxes: Record<string, unknown>[] = [];
  const yAxes: Record<string, unknown>[] = [];
  const mkCatAxis = (gi: number, showLabel: boolean) => ({
    type: 'category',
    gridIndex: gi,
    data: times,
    boundaryGap: ['1', '1'], // 首尾各留一个带宽，K 线不贴左右边框
    axisLine: { lineStyle: { color: 'rgba(128,140,155,0.25)' } },
    axisTick: { show: false },
    axisLabel: showLabel ? { color: '#8a94a3', hideOverlap: true, fontFamily: 'SF Mono, JetBrains Mono, Consolas, monospace', fontSize: 10 } : { show: false },
    splitLine: { show: false },
  });
  xAxes.push(mkCatAxis(0, true));
  yAxes.push({
    gridIndex: 0,
    min: priceMin,
    max: priceMax,
    scale: true,
    axisLine: { show: false },
    axisLabel: { color: '#8a94a3', formatter: fmtPrice, fontFamily: 'SF Mono, JetBrains Mono, Consolas, monospace', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(128,140,155,0.08)' } },
    axisPointer: { label: { formatter: (p: { value: number }) => fmtPrice(p.value) } },
  });
  // VPVR 专用轴：右侧竖版条，与价格轴同范围（保证与 K 线价格严格对齐）
  xAxes.push({
    id: 'vpvrAxis',
    type: 'value',
    gridIndex: 1,
    min: 0,
    max: 1,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { show: false },
    axisPointer: { show: false },
  });
  yAxes.push({
    gridIndex: 1,
    min: priceMin,
    max: priceMax,
    scale: true,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { show: false },
    axisPointer: { show: false },
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
    itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN, borderWidth: 1 },
    valueFormatter: (v: unknown) =>
      Array.isArray(v)
        ? '开 ' + fmtPrice(v[0] as number) + ' 收 ' + fmtPrice(v[1] as number) + ' 低 ' + fmtPrice(v[2] as number) + ' 高 ' + fmtPrice(v[3] as number)
        : fmtPrice(v as number),
  });

  // MA 实线 / EMA 虚线（同色系，周期可编辑）
  const maLegend: { name: string; color: string; vals: (number | null)[] }[] = [];
  for (let i = 0; i < periods.value.length; i++) {
    const row = periods.value[i]!;
    const color = periodColor(i);
    const label = fmtPeriod(row.value);
    if (row.ma) {
      maLegend.push({ name: 'MA(' + label + ')', color, vals: sma(closes, row.value) });
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
      maLegend.push({ name: 'EMA(' + label + ')', color, vals: ema(closes, row.value) });
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

  // VPVR：右侧独立竖版条 —— 用 custom 系列按像素精确绘制，
  // 柱锚定 VPVR 网格右边缘、与价格轴严格对齐（同范围 y 轴）、随可见区间重算；
  // VPVR 网格与 K 线网格之间留出间隔（见 grids 配置）
  if (vpvrOn.value && profile.length) {
    series.push({
      id: 'vpvr',
      name: 'VPVR',
      type: 'custom',
      xAxisIndex: 1,
      yAxisIndex: 1,
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
        const w = Math.max(1, frac * params.coordSys.width * 0.85);
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
      data: cs.map((c) => ({ value: c.volume, itemStyle: { color: c.close >= c.open ? 'rgba(103,194,58,0.5)' : 'rgba(245,108,108,0.5)' } })),
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
      data: macdRes.hist.map((h) => (h == null ? null : { value: h, itemStyle: { color: h >= 0 ? 'rgba(103,194,58,0.55)' : 'rgba(245,108,108,0.55)' } })),
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

  // 网格：0=价格区（右侧留出 VPVR 间隔），1=VPVR 右侧独立竖版条（与 K 线间隔约 40px），2+=副图面板
  const grids = gridTop.map((g, i) =>
    i === 0
      ? { left: 64, right: 215, top: g.top, height: g.height }
      : i === 1
        ? { right: 40, width: 130, top: g.top, height: g.height }
        : { left: 64, right: 16, top: g.top, height: g.height },
  );

  chart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'cross', lineStyle: { color: '#4da3ff', type: 'dashed', width: 1 }, crossStyle: { color: '#4da3ff', type: 'dashed' } },
        backgroundColor: 'rgba(17,22,29,0.92)',
        borderColor: 'rgba(128,140,155,0.3)',
        textStyle: { color: '#d7dde4', fontSize: 11, fontFamily: 'SF Mono, JetBrains Mono, Consolas, monospace' },
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

  // TradingView 风格：图例（左上角指标现值）+ 状态栏（最新可见 K 线 OHLC）
  const lastIdx = Math.max(0, Math.min(to - 1, cs.length - 1));
  updateLegend(lastIdx, maLegend, macdRes, rsiRes);
  updateStatus(to - 1 < cs.length ? cs[to - 1] : undefined, to - 2 >= 0 ? cs[to - 2] : undefined);
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
  if (!candles.value.length) return;
  const cs = candles.value;
  const from = Math.max(0, Math.floor((cs.length * s) / 100));
  const to = Math.min(cs.length, Math.max(from + 1, Math.ceil((cs.length * e) / 100)));
  const visible = cs.slice(from, to);
  // 缩放后价格轴范围随可见 K 线重算（K 线不贴上下边框），VPVR 轴同步
  let yLo = Infinity, yHi = -Infinity;
  for (const c of visible) {
    if (c.low < yLo) yLo = c.low;
    if (c.high > yHi) yHi = c.high;
  }
  const yPad = (yHi - yLo) * 0.06;
  const priceMin = yLo - yPad;
  const priceMax = yHi + yPad;
  const opts: Record<string, unknown> = {
    yAxis: [
      { gridIndex: 0, min: priceMin, max: priceMax },
      { gridIndex: 1, min: priceMin, max: priceMax },
    ],
  };
  if (vpvrOn.value) {
    const buckets = Math.max(16, Math.min(48, Math.round(visible.length / 4)));
    const profile = volumeProfile(visible, buckets);
    const maxVol = Math.max(1e-9, profile.reduce((m, b) => (b.volume > m ? b.volume : m), 0));
    opts['series'] = [{ id: 'vpvr', data: profile.map((b) => [b.volume / maxVol, b.lo, b.hi]) }];
  }
  chart.setOption(opts);
  // 缩放后同步图例与状态栏（以最后可见 K 线为准）
  const closes = cs.map((c) => c.close);
  const macdRes = macd(closes);
  const rsiRes = rsi(closes, 14);
  const maLegend: { name: string; color: string; vals: (number | null)[] }[] = [];
  for (let i = 0; i < periods.value.length; i++) {
    const row = periods.value[i]!;
    const color = periodColor(i);
    const label = fmtPeriod(row.value);
    if (row.ma) maLegend.push({ name: 'MA(' + label + ')', color, vals: sma(closes, row.value) });
    if (row.ema) maLegend.push({ name: 'EMA(' + label + ')', color, vals: ema(closes, row.value) });
  }
  const lastIdx = Math.max(0, Math.min(to - 1, cs.length - 1));
  updateLegend(lastIdx, maLegend, macdRes, rsiRes);
  updateStatus(to - 1 < cs.length ? cs[to - 1] : undefined, to - 2 >= 0 ? cs[to - 2] : undefined);
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
.tv-card :deep(.el-card__body) { padding: 0; }
.dim { color: var(--text-dim); font-size: 12px; }
.mono { font-family: var(--mono); }
.up { color: #67c23a; }
.down { color: #f56c6c; }

/* TradingView 风格顶栏 */
.tv-top { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.tv-symbol { display: flex; align-items: center; gap: 6px; }
.tv-px { font-size: 15px; font-weight: 700; margin-left: 6px; }
.tv-chg { font-size: 11px; }
.tv-intervals { display: flex; align-items: center; gap: 2px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 5px; padding: 2px; }
.tv-tab { border: none; background: none; color: var(--text-dim); font-size: 11px; padding: 3px 7px; border-radius: 4px; cursor: pointer; font-family: var(--mono); }
.tv-tab:hover { color: var(--text); }
.tv-tab.active { background: var(--accent); color: #fff; font-weight: 600; }
.tv-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

/* 指标栏 */
.ind-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 12px; border-bottom: 1px solid var(--border); }
.ind-bar :deep(.el-checkbox) { margin-right: 0; }
.ind-bar :deep(.el-checkbox__label) { font-size: 11px; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 5px; padding: 1px 5px 1px 6px; }
.chip :deep(.el-input__wrapper) { box-shadow: none; }
.chip :deep(.el-input__inner) { font-size: 11px; }
.dot { width: 7px; height: 7px; border-radius: 2px; display: inline-block; flex: none; }
.del { border: none; background: none; color: var(--text-dim); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.del:hover { color: #f56c6c; }

/* 图表 + 图例浮层 */
.chart-wrap { position: relative; }
.chart { height: 668px; width: 100%; }
.legend { position: absolute; top: 6px; left: 70px; display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; font-family: var(--mono); pointer-events: none; z-index: 5; }
.lg b { font-weight: 600; margin-left: 3px; }

/* TradingView 风格状态栏 */
.tv-status { display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-top: 1px solid var(--border); font-size: 11px; flex-wrap: wrap; }
</style>
