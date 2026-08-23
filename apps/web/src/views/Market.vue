<!-- ================= 行情页：K线图 + 技术指标 =================
  周期选择：单个下拉（鼠标悬停自动展开），显示当前激活周期；内置 置顶 / 常用周期 / 自定义 三组（置顶/自定义按账户持久化），自定义可编辑、可置顶、可删除。
  指标菜单：logo 图标下拉抽屉——一级为指标列表（MA/EMA 收进二级，不默认展示），点击“均线”进入二级明细（每条悬停显示 隐藏/编辑/删除 图标，可添加、可联动编辑）。
  指标设置按账户持久化（localStorage，key=aw-chart-ind-<accountId>），刷新/切换账户不丢失。
  VPVR：火焰图配色（低量深蓝 → 高量黄/红）。 -->
<template>
  <el-card shadow="never" class="tv-card fullbleed">
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
      <!-- 指标菜单（左侧，周期边上）：一级指标列表；点击“均线”进入二级明细 -->
      <el-popover v-model:visible="indOpen" placement="bottom-end" :width="430" trigger="click" @hide="indLevel = 'root'">
        <template #reference>
          <el-button size="small" class="ind-btn" :type="indOpen ? 'primary' : 'default'" title="指标设置"><el-icon><TrendCharts /></el-icon></el-button>
        </template>
        <div class="ind-panel">
          <!-- 一级：指标列表（MA / EMA 收进二级，不默认展示） -->
          <template v-if="indLevel === 'root'">
            <div class="ip-list">
              <div class="ip-item" title="点击进入 MA / EMA 明细" @click="indLevel = 'ma'">
                <span class="ip-ic" style="color:#f0a35e"><el-icon><DataLine /></el-icon></span>
                <span class="ip-t">均线 <span class="dim">MA / EMA</span></span>
                <span class="ip-st">{{ activeLineCount }} 条</span>
                <span class="ip-arrow">▸</span>
              </div>
              <div class="ip-item">
                <span class="ip-ic" style="color:#67c23a"><el-icon><Histogram /></el-icon></span>
                <span class="ip-t">成交量</span>
                <el-switch v-model="volOn" size="small" @change="render" />
              </div>
              <div class="ip-item">
                <span class="ip-ic" style="color:#e6a23c"><el-icon><Odometer /></el-icon></span>
                <span class="ip-t">MACD</span>
                <el-switch v-model="macdOn" size="small" @change="render" />
              </div>
              <div class="ip-item">
                <span class="ip-ic" style="color:#4da3ff"><el-icon><DataAnalysis /></el-icon></span>
                <span class="ip-t">RSI</span>
                <el-switch v-model="rsiOn" size="small" @change="render" />
              </div>
              <div class="ip-item">
                <span class="ip-ic" style="color:#9254de"><el-icon><PieChart /></el-icon></span>
                <span class="ip-t">VPVR</span>
                <el-switch v-model="vpvrOn" size="small" @change="render" />
              </div>
            </div>
          </template>
          <!-- 二级：均线明细（每条可隐藏/编辑/删除，可添加，可联动编辑） -->
          <template v-else>
            <div class="ip-sub">
              <div class="ip-sub-head">
                <el-button size="small" text @click="indLevel = 'root'"><el-icon><ArrowLeft /></el-icon>&nbsp;返回</el-button>
                <span class="ip-sub-title">均线</span>
                <span class="ip-grp" title="按组显示/隐藏全部均线">
                  <el-checkbox v-model="emaOn" size="small" @change="render">EMA</el-checkbox>
                  <el-checkbox v-model="maOn" size="small" @change="render">MA</el-checkbox>
                </span>
              </div>
              <div class="ip-sec-t">MA</div>
              <div class="ip-lines">
                <div v-for="ln in maLines" :key="ln.id" class="ip-line" :class="{ off: !ln.on, sel: linkMap[ln.id] }">
                  <el-checkbox v-model="ln.on" size="small" :title="'显示/隐藏 MA(' + fmtPeriod(ln.period) + ')'" @change="lineChanged(ln)" />
                  <span class="ip-name" :style="{ color: ln.color }">MA({{ fmtPeriod(ln.period) }})</span>
                  <input :value="ln.input" class="period-input" size="5" title="周期（支持小数，如 62.8）" @change="(e: Event) => setLinePeriod(ln, (e.target as HTMLInputElement).value)" @keyup.enter="(e: Event) => (e.target as HTMLInputElement).blur()" />
                  <input v-model="ln.color" type="color" class="color" :title="'颜色 ' + ln.color" @change="lineChanged(ln)" />
                  <el-input-number v-model="ln.width" :min="0.5" :max="4" :step="0.1" size="small" style="width: 56px" title="线宽" @change="lineChanged(ln)" />
                  <el-checkbox v-if="linkMode" v-model="linkMap[ln.id]" size="small" class="ip-linkbox" title="联动编辑勾选" @change="syncLink" />
                  <button v-if="lines.length > 1" class="del" title="删除该均线" @click="removeLineById(ln.id)">×</button>
                </div>
                <div v-if="!maLines.length" class="ip-empty" @click="addLine('ma')">暂无 MA 线，点击添加示例 MA(60)</div>
              </div>
              <div class="ip-sec-t">EMA</div>
              <div class="ip-lines">
                <div v-for="ln in emaLines" :key="ln.id" class="ip-line" :class="{ off: !ln.on, sel: linkMap[ln.id] }">
                  <el-checkbox v-model="ln.on" size="small" :title="'显示/隐藏 EMA(' + fmtPeriod(ln.period) + ')'" @change="lineChanged(ln)" />
                  <span class="ip-name" :style="{ color: ln.color }">EMA({{ fmtPeriod(ln.period) }})</span>
                  <input :value="ln.input" class="period-input" size="5" title="周期（支持小数，如 62.8）" @change="(e: Event) => setLinePeriod(ln, (e.target as HTMLInputElement).value)" @keyup.enter="(e: Event) => (e.target as HTMLInputElement).blur()" />
                  <input v-model="ln.color" type="color" class="color" :title="'颜色 ' + ln.color" @change="lineChanged(ln)" />
                  <el-input-number v-model="ln.width" :min="0.5" :max="4" :step="0.1" size="small" style="width: 56px" title="线宽" @change="lineChanged(ln)" />
                  <el-checkbox v-if="linkMode" v-model="linkMap[ln.id]" size="small" class="ip-linkbox" title="联动编辑勾选" @change="syncLink" />
                  <button v-if="lines.length > 1" class="del" title="删除该均线" @click="removeLineById(ln.id)">×</button>
                </div>
                <div v-if="!emaLines.length" class="ip-empty" @click="addLine('ema')">暂无 EMA 线，点击添加示例 EMA(60)</div>
              </div>
              <!-- 联动编辑：开启 ⛓ 联动并勾选 ≥2 条时，颜色/粗细应用到所有选中项 -->
              <div v-if="linkMode && linkCount >= 2" class="ip-link">
                <span class="ip-link-t">联动编辑 {{ linkCount }} 条</span>
                <input v-model="linkColor" type="color" class="color" title="应用到所有选中均线" @change="applyLinked" />
                <el-input-number v-model="linkWidth" :min="0.5" :max="4" :step="0.1" size="small" style="width: 72px" title="应用到所有选中均线" @change="applyLinked" />
                <el-button size="small" text type="primary" @click="clearLink">取消</el-button>
              </div>
              <div class="ip-actions">
                <el-button size="small" text type="primary" @click="addPeriod">+ 周期（MA+EMA）</el-button>
                <el-button size="small" text @click="addLine('ma')">+ MA</el-button>
                <el-button size="small" text @click="addLine('ema')">+ EMA</el-button>
                <el-button size="small" text :type="linkMode ? 'primary' : ''" @click="linkMode = !linkMode">⛓ 联动</el-button>
              </div>
            </div>
          </template>
        </div>
      </el-popover>
      <!-- 时间周期：单个下拉（鼠标悬停自动展开），显示当前激活周期；内置 置顶 / 常用周期 / 自定义 三组 -->
      <div class="tv-intervals">
        <!-- 置顶周期：默认展示 4 个（与下拉内置顶组同步） -->
        <button v-for="iv in pinnedItems" :key="iv.value" class="tv-tab" :class="{ active: interval === iv.value }" :title="iv.label" @click="changeInterval(iv.value)">{{ iv.short }}</button>
        <el-dropdown trigger="hover">
          <span class="iv-trigger mono" :title="'当前周期：' + intervalLabel">{{ intervalLabel }}<span class="caret">▾</span></span>
          <template #dropdown>
            <div class="iv-panel" @click.stop>
              <!-- 置顶 -->
              <div class="iv-sec">
                <div class="iv-sec-t">置顶</div>
                <div class="iv-chips">
                  <span v-for="iv in pinnedItems" :key="iv.value" class="iv-chip" :class="{ on: interval === iv.value }" :title="iv.label" @click="changeInterval(iv.value)">{{ iv.short }}<span class="iv-chip-act" title="移出置顶" @click.stop="unpinIv(iv.value)">×</span></span>
                </div>
              </div>
              <!-- 常用周期 -->
              <div class="iv-sec">
                <div class="iv-sec-t">常用周期</div>
                <div class="iv-chips">
                  <span v-for="iv in commonItems" :key="iv.value" class="iv-chip" :class="{ on: interval === iv.value }" :title="iv.label" @click="changeInterval(iv.value)">{{ iv.short }}<span class="iv-chip-act" title="移到置顶" @click.stop="pinIv(iv.value)"><el-icon><Top /></el-icon></span></span>
                </div>
              </div>
              <!-- 自定义 -->
              <div class="iv-sec">
                <div class="iv-sec-t">自定义</div>
                <div class="iv-chips">
                  <span v-for="iv in customItems" :key="iv.value" class="iv-chip" :class="{ on: interval === iv.value }" :title="iv.label" @click="changeInterval(iv.value)">{{ iv.short }}<span class="iv-chip-act" title="移到置顶" @click.stop="pinIv(iv.value)"><el-icon><Top /></el-icon></span><span class="iv-chip-act" title="删除" @click.stop="removeCustom(iv.value)">×</span></span>
                </div>
                <div class="iv-add">
                  <span class="dim">+ 添加</span>
                  <input v-model="addIvNum" class="cust-num" size="3" placeholder="45" @keyup.enter="addCustom" />
                  <select v-model="addIvUnit" class="cust-unit">
                    <option value="m">m</option><option value="h">h</option><option value="d">d</option><option value="w">w</option><option value="M">M</option>
                  </select>
                  <el-button size="small" text type="primary" @click="addCustom">添加</el-button>
                </div>
              </div>
            </div>
          </template>
        </el-dropdown>
      </div>
      <div class="tv-actions">
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
        <!-- 价格面板图例：EMA / MA 分两列（无 EMA/MA 提示标题，仅线值；右上角 × 关闭整组） -->
        <template v-if="g.cols && g.cols.length">
          <div v-for="col in g.cols" :key="col.key" class="lg-col">
            <span class="lg-x lg-x-col" :title="'关闭全部 ' + col.label + ' 均线'" @click="hideGroup(col.key)">×</span>
            <span v-for="(it, idx) in col.items" :key="idx" class="lg" :style="{ color: it.color }">
              {{ it.name }}<b>{{ it.value }}</b>
              <span v-if="it.id != null" class="lg-quick">
                <el-icon :title="'隐藏/显示 '" @click.stop="toggleLineById(it.id)"><View /></el-icon>
                <el-icon title="编辑" @click.stop="editLineFromLegend()"><EditPen /></el-icon>
                <el-icon title="删除" @click.stop="removeLineById(it.id)"><Delete /></el-icon>
              </span>
            </span>
          </div>
        </template>
        <!-- 其它面板（VOL/MACD/RSI）：× 在数值右边，点击关闭该指标 -->
        <template v-else>
          <span v-for="(it, idx) in g.items" :key="idx" class="lg" :style="{ color: it.color }">{{ it.name }}<b>{{ it.value }}</b></span>
          <span class="lg-x" :title="'关闭 ' + (g.label ?? g.key)" @click="hideIndicator(g.key)">×</span>
        </template>
      </div>

      <!-- 悬停 OHLC 浮窗（当前 K 柱：开高低收/涨跌幅/时间） -->
      <div
        v-if="hoverTip.visible"
        class="hover-tip mono"
        :style="{ left: hoverTip.x + 'px', top: hoverTip.y + 'px' }"
      >
        <div class="ht-time">{{ hoverTip.time }}</div>
        <div class="ht-row"><span class="ht-k">鼠标价</span><span>{{ hoverTip.mousePrice }} <b class="ht-pct" :class="hoverTip.mouseCls">{{ hoverTip.mousePct }}</b></span></div>
        <div class="ht-row"><span class="ht-k">开</span><span>{{ hoverTip.open }}</span></div>
        <div class="ht-row"><span class="ht-k">高</span><span class="up">{{ hoverTip.high }}</span></div>
        <div class="ht-row"><span class="ht-k">低</span><span class="down">{{ hoverTip.low }}</span></div>
        <div class="ht-row"><span class="ht-k">收</span><span :class="hoverTip.cls">{{ hoverTip.close }}</span></div>
        <div class="ht-row"><span class="ht-k">振幅</span><span>{{ hoverTip.amp }}</span></div>
        <div class="ht-row"><span class="ht-k">差值</span><span>{{ hoverTip.diff }}</span></div>
        <div class="ht-row"><span class="ht-k">涨跌</span><span :class="hoverTip.cls">{{ hoverTip.change }} · {{ hoverTip.changePct }}</span></div>
      </div>

      <!-- 可见区间最高/最低点：标在所在 K 线上（价格标签 + 连接线指向该 K 线的高/低点） -->
      <div v-if="hlMarkers.high" class="hl-mark hl-high" :style="{ left: hlMarkers.high.x + 'px', top: hlMarkers.high.y + 'px' }">{{ hlMarkers.high.price }}</div>
      <div v-if="hlMarkers.low" class="hl-mark hl-low" :style="{ left: hlMarkers.low.x + 'px', top: hlMarkers.low.y + 'px' }">{{ hlMarkers.low.price }}</div>
      <!-- 右侧价格列：可见区间最高/最低（与 POC 同一列），格式 88888(H) / 88888(L) -->
      <div v-if="hlRight.high" class="poc-mark hl-r-h mono" :style="{ top: hlRight.high.y + 'px' }">{{ hlRight.high.text }}</div>
      <div v-if="hlRight.low" class="poc-mark hl-r-l mono" :style="{ top: hlRight.low.y + 'px' }">{{ hlRight.low.text }}</div>
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
import { ArrowLeft, DataAnalysis, DataLine, Delete, EditPen, Histogram, Odometer, PieChart, Top, TrendCharts, View } from '@element-plus/icons-vue';
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
/** 默认置顶周期 */
const QUICK_INTERVAL_VALUES = ['1h', '4h', '1d', '1w'];
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
/** 默认视图左侧预热 K 线数：用于 MA/EMA 等指标左侧值计算（不参与默认可见窗口） */
const WARMUP = 250;

