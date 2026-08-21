<template>
  <div class="home">
    <!-- 账户选择 -->
    <el-card shadow="never" class="mb">
      <div class="row">
        <span class="label">账户：</span>
        <el-select :model-value="accountStore.selectedId" style="width: 240px" @change="onAccountChange">
          <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
        </el-select>
        <el-button size="small" @click="loadAll">刷新</el-button>
        <span class="dim">当前展示数据均来自「{{ acctLabelText }}」账户</span>
        <span v-if="acctType === 'real'" class="dim">· 余额/持仓/成交为币安同步的实际数据</span>
      </div>
    </el-card>

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
          <template #header><div class="row"><b>账户净值曲线</b><span class="dim">{{ acctLabelText }} · 实际账户权益</span></div></template>
          <div ref="eqChart" class="chart"></div>
          <el-empty v-if="!eqPoints.length" description="该账户暂无权益数据（真实账户请先同步）" :image-size="50" />
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

    <!-- 近期成交 + 符合度趋势 -->
    <el-row :gutter="12" class="mt">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><div class="row"><b>近期成交（实际 · {{ acctLabelText }}）</b><router-link to="/trades" class="link">全部 →</router-link></div></template>
          <el-table :data="recentFills" size="small">
            <el-table-column prop="tradedAt" label="时间" width="130"><template #default="{ row }">{{ fmtDate(row.tradedAt) }}</template></el-table-column>
            <el-table-column prop="symbol" label="品种" width="90" />
            <el-table-column label="市场" width="90"><template #default="{ row }">{{ MARKET_LABELS[row.market] ?? row.market }}</template></el-table-column>
            <el-table-column label="方向" width="55"><template #default="{ row }"><span :class="row.side === 'BUY' ? 'up' : 'down'">{{ row.side === 'BUY' ? '买' : '卖' }}</span></template></el-table-column>
            <el-table-column prop="qty" label="数量" width="80" />
            <el-table-column prop="price" label="价格" width="90" />
            <el-table-column label="已实现盈亏" width="90"><template #default="{ row }"><span :class="(row.realizedPnl ?? 0) >= 0 ? 'up' : 'down'">{{ row.realizedPnl?.toFixed(2) ?? '-' }}</span></template></el-table-column>
          </el-table>
          <el-empty v-if="!recentFills.length" description="该账户暂无成交记录" :image-size="40" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>规则符合度趋势（执行力 · 交易日志）</template>
          <div ref="discChart" class="chart"></div>
          <el-empty v-if="!discData.length" description="该账户暂无日志评分数据" :image-size="40" />
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
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api, MARKET_LABELS, type TradeAgg } from '../api.ts';
import { accountLabel, accountStore, loadAccounts, selectAccount } from '../store.ts';

const TAG_OPTIONS = ['情绪化交易', '执行错误', '系统缺陷', '正常亏损', '正常盈利', '运气成分'];
const router = useRouter();

interface JRec { id?: string; symbol: string; market?: string; direction: string; closeTime?: number; netPnl?: number; rMultiple?: number; disciplineScore?: number; tags?: string[]; improvements?: string; planExecution?: string }
interface Fill { id: string; symbol: string; market: string; side: string; qty: number; price: number; fee: number; realizedPnl?: number; tradedAt: number }

const agg = ref<TradeAgg | null>(null);
const weekAgg = ref<TradeAgg | null>(null);
const lastWeekAgg = ref<TradeAgg | null>(null);
const records = ref<JRec[]>([]);
const recentFills = ref<Fill[]>([]);
const eqPoints = ref<{ timestamp: number; equity: number }[]>([]);
const discData = ref<{ t: number; v: number }[]>([]);
const todos = ref<{ kind: string; type: 'warning' | 'danger' | 'info' | 'success'; title: string; actionLabel: string; action: () => void }[]>([]);
const eqChart = ref<HTMLDivElement | null>(null);
const discChart = ref<HTMLDivElement | null>(null);
let eqE: echarts.ECharts | null = null;
let discE: echarts.ECharts | null = null;

