<!-- ================= 行情页：K线图 + 技术指标 =================
  周期选择：默认展示最常用的 4 个（1h/4h/1d/1w），其余在“更多”下拉；支持自定义“数字+时间单位”（如 45m/3h/2d，前端聚合）。
  指标菜单：下拉面板（指标按钮），EMA/MA 两组开关；每条均线单独编辑（周期/颜色/线宽），勾选 ≥2 条可联动编辑。
  指标设置按账户持久化（localStorage，key=aw-chart-ind-<accountId>），刷新/切换账户不丢失。
  VPVR：火焰图配色（低量深蓝 → 高量黄/红）。 -->
<template>
  <el-card shadow="never" class="tv-card">
    <!-- TradingView 风格顶栏：品种 + 周期选择 + 指标菜单 -->
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
          v-for="i in quickIntervals"
          :key="i.value"
          class="tv-tab"
          :class="{ active: interval === i.value }"
          @click="changeInterval(i.value)"
        >{{ i.short }}</button>
        <el-dropdown trigger="click" @command="onMoreInterval">
          <button class="tv-tab" :class="{ active: moreActive }">更多<span class="caret">▾</span></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="i in moreIntervals" :key="i.value" :command="i.value" :class="{ 'iv-active': interval === i.value }">{{ i.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <input v-model="customIv" class="cust-iv" size="7" placeholder="自定义 45m" title="输入数字+时间单位（m/h/d/w/M）后回车，如 45m / 3h / 2d / 1w；不支持的周期自动按最小可整除周期聚合" @keyup.enter="applyCustomInterval" />
      </div>
      <div class="tv-actions">
        <!-- 指标菜单（抽屉下拉）：EMA/MA 组开关、各指标开关、均线逐条编辑与联动编辑 -->
        <el-popover v-model:visible="indOpen" placement="bottom-end" :width="450" trigger="click">
          <template #reference>
            <el-button size="small" :type="indOpen ? 'primary' : 'default'">指标</el-button>
          </template>
          <div class="ind-panel">
            <!-- 主开关：EMA/MA 按组开关 + 其它指标 -->
            <div class="ip-head">
              <span class="ip-grp" title="按组显示/隐藏全部均线">
                <el-checkbox v-model="emaOn" size="small" @change="render">EMA</el-checkbox>
                <el-checkbox v-model="maOn" size="small" @change="render">MA</el-checkbox>
              </span>
              <span class="ip-div"></span>
              <el-checkbox v-model="volOn" size="small" @change="render">成交量</el-checkbox>
              <el-checkbox v-model="macdOn" size="small" @change="render">MACD</el-checkbox>
              <el-checkbox v-model="rsiOn" size="small" @change="render">RSI</el-checkbox>
              <el-checkbox v-model="vpvrOn" size="small" @change="render">VPVR</el-checkbox>
            </div>

            <!-- 联动编辑：勾选 ≥2 条时显示，颜色/粗细应用到所有选中项 -->
            <div v-if="linkCount >= 2" class="ip-link">
              <span class="ip-link-t">联动编辑 {{ linkCount }} 条</span>
              <input v-model="linkColor" type="color" class="color" title="应用到所有选中均线" @change="applyLinked" />
              <el-input-number v-model="linkWidth" :min="0.5" :max="4" :step="0.1" size="small" style="width: 72px" title="应用到所有选中均线" @change="applyLinked" />
              <el-button size="small" text type="primary" @click="clearLink">取消</el-button>
            </div>

            <!-- 均线列表：每条单独编辑（周期/颜色/线宽）；最右侧勾选框用于联动编辑 -->
            <div class="ip-lines">
              <div v-for="(ln, i) in lines" :key="ln.id" class="ip-line" :class="{ sel: linkMap[ln.id] }">
                <el-checkbox v-model="ln.on" size="small" :title="'显示/隐藏 ' + ln.kind.toUpperCase() + '(' + fmtPeriod(ln.period) + ')'" @change="lineChanged(ln)" />
                <span class="ip-name" :style="{ color: ln.color }">{{ ln.kind.toUpperCase() }}({{ fmtPeriod(ln.period) }})</span>
                <input :value="ln.input" class="period-input" size="5" title="周期（支持小数，如 62.8）" @change="(e: Event) => setLinePeriod(ln, (e.target as HTMLInputElement).value)" @keyup.enter="(e: Event) => (e.target as HTMLInputElement).blur()" />
                <input v-model="ln.color" type="color" class="color" :title="'颜色 ' + ln.color" @change="lineChanged(ln)" />
                <el-input-number v-model="ln.width" :min="0.5" :max="4" :step="0.1" size="small" style="width: 60px" title="线宽" @change="lineChanged(ln)" />
                <el-checkbox v-model="linkMap[ln.id]" size="small" class="ip-linkbox" title="勾选后与其它勾选项联动编辑（颜色/粗细）" @change="syncLink" />
                <button v-if="lines.length > 1" class="del" title="删除该均线" @click="removeLine(i)">×</button>
              </div>
            </div>
            <div class="ip-actions">
              <el-button size="small" text type="primary" @click="addPeriod">+ 周期（MA+EMA）</el-button>
              <el-button size="small" text @click="addLine('ema')">+ EMA</el-button>
              <el-button size="small" text @click="addLine('ma')">+ MA</el-button>
            </div>
          </div>
        </el-popover>
        <el-input-number v-model="limit" :min="50" :max="1000" :step="50" size="small" style="width: 96px" @change="load()" />
        <span class="dim">自动</span>
        <el-switch v-model="autoRefresh" size="small" />
        <el-button size="small" @click="refreshLatest">刷新</el-button>
      </div>
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
        <!-- 价格面板图例：EMA / MA 分两列（组关闭或全隐藏时不渲染该列，不留灰色框） -->
        <template v-if="g.cols && g.cols.length">
          <div v-for="col in g.cols" :key="col.key" class="lg-col">
            <span class="lg-head" :style="{ color: col.key === 'ema' ? '#f0a35e' : '#4da3ff' }">{{ col.label }}</span>
            <span v-for="(it, idx) in col.items" :key="idx" class="lg" :style="{ color: it.color }">{{ it.name }}<b>{{ it.value }}</b></span>
          </div>
        </template>
        <template v-else>
          <span v-for="(it, idx) in g.items" :key="idx" class="lg" :style="{ color: it.color }">{{ it.name }}<b>{{ it.value }}</b></span>
        </template>
      </div>

      <!-- 悬停 OHLC 浮窗（当前 K 柱：开高低收/涨跌幅/时间） -->
      <div
        v-if="hoverTip.visible"
        class="hover-tip mono"
        :style="{ left: hoverTip.x + 'px', top: hoverTip.y + 'px' }"
      >
        <div class="ht-time">{{ hoverTip.time }}</div>
        <div class="ht-row"><span class="ht-k">开</span><span>{{ hoverTip.open }}</span></div>
        <div class="ht-row"><span class="ht-k">高</span><span class="up">{{ hoverTip.high }}</span></div>
        <div class="ht-row"><span class="ht-k">低</span><span class="down">{{ hoverTip.low }}</span></div>
        <div class="ht-row"><span class="ht-k">收</span><span :class="hoverTip.cls">{{ hoverTip.close }}</span></div>
        <div class="ht-row"><span class="ht-k">涨跌</span><span :class="hoverTip.cls">{{ hoverTip.change }} · {{ hoverTip.changePct }}</span></div>
      </div>

      <!-- 可见区间最高/最低点：标在所在 K 线上（价格标签 + 连接线指向该 K 线的高/低点） -->
      <div v-if="hlMarkers.high" class="hl-mark hl-high" :style="{ left: hlMarkers.high.x + 'px', top: hlMarkers.high.y + 'px' }">{{ hlMarkers.high.price }}(H)</div>
      <div v-if="hlMarkers.low" class="hl-mark hl-low" :style="{ left: hlMarkers.low.x + 'px', top: hlMarkers.low.y + 'px' }">{{ hlMarkers.low.price }}(L)</div>
      <!-- POC 价格：显示在右侧价格列（与价格标签一起），格式 88888.9(poc) -->
      <div v-if="pocMark" class="poc-mark mono" :style="{ top: pocMark.y + 'px' }">{{ pocMark.text }}</div>
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
import { accountStore } from '../store.ts';
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
/** 全部周期（含前端聚合的 2w）；默认只展示最常用的 4 个，其余进“更多”下拉 */
const ALL_INTERVALS = [
  { value: '1m', label: '1分钟', short: '1m' }, { value: '3m', label: '3分钟', short: '3m' }, { value: '5m', label: '5分钟', short: '5m' },
  { value: '15m', label: '15分钟', short: '15m' }, { value: '30m', label: '30分钟', short: '30m' }, { value: '1h', label: '1小时', short: '1h' },
  { value: '2h', label: '2小时', short: '2h' }, { value: '4h', label: '4小时', short: '4h' }, { value: '6h', label: '6小时', short: '6h' },
  { value: '8h', label: '8小时', short: '8h' }, { value: '12h', label: '12小时', short: '12h' }, { value: '1d', label: '1天', short: '1D' },
  { value: '3d', label: '3天', short: '3D' }, { value: '1w', label: '1周', short: '1W' }, { value: '2w', label: '2周', short: '2W' },
  { value: '1M', label: '1月', short: '1M' },
];
const QUICK_INTERVAL_VALUES = ['1h', '4h', '1d', '1w'];
const quickIntervals = ALL_INTERVALS.filter((i) => QUICK_INTERVAL_VALUES.includes(i.value));
const moreIntervals = ALL_INTERVALS.filter((i) => !QUICK_INTERVAL_VALUES.includes(i.value));
/** 后端原生支持的周期（毫秒），用于自定义周期解析（2w 由前端 1w 聚合，不在其中） */
const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000, '8h': 28_800_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
};

/** 每条均线（EMA / MA 分开，可单独编辑） */
const PERIOD_COLORS = ['#e6a23c', '#409eff', '#9254de', '#14b8a6', '#ec4899', '#06b6d4', '#f59e0b', '#7c8cf8'];
interface MaLineCfg {
  id: number;
  kind: 'ema' | 'ma';
  period: number;
  color: string;
  width: number;
  on: boolean;
  input: string;
}
const DEFAULT_LINE_PERIODS = [20, 62.8, 144, 169];
let lineSeq = 1;
function fmtPeriod(v: number): string {
  return String(Math.round(v * 100) / 100);
}
function defaultLines(): MaLineCfg[] {
  const out: MaLineCfg[] = [];
  DEFAULT_LINE_PERIODS.forEach((p, i) => {
    const c = PERIOD_COLORS[i % PERIOD_COLORS.length]!;
    out.push({ id: lineSeq++, kind: 'ema', period: p, color: c, width: 1.2, on: true, input: fmtPeriod(p) });
    out.push({ id: lineSeq++, kind: 'ma', period: p, color: c, width: 1.2, on: true, input: fmtPeriod(p) });
  });
  return out;
}
function addPeriod() {
  const c = PERIOD_COLORS[lines.value.length % PERIOD_COLORS.length]!;
  lines.value.push({ id: lineSeq++, kind: 'ema', period: 60, color: c, width: 1.2, on: true, input: '60' });
  lines.value.push({ id: lineSeq++, kind: 'ma', period: 60, color: c, width: 1.2, on: true, input: '60' });
  render();
}
function addLine(kind: 'ema' | 'ma') {
  const c = PERIOD_COLORS[lines.value.length % PERIOD_COLORS.length]!;
  lines.value.push({ id: lineSeq++, kind, period: 60, color: c, width: 1.2, on: true, input: '60' });
  render();
}
function removeLine(i: number) {
  const ln = lines.value[i];
  if (!ln) return;
  delete linkMap[ln.id];
  lines.value.splice(i, 1);
  syncLink();
  render();
}
function setLinePeriod(ln: MaLineCfg, raw: string | number) {
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(v) || v <= 0) {
    ln.input = fmtPeriod(ln.period); // 非法输入还原
    return;
  }
  ln.period = Math.max(1, Math.min(999, Math.round(v * 100) / 100));
  ln.input = fmtPeriod(ln.period);
  render();
}

