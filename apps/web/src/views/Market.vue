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
        <el-button size="small" @click="refreshLatest">刷新</el-button>
      </div>
    </div>

    <!-- 指标栏 -->
    <div class="ind-bar">
      <span class="dim">均线（周期/颜色/线宽可编辑）</span>
      <span v-for="(p, i) in periods" :key="p.id" class="chip">
        <input :value="p.input" class="period-input" size="6" title="周期（支持小数，如 62.8）" @change="(e: Event) => setPeriod(p, (e.target as HTMLInputElement).value)" @keyup.enter="(e: Event) => (e.target as HTMLInputElement).blur()" />
        <input v-model="p.color" type="color" class="color" :title="'颜色 ' + p.color" />
        <el-input-number v-model="p.width" :min="0.5" :max="4" :step="0.1" size="small" style="width: 58px" title="线宽" @change="render" />
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

    <!-- 图表 + 各面板独立图例（悬停联动，默认显示最新值）+ 面板拖拽手柄 -->
    <div class="chart-wrap">
      <div ref="chartEl" v-loading="loading" class="chart"></div>
      <div
        v-for="(h, hi) in dragHandles"
        :key="'h' + hi"
        class="drag-handle"
        :style="{ top: h.top + 'px' }"
        :title="'拖动调整面板高度'"
        @mousedown.prevent="startDrag(hi, $event)"
      ></div>
      <div
        v-for="g in legends"
        :key="g.key"
        class="legend"
        :style="{ top: g.top + 'px', left: g.left + 'px' }"
      >
        <span v-for="(it, idx) in g.items" :key="idx" class="lg" :style="{ color: it.color }">{{ it.name }}<b>{{ it.value }}</b></span>
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
/** 每行周期：颜色与线宽可编辑（MA 实线、EMA 虚线同色） */
const PERIOD_COLORS = ['#e6a23c', '#409eff', '#9254de', '#14b8a6', '#ec4899', '#06b6d4', '#f59e0b', '#7c8cf8'];
interface PeriodRow { id: number; value: number; ma: boolean; ema: boolean; color: string; width: number; input: string }
const periods = ref<PeriodRow[]>(
  PERIOD_COLORS.slice(0, 4).map((c, i) => {
    const v = [20, 62.8, 144, 169][i]!;
    return { id: i + 1, value: v, ma: true, ema: true, color: c, width: 1.2, input: fmtPeriod(v) };
  }),
);
let periodSeq = 5;
function periodColor(i: number): string {
  return PERIOD_COLORS[i % PERIOD_COLORS.length]!;
}
function fmtPeriod(v: number): string {
  return String(Math.round(v * 100) / 100);
}
function addPeriod() {
  periods.value.push({ id: periodSeq++, value: 60, ma: true, ema: true, color: periodColor(periods.value.length), width: 1.2, input: '60' });
  render();
}
function removePeriod(i: number) {
  periods.value.splice(i, 1);
  render();
}
function setPeriod(row: PeriodRow, raw: string | number) {
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(v) || v <= 0) {
    row.input = fmtPeriod(row.value); // 非法输入还原
    return;
  }
  row.value = Math.max(1, Math.min(999, Math.round(v * 100) / 100));
  row.input = fmtPeriod(row.value);
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

// TradingView 风格：各面板独立图例（默认最新值，悬停联动）+ 状态栏
interface LegendItem { name: string; color: string; value: string }
interface LegendGroup { key: string; top: number; left: number; items: LegendItem[] }
const legends = ref<LegendGroup[]>([]);
const status = ref<{ time: string; open: string; high: string; low: string; close: string; change: string; changePct: string; cls: string; volume: string }>({
  time: '-', open: '-', high: '-', low: '-', close: '-', change: '-', changePct: '-', cls: '', volume: '-',
});

/** 面板图例布局：K线(price)/成交量(vol)/MACD(macd)/RSI(rsi) 各自左上角 */
const PANEL_LEGEND_LEFT: Record<string, number> = { price: 70, vol: 70, macd: 70, rsi: 70 };
let legendTops: Record<string, number> = { price: 6 };

// 悬停联动用：缓存最近一次渲染的指标（避免每次 mousemove 重算全量）
let hoverMa: { name: string; color: string; vals: (number | null)[] }[] = [];
let hoverMacd: { dif: (number | null)[]; dea: (number | null)[]; hist: (number | null)[] } = { dif: [], dea: [], hist: [] };
let hoverRsi: (number | null)[] = [];
let hoverVolMa: (number | null)[] = [];
let hoverLatestIdx = 0;

