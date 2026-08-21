<template>
  <div class="home">
    <!-- KPI -->
    <el-row :gutter="12">
      <el-col :span="4" v-for="c in kpis" :key="c.label">
        <el-card shadow="never" class="kpi">
          <div class="kpi-label">{{ c.label }}</div>
          <div class="kpi-value mono" :class="c.cls">{{ c.text }}</div>
          <div class="kpi-delta" :class="c.deltaCls">{{ c.deltaText }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 净值曲线 + 待办 -->
    <el-row :gutter="12" class="mt">
      <el-col :span="16">
        <el-card shadow="never">
          <template #header><div class="row"><b>账户净值曲线</b><span class="dim">实时账户权益 / 可叠加 BTC 基准</span></div></template>
          <div ref="eqChart" class="chart"></div>
          <el-empty v-if="!eqPoints.length" description="暂无权益数据（真实账户请先同步）" :image-size="50" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>待办</template>
          <div class="todo-item" v-for="t in todos" :key="t.title">
            <el-tag size="small" :type="t.type" effect="plain">{{ t.kind }}</el-tag>
            <span class="todo-text">{{ t.title }}</span>
            <el-button size="small" text type="primary" @click="t.action">{{ t.actionLabel }}</el-button>
          </div>
          <el-empty v-if="!todos.length" description="没有待办" :image-size="40" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 近期交易 + 符合度趋势 -->
    <el-row :gutter="12" class="mt">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><div class="row"><b>近期交易</b><router-link to="/journal" class="link">全部 →</router-link></div></template>
          <el-table :data="recent" size="small" @row-click="gotoDetail">
            <el-table-column prop="closeTime" label="日期" width="90"><template #default="{ row }">{{ fmtDate(row.closeTime) }}</template></el-table-column>
            <el-table-column prop="symbol" label="品种" width="90" />
            <el-table-column label="方向" width="50"><template #default="{ row }"><span :class="row.direction === 'LONG' ? 'up' : 'down'">{{ row.direction === 'LONG' ? '多' : '空' }}</span></template></el-table-column>
            <el-table-column label="净盈亏" width="80"><template #default="{ row }"><span :class="(row.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ row.netPnl?.toFixed(0) ?? '-' }}</span></template></el-table-column>
            <el-table-column label="R" width="50"><template #default="{ row }">{{ row.rMultiple?.toFixed(2) ?? '-' }}</template></el-table-column>
            <el-table-column label="符合度" width="60"><template #default="{ row }">{{ row.disciplineScore ?? '-' }}</template></el-table-column>
          </el-table>
          <el-empty v-if="!recent.length" description="还没有交易日志" :image-size="40" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>规则符合度趋势（执行力）</template>
          <div ref="discChart" class="chart"></div>
          <el-empty v-if="!discData.length" description="暂无评分数据" :image-size="40" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 快速操作 -->
    <el-card shadow="never" class="mt">
      <template #header>快速操作</template>
      <div class="row">
        <el-button type="primary" @click="$router.push('/journal?new=1')">+ 新建交易日志</el-button>
        <el-button @click="quickOpen">快速记录（关键字段）</el-button>
        <el-button @click="$router.push('/stats')">查看本月统计</el-button>
        <span class="dim">交易后 24 小时内填写，避免记忆偏差</span>
      </div>
    </el-card>

    <!-- 快速记录弹窗 -->
    <el-dialog v-model="quickVisible" title="快速记录" width="420px">
      <el-form label-width="70px" size="small">
        <el-form-item label="品种"><el-input v-model="quick.symbol" placeholder="BTCUSDT" /></el-form-item>
        <el-form-item label="方向">
          <el-radio-group v-model="quick.direction"><el-radio-button value="LONG">多</el-radio-button><el-radio-button value="SHORT">空</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item label="净盈亏"><el-input-number v-model="quick.netPnl" :precision="2" style="width: 100%" /></el-form-item>
        <el-form-item label="按计划"><el-select v-model="quick.planExecution" style="width: 100%"><el-option value="complete" label="完全执行" /><el-option value="partial" label="部分执行" /><el-option value="none" label="未执行" /></el-select></el-form-item>
        <el-form-item label="标签">
          <el-checkbox-group v-model="quick.tags">
            <el-checkbox v-for="t in TAG_OPTIONS" :key="t" :value="t" size="small">{{ t }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="quickVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="quickSaving" @click="quickSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api } from '../api.ts';

const TAG_OPTIONS = ['情绪化交易', '执行错误', '系统缺陷', '正常亏损', '正常盈利', '运气成分'];
const router = useRouter();

interface JRec { id?: string; tradeNo?: string; symbol: string; direction: string; closeTime?: number; netPnl?: number; rMultiple?: number; disciplineScore?: number; tags?: string[]; improvements?: string; planExecution?: string; market?: string }

const stats = ref<Record<string, number | string>>({});
const records = ref<JRec[]>([]);
const recent = ref<JRec[]>([]);
const eqPoints = ref<{ timestamp: number; equity: number }[]>([]);
const discData = ref<{ t: number; v: number }[]>([]);
const todos = ref<{ kind: string; type: 'warning' | 'danger' | 'info' | 'success'; title: string; actionLabel: string; action: () => void }[]>([]);
const eqChart = ref<HTMLDivElement | null>(null);
const discChart = ref<HTMLDivElement | null>(null);
let eqE: echarts.ECharts | null = null;
let discE: echarts.ECharts | null = null;

const quickVisible = ref(false);
const quickSaving = ref(false);
const quick = reactive<{ symbol: string; direction: 'LONG' | 'SHORT'; netPnl?: number; planExecution: string; tags: string[] }>({ symbol: '', direction: 'LONG', planExecution: 'complete', tags: [] });

function fmtDate(ts?: number) {
  return ts ? new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '-';
}
function weekRange(offset: number): [number, number] {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 周一为0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - offset * 7);
  const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return [monday.getTime(), end.getTime()];
}