const UP = '#67c23a';
const DOWN = '#f56c6c';
const GRID_GAP = 14;

// ---------- 状态 ----------
const symbol = ref('BTCUSDT');
const market = ref('SPOT');
const interval = ref('1h');
const customIv = ref('');
const limit = ref(300);
const autoRefresh = ref(false);
/** EMA / MA 两组开关：按组显示/隐藏全部均线 */
const emaOn = ref(true);
const maOn = ref(true);
const volOn = ref(true);
const macdOn = ref(true);
const rsiOn = ref(true);
const vpvrOn = ref(true);
const indOpen = ref(false);
const lines = ref<MaLineCfg[]>(defaultLines());
// 联动编辑：勾选 ≥2 条后，颜色/粗细应用到所有选中项
const linkMap = reactive<Record<number, boolean>>({});
const linkColor = ref('#409eff');
const linkWidth = ref(1.2);
const linkCount = computed(() => Object.values(linkMap).filter(Boolean).length);
const loading = ref(false);
const candles = ref<CandleView[]>([]);
const lastPrice = ref<number | null>(null);
const lastUp = ref(true);
const lastChangePct = ref('');
const chartEl = ref<HTMLDivElement | null>(null);

const moreActive = computed(() => !quickIntervals.some((i) => i.value === interval.value));
const intervalLabel = computed(() => ALL_INTERVALS.find((i) => i.value === interval.value)?.label ?? interval.value);