// ---------- 状态 ----------
const symbol = ref('BTCUSDT');
const market = ref('SPOT');
const interval = ref('1h');
// 时间周期：置顶 / 常用 / 自定义 三组（按账户持久化）
const pinnedIv = ref<string[]>([...QUICK_INTERVAL_VALUES]);
const customIvList = ref<{ value: string; label: string }[]>([]);
const addIvNum = ref('');
const addIvUnit = ref('m');
const limit = ref(256);
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

// ---------- 指标菜单：一级(列表) / 二级(均线明细) 导航 ----------
const indLevel = ref<'root' | 'ma'>('root');
const linkMode = ref(false);
const maLines = computed(() => lines.value.filter((l) => l.kind === 'ma'));
const emaLines = computed(() => lines.value.filter((l) => l.kind === 'ema'));
/** 当前可见均线条数（一级菜单“均线”行摘要） */
const activeLineCount = computed(() => {
  let n = 0;
  for (const l of lines.value) {
    if (l.on && (l.kind === 'ema' ? emaOn.value : maOn.value)) n++;
  }
  return n;
});
/** 图例快捷图标：隐藏/显示单条均线（按 id） */
function toggleLineById(id: number) {
  const ln = lines.value.find((l) => l.id === id);
  if (ln) { ln.on = !ln.on; render(); }
}
/** 图例快捷图标：删除单条均线（按 id） */
function removeLineById(id: number) {
  const i = lines.value.findIndex((l) => l.id === id);
  if (i >= 0) removeLine(i);
}
/** 图例快捷图标：编辑 → 打开指标菜单二级（均线明细直接展示编辑工具） */
function editLineFromLegend() {
  indOpen.value = true;
  indLevel.value = 'ma';
}
/** 周期显示文案：标准周期用中文标签；自定义按“数字+单位”转中文（45m→45分钟、2d→2天） */
const UNIT_CN: Record<string, string> = { m: '分钟', h: '小时', d: '天', w: '周', M: '月' };
function fmtIntervalLabel(v: string): string {
  const std = ALL_INTERVALS.find((i) => i.value === v);
  if (std) return std.label;
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d|w|M)$/.exec(v);
  if (m) return fmtPeriod(Number(m[1])) + (UNIT_CN[m[2]!] ?? m[2]!);
  return v;
}
const intervalLabel = computed(() => fmtIntervalLabel(interval.value));

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
// ---------- 时间周期三组：置顶 / 常用周期 / 自定义 ----------
interface IvItem { value: string; label: string; short: string }
function ivItemOf(v: string): IvItem | null {
  const std = ALL_INTERVALS.find((i) => i.value === v);
  if (std) return std;
  const c = customIvList.value.find((c) => c.value === v);
  if (c) return { value: c.value, label: c.label, short: c.label };
  return null;
}
const pinnedItems = computed(() => pinnedIv.value.map((v) => ivItemOf(v)).filter((x): x is IvItem => x != null));
const commonItems = computed(() => ALL_INTERVALS.filter((i) => !pinnedIv.value.includes(i.value)));
const customItems = computed(() => customIvList.value.filter((c) => !pinnedIv.value.includes(c.value)).map((c) => ({ value: c.value, label: c.label, short: c.label })));