const kpis = computed(() => {
  const s = stats.value;
  const net = Number(s.netPnl ?? 0);
  return [
    { label: '累计净收益', text: net.toFixed(0), cls: net >= 0 ? 'up' : 'down', deltaText: delta(s, 'netPnl', (v) => v.toFixed(0)), deltaCls: deltaCls(s, 'netPnl') },
    { label: '胜率', text: (Number(s.winRate ?? 0) * 100).toFixed(1) + '%', cls: '', deltaText: delta(s, 'winRate', (v) => (v * 100).toFixed(1) + '%'), deltaCls: deltaCls(s, 'winRate') },
    { label: '盈亏比', text: String(s.profitFactor === Infinity ? '∞' : Number(s.profitFactor ?? 0).toFixed(2)), cls: '', deltaText: delta(s, 'profitFactor', (v) => v.toFixed(2)), deltaCls: deltaCls(s, 'profitFactor') },
    { label: '平均 R', text: Number(s.avgR ?? 0).toFixed(2), cls: '', deltaText: delta(s, 'avgR', (v) => v.toFixed(2)), deltaCls: deltaCls(s, 'avgR') },
    { label: '期望值', text: Number(s.expectancy ?? 0).toFixed(2), cls: Number(s.expectancy ?? 0) >= 0 ? 'up' : 'down', deltaText: delta(s, 'expectancy', (v) => v.toFixed(2)), deltaCls: deltaCls(s, 'expectancy') },
    { label: '最大回撤', text: drawdownText(), cls: '', deltaText: '', deltaCls: '' },
  ];
});

const weekStats = ref<Record<string, number | string>>({});
const lastWeekStats = ref<Record<string, number | string>>({});
function delta(s: Record<string, number | string>, k: string, fmt: (v: number) => string): string {
  const cur = Number(s[k] ?? 0);
  const prev = Number(lastWeekStats.value[k] ?? 0);
  if (k === 'winRate' || k === 'avgR' || k === 'expectancy' || k === 'profitFactor') {
    const d = cur - prev;
    return 'vs 上周 ' + (d >= 0 ? '+' : '') + fmt(d);
  }
  return 'vs 上周 ' + (cur - prev >= 0 ? '+' : '') + fmt(cur - prev);
}
function deltaCls(s: Record<string, number | string>, k: string): string {
  const cur = Number(s[k] ?? 0);
  const prev = Number(lastWeekStats.value[k] ?? 0);
  return cur - prev >= 0 ? 'up' : 'down';
}
function drawdownText(): string {
  const pts = records.value.slice().sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0));
  let peak = 0, dd = 0;
  let cum = 0;
  for (const p of pts) {
    cum += p.netPnl ?? 0;
    if (cum > peak) peak = cum;
    if (peak > 0) dd = Math.max(dd, (peak - cum) / peak);
  }
  return (dd * 100).toFixed(1) + '%';
}

function renderEq() {
  if (!eqChart.value) return;
  if (!eqE) eqE = echarts.init(eqChart.value);
  const pts = eqPoints.value;
  if (!pts.length) { eqE.clear(); return; }
  eqE.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 16, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: pts.map((p) => new Date(p.timestamp).toLocaleDateString('zh-CN')) },
    yAxis: { type: 'value', scale: true },
    series: [{ type: 'line', showSymbol: false, data: pts.map((p) => p.equity), lineStyle: { color: '#4da3ff', width: 1.5 }, areaStyle: { color: 'rgba(77,163,255,0.06)' } }],
  });
}