/** 解析周期（含自定义“数字+时间单位”），返回取数基础周期与聚合倍数；2w→1w×2，45m→15m×3 */
function resolveInterval(raw: string): { base: string; factor: number } | null {
  const s = raw.trim();
  if (!s) return null;
  if (INTERVAL_MS[s]) return { base: s, factor: 1 }; // 原生支持的周期直接用
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d|w|M)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0)) return null;
  const unitMs = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : m[2] === 'd' ? 86_400_000 : m[2] === 'w' ? 604_800_000 : 2_592_000_000;
  const target = n * unitMs;
  // 取最大的可整除的原生周期作为基础，前端聚合（如 2w→1w×2、45m→15m×3）
  const entries = Object.entries(INTERVAL_MS).sort((a, b) => b[1] - a[1]);
  for (const [iv, ms] of entries) {
    if (ms <= target + 1e-6) {
      const factor = Math.round(target / ms);
      if (factor >= 1 && Math.abs(factor * ms - target) < 1e-6) return { base: iv, factor };
    }
  }
  return null;
}
function intervalFetch(): { base: string; factor: number } {
  return resolveInterval(interval.value) ?? { base: interval.value, factor: 1 };
}
function applyCustomInterval() {
  const v = customIv.value.trim();
  if (!v) return;
  if (!resolveInterval(v)) {
    ElMessage.warning('周期格式：数字+时间单位，如 45m / 3h / 2d / 1w / 1M');
    return;
  }
  changeInterval(v);
}
function onMoreInterval(v: string) {
  changeInterval(v);
}