function pinIv(v: string) {
  if (!pinnedIv.value.includes(v)) pinnedIv.value.push(v);
}
function unpinIv(v: string) {
  pinnedIv.value = pinnedIv.value.filter((x) => x !== v);
}
function addCustom() {
  const num = addIvNum.value.trim();
  if (!num) return;
  const v = num + addIvUnit.value;
  if (!resolveInterval(v)) {
    ElMessage.warning('周期格式：数字+时间单位，如 45m / 3h / 2d / 1w / 1M');
    return;
  }
  if (customIvList.value.some((c) => c.value === v)) {
    ElMessage.warning('该自定义周期已存在');
    return;
  }
  customIvList.value.push({ value: v, label: fmtIntervalLabel(v) });
  addIvNum.value = '';
}
function removeCustom(v: string) {
  customIvList.value = customIvList.value.filter((c) => c.value !== v);
  unpinIv(v);
  if (interval.value === v) changeInterval('1h');
}
// TradingView 风格：各面板独立图例（默认最新值，悬停联动）+ 状态栏
interface LegendItem { id?: number; name: string; color: string; value: string }
interface LegendCol { key: 'ema' | 'ma'; label: string; items: LegendItem[] }
interface LegendGroup { key: string; top: number; left: number; items?: LegendItem[]; cols?: LegendCol[]; label?: string }
const legends = ref<LegendGroup[]>([]);
const status = ref<{ time: string; open: string; high: string; low: string; close: string; change: string; changePct: string; cls: string; volume: string }>({
  time: '-', open: '-', high: '-', low: '-', close: '-', change: '-', changePct: '-', cls: '', volume: '-',
});