function renderDisc() {
  if (!discChart.value) return;
  if (!discE) discE = echarts.init(discChart.value);
  discE.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 30, right: 12, top: 12, bottom: 24 },
    xAxis: { type: 'category', data: discData.value.map((d) => fmtDate(d.t)) },
    yAxis: { type: 'value', min: 0, max: 10 },
    series: [{ type: 'bar', data: discData.value.map((d) => d.v), itemStyle: { color: '#4da3ff' } }],
  });
}

function gotoDetail(row: JRec) {
  router.push('/journal?id=' + row.id);
}

function quickOpen() { quickVisible.value = true; }
async function quickSave() {
  quickSaving.value = true;
  try {
    await api.post('/journal/trades', { record: { ...quick, tradeNo: 'Q' + Date.now().toString(36), market: 'U本位合约' } });
    ElMessage.success('已快速记录');
    quickVisible.value = false;
    Object.assign(quick, { symbol: '', direction: 'LONG', netPnl: undefined, planExecution: 'complete', tags: [] });
    await loadAll();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    quickSaving.value = false;
  }
}

async function loadAll() {
  const [now, last] = weekRange(0);
  const [pnow, plast] = weekRange(1);
  const [all, wk, lwk, list] = await Promise.all([
    api.get<Record<string, number | string>>('/journal/trades/stats'),
    api.get<Record<string, number | string>>('/journal/trades/stats?from=' + now + '&to=' + last),
    api.get<Record<string, number | string>>('/journal/trades/stats?from=' + pnow + '&to=' + plast),
    api.get<{ records: JRec[] }>('/journal/trades?limit=100'),
  ]);
  stats.value = all;
  weekStats.value = wk;
  lastWeekStats.value = lwk;
  records.value = list.records;
  recent.value = list.records.slice(0, 8);
  discData.value = list.records
    .filter((r) => r.disciplineScore !== undefined)
    .slice(-15)
    .map((r) => ({ t: r.closeTime ?? 0, v: r.disciplineScore! }));

  // 权益曲线（真实账户优先）
  const accounts = await api.get<{ accounts: { id: string; type: string }[] }>('/accounts');
  const real = accounts.accounts.find((a) => a.type === 'real');
  const id = real?.id ?? accounts.accounts[0]?.id;
  if (id) {
    const detail = await api.get<{ equityCurve: { timestamp: number; equity: number }[] }>('/accounts/' + id);
    eqPoints.value = detail.equityCurve;
  }
  renderEq();
  renderDisc();

  // 待办
  const t: typeof todos.value = [];
  const trades = await api.get<{ trades: { symbol: string; side: string; tradedAt: number; realizedPnl?: number }[] }>('/trades?limit=30').catch(() => null);
  if (trades?.trades?.length) {
    const loggedSymbols = new Set(list.records.map((r) => r.symbol));
    const unlogged = trades.trades.filter((x) => !loggedSymbols.has(x.symbol)).slice(0, 3);
    for (const x of unlogged) {
      t.push({ kind: '补日志', type: 'warning', title: x.symbol + ' ' + (x.side === 'BUY' ? '买入' : '卖出') + ' 已有成交记录', actionLabel: '补填', action: () => router.push('/journal?quick=' + encodeURIComponent(JSON.stringify({ symbol: x.symbol }))) });
    }
  }
  for (const r of list.records.slice(0, 20)) {
    const problematic = (r.disciplineScore !== undefined && r.disciplineScore < 7) || (r.tags ?? []).some((tag) => ['情绪化交易', '执行错误', '系统缺陷'].includes(tag)) || (!r.improvements && r.netPnl !== undefined && r.netPnl < 0);
    if (problematic && t.length < 5) {
      t.push({ kind: '复盘', type: 'danger', title: r.symbol + ' ' + fmtDate(r.closeTime) + ' 需要复盘', actionLabel: '去复盘', action: () => router.push('/journal?id=' + r.id) });
    }
  }
  t.push({ kind: '计划', type: 'info', title: '今日无预设交易计划', actionLabel: '添加', action: () => router.push('/journal') });
  todos.value = t.slice(0, 6);
}

onMounted(async () => {
  await loadAll();
  window.addEventListener('resize', () => { eqE?.resize(); discE?.resize(); });
});
</script>

<style scoped>
.mt { margin-top: 12px; }
.row { display: flex; align-items: center; gap: 10px; }
.link { color: var(--accent); text-decoration: none; font-size: 12px; }
.dim { color: var(--text-dim); font-size: 12px; }
.kpi { text-align: left; }
.kpi-label { color: var(--text-dim); font-size: 12px; }
.kpi-value { font-size: 22px; font-weight: 700; margin: 4px 0 2px; }
.kpi-delta { font-size: 11px; color: var(--text-dim); }
.mono { font-family: var(--mono); }
.chart { height: 280px; }
.todo-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--border); font-size: 13px; }
.todo-text { flex: 1; }
</style>