// TradingView 风格：各面板独立图例（默认最新值，悬停联动）+ 状态栏
interface LegendItem { name: string; color: string; value: string }
interface LegendCol { key: 'ema' | 'ma'; label: string; items: LegendItem[] }
interface LegendGroup { key: string; top: number; left: number; items?: LegendItem[]; cols?: LegendCol[] }
const legends = ref<LegendGroup[]>([]);
const status = ref<{ time: string; open: string; high: string; low: string; close: string; change: string; changePct: string; cls: string; volume: string }>({
  time: '-', open: '-', high: '-', low: '-', close: '-', change: '-', changePct: '-', cls: '', volume: '-',
});

// 悬停 OHLC 浮窗
const hoverTip = ref<{ visible: boolean; x: number; y: number; time: string; open: string; high: string; low: string; close: string; change: string; changePct: string; cls: string }>({
  visible: false, x: 0, y: 0, time: '', open: '-', high: '-', low: '-', close: '-', change: '-', changePct: '-', cls: '',
});
// 可见区间最高/最低点：标在所在 K 线上（价格标签 + 连接线指向该 K 线的高/低点）
interface HlMarker { x: number; y: number; price: string }
const hlMarkers = ref<{ high: HlMarker | null; low: HlMarker | null }>({ high: null, low: null });
// POC 价格标记：显示在右侧价格列（与 y 轴价格标签一起），格式 88888.9(poc)
const pocMark = ref<{ y: number; text: string } | null>(null);

/** 更新右侧 POC 价格标记（锚定在 POC 价格高度，随缩放/刷新重算） */
function updatePocMark(pocPrice: number | null) {
  if (!chart || pocPrice == null || !candles.value.length) {
    pocMark.value = null;
    return;
  }
  try {
    const [, py] = chart.convertToPixel({ seriesIndex: 0 }, [candles.value.length - 1, pocPrice]);
    const h = chartEl.value?.clientHeight ?? 0;
    pocMark.value = { y: Math.max(4, Math.min(h - 16, py)), text: fmtPrice(pocPrice) + '(poc)' };
  } catch {
    pocMark.value = null;
  }
}

/** 更新可见区间最高/最低点的像素位置（标签锚定在对应的 K 线上） */
function updateHlMarkers(visibleCandles: CandleView[], startIdx: number) {
  if (!chart || !visibleCandles.length) {
    hlMarkers.value = { high: null, low: null };
    return;
  }
  let hi = -Infinity, lo = Infinity;
  let hiI = 0, loI = 0;
  for (let i = 0; i < visibleCandles.length; i++) {
    const c = visibleCandles[i]!;
    if (c.high > hi) { hi = c.high; hiI = i; }
    if (c.low < lo) { lo = c.low; loI = i; }
  }
  try {
    const [pxHi, pyHi] = chart.convertToPixel({ seriesIndex: 0 }, [startIdx + hiI, hi]);
    const [pxLo, pyLo] = chart.convertToPixel({ seriesIndex: 0 }, [startIdx + loI, lo]);
    const w = chartEl.value?.clientWidth ?? 0;
    const h = chartEl.value?.clientHeight ?? 0;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    hlMarkers.value = {
      high: { x: clamp(pxHi, 36, w - 36), y: clamp(pyHi - 24, 4, h - 22), price: fmtPrice(hi) },
      low: { x: clamp(pxLo, 36, w - 36), y: clamp(pyLo + 8, 22, h - 18), price: fmtPrice(lo) },
    };
  } catch {
    hlMarkers.value = { high: null, low: null };
  }
}

/** 面板图例布局：K线(price)/成交量(vol)/MACD(macd)/RSI(rsi) 各自左上角 */
let legendTops: Record<string, number> = { price: 6 };

// 悬停联动用：缓存最近一次渲染的指标（避免每次 mousemove 重算全量）
interface MaLine { name: string; color: string; vals: (number | null)[]; kind: 'ema' | 'ma' }
let hoverMa: MaLine[] = [];
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
  // 标准周期清空自定义输入；自定义周期回显到输入框
  customIv.value = (quickIntervals.some((i) => i.value === v) || moreIntervals.some((i) => i.value === v)) ? '' : v;
  load(true);
}