const acct = computed(() => accountStore.accounts.find((a) => a.id === accountStore.selectedId) ?? null);
const acctLabelText = computed(() => accountLabel(acct.value));
const acctType = computed(() => acct.value?.type ?? '');

const quickVisible = ref(false);
const quickSaving = ref(false);
const quick = reactive<{ symbol: string; direction: 'LONG' | 'SHORT'; netPnl?: number; planExecution: string; tags: string[] }>({ symbol: '', direction: 'LONG', planExecution: 'complete', tags: [] });

function fmtDate(ts?: number) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
}
function weekRange(offset: number): [number, number] {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 周一为0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - offset * 7);
  const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return [monday.getTime(), end.getTime()];
}

const kpis = computed(() => {
  const a = agg.value;
  const w = weekAgg.value;
  const lw = lastWeekAgg.value;
  const net = a?.netPnl ?? 0;
  const wNet = (w?.netPnl ?? 0) - (lw?.netPnl ?? 0);
  const wWin = ((w?.winRate ?? 0) - (lw?.winRate ?? 0)) * 100;
  const wTrades = (w?.totalTrades ?? 0) - (lw?.totalTrades ?? 0);
  const last = eqPoints.value.length ? eqPoints.value[eqPoints.value.length - 1]!.equity : null;
  const pf = a?.profitFactor;
  return [
    { label: '当前权益', text: last != null ? last.toFixed(2) : '—', cls: '', deltaText: a?.feesPaid != null ? '手续费 ' + a.feesPaid.toFixed(2) : '', deltaCls: '' },
    { label: '累计净收益', text: net.toFixed(2), cls: net >= 0 ? 'up' : 'down', deltaText: 'vs 上周 ' + (wNet >= 0 ? '+' : '') + wNet.toFixed(2), deltaCls: wNet >= 0 ? 'up' : 'down' },
    { label: '胜率', text: ((a?.winRate ?? 0) * 100).toFixed(1) + '%', cls: '', deltaText: 'vs 上周 ' + (wWin >= 0 ? '+' : '') + wWin.toFixed(1) + '%', deltaCls: wWin >= 0 ? 'up' : 'down' },
    { label: '盈亏比', text: pf === undefined || pf === null ? '—' : pf === Infinity ? '∞' : pf.toFixed(2), cls: '', deltaText: '', deltaCls: '' },
    { label: '最大回撤', text: drawdownText(), cls: '', deltaText: '', deltaCls: '' },
    { label: '交易数', text: String(a?.totalTrades ?? 0), cls: '', deltaText: 'vs 上周 ' + (wTrades >= 0 ? '+' : '') + wTrades, deltaCls: wTrades >= 0 ? 'up' : 'down' },
  ];
});

function drawdownText(): string {
  let peak = -Infinity;
  let dd = 0;
  for (const p of eqPoints.value) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) dd = Math.max(dd, (peak - p.equity) / peak);
  }
  return eqPoints.value.length ? (dd * 100).toFixed(1) + '%' : '—';
}

function renderEq() {
  if (!eqChart.value) return;
  if (!eqE) eqE = echarts.init(eqChart.value);
  const pts = eqPoints.value;
  if (!pts.length) { eqE.clear(); return; }
  eqE.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 16, top: 16, bottom: 24 },
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
    xAxis: { type: 'category', data: discData.value.map((d) => new Date(d.t).toLocaleDateString('zh-CN')) },
    yAxis: { type: 'value', min: 0, max: 10 },
    series: [{ type: 'bar', data: discData.value.map((d) => d.v), itemStyle: { color: '#4da3ff' } }],
  });
}