// 悬停 OHLC 浮窗（含振幅/差值/高低相对收盘价百分比：高用+，低用-）
const hoverTip = ref<{ visible: boolean; x: number; y: number; time: string; open: string; high: string; low: string; close: string; mousePrice: string; mousePct: string; mouseCls: string; amp: string; diff: string; change: string; changePct: string; cls: string }>({
  visible: false, x: 0, y: 0, time: '', open: '-', high: '-', low: '-', close: '-', mousePrice: '-', mousePct: '', mouseCls: '', amp: '-', diff: '-', change: '-', changePct: '-', cls: '',
});
// 可见区间最高/最低点：标在所在 K 线上（价格标签 + 连接线指向该 K 线的高/低点）
interface HlMarker { x: number; y: number; price: string }
const hlMarkers = ref<{ high: HlMarker | null; low: HlMarker | null }>({ high: null, low: null });
// 右侧价格列：可见区间最高/最低标记（与 POC 同一列），格式 88888(H) / 88888(L)
const hlRight = ref<{ high: { y: number; text: string } | null; low: { y: number; text: string } | null }>({ high: null, low: null });
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
    hlRight.value = { high: null, low: null };
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
    // 右侧价格列（与 POC 同一列）：格式 88888(H) / 88888(L)，锚定在价格高度
    hlRight.value = {
      high: { y: Math.max(4, Math.min(h - 16, pyHi)), text: fmtPrice(hi) + '(H)' },
      low: { y: Math.max(4, Math.min(h - 16, pyLo)), text: fmtPrice(lo) + '(L)' },
    };
  } catch {
    hlMarkers.value = { high: null, low: null };
    hlRight.value = { high: null, low: null };
  }
}

/** 面板图例布局：K线(price)/成交量(vol)/MACD(macd)/RSI(rsi) 各自左上角 */
let legendTops: Record<string, number> = { price: 6 };

// 悬停联动用：缓存最近一次渲染的指标（避免每次 mousemove 重算全量）
interface MaLine { id: number; name: string; color: string; vals: (number | null)[]; kind: 'ema' | 'ma' }
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
      id: ln.id,
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
    const it: LegendItem = { id: m.id, name: m.name, color: m.color, value: fmtPrice(v) };
    if (m.kind === 'ema') emaCol.items.push(it);
    else maCol.items.push(it);
  }
  const cols: LegendCol[] = [];
  if (emaOn.value && emaCol.items.length) cols.push(emaCol);
  if (maOn.value && maCol.items.length) cols.push(maCol);
  if (cols.length) groups.push({ key: 'price', top: legendTops.price ?? 6, left: 10, cols });
  // 成交量
  if (volOn.value) {
    const volItems: LegendItem[] = [];
    const v = candles.value[idx]?.volume;
    if (v != null) volItems.push({ name: 'VOL', color: '#8a94a3', value: fmtVol(v) });
    const vm = volMa[idx];
    if (vm != null) volItems.push({ name: 'VOL MA5', color: '#409eff', value: fmtVol(vm) });
    groups.push({ key: 'vol', label: '成交量', top: legendTops.vol ?? 0, left: 10, items: volItems });
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
    groups.push({ key: 'macd', label: 'MACD', top: legendTops.macd ?? 0, left: 10, items: macdItems });
  }
  // RSI
  if (rsiOn.value) {
    const rsiItems: LegendItem[] = [];
    const r = rsiVals[idx];
    if (r != null) rsiItems.push({ name: 'RSI(14)', color: '#4da3ff', value: Number(r).toFixed(2) });
    groups.push({ key: 'rsi', label: 'RSI', top: legendTops.rsi ?? 0, left: 10, items: rsiItems });
  }
  legends.value = groups;
}

/** 图例 ×（EMA/MA 列右上角）：关闭整组均线（重新开启在指标菜单） */
function hideGroup(key: 'ema' | 'ma') {
  if (key === 'ema') emaOn.value = false;
  else maOn.value = false;
  render();
}