/** 联动编辑：勾选项 ≥2 时应用颜色/粗细到所有选中均线 */
function syncLink() {
  const first = lines.value.find((l) => linkMap[l.id]);
  if (first) {
    linkColor.value = first.color;
    linkWidth.value = first.width;
  }
}
function clearLink() {
  for (const k of Object.keys(linkMap)) delete linkMap[Number(k)];
}
function applyLinked() {
  for (const l of lines.value) {
    if (linkMap[l.id]) { l.color = linkColor.value; l.width = linkWidth.value; }
  }
  render();
}
/** 单条均线变化：勾选了联动编辑的项，颜色/粗细同步到其它选中项 */
function lineChanged(ln: MaLineCfg) {
  if (linkMap[ln.id] && linkCount.value >= 2) {
    for (const l of lines.value) {
      if (linkMap[l.id] && l.id !== ln.id) { l.color = ln.color; l.width = ln.width; }
    }
    linkColor.value = ln.color;
    linkWidth.value = ln.width;
  }
  render();
}

/** 按当前可见均线构建图例缓存（kind 区分 EMA / MA，图例按组分列） */
function buildMaLegend(closes: number[]): MaLine[] {
  const out: MaLine[] = [];
  for (const ln of lines.value) {
    const on = ln.kind === 'ema' ? emaOn.value && ln.on : maOn.value && ln.on;
    if (!on) continue;
    const label = fmtPeriod(ln.period);
    out.push({
      name: (ln.kind === 'ema' ? 'EMA(' : 'MA(') + label + ')',
      color: ln.color,
      kind: ln.kind,
      vals: ln.kind === 'ema' ? ema(closes, ln.period) : sma(closes, ln.period),
    });
  }
  return out;
}

/** 计算某个索引处各面板的图例值（悬停时随鼠标联动，默认显示最新值） */
function updateLegends(idx: number, maLines: MaLine[], macdRes: { dif: (number | null)[]; dea: (number | null)[]; hist: (number | null)[] }, rsiVals: (number | null)[], volMa: (number | null)[]) {
  const groups: LegendGroup[] = [];
  // K线框：EMA / MA 按组分两列（组关闭或该组无可见线时不渲染该列，避免残留灰色框）
  const emaCol: LegendCol = { key: 'ema', label: 'EMA', items: [] };
  const maCol: LegendCol = { key: 'ma', label: 'MA', items: [] };
  for (const m of maLines) {
    const v = m.vals[idx];
    if (v == null) continue;
    const it: LegendItem = { name: m.name, color: m.color, value: fmtPrice(v) };
    if (m.kind === 'ema') emaCol.items.push(it);
    else maCol.items.push(it);
  }
  const cols: LegendCol[] = [];
  if (emaOn.value && emaCol.items.length) cols.push(emaCol);
  if (maOn.value && maCol.items.length) cols.push(maCol);
  if (cols.length) groups.push({ key: 'price', top: legendTops.price ?? 6, left: 70, cols });
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
    // 自定义周期（如 45m / 2w）：拉基础周期数据后前端聚合
    const { base, factor } = intervalFetch();
    const n = Math.min(limit.value * factor, 1000);
    const res = await api.get<{ candles: CandleView[] }>(
      '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + base + '&limit=' + n,
    );
    let cs = res.candles;
    if (factor > 1) cs = aggregateCandles(cs, factor);
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
    const { base, factor } = intervalFetch();
    const n = Math.min(limit.value * factor, 1000);
    const res = await api.get<{ candles: CandleView[] }>(
      '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + base + '&limit=' + n,
    );
    let cs = res.candles;
    if (factor > 1) cs = aggregateCandles(cs, factor);
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
        markLine: vpvrOn.value ? pocMarkLine(pocPrice) : undefined,
      },
    ];
    for (const ln of lines.value) {
      const on = ln.kind === 'ema' ? emaOn.value && ln.on : maOn.value && ln.on;
      if (!on) continue;
      seriesUpdate.push({ id: 'ind-' + ln.id, data: padNull(ln.kind === 'ema' ? ema(closes, ln.period) : sma(closes, ln.period)) });
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
    const maLegend = buildMaLegend(closes);
    hoverMa = maLegend;
    hoverMacd = macdRes;
    hoverRsi = rsiRes;
    hoverVolMa = volMa;
    const lastIdx = Math.max(0, Math.min(realTo - 1, cs.length - 1));
    hoverLatestIdx = lastIdx;
    updateLegends(lastIdx, maLegend, macdRes, rsiRes, volMa);
    updateStatus(realTo - 1 < cs.length ? cs[realTo - 1] : undefined, realTo - 2 >= 0 ? cs[realTo - 2] : undefined);
    updateHlMarkers(visible, realFrom);
    updatePocMark(vpvrOn.value ? pocPrice : null);
    const last = cs[cs.length - 1]!;
    const prevC = cs.length > 1 ? cs[cs.length - 2]!.close : last.open;
    lastPrice.value = last.close;
    lastUp.value = last.close >= prevC;
    lastChangePct.value = prevC > 0 ? (((last.close - prevC) / prevC) * 100 >= 0 ? '+' : '') + (((last.close - prevC) / prevC) * 100).toFixed(2) + '%' : '';
  } catch {
    /* 自动刷新失败静默，等待下次 */
  }
}