function quickOpen() { quickVisible.value = true; }
async function quickSave() {
  quickSaving.value = true;
  try {
    await api.post('/journal/trades', { record: { ...quick, tradeNo: 'Q' + Date.now().toString(36), market: 'U本位合约', accountId: accountStore.selectedId || undefined } });
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
  await loadAccounts();
  const acctId = accountStore.selectedId;
  if (!acctId) {
    agg.value = null; weekAgg.value = null; lastWeekAgg.value = null;
    records.value = []; recentFills.value = []; eqPoints.value = []; discData.value = []; todos.value = [];
    renderEq(); renderDisc();
    return;
  }
  const [now, last] = weekRange(0);
  const [pnow, plast] = weekRange(1);
  let list: { records: JRec[] } = { records: [] };
  let fills: { trades: Fill[] } = { trades: [] };
  try {
    const [detail, wk, lwk, l, fl] = await Promise.all([
      api.get<{ equityCurve: { timestamp: number; equity: number }[]; aggregates: TradeAgg | null }>('/accounts/' + acctId),
      api.get<TradeAgg>('/pnl?accountId=' + acctId + '&from=' + now + '&to=' + last),
      api.get<TradeAgg>('/pnl?accountId=' + acctId + '&from=' + pnow + '&to=' + plast),
      api.get<{ records: JRec[] }>('/journal/trades?accountId=' + acctId + '&limit=200'),
      api.get<{ trades: Fill[] }>('/trades?accountId=' + acctId + '&limit=50'),
    ]);
    agg.value = detail.aggregates;
    weekAgg.value = wk;
    lastWeekAgg.value = lwk;
    list = l;
    fills = fl;
    records.value = l.records;
    recentFills.value = fl.trades.slice(0, 8); // listTrades 已按时间倒序（最新在前）
    eqPoints.value = detail.equityCurve ?? [];
    discData.value = l.records
      .filter((r) => r.disciplineScore !== undefined)
      .slice(-15)
      .map((r) => ({ t: r.closeTime ?? 0, v: r.disciplineScore! }));
  } catch (e) {
    ElMessage.error('数据加载失败：' + (e instanceof Error ? e.message : String(e)));
  }
  renderEq();
  renderDisc();

  // 待办（基于所选账户）
  const t: typeof todos.value = [];
  const logged = new Set(records.value.map((r) => (r.symbol + '|' + (r.market ?? '') + '|' + r.direction).toUpperCase()));
  for (const x of fills.trades.slice(-10)) {
    const key = (x.symbol + '|' + x.market + '|' + (x.side === 'BUY' ? 'LONG' : 'SHORT')).toUpperCase();
    if (!logged.has(key) && t.length < 3) {
      t.push({
        kind: '补日志', type: 'warning', title: x.symbol + ' ' + (x.side === 'BUY' ? '买入' : '卖出') + ' 已有实际成交',
        actionLabel: '补填', action: () => router.push('/journal?quick=' + encodeURIComponent(JSON.stringify({ symbol: x.symbol, market: MARKET_LABELS[x.market] ?? x.market, direction: x.side === 'BUY' ? 'LONG' : 'SHORT' }))),
      });
    }
  }
  for (const r of records.value.slice(0, 20)) {
    const problematic = (r.disciplineScore !== undefined && r.disciplineScore < 7) || (r.tags ?? []).some((tag) => ['情绪化交易', '执行错误', '系统缺陷'].includes(tag)) || (!r.improvements && r.netPnl !== undefined && r.netPnl < 0);
    if (problematic && t.length < 5) {
      t.push({ kind: '复盘', type: 'danger', title: r.symbol + ' ' + fmtDate(r.closeTime) + ' 需要复盘', actionLabel: '去复盘', action: () => router.push('/journal?id=' + r.id) });
    }
  }
  t.push({ kind: '计划', type: 'info', title: '今日无预设交易计划', actionLabel: '添加', action: () => router.push('/journal') });
  todos.value = t.slice(0, 6);
}

function onAccountChange(id: string) {
  selectAccount(id);
  loadAll();
}

watch(() => accountStore.selectedId, () => loadAll());

onMounted(async () => {
  await loadAll();
  window.addEventListener('resize', () => { eqE?.resize(); discE?.resize(); });
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.mt { margin-top: 12px; }
.row { display: flex; align-items: center; gap: 10px; }
.label { font-size: 13px; color: var(--text-dim); }
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
.up { color: #67c23a; }
.down { color: #f56c6c; }
</style>