/** 图例 ×（VOL/MACD/RSI 数值右边）：关闭该指标（重新开启在指标菜单） */
function hideIndicator(key: string) {
  if (key === 'vol') volOn.value = false;
  else if (key === 'macd') macdOn.value = false;
  else if (key === 'rsi') rsiOn.value = false;
  render();
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
// 视图平移（上下拖拽价格轴）与历史分页状态
let yPan = 0;                          // 价格轴上下平移量（相对可见区间基准范围）
let yDrag: { startY: number; startPan: number } | null = null;
let yPanRaf = 0;
let baseCandles: CandleView[] = [];    // 基础周期连续 K 线（历史页向左追加，含左侧预热数据）
let loadingHistory = false;            // 历史页加载中（防重入）
let reachedStart = false;              // 已到数据起点（无法再往前翻）
// 最近一次渲染的可见区间/价格信息（供拖拽平移时同步右侧价格标记）
let lastPocPrice: number | null = null;
let lastVisible: CandleView[] = [];
let lastRealFrom = 0;
// 用户是否手动调整过视图（拖拽/滚轮缩放）。true 时自动刷新保持绝对窗口位置（不跟随最新 K 线），
// 只在数据加载（load）或手动刷新后回到跟随最新状态。
let userAdjusted = false;
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
    chart!.setOption({ grid: gridTop.map((g) => ({ left: 8, right: 60, top: g.top, height: g.height })) });
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
async function load(resetZoom = true) {
  if (resetZoom) {
    zoomStart = 0;
    zoomEnd = 100;
  }
  loading.value = true;
  try {
    // 自定义周期（如 45m / 2w）：拉基础周期数据后前端聚合；
    // 额外多拉 WARMUP 根作为左侧预热（MA/EMA 左侧值用，不参与默认可见窗口）
    const { base, factor } = intervalFetch();
    const total = Math.min((limit.value + WARMUP) * factor, Math.floor(1000 / factor) * factor);
    const res = await api.get<{ candles: CandleView[] }>(
      '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + base + '&limit=' + total,
    );
    baseCandles = res.candles;
    candles.value = factor > 1 ? aggregateCandles(baseCandles, factor) : baseCandles;
    reachedStart = false;
    yPan = 0;
    userAdjusted = false; // 重新加载 → 回到默认视图（跟随最新 K 线）
    if (resetZoom && candles.value.length) {
      // 默认视图：最近 limit 根可见，左侧预热数据隐藏（用于 MA/EMA 左侧值），右侧留空可自由平移
      const warmup = Math.max(0, candles.value.length - limit.value);
      anchorZoom(warmup, candles.value.length);
    }
    const cs = candles.value;
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
let refreshingLatest = false; // 防重入：上一次刷新还在请求中则跳过本次（1s 高频下避免重叠/竞态）
async function refreshLatest() {
  if (refreshingLatest) return;
  if (!chart || !candles.value.length) return load();
  refreshingLatest = true;
  try {
    const { base, factor } = intervalFetch();
    const n = Math.min(limit.value * factor, Math.floor(1000 / factor) * factor);
    const res = await api.get<{ candles: CandleView[] }>(
      '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + base + '&limit=' + n,
    );
    const latestBase = res.candles;
    if (!latestBase.length) return;
    const prevArr = candles.value;
    const lastPrev = prevArr[prevArr.length - 1];
    const lastNew = latestBase[latestBase.length - 1];
    if (!lastNew) return;
    // 无变化（最新 K 线时间与收盘价一致）则跳过
    if (lastPrev && lastPrev.closeTime === lastNew.closeTime && lastPrev.close === lastNew.close) return;
    // 记录当前可见窗口的绝对位置（padded 空间，不 clamp 到真实 K 线）：
    // - 用户已调整视图：保持同一批 K 线可见，不跟随最新 K 线，右侧进入填充区也不回弹；
    // - 默认视图（未调整）：按距最新 K 线的偏移跟随，新 K 线自然进入视野。
    const oldPadded = prevArr.length + rightPadFor(prevArr.length);
    const oldFrom = Math.max(0, Math.floor((oldPadded * zoomStart) / 100));
    const oldToPadded = Math.max(oldFrom + 1, Math.ceil((oldPadded * zoomEnd) / 100));
    const oldTo = Math.min(prevArr.length, oldToPadded);
    const leftOff = prevArr.length - 1 - oldFrom;
    const rightOff = prevArr.length - oldTo;
    // 与已加载缓冲合并（保留左侧历史/预热页）：丢弃与新页重叠的旧尾部，避免缺口
    if (baseCandles.length) {
      const firstFresh = latestBase[0]!.openTime;
      let cut = baseCandles.length;
      while (cut > 0 && baseCandles[cut - 1]!.openTime >= firstFresh) cut--;
      baseCandles = [...baseCandles.slice(0, cut), ...latestBase];
    } else {
      baseCandles = latestBase;
    }
    const cs = factor > 1 ? aggregateCandles(baseCandles, factor) : baseCandles;
    if (!cs.length) return;
    candles.value = cs;
    // 锚定可见窗口：
    // - 用户已调整（拖拽/缩放）→ 保持绝对窗口位置：同一批 K 线原地不动，新 K 线不挤入视野，
    //   右侧原本在填充区时按填充区偏移保持（不再回弹到默认视图）；
    // - 默认视图 → 按距最新 K 线的偏移跟随，新 K 线进入视野（仅更新最新价格，不整体复位）。
    if (userAdjusted) {
      const newPadded = cs.length + rightPadFor(cs.length);
      const newFrom = Math.max(0, Math.min(oldFrom, cs.length - 1));
      const newToPadded = Math.min(newPadded, Math.max(newFrom + 1, oldToPadded));
      zoomStart = (newFrom / newPadded) * 100;
      zoomEnd = (newToPadded / newPadded) * 100;
    } else {
      const nf = Math.max(0, cs.length - 1 - leftOff);
      const nt = Math.min(cs.length, cs.length - rightOff);
      if (nf < cs.length && nt > nf + 1) {
        anchorZoom(nf, nt);
      }
    }

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
    const priceMin = yLo - yPad + yPan;
    const priceMax = yHi + yPad + yPan;
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
      dataZoom: [{ start: zoomStart, end: zoomEnd }],
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
    lastPocPrice = vpvrOn.value ? pocPrice : null;
    lastVisible = visible;
    lastRealFrom = realFrom;
    const last = cs[cs.length - 1]!;
    const prevC = cs.length > 1 ? cs[cs.length - 2]!.close : last.open;
    lastPrice.value = last.close;
    lastUp.value = last.close >= prevC;
    lastChangePct.value = prevC > 0 ? (((last.close - prevC) / prevC) * 100 >= 0 ? '+' : '') + (((last.close - prevC) / prevC) * 100).toFixed(2) + '%' : '';
  } catch {
    /* 自动刷新失败静默，等待下次 */
  } finally {
    refreshingLatest = false;
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
          // 振幅=(高-低)/昨收、差值=高-低；鼠标所在价位相对当前价(最新价)的百分比（OHLC 仅价格不带 %）
          const amp = prevC > 0 ? ((c.high - c.low) / prevC) * 100 : 0;
          const diff = c.high - c.low;
          const yVal = Number(point[1]);
          const curPrice = lastPrice.value ?? c.close;
          const mousePct = curPrice > 0 ? ((yVal - curPrice) / curPrice) * 100 : 0;
          const tw = chartEl.value?.clientWidth ?? 0;
          const th = chartEl.value?.clientHeight ?? 0;
          hoverTip.value = {
            visible: true,
            x: Math.min(x + 14, tw - 175),
            y: Math.min(y + 14, th - 195),
            time: new Date(c.openTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
            open: fmtPrice(c.open),
            high: fmtPrice(c.high),
            low: fmtPrice(c.low),
            close: fmtPrice(c.close),
            mousePrice: fmtPrice(yVal),
            mousePct: (mousePct >= 0 ? '+' : '') + mousePct.toFixed(2) + '%',
            mouseCls: mousePct >= 0 ? 'up' : 'down',
            amp: amp.toFixed(2) + '%',
            diff: fmtPrice(diff),
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
    // 视图上下拖拽：拖拽平移价格轴（左右平移由 dataZoom 内置处理，互不冲突）。
    // 注意：zrender 在 canvas 上 stopPropagation 掉 mousemove，冒泡到不了 window/chartEl，
    // 必须用捕获阶段监听（捕获先于 zrender 的目标阶段处理，必然能收到事件）。
    chartEl.value.addEventListener('mousedown', onYDown);
    chartEl.value.addEventListener('mousemove', onYMove, true);
    chartEl.value.addEventListener('mouseup', onYUp, true);
    chartEl.value.addEventListener('dblclick', () => {
      yPan = 0; // 双击重置价格轴平移
      render();
    });
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

  // 价格轴范围：可见 K 线高低 + 6% 边距（K 线不贴上下边框），VPVR 轴同步；上下拖拽平移量 yPan 叠加
  let yLo = Infinity, yHi = -Infinity;
  for (const c of visible) {
    if (c.low < yLo) yLo = c.low;
    if (c.high > yHi) yHi = c.high;
  }
  const yPad = (yHi - yLo) * 0.06;
  const priceMin = yLo - yPad + yPan;
  const priceMax = yHi + yPad + yPan;

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
    maLegend.push({ id: ln.id, name, color: ln.color, kind: ln.kind, vals });
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
        // VPVR 归一化限宽：最大量柱映射到目标宽度（网格 14%，上限 110px），其余按量等比缩放，不截断
        const maxBarW = Math.min(110, params.coordSys.width * 0.14);
        const w = Math.max(1, frac * maxBarW);
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
  // 图表内部左右只留一点点边距（左侧 8px，右侧 60px 仅容纳价格标签），K 线区域更宽
  const grids = gridTop.map((g) => ({ left: 8, right: 60, top: g.top, height: g.height }));

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
  lastPocPrice = vpvrOn.value ? pocPrice : null;
  lastVisible = visible;
  lastRealFrom = realFrom;
}

// ---------- 视图上下拖拽：拖拽平移价格轴（左右平移由 dataZoom 内置处理） ----------
/** 当前可见区间的价格范围（不含 yPan 偏移），用于拖拽平移换算 */
function currentPriceRange(): { lo: number; hi: number } | null {
  const cs = candles.value;
  if (!cs.length) return null;
  const RIGHT_PAD = rightPadFor(cs.length);
  const paddedLen = cs.length + RIGHT_PAD;
  const from = Math.max(0, Math.floor((paddedLen * zoomStart) / 100));
  const to = Math.min(paddedLen, Math.max(from + 1, Math.ceil((paddedLen * zoomEnd) / 100)));
  const realFrom = Math.min(cs.length, from);
  const realTo = Math.min(cs.length, Math.max(realFrom + 1, to));
  let lo = Infinity, hi = -Infinity;
  for (let i = realFrom; i < realTo; i++) {
    const c = cs[i]!;
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  const yPad = (hi - lo) * 0.06;
  return { lo: lo - yPad, hi: hi + yPad };
}

/** 应用价格轴平移（上下拖拽）：只改主图 y 轴范围，并同步右侧价格标记 */
function applyYPan() {
  if (!chart) return;
  const range = currentPriceRange();
  if (range == null) return;
  chart.setOption({ yAxis: [{ gridIndex: 0, min: range.lo + yPan, max: range.hi + yPan }] });
  updatePocMark(lastPocPrice);
  updateHlMarkers(lastVisible, lastRealFrom);
}

function onYDown(e: MouseEvent) {
  if (e.button !== 0) return;
  yDrag = { startY: e.clientY, startPan: yPan };
}
function onYMove(e: MouseEvent) {
  if (!yDrag) return;
  const dy = e.clientY - yDrag.startY;
  if (Math.abs(dy) < 2) return; // 死区：忽略轻微抖动
  const range = currentPriceRange();
  if (range == null) return;
  // 往下拖 = 视图下移 = 看到更高价格区间（与 TradingView 一致）
  const delta = (dy / Math.max(50, mainGridH)) * (range.hi - range.lo);
  yPan = yDrag.startPan + delta;
  if (yPanRaf) return;
  yPanRaf = requestAnimationFrame(() => {
    yPanRaf = 0;
    applyYPan();
  });
}
function onYUp() {
  yDrag = null;
}

// ---------- 历史分页：往右拖拽（向更早数据）到已加载边界时按页加载 ----------
/** 将视图窗口锚定到绝对 K 线区间 [fromIdx, toIdx)，历史页追加后保持窗口不跳动 */
function anchorZoom(fromIdx: number, toIdx: number) {
  const paddedLen = candles.value.length + rightPadFor(candles.value.length);
  zoomStart = Math.max(0, Math.min(100, (fromIdx / paddedLen) * 100));
  zoomEnd = Math.max(zoomStart + 1e-3, Math.min(100, (toIdx / paddedLen) * 100));
}

/** 加载更早一页历史（endTime 取当前最旧 K 线之前），追加后保持当前可见窗口不变 */
async function loadOlderPage() {
  if (loadingHistory || reachedStart || !baseCandles.length) return;
  loadingHistory = true;
  try {
    const { base, factor } = intervalFetch();
    const baseMs = INTERVAL_MS[base];
    if (!baseMs) return;
    const n = Math.min(limit.value * factor, Math.floor(1000 / factor) * factor);
    const endTime = baseCandles[0]!.openTime - baseMs;
    const res = await api.get<{ candles: CandleView[] }>(
      '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + base + '&limit=' + n + '&endTime=' + endTime,
    );
    const page = res.candles;
    if (!page.length) {
      reachedStart = true; // 已到数据起点，无法再往前翻
      return;
    }
    // 记录当前可见的绝对 K 线区间（追加后按平移量重新锚定）
    const oldLen = candles.value.length;
    const oldPaddedLen = oldLen + rightPadFor(oldLen);
    const realFrom = Math.max(0, Math.floor((oldPaddedLen * zoomStart) / 100));
    const realTo = Math.min(oldLen, Math.max(realFrom + 1, Math.ceil((oldPaddedLen * zoomEnd) / 100)));
    baseCandles = [...page, ...baseCandles];
    candles.value = factor > 1 ? aggregateCandles(baseCandles, factor) : baseCandles;
    const shift = candles.value.length - oldLen;
    anchorZoom(realFrom + shift, realTo + shift);
    render();
  } catch {
    /* 历史加载失败静默，下次拖拽再试 */
  } finally {
    loadingHistory = false;
  }
}

// ---------- 缩放：仅重算 VPVR（可见区间） ----------
function onZoom() {
  if (!chart) return;
  const dz = (chart.getOption() as { dataZoom?: unknown }).dataZoom;
  const arr = (Array.isArray(dz) ? dz : dz ? [dz] : []) as Array<{ start?: number; end?: number }>;
  const s = arr[0]?.start;
  const e = arr[0]?.end;
  if (s == null || e == null) return;
  userAdjusted = true; // 用户手动拖拽/缩放：自动刷新不再跟随最新 K 线
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
  // 历史分页：视图左缘到达已加载数据起点（拖动/缩放到最左）时，按页加载更早数据
  if (from <= 0 && !loadingHistory && !reachedStart && baseCandles.length) {
    void loadOlderPage();
  }
  // 缩放后价格轴范围随可见 K 线重算（K 线不贴上下边框）
  let yLo = Infinity, yHi = -Infinity;
  for (const c of visible) {
    if (c.low < yLo) yLo = c.low;
    if (c.high > yHi) yHi = c.high;
  }
  const yPad = (yHi - yLo) * 0.06;
  const priceMin = yLo - yPad + yPan;
  const priceMax = yHi + yPad + yPan;
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
  lastPocPrice = vpvrOn.value ? pocPrice : null;
  lastVisible = visible;
  lastRealFrom = realFrom;
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
// ---------- 时间周期配置持久化（置顶 / 自定义，按账户保存） ----------
function ivSettingsKey(): string {
  return 'aw-chart-iv-' + (accountStore.selectedId || 'default');
}
function saveIvSettings() {
  try {
    localStorage.setItem(ivSettingsKey(), JSON.stringify({ pinned: pinnedIv.value, custom: customIvList.value }));
  } catch { /* 存储异常忽略 */ }
}
function loadIvSettings() {
  try {
    const raw = localStorage.getItem(ivSettingsKey());
    if (!raw) return;
    const d = JSON.parse(raw) as { pinned?: unknown; custom?: unknown };
    if (Array.isArray(d.pinned)) {
      const list = d.pinned.filter((v): v is string => typeof v === 'string');
      if (list.length) pinnedIv.value = list;
    }
    if (Array.isArray(d.custom)) {
      customIvList.value = d.custom
        .filter((c): c is { value: string; label?: unknown } => !!c && typeof (c as { value?: unknown }).value === 'string')
        .map((c) => ({ value: c.value, label: typeof c.label === 'string' && c.label ? c.label : fmtIntervalLabel(c.value) }));
    }
  } catch { /* 损坏的存储忽略 */ }
}
// 任何指标设置变化自动保存；切换账户时加载对应账户的设置
watch([emaOn, maOn, volOn, macdOn, rsiOn, vpvrOn, lines], () => saveSettings(), { deep: true });
watch([pinnedIv, customIvList], () => saveIvSettings(), { deep: true });
watch(() => accountStore.selectedId, () => {
  loadSettings();
  loadIvSettings();
  render();
});

// ---------- 生命周期 ----------
// 自动刷新默认开启：周期取设置页「行情刷新周期」（1–60 秒，默认 1 秒）。
// 单次 klines 请求权重很低（≤1000 根=权重 5），1 秒一次 ≈ 60 次/分 ≈ 300 权重/分，远低于币安限流；
// 数据无变化时 refreshLatest 直接跳过，不重绘不额外开销；另有 refreshingLatest 防重入。
function startAutoRefresh() {
  if (timer) return;
  const sec = Math.max(1, Math.min(60, Number(localStorage.getItem('aw-market-refresh')) || 1));
  timer = setInterval(() => refreshLatest(), sec * 1000);
}

onMounted(() => {
  resizeHandler = () => {
    chart?.resize();
    measureChart();
  };
  window.addEventListener('resize', resizeHandler);
  measureChart();
  loadSettings();
  loadIvSettings();
  load();
  startAutoRefresh();
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
/* 行情图表左右占满内容区：抵消 .content 的 20px 左右内边距，不留白、不设 margin */
.tv-card.fullbleed {
  margin-left: -20px;
  margin-right: -20px;
  border-radius: 0 !important; /* 覆盖全局 .el-card 圆角 */
  border-left: none;
  border-right: none;
}
.dim { color: var(--text-dim); font-size: 12px; }
.mono { font-family: var(--mono); }
.up { color: #67c23a; }
.down { color: #f56c6c; }

/* TradingView 风格顶栏 */
.tv-top { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.tv-symbol { display: flex; align-items: center; gap: 6px; }
.tv-px { font-size: 15px; font-weight: 700; margin-left: 6px; }
.tv-chg { font-size: 11px; }
.tv-intervals { display: flex; align-items: center; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 5px; padding: 2px; }
/* 置顶周期 tab（默认展示 4 个） */
.tv-tab { border: none; background: none; color: var(--text-dim); font-size: 11px; padding: 3px 7px; border-radius: 4px; cursor: pointer; font-family: var(--mono); }
.tv-tab:hover { color: var(--text); }
.tv-tab.active { background: var(--accent); color: #fff; font-weight: 600; }
/* 当前周期下拉触发：显示激活周期，悬停展开 */
.iv-trigger { display: inline-flex; align-items: center; gap: 5px; color: var(--text); font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.iv-trigger:hover { color: var(--accent); }
.caret { font-size: 9px; opacity: 0.7; }
.cust-num { width: 54px; background: var(--bg-elev); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; font-family: var(--mono); padding: 2px 5px; text-align: center; }
.cust-num:focus { outline: none; border-color: var(--accent); }
.cust-unit { border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); font-size: 11px; font-family: var(--mono); padding: 2px 2px; cursor: pointer; border-radius: 4px; }
.cust-unit:focus { outline: none; }
/* 周期下拉面板：置顶 / 常用周期 / 自定义 三组 */
.iv-panel { width: 330px; }
.iv-sec { padding: 4px 0 6px; border-bottom: 1px solid var(--border); }
.iv-sec:last-child { border-bottom: none; }
.iv-sec-t { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; font-weight: 600; }
.iv-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.iv-chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px; background: var(--bg-elev); border: 1px solid var(--border); font-size: 11px; font-family: var(--mono); cursor: pointer; color: var(--text); }
.iv-chip:hover { border-color: var(--accent); }
.iv-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.iv-chip-act { display: inline-flex; align-items: center; font-size: 10px; opacity: 0.55; cursor: pointer; border-radius: 2px; line-height: 1; padding: 0 1px; }
.iv-chip-act .el-icon { font-size: 11px; vertical-align: middle; }
.iv-chip-act:hover { opacity: 1; color: var(--accent); background: rgba(64,158,255,0.15); }
.iv-chip.on .iv-chip-act { color: #fff; }
.iv-chip.on .iv-chip-act:hover { color: #f56c6c; background: rgba(245,108,108,0.25); }
.iv-edit, .iv-add { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
.tv-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

/* 指标菜单（下拉抽屉，logo 图标）：一级列表 + 二级均线明细 */
.ind-panel { font-size: 12px; }
.ind-btn { font-size: 15px; padding: 5px 8px; }
.ind-btn .el-icon { font-size: 15px; }
.ip-list { display: flex; flex-direction: column; gap: 2px; }
.ip-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; }
.ip-item:hover { background: var(--bg-elev); }
.ip-ic { display: inline-flex; align-items: center; }
.ip-ic .el-icon { font-size: 15px; }
.ip-t { flex: 1; }
.ip-st { font-size: 11px; color: var(--text-dim); font-family: var(--mono); }
.ip-arrow { color: var(--text-dim); font-size: 12px; }
.ip-sub-head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.ip-sub-title { font-weight: 700; }
.ip-grp { display: inline-flex; align-items: center; gap: 2px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; margin-left: auto; }
.ip-grp :deep(.el-checkbox__label) { font-weight: 600; font-size: 11px; }
.ip-sec-t { font-size: 11px; color: var(--text-dim); margin: 6px 0 2px; font-weight: 600; }
.ip-lines { display: flex; flex-direction: column; gap: 2px; max-height: 196px; overflow-y: auto; }
.ip-line { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border-radius: 4px; min-height: 22px; }
.ip-line:hover { background: var(--bg-elev); }
.ip-line.off { opacity: 0.45; }
.ip-line.sel { background: rgba(64,158,255,0.12); outline: 1px solid rgba(64,158,255,0.4); }
.ip-line :deep(.el-checkbox) { margin-right: 0; }
.ip-name { font-family: var(--mono); font-size: 11px; font-weight: 600; }
/* 菜单二级直接展示编辑工具（周期/颜色/线宽），删除按钮靠右 */
.ip-name { font-family: var(--mono); font-size: 11px; font-weight: 600; width: 62px; flex: none; }
.ip-line .del { margin-left: auto; }
.ip-linkbox { flex: none; }
.ip-empty { font-size: 11px; color: var(--text-dim); padding: 4px 6px; cursor: pointer; border: 1px dashed var(--border); border-radius: 4px; }
.ip-empty:hover { color: var(--accent); border-color: var(--accent); }
.ip-link { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(64,158,255,0.08); border: 1px solid rgba(64,158,255,0.35); border-radius: 5px; margin-top: 6px; }
.ip-link-t { color: #409eff; font-weight: 600; margin-right: 2px; }
.ip-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); }

/* 图表 + 图例浮层 + 面板拖拽手柄 */
.chart-wrap { position: relative; }
.chart { height: calc(100vh - 248px); min-height: 420px; width: 100%; }
.legend { position: absolute; display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; font-family: var(--mono); pointer-events: none; z-index: 5; }
.lg { display: inline-flex; align-items: center; }
.lg b { font-weight: 600; margin-left: 3px; }
/* 图例行悬浮快捷图标（K线图上）：隐藏/编辑/删除 */
.lg-quick { display: none; align-items: center; gap: 3px; margin-left: 4px; pointer-events: auto; }
.lg:hover .lg-quick { display: inline-flex; }
.lg-quick .el-icon { font-size: 11px; cursor: pointer; color: var(--text-dim); padding: 1px; border-radius: 3px; }
.lg-quick .el-icon:hover { color: #fff; background: rgba(128,140,155,0.25); }
.lg-quick .el-icon:last-child:hover { color: #f56c6c; background: rgba(245,108,108,0.15); }
/* EMA / MA 图例分两列（组关闭时不渲染，不留灰色框） */
.lg-col { position: relative; display: flex; flex-direction: column; gap: 2px; background: rgba(17,22,29,0.6); border: 1px solid var(--border); border-radius: 5px; padding: 3px 14px 4px 8px; }
.lg-col .lg { line-height: 1.5; }
/* 图例关闭 ×：EMA/MA 在列右上角（无 EMA/MA 标题），VOL/MACD/RSI 在数值右边 */
.lg-x { pointer-events: auto; cursor: pointer; color: var(--text-dim); font-size: 12px; line-height: 1; padding: 0 2px; border-radius: 3px; }
.lg-x:hover { color: #f56c6c; background: rgba(245,108,108,0.15); }
.lg-x-col { position: absolute; top: 1px; right: 2px; }
.drag-handle { position: absolute; left: 6px; right: 54px; height: 7px; cursor: row-resize; z-index: 6; border-top: 1px dashed transparent; }
.drag-handle:hover { border-top: 1px dashed var(--accent); }
/* 悬停 OHLC 浮窗 */
.hover-tip { position: absolute; z-index: 7; background: rgba(17,22,29,0.92); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; font-size: 11px; pointer-events: none; min-width: 152px; }
.ht-pct { font-weight: 600; margin-left: 4px; }
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
.poc-mark { position: absolute; left: auto; right: 4px; transform: translateY(-50%); z-index: 6; font-size: 10px; color: #e6c55a; padding: 1px 4px; border-radius: 3px; background: rgba(17,22,29,0.85); border: 1px solid rgba(230,197,90,0.35); pointer-events: none; white-space: nowrap; line-height: 1.4; }
/* 右侧价格列：最高/最低（与 POC 同列同式样，仅颜色区分） */
.poc-mark.hl-r-h { color: #67c23a; border-color: rgba(103,194,58,0.55); }
.poc-mark.hl-r-l { color: #f56c6c; border-color: rgba(245,108,108,0.55); }
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