/** POC 价格线（虚线）；价格文本由右侧 DOM 标记显示，格式 88888.9(poc) */
function pocMarkLine(pocPrice: number | null): Record<string, unknown> | undefined {
  if (pocPrice == null) return undefined;
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: 'rgba(230,197,90,0.8)', type: 'dashed', width: 1 },
    label: { show: false },
    data: [{ yAxis: pocPrice }],
  };
}

/** VPVR 火焰图配色：低量→深蓝，高量→黄/红（辨识度更高） */
function heatColor(f: number): string {
  const t = Math.max(0, Math.min(1, f));
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [15, 46, 98]],
    [0.3, [0, 108, 186]],
    [0.55, [24, 168, 212]],
    [0.75, [255, 213, 79]],
    [1.0, [255, 92, 51]],
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1]![0]) i++;
  const [t0, c0] = stops[i]!;
  const [t1, c1] = stops[i + 1]!;
  const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * k);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * k);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * k);
  const a = (0.18 + t * 0.72).toFixed(3);
  return `rgba(${r},${g},${b},${a})`;
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
          // 悬停 OHLC 浮窗：跟随光标，展示当前 K 柱开高低收/涨跌幅/时间
          const c = candles.value[i];
          const prevC = i > 0 ? candles.value[i - 1]!.close : c.open;
          const chg = c.close - prevC;
          const pct = prevC > 0 ? (chg / prevC) * 100 : 0;
          const up = c.close >= prevC;
          const tw = chartEl.value?.clientWidth ?? 0;
          const th = chartEl.value?.clientHeight ?? 0;
          hoverTip.value = {
            visible: true,
            x: Math.min(x + 14, tw - 148),
            y: Math.min(y + 14, th - 140),
            time: new Date(c.openTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
            open: fmtPrice(c.open),
            high: fmtPrice(c.high),
            low: fmtPrice(c.low),
            close: fmtPrice(c.close),
            change: (chg >= 0 ? '+' : '') + fmtPrice(chg),
            changePct: (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%',
            cls: up ? 'up' : 'down',
          };
        } else {
          hoverTip.value.visible = false;
        }
      } catch {
        /* 网格外悬停忽略 */
      }
    };
    const onChartLeave = () => {
      resetHoverLegends();
      hoverTip.value.visible = false;
    };
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
    // 悬浮十字光标：只在 K 线主图显示时间标签，副图(VOL/MACD/RSI)不显示
    axisPointer: { label: { show: showLabel } },
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
    markLine: vpvrOn.value ? pocMarkLine(pocPrice) : undefined,
    valueFormatter: (v: unknown) =>
      Array.isArray(v)
        ? '开 ' + fmtPrice(v[0] as number) + ' 收 ' + fmtPrice(v[1] as number) + ' 低 ' + fmtPrice(v[2] as number) + ' 高 ' + fmtPrice(v[3] as number)
        : fmtPrice(v as number),
  });

  // MA / EMA 线：每条单独编辑（周期/颜色/线宽），EMA / MA 两组开关按组隐藏，勾选可联动编辑
  const maLegend: MaLine[] = [];
  for (const ln of lines.value) {
    const on = ln.kind === 'ema' ? emaOn.value && ln.on : maOn.value && ln.on;
    if (!on) continue;
    const label = fmtPeriod(ln.period);
    const name = (ln.kind === 'ema' ? 'EMA(' : 'MA(') + label + ')';
    const vals = ln.kind === 'ema' ? ema(closes, ln.period) : sma(closes, ln.period);
    maLegend.push({ name, color: ln.color, kind: ln.kind, vals });
    series.push({
      id: 'ind-' + ln.id,
      name,
      type: 'line',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: padNull(vals),
      symbol: 'none',
      connectNulls: false,
      z: 2,
      lineStyle: { width: ln.width, color: ln.color },
      emphasis: { disabled: true },
      valueFormatter: (v: unknown) => fmtPrice(v as number),
    });
  }

  // VPVR：右侧独立竖版条 —— 用 custom 系列按像素精确绘制，
  // 柱锚定 VPVR 网格右边缘、与价格轴严格对齐（同范围 y 轴）、随可见区间重算；
  // 火焰图配色：低量深蓝 → 高量黄/红
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
          style: { fill: heatColor(frac) },
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
  updateHlMarkers(visible, realFrom);
  updatePocMark(vpvrOn.value ? pocPrice : null);
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
  // POC：可见区域最大量价位线（函数级作用域，供右侧价格标记使用）
  let pocPrice: number | null = null;
  if (vpvrOn.value) {
    const buckets = Math.max(16, Math.min(48, Math.round(visible.length / 4)));
    const profile = volumeProfile(visible, buckets);
    const maxVol = Math.max(1e-9, profile.reduce((m, b) => (b.volume > m ? b.volume : m), 0));
    if (profile.length) {
      let best = profile[0]!;
      for (const b of profile) if (b.volume > best.volume) best = b;
      pocPrice = best.price;
    }
    opts['series'] = [
      { id: 'vpvr', data: profile.map((b) => [b.volume / maxVol, b.lo, b.hi]) },
      {
        id: 'kline',
        markLine: pocMarkLine(pocPrice),
      },
    ];
  }
  chart.setOption(opts);
  // 缩放后同步图例与状态栏（以最后可见 K 线为准）
  const closes = cs.map((c) => c.close);
  const macdRes = macd(closes);
  const rsiRes = rsi(closes, 14);
  const volMa = sma(cs.map((c) => c.volume), 5);
  const maLegend = buildMaLegend(closes);
  const lastIdx = Math.max(0, Math.min(realTo - 1, cs.length - 1));
  hoverMa = maLegend;
  hoverMacd = macdRes;
  hoverRsi = rsiRes;
  hoverVolMa = volMa;
  hoverLatestIdx = lastIdx;
  updateLegends(lastIdx, maLegend, macdRes, rsiRes, volMa);
  updateStatus(realTo - 1 < cs.length ? cs[realTo - 1] : undefined, realTo - 2 >= 0 ? cs[realTo - 2] : undefined);
  updateHlMarkers(visible, realFrom);
  updatePocMark(vpvrOn.value ? pocPrice : null);
}