function updateHoverLegends(idx: number) {
  updateLegends(idx, hoverMa, hoverMacd, hoverRsi, hoverVolMa);
}
function resetHoverLegends() {
  updateLegends(hoverLatestIdx, hoverMa, hoverMacd, hoverRsi, hoverVolMa);
}


function onSymbol(v: string) { symbol.value = v; load(true); }
function onMarket(v: string) { market.value = v; load(true); }
function changeInterval(v: string) {
  if (interval.value === v) return;
  interval.value = v;
  load(true);
}

/** 计算某个索引处各面板的图例值（悬停时随鼠标联动，默认显示最新值） */
function updateLegends(idx: number, maLines: { name: string; color: string; vals: (number | null)[] }[], macdRes: { dif: (number | null)[]; dea: (number | null)[]; hist: (number | null)[] }, rsiVals: (number | null)[], volMa: (number | null)[]) {
  const groups: LegendGroup[] = [];
  // K线框：MA/EMA
  const priceItems: LegendItem[] = [];
  for (const m of maLines) {
    const v = m.vals[idx];
    if (v != null) priceItems.push({ name: m.name, color: m.color, value: fmtPrice(v) });
  }
  groups.push({ key: 'price', top: legendTops.price ?? 6, left: 70, items: priceItems });
  // 成交量
  if (volOn.value) {
    const volItems: LegendItem[] = [];
    const v = candles.value[idx]?.volume;
    if (v != null) volItems.push({ name: 'VOL', color: '#8a94a3', value: fmtVol(v) });
    const vm = volMa[idx];
    if (vm != null) volItems.push({ name: 'VOL MA5', color: '#409eff', value: fmtVol(vm) });
    groups.push({ key: 'vol', top: legendTops.vol ?? 0, left: 70, items: volItems });
  }
  // MACD
  if (macdOn.value) {
    const macdItems: LegendItem[] = [];
    const h = macdRes.hist[idx];
    if (h != null) macdItems.push({ name: 'MACD', color: h >= 0 ? '#67c23a' : '#f56c6c', value: fmtPrice(h) });
    const d = macdRes.dif[idx];
    if (d != null) macdItems.push({ name: 'DIF', color: '#f0a35e', value: fmtPrice(d) });
    const de = macdRes.dea[idx];
    if (de != null) macdItems.push({ name: 'DEA', color: '#4da3ff', value: fmtPrice(de) });
    groups.push({ key: 'macd', top: legendTops.macd ?? 0, left: 70, items: macdItems });
  }
  // RSI
  if (rsiOn.value) {
    const rsiItems: LegendItem[] = [];
    const r = rsiVals[idx];
    if (r != null) rsiItems.push({ name: 'RSI(14)', color: '#4da3ff', value: Number(r).toFixed(2) });
    groups.push({ key: 'rsi', top: legendTops.rsi ?? 0, left: 70, items: rsiItems });
  }
  legends.value = groups;
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
// 增量刷新用：最近一次渲染的面板网格索引（series 按 id 合并更新）
let lastGridIdx: Record<string, number> = {};

// ---------- 自适应高度 + 面板高度（可拖拽） ----------
const chartH = ref(660);
const panelH = reactive<{ vol: number; macd: number; rsi: number }>({ vol: 86, macd: 86, rsi: 86 });
const dragHandles = ref<{ top: number }[]>([]);

/** 右侧留空填充量：用于自由往右拖拽（最新值拖到中间、右边留空） */
function rightPadFor(len: number): number {
  return Math.max(20, Math.ceil(len * 0.6));
}

/** 面板布局计算（K线 + 可选副图面板，高度可调） */
function computeGridLayout(panels: { key: 'vol' | 'macd' | 'rsi' }[]) {
  const gridTop: { top: number; height: number }[] = [];
  const gridIdx: Record<string, number> = {};
  const mainH = chartH.value - 8 - panels.reduce((a, p) => a + panelH[p.key], 0) - panels.length * GRID_GAP;
  gridTop.push({ top: 4, height: mainH });
  mainGridH = mainH;
  let top = 4 + mainH + GRID_GAP;
  for (let i = 0; i < panels.length; i++) {
    gridTop.push({ top, height: panelH[panels[i]!.key] });
    gridIdx[panels[i]!.key] = i + 1;
    top += panelH[panels[i]!.key] + GRID_GAP;
  }
  return { gridTop, gridIdx, catAxisIdx: [0, ...panels.map((_, i) => i + 1)] };
}

function measureChart() {
  if (!chartEl.value) return;
  const h = chartEl.value.clientHeight;
  if (h > 100 && Math.abs(h - chartH.value) > 2) {
    chartH.value = h;
    render();
  }
}

/** 面板拖拽：手柄 i 调整第 i 个面板高度 */
function startDrag(hi: number, e: MouseEvent) {
  const keys = (['vol', 'macd', 'rsi'] as const).filter((k) => (k === 'vol' ? volOn.value : k === 'macd' ? macdOn.value : rsiOn.value));
  const key = keys[hi];
  if (!key || !chart) return;
  const startY = e.clientY;
  const startH = panelH[key];
  const onMove = (ev: MouseEvent) => {
    // 往下拖 = 手柄下移 = 下方面板变矮、上方区域变高
    panelH[key] = Math.max(48, Math.min(chartH.value * 0.6, startH - (ev.clientY - startY)));
    const panels: { key: 'vol' | 'macd' | 'rsi' }[] = [];
    if (volOn.value) panels.push({ key: 'vol' });
    if (macdOn.value) panels.push({ key: 'macd' });
    if (rsiOn.value) panels.push({ key: 'rsi' });
    const { gridTop } = computeGridLayout(panels);
    updateDragHandles(gridTop);
    chart!.setOption({ grid: gridTop.map((g) => ({ left: 64, right: 150, top: g.top, height: g.height })) });
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    render();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function updateDragHandles(gridTop: { top: number }[]) {
  dragHandles.value = gridTop.slice(1).map((g) => ({ top: g.top - 4 }));
}

// ---------- 数据加载 ----------
async function load(resetZoom = false) {
  if (resetZoom) zoomStart = 0;
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
    if (resetZoom && cs.length) {
      // 默认视图：真实数据铺满左侧，右侧留空（VPVR 区），可自由往右拖拽
      zoomEnd = (cs.length / (cs.length + rightPadFor(cs.length))) * 100;
    }
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

/**
 * 增量刷新（自动刷新用）：只更新最新 K 线与指标数据（merge 模式，不重建整图），
 * 避免整页重绘闪屏；无变化时直接跳过。
 */
async function refreshLatest() {
  if (!chart || !candles.value.length) return load();
  try {
    const iv = interval.value === '2w' ? '1w' : interval.value;
    const n = interval.value === '2w' ? Math.min(limit.value * 2, 1000) : limit.value;
    const res = await api.get<{ candles: CandleView[] }>(
      '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + iv + '&limit=' + n,
    );
    let cs = res.candles;
    if (interval.value === '2w') cs = aggregateCandles(cs, 2);
    cs = cs.slice(-limit.value);
    const prevArr = candles.value;
    const lastPrev = prevArr[prevArr.length - 1];
    const lastNew = cs[cs.length - 1];
    if (!cs.length || !lastNew) return;
    // 无变化（最新 K 线时间与收盘价一致）则跳过
    if (lastPrev && lastPrev.closeTime === lastNew.closeTime && lastPrev.close === lastNew.close) return;
    candles.value = cs;

    // 重算指标（含右侧填充）
    const RIGHT_PAD = rightPadFor(cs.length);
    const paddedLen = cs.length + RIGHT_PAD;
    const closes = cs.map((c) => c.close);
    const macdRes = macd(closes);
    const rsiRes = rsi(closes, 14);
    const volMa = sma(cs.map((c) => c.volume), 5);
    const times = [...cs.map((c) => fmtAxisTime(c.openTime, interval.value)), ...Array<string>(RIGHT_PAD).fill('')];
    const padNull = <T,>(a: (T | null)[]): (T | null)[] => [...a, ...Array<T | null>(RIGHT_PAD).fill(null)];
    const padNaN = (a: number[][]): (number[] | [number, number, number, number])[] => [...a, ...Array.from({ length: RIGHT_PAD }, () => [NaN, NaN, NaN, NaN])];
    const from = Math.max(0, Math.floor((paddedLen * zoomStart) / 100));
    const to = Math.min(paddedLen, Math.max(from + 1, Math.ceil((paddedLen * zoomEnd) / 100)));
    const realFrom = Math.min(cs.length, from);
    const realTo = Math.min(cs.length, Math.max(realFrom + 1, to));
    const visible = cs.slice(realFrom, realTo);
    let yLo = Infinity, yHi = -Infinity;
    for (const c of visible) {
      if (c.low < yLo) yLo = c.low;
      if (c.high > yHi) yHi = c.high;
    }
    const yPad = (yHi - yLo) * 0.06;
    const priceMin = yLo - yPad;
    const priceMax = yHi + yPad;
    const buckets = Math.max(16, Math.min(48, Math.round(visible.length / 4)));
    const profile = volumeProfile(visible, buckets);
    const maxVol = Math.max(1e-9, profile.reduce((m, b) => (b.volume > m ? b.volume : m), 0));
    let pocPrice: number | null = null;
    if (profile.length) {
      let best = profile[0]!;
      for (const b of profile) if (b.volume > best.volume) best = b;
      pocPrice = best.price;
    }

    // merge 模式只更新数据（按 series id 合并），不重建整图
    const seriesUpdate: Record<string, unknown>[] = [
      {
        id: 'kline',
        data: padNaN(cs.map((c) => [c.open, c.close, c.low, c.high])),
        markLine: pocPrice != null && vpvrOn.value
          ? { silent: true, symbol: 'none', lineStyle: { color: 'rgba(230,197,90,0.8)', type: 'dashed', width: 1 }, label: { show: true, formatter: 'POC ' + fmtPrice(pocPrice), color: '#e6c55a', fontSize: 10, position: 'insideEndTop' }, data: [{ yAxis: pocPrice }] }
          : undefined,
      },
    ];
    for (let i = 0; i < periods.value.length; i++) {
      const row = periods.value[i]!;
      if (row.ma) seriesUpdate.push({ id: 'ma-' + i + '-ma', data: padNull(sma(closes, row.value)) });
      if (row.ema) seriesUpdate.push({ id: 'ma-' + i + '-ema', data: padNull(ema(closes, row.value)) });
    }
    if (vpvrOn.value && profile.length) {
      seriesUpdate.push({ id: 'vpvr', data: profile.map((b) => [b.volume / maxVol, b.lo, b.hi]) });
    }
    if (volOn.value) {
      seriesUpdate.push({ id: 'vol', data: padNull(cs.map((c) => ({ value: c.volume, itemStyle: { color: c.close >= c.open ? 'rgba(103,194,58,0.5)' : 'rgba(245,108,108,0.5)' } }))) });
      seriesUpdate.push({ id: 'volma5', data: padNull(volMa) });
    }
    if (macdOn.value) {
      seriesUpdate.push({ id: 'macd', data: padNull(macdRes.hist.map((h) => (h == null ? null : { value: h, itemStyle: { color: h >= 0 ? 'rgba(103,194,58,0.55)' : 'rgba(245,108,108,0.55)' } }))) });
      seriesUpdate.push({ id: 'dif', data: padNull(macdRes.dif) });
      seriesUpdate.push({ id: 'dea', data: padNull(macdRes.dea) });
    }
    if (rsiOn.value) seriesUpdate.push({ id: 'rsi', data: padNull(rsiRes) });

    // 同步各面板时间轴数据（按 id 合并，避免按索引合并污染 VPVR 值轴）
    const catAxisUpdate: Record<string, unknown>[] = [{ id: 'x-cat-0', data: times }];
    if (volOn.value && lastGridIdx.vol !== undefined) catAxisUpdate.push({ id: 'x-cat-' + lastGridIdx.vol, data: times });
    if (macdOn.value && lastGridIdx.macd !== undefined) catAxisUpdate.push({ id: 'x-cat-' + lastGridIdx.macd, data: times });
    if (rsiOn.value && lastGridIdx.rsi !== undefined) catAxisUpdate.push({ id: 'x-cat-' + lastGridIdx.rsi, data: times });

    chart.setOption({
      yAxis: [{ gridIndex: 0, min: priceMin, max: priceMax }],
      xAxis: catAxisUpdate,
      series: seriesUpdate,
    });

    // 图例 / 状态栏 / 顶栏价格
    const maLegend: { name: string; color: string; vals: (number | null)[] }[] = [];
    for (let i = 0; i < periods.value.length; i++) {
      const row = periods.value[i]!;
      const label = fmtPeriod(row.value);
      if (row.ma) maLegend.push({ name: 'MA(' + label + ')', color: row.color, vals: sma(closes, row.value) });
      if (row.ema) maLegend.push({ name: 'EMA(' + label + ')', color: row.color, vals: ema(closes, row.value) });
    }
    hoverMa = maLegend;
    hoverMacd = macdRes;
    hoverRsi = rsiRes;
    hoverVolMa = volMa;
    const lastIdx = Math.max(0, Math.min(realTo - 1, cs.length - 1));
    hoverLatestIdx = lastIdx;
    updateLegends(lastIdx, maLegend, macdRes, rsiRes, volMa);
    updateStatus(realTo - 1 < cs.length ? cs[realTo - 1] : undefined, realTo - 2 >= 0 ? cs[realTo - 2] : undefined);
    const last = cs[cs.length - 1]!;
    const prevC = cs.length > 1 ? cs[cs.length - 2]!.close : last.open;
    lastPrice.value = last.close;
    lastUp.value = last.close >= prevC;
    lastChangePct.value = prevC > 0 ? (((last.close - prevC) / prevC) * 100 >= 0 ? '+' : '') + (((last.close - prevC) / prevC) * 100).toFixed(2) + '%' : '';
  } catch {
    /* 自动刷新失败静默，等待下次 */
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
    // 悬停：按纵轴任意位置触发（不要求鼠标正好压在 K 线上），各面板图例联动。
    // 用 DOM 原生事件（offsetX/offsetY 相对图表容器）+ convertFromPixel(seriesIndex) 换算 K 线索引
    const onChartMove = (e: MouseEvent) => {
      const x = e.offsetX ?? (e as MouseEvent & { layerX?: number }).layerX;
      const y = e.offsetY ?? (e as MouseEvent & { layerY?: number }).layerY;
      if (x == null || y == null || !chart) return;
      try {
        const point = chart.convertFromPixel({ seriesIndex: 0 }, [x, y]);
        const i = Math.round(point[0] as number);
        if (Number.isFinite(i) && i >= 0 && i < candles.value.length) {
          updateHoverLegends(i);
        }
      } catch {
        /* 网格外悬停忽略 */
      }
    };
    const onChartLeave = () => resetHoverLegends();
    chartEl.value.addEventListener('mousemove', onChartMove);
    chartEl.value.addEventListener('mouseleave', onChartLeave);
    chart.on('globalout', () => resetHoverLegends());
  }
  const cs = candles.value;
  if (!cs.length) return;

  const closes = cs.map((c) => c.close);
  // 右侧填充：允许把最新值往左拖到中间、右边留空（TradingView 式自由平移）
  const RIGHT_PAD = rightPadFor(cs.length);
  const paddedLen = cs.length + RIGHT_PAD;
  const times = [...cs.map((c) => fmtAxisTime(c.openTime, interval.value)), ...Array<string>(RIGHT_PAD).fill('')];
  const padNull = <T,>(a: (T | null)[]): (T | null)[] => [...a, ...Array<T | null>(RIGHT_PAD).fill(null)];
  const padNaN = (a: number[][]): (number[] | [number, number, number, number])[] => [...a, ...Array.from({ length: RIGHT_PAD }, () => [NaN, NaN, NaN, NaN])];

  // 可见范围（考虑右侧填充；VPVR/价格范围只统计真实 K 线）
  const from = Math.max(0, Math.floor((paddedLen * zoomStart) / 100));
  const to = Math.min(paddedLen, Math.max(from + 1, Math.ceil((paddedLen * zoomEnd) / 100)));
  const realFrom = Math.min(cs.length, from);
  const realTo = Math.min(cs.length, Math.max(realFrom + 1, to));
  const visible = cs.slice(realFrom, realTo);

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
  // POC：当前可见区域成交量最大的价位（VPVR 的平衡点价格线）
  let pocPrice: number | null = null;
  if (profile.length) {
    let best = profile[0]!;
    for (const b of profile) if (b.volume > best.volume) best = b;
    pocPrice = best.price;
  }

  // 面板布局（成交量 / MACD / RSI 可开关，高度可拖拽调整）
  const panels: { key: 'vol' | 'macd' | 'rsi' }[] = [];
  if (volOn.value) panels.push({ key: 'vol' });
  if (macdOn.value) panels.push({ key: 'macd' });
  if (rsiOn.value) panels.push({ key: 'rsi' });

  const { gridTop, gridIdx, catAxisIdx } = computeGridLayout(panels);
  lastGridIdx = { ...gridIdx };
  updateDragHandles(gridTop);

  // 坐标轴
  const xAxes: Record<string, unknown>[] = [];
  const yAxes: Record<string, unknown>[] = [];
  const mkCatAxis = (gi: number, showLabel: boolean) => ({
    id: 'x-cat-' + gi,
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
  // 价格轴（K线框内，数值靠右，与下方 RSI/VOL 面板对齐）
  yAxes.push({
    gridIndex: 0,
    position: 'right',
    min: priceMin,
    max: priceMax,
    scale: true,
    axisLine: { show: false },
    axisLabel: { color: '#8a94a3', formatter: fmtPrice, fontFamily: 'SF Mono, JetBrains Mono, Consolas, monospace', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(128,140,155,0.08)' } },
    axisPointer: { label: { formatter: (p: { value: number }) => fmtPrice(p.value) } },
  });
  // 先建全部 category 轴（K线 + 面板），VPVR 值轴放到最后，避免挤占面板轴索引
  for (const p of panels) {
    const gi = gridIdx[p.key]!;
    xAxes.push(mkCatAxis(gi, false));
    // 注意：yAxis 必须显式指定 gridIndex（默认 0 会导致跨 grid 报错）
    if (p.key === 'vol') {
      yAxes.push({ gridIndex: gi, position: 'right', scale: true, axisLine: { show: false }, axisLabel: { color: '#8a94a3', formatter: fmtVol, fontFamily: 'SF Mono, JetBrains Mono, Consolas, monospace', fontSize: 10 }, splitLine: { show: false } });
    } else if (p.key === 'macd') {
      yAxes.push({ gridIndex: gi, position: 'right', scale: true, axisLine: { show: false }, axisLabel: { color: '#8a94a3', formatter: (v: number) => fmtPrice(v), fontFamily: 'SF Mono, JetBrains Mono, Consolas, monospace', fontSize: 10 }, splitLine: { show: false } });
    } else {
      yAxes.push({
        gridIndex: gi,
        position: 'right',
        min: 0, max: 100, interval: 25,
        axisLine: { show: false },
        axisLabel: { color: '#8a94a3', fontFamily: 'SF Mono, JetBrains Mono, Consolas, monospace', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(128,140,155,0.08)' } },
      });
    }
  }
  // VPVR 专用值轴：与 K 线同网格（嵌入 K 线框内，重叠展示）——放数组末尾
  xAxes.push({
    id: 'vpvrAxis',
    type: 'value',
    gridIndex: 0,
    min: 0,
    max: 1,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { show: false },
    axisPointer: { show: false },
  });
  const vpvrXIdx = xAxes.length - 1;
  // 序列
  const series: Record<string, unknown>[] = [];

  series.push({
    id: 'kline',
    name: 'K线',
    type: 'candlestick',
    xAxisIndex: 0,
    yAxisIndex: 0,
    data: padNaN(cs.map((c) => [c.open, c.close, c.low, c.high])),
    itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN, borderWidth: 1 },
    markLine: pocPrice != null && vpvrOn.value
      ? {
          silent: true,
          symbol: 'none',
          lineStyle: { color: 'rgba(230,197,90,0.8)', type: 'dashed', width: 1 },
          label: { show: true, formatter: 'POC ' + fmtPrice(pocPrice), color: '#e6c55a', fontSize: 10, position: 'insideEndTop' },
          data: [{ yAxis: pocPrice }],
        }
      : undefined,
    valueFormatter: (v: unknown) =>
      Array.isArray(v)
        ? '开 ' + fmtPrice(v[0] as number) + ' 收 ' + fmtPrice(v[1] as number) + ' 低 ' + fmtPrice(v[2] as number) + ' 高 ' + fmtPrice(v[3] as number)
        : fmtPrice(v as number),
  });

  // MA 实线 / EMA 虚线（同色系，周期/颜色/线宽可编辑）
  const maLegend: { name: string; color: string; vals: (number | null)[] }[] = [];
  for (let i = 0; i < periods.value.length; i++) {
    const row = periods.value[i]!;
    const label = fmtPeriod(row.value);
    if (row.ma) {
      maLegend.push({ name: 'MA(' + label + ')', color: row.color, vals: sma(closes, row.value) });
      series.push({
        id: 'ma-' + i + '-ma',
        name: 'MA(' + label + ')',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: padNull(sma(closes, row.value)),
        symbol: 'none',
        connectNulls: false,
        z: 2,
        lineStyle: { width: row.width, color: row.color },
        emphasis: { disabled: true },
        valueFormatter: (v: unknown) => fmtPrice(v as number),
      });
    }
    if (row.ema) {
      maLegend.push({ name: 'EMA(' + label + ')', color: row.color, vals: ema(closes, row.value) });
      series.push({
        id: 'ma-' + i + '-ema',
        name: 'EMA(' + label + ')',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: padNull(ema(closes, row.value)),
        symbol: 'none',
        connectNulls: false,
        z: 2,
        lineStyle: { width: row.width, color: row.color, type: 'dashed' },
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
      xAxisIndex: vpvrXIdx, // VPVR 值轴（同 K 线网格）
      yAxisIndex: 0, // 与 K 线共用价格轴
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
        const w = Math.max(1, frac * params.coordSys.width * 0.5); // 重叠展示，柱宽限半
        return {
          type: 'rect',
          shape: { x: right - w, y: yTop, width: w, height: h },
          style: { fill: 'rgba(77,163,255,0.30)' },
        };
      },
    });
  }

  if (gridIdx.vol !== undefined) {
    const gi = gridIdx.vol;
    series.push({
      id: 'vol',
      name: '成交量',
      type: 'bar',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: padNull(cs.map((c) => ({ value: c.volume, itemStyle: { color: c.close >= c.open ? 'rgba(103,194,58,0.5)' : 'rgba(245,108,108,0.5)' } }))),
      barMaxWidth: 8,
      valueFormatter: (v: unknown) => fmtVol(v as number),
    });
    series.push({
      id: 'volma5',
      name: 'VOL MA5',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: padNull(volMa),
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
      id: 'macd',
      name: 'MACD',
      type: 'bar',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: padNull(macdRes.hist.map((h) => (h == null ? null : { value: h, itemStyle: { color: h >= 0 ? 'rgba(103,194,58,0.55)' : 'rgba(245,108,108,0.55)' } }))),
      barMaxWidth: 6,
      valueFormatter: (v: unknown) => fmtPrice(v as number),
    });
    series.push({
      id: 'dif',
      name: 'DIF',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: padNull(macdRes.dif),
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1, color: '#f0a35e' },
      emphasis: { disabled: true },
      valueFormatter: (v: unknown) => fmtPrice(v as number),
    });
    series.push({
      id: 'dea',
      name: 'DEA',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: padNull(macdRes.dea),
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
      id: 'rsi',
      name: 'RSI14',
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: padNull(rsiRes),
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

  // 网格：K线框与所有副图面板左右对齐（VPVR 嵌入 K 线框内重叠展示，数值全部靠右对齐）
  const grids = gridTop.map((g) => ({ left: 64, right: 150, top: g.top, height: g.height }));

  chart.setOption(
    {
      animation: false,
      // 不用统一大浮窗：tooltip 触发十字光标但 formatter 返回空（不弹框），各面板数值显示在自己图例上（悬停联动）
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#4da3ff', type: 'dashed', width: 1 }, crossStyle: { color: '#4da3ff', type: 'dashed' }, label: { backgroundColor: '#2f3a46', color: '#d7dde4', fontSize: 10 } },
        formatter: () => '',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        padding: 0,
      },
      axisPointer: {
        link: [{ xAxisIndex: catAxisIdx }],
        lineStyle: { color: '#4da3ff', type: 'dashed', width: 1 },
        crossStyle: { color: '#4da3ff', type: 'dashed' },
        label: { backgroundColor: '#2f3a46', color: '#d7dde4', fontSize: 10 },
      },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      dataZoom: [
        // 仅内置缩放（滚轮/拖拽），不显示底部缩放条
        { type: 'inside', xAxisIndex: catAxisIdx, start: zoomStart, end: zoomEnd },
      ],
      series,
    },
    true,
  );

  // TradingView 风格：各面板图例（左上角，悬停联动）+ 状态栏（最新可见 K 线 OHLC）
  legendTops = { price: 6 };
  if (gridIdx.vol !== undefined) legendTops.vol = gridTop[gridIdx.vol]!.top + 2;
  if (gridIdx.macd !== undefined) legendTops.macd = gridTop[gridIdx.macd]!.top + 2;
  if (gridIdx.rsi !== undefined) legendTops.rsi = gridTop[gridIdx.rsi]!.top + 2;
  const lastIdx = Math.max(0, Math.min(to - 1, cs.length - 1));
  hoverMa = maLegend;
  hoverMacd = macdRes;
  hoverRsi = rsiRes;
  hoverVolMa = volMa;
  hoverLatestIdx = lastIdx;
  updateLegends(lastIdx, maLegend, macdRes, rsiRes, volMa);
  updateStatus(realTo - 1 < cs.length ? cs[realTo - 1] : undefined, realTo - 2 >= 0 ? cs[realTo - 2] : undefined);
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
  const RIGHT_PAD = rightPadFor(cs.length);
  const paddedLen = cs.length + RIGHT_PAD;
  const from = Math.max(0, Math.floor((paddedLen * s) / 100));
  const to = Math.min(paddedLen, Math.max(from + 1, Math.ceil((paddedLen * e) / 100)));
  const realFrom = Math.min(cs.length, from);
  const realTo = Math.min(cs.length, Math.max(realFrom + 1, to));
  const visible = cs.slice(realFrom, realTo);
  // 缩放后价格轴范围随可见 K 线重算（K 线不贴上下边框）
  let yLo = Infinity, yHi = -Infinity;
  for (const c of visible) {
    if (c.low < yLo) yLo = c.low;
    if (c.high > yHi) yHi = c.high;
  }
  const yPad = (yHi - yLo) * 0.06;
  const priceMin = yLo - yPad;
  const priceMax = yHi + yPad;
  const opts: Record<string, unknown> = {
    yAxis: [{ gridIndex: 0, min: priceMin, max: priceMax }],
  };
  if (vpvrOn.value) {
    const buckets = Math.max(16, Math.min(48, Math.round(visible.length / 4)));
    const profile = volumeProfile(visible, buckets);
    const maxVol = Math.max(1e-9, profile.reduce((m, b) => (b.volume > m ? b.volume : m), 0));
    // POC：可见区域最大量价位线
    let pocPrice: number | null = null;
    if (profile.length) {
      let best = profile[0]!;
      for (const b of profile) if (b.volume > best.volume) best = b;
      pocPrice = best.price;
    }
    opts['series'] = [
      { id: 'vpvr', data: profile.map((b) => [b.volume / maxVol, b.lo, b.hi]) },
      {
        id: 'kline',
        markLine: pocPrice != null
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: 'rgba(230,197,90,0.8)', type: 'dashed', width: 1 },
              label: { show: true, formatter: 'POC ' + fmtPrice(pocPrice), color: '#e6c55a', fontSize: 10, position: 'insideEndTop' },
              data: [{ yAxis: pocPrice }],
            }
          : undefined,
      },
    ];
  }
  chart.setOption(opts);
  // 缩放后同步图例与状态栏（以最后可见 K 线为准）
  const closes = cs.map((c) => c.close);
  const macdRes = macd(closes);
  const rsiRes = rsi(closes, 14);
  const volMa = sma(cs.map((c) => c.volume), 5);
  const maLegend: { name: string; color: string; vals: (number | null)[] }[] = [];
  for (let i = 0; i < periods.value.length; i++) {
    const row = periods.value[i]!;
    const label = fmtPeriod(row.value);
    if (row.ma) maLegend.push({ name: 'MA(' + label + ')', color: row.color, vals: sma(closes, row.value) });
    if (row.ema) maLegend.push({ name: 'EMA(' + label + ')', color: row.color, vals: ema(closes, row.value) });
  }
  const lastIdx = Math.max(0, Math.min(realTo - 1, cs.length - 1));
  hoverMa = maLegend;
  hoverMacd = macdRes;
  hoverRsi = rsiRes;
  hoverVolMa = volMa;
  hoverLatestIdx = lastIdx;
  updateLegends(lastIdx, maLegend, macdRes, rsiRes, volMa);
  updateStatus(realTo - 1 < cs.length ? cs[realTo - 1] : undefined, realTo - 2 >= 0 ? cs[realTo - 2] : undefined);
}

// ---------- 生命周期 ----------
watch(autoRefresh, (on) => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (on) timer = setInterval(() => refreshLatest(), 30_000);
});

onMounted(() => {
  resizeHandler = () => {
    chart?.resize();
    measureChart();
  };
  window.addEventListener('resize', resizeHandler);
  measureChart();
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
.color { width: 18px; height: 18px; border: none; border-radius: 4px; padding: 0; background: none; cursor: pointer; }
.color::-webkit-color-swatch-wrapper { padding: 0; }
.color::-webkit-color-swatch { border: 1px solid var(--border); border-radius: 4px; }
.dot { width: 7px; height: 7px; border-radius: 2px; display: inline-block; flex: none; }
.del { border: none; background: none; color: var(--text-dim); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.del:hover { color: #f56c6c; }

/* 图表 + 图例浮层 + 面板拖拽手柄 */
.chart-wrap { position: relative; }
.chart { height: calc(100vh - 248px); min-height: 420px; width: 100%; }
.legend { position: absolute; display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; font-family: var(--mono); pointer-events: none; z-index: 5; }
.lg b { font-weight: 600; margin-left: 3px; }
.drag-handle { position: absolute; left: 60px; right: 10px; height: 7px; cursor: row-resize; z-index: 6; border-top: 1px dashed transparent; }
.drag-handle:hover { border-top: 1px dashed var(--accent); }
.period-input { width: 56px; background: var(--bg-elev); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; font-family: var(--mono); padding: 2px 4px; text-align: center; }
.period-input:focus { outline: none; border-color: var(--accent); }

/* TradingView 风格状态栏 */
.tv-status { display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-top: 1px solid var(--border); font-size: 11px; flex-wrap: wrap; }
</style>