// ---------- 指标设置持久化（按账户保存，刷新不丢失） ----------
interface IndSettings {
  v: number;
  emaOn: boolean;
  maOn: boolean;
  volOn: boolean;
  macdOn: boolean;
  rsiOn: boolean;
  vpvrOn: boolean;
  lines: MaLineCfg[];
}
function settingsKey(): string {
  return 'aw-chart-ind-' + (accountStore.selectedId || 'default');
}
function saveSettings() {
  try {
    const data: IndSettings = {
      v: 1,
      emaOn: emaOn.value, maOn: maOn.value,
      volOn: volOn.value, macdOn: macdOn.value, rsiOn: rsiOn.value, vpvrOn: vpvrOn.value,
      lines: lines.value.map((l) => ({ ...l })),
    };
    localStorage.setItem(settingsKey(), JSON.stringify(data));
  } catch { /* 存储异常忽略 */ }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(settingsKey());
    if (!raw) return;
    const d = JSON.parse(raw) as IndSettings;
    if (!d || d.v !== 1) return;
    emaOn.value = d.emaOn !== false;
    maOn.value = d.maOn !== false;
    volOn.value = d.volOn !== false;
    macdOn.value = d.macdOn !== false;
    rsiOn.value = d.rsiOn !== false;
    vpvrOn.value = d.vpvrOn !== false;
    if (Array.isArray(d.lines) && d.lines.length) {
      lines.value = d.lines.map((l) => {
        const period = Number(l.period) > 0 ? Number(l.period) : 20;
        return {
          id: l.id,
          kind: l.kind === 'ema' ? 'ema' : 'ma',
          period,
          color: typeof l.color === 'string' ? l.color : '#409eff',
          width: Number(l.width) > 0 ? Number(l.width) : 1.2,
          on: l.on !== false,
          input: typeof l.input === 'string' && l.input ? l.input : fmtPeriod(period),
        };
      });
      lineSeq = Math.max(lineSeq, ...lines.value.map((l) => l.id)) + 1;
    }
    for (const k of Object.keys(linkMap)) {
      if (!lines.value.some((l) => l.id === Number(k))) delete linkMap[Number(k)];
    }
  } catch { /* 损坏的存储忽略 */ }
}
// 任何指标设置变化自动保存；切换账户时加载对应账户的设置
watch([emaOn, maOn, volOn, macdOn, rsiOn, vpvrOn, lines], () => saveSettings(), { deep: true });
watch(() => accountStore.selectedId, () => {
  loadSettings();
  render();
});

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
  loadSettings();
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
.caret { font-size: 9px; opacity: 0.7; margin-left: 2px; }
.cust-iv { width: 92px; background: var(--bg-elev); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; font-family: var(--mono); padding: 2px 5px; text-align: center; }
.cust-iv:focus { outline: none; border-color: var(--accent); }
.iv-active { font-weight: 700; color: var(--accent) !important; }
.tv-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

/* 指标菜单（下拉面板） */
.ind-panel { font-size: 12px; }
.ip-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.ip-head :deep(.el-checkbox__label) { font-size: 12px; }
.ip-grp { display: inline-flex; align-items: center; gap: 2px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; }
.ip-grp :deep(.el-checkbox__label) { font-weight: 600; }
.ip-div { width: 1px; height: 18px; background: var(--border); }
.ip-link { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(64,158,255,0.08); border: 1px solid rgba(64,158,255,0.35); border-radius: 5px; margin-top: 8px; }
.ip-link-t { color: #409eff; font-weight: 600; margin-right: 2px; }
.ip-lines { max-height: 264px; overflow-y: auto; margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.ip-line { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 4px; }
.ip-line:hover { background: var(--bg-elev); }
.ip-line.sel { background: rgba(64,158,255,0.12); outline: 1px solid rgba(64,158,255,0.4); }
.ip-line :deep(.el-checkbox) { margin-right: 0; }
.ip-line :deep(.el-checkbox__label) { font-size: 11px; }
.ip-name { width: 88px; font-family: var(--mono); font-size: 11px; font-weight: 600; flex: none; }
.ip-linkbox { margin-left: auto; }
.ip-actions { display: flex; gap: 6px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); }

/* 图表 + 图例浮层 + 面板拖拽手柄 */
.chart-wrap { position: relative; }
.chart { height: calc(100vh - 248px); min-height: 420px; width: 100%; }
.legend { position: absolute; display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; font-family: var(--mono); pointer-events: none; z-index: 5; }
.lg b { font-weight: 600; margin-left: 3px; }
/* EMA / MA 图例分两列（组关闭时不渲染，不留灰色框） */
.lg-col { display: flex; flex-direction: column; gap: 2px; background: rgba(17,22,29,0.6); border: 1px solid var(--border); border-radius: 5px; padding: 3px 8px 4px; }
.lg-col .lg { line-height: 1.5; }
.lg-head { font-weight: 700; line-height: 1.6; }
.drag-handle { position: absolute; left: 60px; right: 10px; height: 7px; cursor: row-resize; z-index: 6; border-top: 1px dashed transparent; }
.drag-handle:hover { border-top: 1px dashed var(--accent); }
/* 悬停 OHLC 浮窗 */
.hover-tip { position: absolute; z-index: 7; background: rgba(17,22,29,0.92); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; font-size: 11px; pointer-events: none; min-width: 132px; }
.ht-time { color: var(--text-dim); margin-bottom: 4px; }
.ht-row { display: flex; justify-content: space-between; gap: 14px; line-height: 1.6; }
.ht-k { color: var(--text-dim); }
/* 可见区间最高/最低点：锚定在所在 K 线上，标签 + 连接线指向该点 */
.hl-mark { position: absolute; transform: translateX(-50%); z-index: 6; font-size: 10px; font-family: var(--mono); padding: 1px 5px; border-radius: 3px; background: rgba(17,22,29,0.9); border: 1px solid; pointer-events: none; white-space: nowrap; line-height: 1.4; }
.hl-high { color: #67c23a; border-color: rgba(103,194,58,0.55); }
.hl-high::after { content: ''; position: absolute; left: 50%; top: 100%; transform: translateX(-50%); width: 1px; height: 5px; background: rgba(103,194,58,0.8); }
.hl-low { color: #f56c6c; border-color: rgba(245,108,108,0.55); }
.hl-low::after { content: ''; position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%); width: 1px; height: 5px; background: rgba(245,108,108,0.8); }
/* POC 价格标记：右侧价格列（网格右缘往右 6px），与价格标签一起显示 */
.poc-mark { position: absolute; left: calc(100% - 150px + 6px); transform: translateY(-50%); z-index: 6; font-size: 10px; color: #e6c55a; padding: 1px 4px; border-radius: 3px; background: rgba(17,22,29,0.85); border: 1px solid rgba(230,197,90,0.35); pointer-events: none; white-space: nowrap; line-height: 1.4; }
.period-input { width: 56px; background: var(--bg-elev); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; font-family: var(--mono); padding: 2px 4px; text-align: center; }
.period-input:focus { outline: none; border-color: var(--accent); }
.del { border: none; background: none; color: var(--text-dim); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.del:hover { color: #f56c6c; }
.color { width: 18px; height: 18px; border: none; border-radius: 4px; padding: 0; background: none; cursor: pointer; }
.color::-webkit-color-swatch-wrapper { padding: 0; }
.color::-webkit-color-swatch { border: 1px solid var(--border); border-radius: 4px; }

/* TradingView 风格状态栏 */
.tv-status { display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-top: 1px solid var(--border); font-size: 11px; flex-wrap: wrap; }
</style>
