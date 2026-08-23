<template>
  <div class="dashboard aw-page">
    <!-- 4.1 顶部 KPI 条（固定） -->
    <div class="kpi-bar">
      <div class="kpi-block main">
        <div class="kpi-label">累计盈亏</div>
        <div class="kpi-value mono" :class="netPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(netPnl) }} <span class="kpi-sub">USDT</span></div>
        <div class="kpi-extra" :class="totalReturn >= 0 ? 'up' : 'down'">({{ fmtPctSigned(totalReturn) }})</div>
      </div>
      <div class="kpi-sep"></div>
      <div class="kpi-block">
        <div class="kpi-label">持仓中</div>
        <div class="kpi-value mono">{{ counts.holding }}</div>
        <div class="kpi-extra dim">笔</div>
      </div>
      <div class="kpi-block" :class="{ 'has-todo': counts.pending > 0 }">
        <div class="kpi-label">待复盘</div>
        <div class="kpi-value mono" :class="{ down: counts.pending > 0 }">{{ counts.pending }}</div>
        <div class="kpi-extra" :class="counts.pending > 0 ? 'down' : 'dim'">{{ counts.pending > 0 ? '需处理' : '无积压' }}</div>
      </div>
      <div class="kpi-block">
        <div class="kpi-label">今日计划</div>
        <div class="kpi-value mono">{{ todayPlans }}</div>
        <div class="kpi-extra dim">条</div>
      </div>
    </div>
    <div v-if="counts.pending > 0" class="kpi-progress"><div class="kpi-progress-fill" :style="{ width: pendingRatio + '%' }"></div></div>

    <!-- 4.2 账户全景面板（折叠） -->
    <div class="aw-card panorama">
      <div class="panorama-head" @click="panoramaOpen = !panoramaOpen">
        <span class="p-title">账户全景</span>
        <span class="p-toggle">{{ panoramaOpen ? '▴' : '▾' }}</span>
      </div>
      <transition name="fade">
        <div v-if="panoramaOpen" class="panorama-grid">
          <div class="pano-card" v-for="c in panoramaCards" :key="c.title">
            <div class="pano-title">{{ c.title }}</div>
            <div class="pano-body">
              <div v-for="row in c.rows" :key="row.label" class="pano-row" :title="row.hint">
                <span class="pano-label">{{ row.label }}</span>
                <span class="pano-val mono" :class="row.cls">{{ row.value }}</span>
              </div>
            </div>
          </div>
          <div class="pano-export">
            <button class="aw-btn aw-btn-text" @click="exportReport">导出账户报告 →</button>
          </div>
        </div>
      </transition>
    </div>

    <!-- 4.3 主内容三栏 -->
    <div class="main3">
      <!-- 左栏 50%：持仓监控 -->
      <div class="aw-card col">
        <div class="col-head">
          <b>当前持仓</b>
          <span class="dim">{{ lastUpdate }}</span>
        </div>
        <div v-if="holdings.length" class="hold-list">
          <div v-for="h in holdings" :key="h.symbol + h.side" class="hold-item" :class="{ 'edge-up': h.pnl >= 0, 'edge-down': h.pnl < 0 }">
            <div class="hold-main">
              <div class="hold-sym">
                <span class="coin-ic">{{ h.symbol.slice(0, 1) }}</span>
                <b>{{ h.symbol }}</b>
                <span class="dir-tag" :class="h.side === 'LONG' ? 'long' : 'short'">{{ h.side === 'LONG' ? '多' : '空' }}</span>
              </div>
              <div class="hold-price">
                <span class="mono">{{ fmtPrice(h.entry) }}</span>
                <span class="arr">→</span>
                <span class="mono">{{ fmtPrice(h.current) }}</span>
              </div>
              <div class="hold-pnl mono" :class="h.pnl >= 0 ? 'up' : 'down'">{{ fmtPnl(h.pnl) }}</div>
            </div>
            <div class="hold-foot">
              <span class="dim" v-if="h.planRef">计划：{{ h.planRef }}</span>
              <span class="dim" v-else>无关联计划</span>
              <span class="dim">持仓 {{ h.duration }}</span>
            </div>
          </div>
        </div>
        <div v-else class="aw-empty">
          <svg class="aw-empty-illus" viewBox="0 0 64 48"><rect x="4" y="10" width="56" height="30" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 28 L28 18 L38 26 L50 14" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <span>当前无持仓，去交易日志页制定计划</span>
          <button class="aw-btn aw-btn-text" @click="go('/journal?new=1')">去新建计划 →</button>
        </div>
      </div>

      <!-- 中栏 30%：流转漏斗 -->
      <div class="aw-card col">
        <div class="col-head"><b>交易流转</b></div>
        <div class="funnel">
          <div v-for="s in funnel" :key="s.key" class="funnel-row" :class="{ has: s.count > 0, 'funnel-pending': s.key === 'pending' && s.count > 0 }">
            <span class="funnel-label" :style="{ color: s.color }"><span class="funnel-dot" :style="{ background: s.color }"></span>{{ s.label }}</span>
            <span class="funnel-count mono">{{ s.count }}</span>
            <span class="funnel-arrow">──▶</span>
            <button v-if="s.key === 'pending' && s.count > 0" class="aw-btn aw-btn-primary mini" @click="go('/review')">去处理</button>
          </div>
        </div>
        <div class="funnel-trend">
          <div class="dim">近 7 天「待复盘→已复盘」转化</div>
          <div class="trend-bars">
            <div v-for="(t, i) in conversionTrend" :key="i" class="trend-col">
              <div class="trend-bar" :style="{ height: t.v + '%' }" :title="t.day + ' ' + t.v + '%'"></div>
              <div class="trend-day">{{ t.day }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右栏 20%：快速入口 -->
      <div class="aw-card col">
        <div class="col-head"><b>快速入口</b></div>
        <div class="quick-actions">
          <button class="aw-btn aw-btn-primary quick" @click="go('/journal?new=1')"><el-icon><Plus /></el-icon>+ 新建计划</button>
          <button class="aw-btn aw-btn-secondary quick" @click="go('/review')"><el-icon><EditPen /></el-icon>+ 补记复盘</button>
          <button class="aw-btn aw-btn-secondary quick" @click="importVisible = true"><el-icon><Upload /></el-icon>+ 历史导入</button>
        </div>
        <div class="strategy-feedback" @click="go('/strategies')">
          <div class="sf-title">策略反馈</div>
          <div class="sf-desc">已复盘 {{ counts.done }} 条记录可供策略分析</div>
          <span class="sf-link">去查看 →</span>
        </div>
      </div>
    </div>

    <!-- 4.4 底部折叠区 -->
    <div class="aw-card bottom-fold">
      <div class="fold-head" @click="foldOpen = !foldOpen">
        <b>本周流转效率</b><span class="dim">转化率趋势</span><span class="p-toggle">{{ foldOpen ? '▴' : '▾' }}</span>
      </div>
      <transition name="fade">
        <div v-if="foldOpen" class="fold-body">
          <div class="fold-charts">
            <div ref="effChart" class="eff-chart"></div>
            <div class="recent-reviews">
              <div class="rr-title">最近复盘结论</div>
              <div v-for="r in recentReviews" :key="r.id" class="rr-item">
                <span class="rr-sym mono">{{ r.symbol }}</span>
                <span class="rr-txt">{{ r.lesson }}</span>
                <span class="dim">{{ fmtTime(r.time) }}</span>
              </div>
              <div v-if="!recentReviews.length" class="dim">暂无已复盘记录</div>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- 历史导入弹窗 -->
    <el-dialog v-model="importVisible" title="历史交易导入" width="480px">
      <div class="import-tip dim">导入的历史记录将直接进入「待复盘」状态，前往复盘中心补记日志与复盘。</div>
      <el-form label-width="70px" size="small" class="mt8">
        <el-form-item label="账户">
          <el-select v-model="importForm.accountId" style="width: 100%">
            <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="示例行">
          <el-input v-model="sampleLine" placeholder="symbol,side,qty,price,closeTimeMs,pnl" class="mono" />
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" title="快速导入示例（每行一条，逗号分隔）" description="BTCUSDT,LONG,0.5,71500,1787416000000,450" />
      <template #footer>
        <el-button size="small" @click="importVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="importing" @click="doImport">导入并标记待复盘</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api } from '../api.ts';
import { accountStore, loadAccounts } from '../store.ts';
import type { TradeJournal } from '../lib/journal.ts';
import { deriveStatus, fmtPnl, fmtPrice, fmtTime, holdingDuration, fmtDuration, STATUS_META, STATUS_ORDER } from '../lib/journal.ts';

const router = useRouter();
function go(path: string) { router.push(path); }

const records = ref<TradeJournal[]>([]);
const fills = ref<{ symbol: string; side: string; qty: number; price: number; realizedPnl?: number; tradedAt: number }[]>([]);
const eqPoints = ref<{ timestamp: number; equity: number }[]>([]);
const agg = ref<{ netPnl?: number; totalTrades?: number; winRate?: number; profitFactor?: number } | null>(null);
const positions = ref<{ symbol: string; side: string; quantity: number; avgEntryPrice: number; unrealizedPnl: number }[]>([]);
const tickers = ref<Record<string, { lastPrice: number }>>({});
const panoramaOpen = ref(true);
const foldOpen = ref(true);
const importVisible = ref(false);
const importing = ref(false);
const importForm = ref<{ accountId: string }>({ accountId: '' });
const sampleLine = ref('BTCUSDT,LONG,0.5,71500,1787416000000,450');
const effChart = ref<HTMLDivElement | null>(null);
let effE: echarts.ECharts | null = null;

const counts = computed(() => {
  const c = { plan: 0, holding: 0, pending: 0, done: 0 };
  for (const r of records.value) c[deriveStatus(r)]++;
  // 真实账户持仓并入「持仓中」
  if (positions.value.length) c.holding = Math.max(c.holding, positions.value.length);
  return c;
});

const netPnl = computed(() => {
  const fromJournal = records.value.reduce((a, r) => a + (r.netPnl ?? 0), 0);
  return fromJournal || agg.value?.netPnl || 0;
});

const totalReturn = computed(() => {
  const eq = eqPoints.value;
  if (!eq.length) return 0;
  const first = eq[0]?.equity ?? 1;
  const last = eq[eq.length - 1]?.equity ?? 0;
  return first > 0 ? (last - first) / first : 0;
});

const pendingRatio = computed(() => {
  const total = counts.value.plan + counts.value.holding + counts.value.pending + counts.value.done;
  return total ? Math.round((counts.value.pending / total) * 100) : 0;
});

const todayPlans = computed(() => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return records.value.filter((r) => deriveStatus(r) === 'plan' && (r.createdAt ?? 0) >= start.getTime() && (r.createdAt ?? 0) <= end.getTime()).length;
});

const lastUpdate = computed(() => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));

/** 持仓列表：优先真实账户持仓，否则日志中的持仓中记录 */
const holdings = computed(() => {
  const out: { symbol: string; side: string; entry: number; current: number; pnl: number; planRef: string; duration: string }[] = [];
  for (const p of positions.value) {
    const t = tickers.value[p.symbol]?.lastPrice;
    const cur = t ?? p.avgEntryPrice;
    const pnl = p.unrealizedPnl ?? 0;
    const dur = fmtDuration(Date.now() - (Date.now() - 3600_000)); // 真实账户无开仓时间，显示 —
    out.push({ symbol: p.symbol, side: p.side === 'SHORT' ? 'SHORT' : 'LONG', entry: p.avgEntryPrice, current: cur, pnl, planRef: '', duration: dur === '—' ? '实时' : dur });
  }
  for (const r of records.value) {
    if (deriveStatus(r) !== 'holding') continue;
    if (out.some((o) => o.symbol === r.symbol)) continue;
    const t = tickers.value[r.symbol]?.lastPrice;
    const entry = r.actualEntry ?? 0;
    const cur = t ?? entry;
    const qty = r.actualQty ?? 1;
    const pnl = entry ? (cur - entry) * qty * (r.direction === 'SHORT' ? -1 : 1) : 0;
    out.push({ symbol: r.symbol, side: r.direction, entry, current: cur, pnl, planRef: r.strategyName ?? '', duration: fmtDuration(holdingDuration(r)) });
  }
  return out.slice(0, 12);
});

const funnel = computed(() => STATUS_ORDER.map((key) => ({
  key,
  label: STATUS_META[key].label,
  color: STATUS_META[key].color,
  count: counts.value[key],
})));

/** 近7天 待复盘→已复盘 转化率（模拟从记录分布） */
const conversionTrend = computed(() => {
  const days: { day: string; v: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
    const closed = records.value.filter((r) => (r.closeTime ?? 0) >= d.getTime() && (r.closeTime ?? 0) <= dEnd.getTime());
    const reviewed = closed.filter((r) => deriveStatus(r) === 'done');
    const v = closed.length ? Math.round((reviewed.length / closed.length) * 100) : 0;
    days.push({ day: (d.getMonth() + 1) + '/' + d.getDate(), v });
  }
  return days;
});

const recentReviews = computed(() => records.value
  .filter((r) => deriveStatus(r) === 'done' && (r.improvements || r.strengths))
  .slice(0, 3)
  .map((r) => ({ id: r.id, symbol: r.symbol, lesson: (r.improvements || r.strengths || '').slice(0, 40), time: r.closeTime ?? r.updatedAt })));

/** 账户全景 2×3 网格 */
const panoramaCards = computed(() => {
  const st = journalStats.value;
  const a = agg.value;
  const wins = st?.wins ?? 0;
  const losses = st?.losses ?? 0;
  const closed = st?.closed ?? 0;
  const firstT = records.value.length ? Math.min(...records.value.map((r) => r.createdAt ?? Date.now())) : Date.now();
  const years = Math.max((Date.now() - firstT) / (365 * 86400000), 0);
  const winAmt = st?.netPnl !== undefined && st?.wins ? 0 : 0; // 平均盈利从聚合数据
  const avgWin = a?.winRate !== undefined && a?.netPnl !== undefined ? 0 : 0;
  const maxWin = Math.max(0, ...records.value.map((r) => r.netPnl ?? 0));
  const maxLoss = Math.min(0, ...records.value.map((r) => r.netPnl ?? 0));
  const dd = maxDrawdown();
  const streak = streaks();
  const wins2 = Math.max(...records.value.filter((r) => (r.netPnl ?? 0) > 0).map((r) => r.netPnl ?? 0), 0);
  const loss2 = Math.min(...records.value.filter((r) => (r.netPnl ?? 0) < 0).map((r) => r.netPnl ?? 0), 0);

  return [
    {
      title: '交易概况',
      rows: [
        { label: '总交易数', value: String(records.value.length), hint: '全部已记录交易' },
        { label: '已完成', value: String(closed), hint: '已平仓的交易' },
        { label: '持仓中', value: String(holdings.value.length), hint: '当前未平仓（含真实账户持仓）' },
        { label: '交易年限', value: years.toFixed(1) + ' 年', hint: '从首笔记录起' },
        { label: '日均交易', value: (years > 0 ? (closed / 365 / years).toFixed(1) : '—') + ' 笔', hint: '平均每日完成交易数' },
      ],
    },
    {
      title: '收益质量',
      rows: [
        { label: '夏普比率', value: fmt2(sharpe()), hint: '夏普 <1 一般 / 1-2 良好 / >2 优秀' },
        { label: '索提诺比率', value: fmt2(sortino()), hint: '仅统计下行波动' },
        { label: '卡尔玛比率', value: fmt2(calmar()), hint: '年化收益 / 最大回撤，<2 一般 / 2-3 良好 / >3 优秀' },
        { label: '月均收益', value: fmtPct(monthlyReturn()), hint: '按月平均收益率' },
        { label: '标准差', value: fmtPct(stdDev()), hint: '收益波动' },
      ],
    },
    {
      title: '盈亏结构',
      rows: [
        { label: '盈利笔数', value: String(wins), hint: '' },
        { label: '亏损笔数', value: String(losses), hint: '' },
        { label: '平均盈利', value: wins ? fmtPnl(wins ? (records.value.filter(r => (r.netPnl ?? 0) > 0).reduce((a, r) => a + (r.netPnl ?? 0), 0) / wins) : 0) : '—', hint: '' },
        { label: '平均亏损', value: losses ? fmtPnl(losses ? (records.value.filter(r => (r.netPnl ?? 0) < 0).reduce((a, r) => a + (r.netPnl ?? 0), 0) / losses) : 0) : '—', hint: '' },
        { label: '期望值', value: closed ? fmtPnl(st?.expectancy ?? 0) : '—', hint: '单笔平均期望' },
        { label: '最大单笔', value: fmtPnl(maxWin) + ' / ' + fmtPnl(maxLoss), hint: '盈利 / 亏损' },
      ],
    },
    {
      title: '回撤与连击',
      rows: [
        { label: '最大回撤', value: fmtPct(dd.max), hint: '<10% 优秀 / 10-20% 可控 / >20% 高风险', cls: dd.max > 0.2 ? 'down' : dd.max > 0.1 ? 'todo' : 'up' },
        { label: '当前回撤', value: fmtPct(dd.current), hint: '距最近高点的回撤' },
        { label: '最大连胜', value: String(streak.maxWin), hint: '连续盈利笔数' },
        { label: '最大连败', value: String(streak.maxLoss), hint: '连续亏损笔数' },
        { label: '恢复时间', value: dd.recovery + ' 天', hint: '最大回撤后恢复天数' },
      ],
    },
    {
      title: '时间分布',
      rows: [
        { label: '盈利月份', value: String(monthStats().winMonths), hint: '净盈利的月份数' },
        { label: '亏损月份', value: String(monthStats().lossMonths), hint: '净亏损的月份数' },
        { label: '最佳月份', value: fmtPct(monthStats().best), hint: '单月最高收益率' },
        { label: '最差月份', value: fmtPct(monthStats().worst), hint: '单月最低收益率' },
        { label: '连续盈利月', value: String(monthStats().curWinStreak) + '（当前）', hint: '当前连续盈利月份' },
      ],
    },
    {
      title: '持仓特征',
      rows: [
        { label: '平均持仓', value: avgHoldText(), hint: '全部已平仓记录的平均持仓时长' },
        { label: '中位数', value: medianHoldText(), hint: '持仓时长中位数' },
        { label: '最长持仓', value: maxHoldText(), hint: '最长单笔持仓' },
        { label: '平均仓位使用率', value: '—', hint: '需账户数据支持' },
      ],
    },
  ];
});

function fmt2(v: number): string { return Number.isFinite(v) ? v.toFixed(2) : '—'; }
function fmtPct(v: number): string { return Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—'; }
function fmtPctSigned(v: number): string { return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

const journalStats = ref<{ closed: number; wins: number; losses: number; netPnl: number; expectancy: number } | null>(null);

function maxDrawdown(): { max: number; current: number; recovery: number } {
  const pts = eqPoints.value;
  if (pts.length < 2) return { max: 0, current: 0, recovery: 0 };
  let peak = pts[0]!.equity;
  let maxDd = 0;
  let maxDdTime = 0;
  let cur = 0;
  for (const p of pts) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak > 0 ? (peak - p.equity) / peak : 0;
    if (dd > maxDd) { maxDd = dd; maxDdTime = p.timestamp; }
    cur = dd;
  }
  const last = pts[pts.length - 1]!;
  const recoveryDays = last.timestamp > maxDdTime ? (last.timestamp - maxDdTime) / 86400000 : 0;
  return { max: maxDd, current: cur, recovery: Math.round(recoveryDays) };
}

function streaks(): { maxWin: number; maxLoss: number } {
  let mw = 0, ml = 0, cw = 0, cl = 0;
  for (const r of records.value) {
    const n = r.netPnl ?? 0;
    if (n > 0) { cw++; cl = 0; mw = Math.max(mw, cw); }
    else if (n < 0) { cl++; cw = 0; ml = Math.max(ml, cl); }
  }
  return { maxWin: mw, maxLoss: ml };
}

function sharpe(): number {
  const rets = returns();
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
}
function sortino(): number {
  const rets = returns();
  const negs = rets.filter((r) => r < 0);
  if (rets.length < 2 || !negs.length) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const downSd = Math.sqrt(negs.reduce((a, b) => a + b * b, 0) / rets.length);
  return downSd > 0 ? (mean / downSd) * Math.sqrt(252) : 0;
}
function calmar(): number {
  const dd = maxDrawdown().max;
  const yr = annualized();
  return dd > 0 ? yr / dd : 0;
}
function annualized(): number {
  const eq = eqPoints.value;
  if (eq.length < 2) return 0;
  const days = (eq[eq.length - 1]!.timestamp - eq[0]!.timestamp) / 86400000;
  const total = (eq[eq.length - 1]!.equity - eq[0]!.equity) / (eq[0]!.equity || 1);
  return days > 0 ? Math.pow(1 + total, 365 / days) - 1 : 0;
}
function monthlyReturn(): number {
  const rets = returns();
  return rets.length ? rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length / 22) : 0;
}
function stdDev(): number {
  const rets = returns();
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
}
function returns(): number[] {
  const sorted = records.value.filter((r) => r.netPnl !== undefined && r.closeTime).sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0));
  return sorted.map((r) => r.netPnl! / 1000); // 按千单位收益率近似
}
function monthStats(): { winMonths: number; lossMonths: number; best: number; worst: number; curWinStreak: number } {
  const byMonth: Record<string, number> = {};
  for (const r of records.value) {
    if (r.netPnl === undefined) continue;
    const k = new Date(r.closeTime ?? r.createdAt!).toISOString().slice(0, 7);
    byMonth[k] = (byMonth[k] ?? 0) + r.netPnl;
  }
  const keys = Object.keys(byMonth).sort();
  const vals = keys.map((k) => byMonth[k]!);
  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    if ((byMonth[keys[i]!] ?? 0) > 0) streak++;
    else break;
  }
  return {
    winMonths: vals.filter((v) => v > 0).length,
    lossMonths: vals.filter((v) => v < 0).length,
    best: keys.length ? Math.max(...vals) / 10000 : 0,
    worst: keys.length ? Math.min(...vals) / 10000 : 0,
    curWinStreak: streak,
  };
}
function holdTimes(): number[] {
  return records.value
    .filter((r) => r.openTime && r.closeTime && r.closeTime > r.openTime!)
    .map((r) => r.closeTime! - r.openTime!)
    .sort((a, b) => a - b);
}
function avgHoldText(): string {
  const h = holdTimes();
  return h.length ? fmtDuration(h.reduce((a, b) => a + b, 0) / h.length) : '—';
}
function medianHoldText(): string {
  const h = holdTimes();
  if (!h.length) return '—';
  const mid = Math.floor(h.length / 2);
  return fmtDuration(h.length % 2 ? h[mid]! : (h[mid - 1]! + h[mid]!) / 2);
}
function maxHoldText(): string {
  const h = holdTimes();
  return h.length ? fmtDuration(h[h.length - 1]!) : '—';
}

function exportReport() {
  const lines = ['AgentWin 账户报告 ' + new Date().toLocaleDateString('zh-CN'), '---'];
  for (const c of panoramaCards.value) {
    lines.push('## ' + c.title);
    for (const row of c.rows) lines.push(row.label + ': ' + row.value);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'agentwin-report.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function doImport() {
  if (!importForm.value.accountId) { ElMessage.warning('请选择账户'); return; }
  importing.value = true;
  try {
    const lines = sampleLine.value.split('\n').map((s) => s.trim()).filter(Boolean);
    let ok = 0;
    for (const line of lines) {
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length < 6) continue;
      const [symbol, side, qty, price, closeTime, pnl] = parts;
      const record = {
        symbol: (symbol ?? 'BTCUSDT').toUpperCase(),
        direction: side === 'SHORT' ? 'SHORT' : 'LONG',
        market: '现货',
        actualQty: Number(qty) || 1,
        actualEntry: Number(price) || 0,
        actualExit: Number(price) || 0,
        closeTime: Number(closeTime) || Date.now(),
        netPnl: Number(pnl) || 0,
        pnl: Number(pnl) || 0,
        accountId: importForm.value.accountId,
        tags: ['历史导入'],
      };
      await api.post('/journal/trades', { record });
      ok++;
    }
    ElMessage.success('成功导入 ' + ok + ' 条记录，均已标记为待复盘，前往复盘中心 →');
    importVisible.value = false;
    await loadAll();
    router.push('/review');
  } catch (e) {
    ElMessage.error('导入失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    importing.value = false;
  }
}

async function loadAll() {
  await loadAccounts();
  const acctId = accountStore.selectedId;
  if (!acctId) return;
  try {
    const [jl, detail, tk] = await Promise.all([
      api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000'),
      api.get<{ equityCurve: { timestamp: number; equity: number }[]; aggregates: { netPnl?: number; totalTrades?: number; winRate?: number; profitFactor?: number } | null; positions?: { symbol: string; side: string; quantity: number; avgEntryPrice: number; unrealizedPnl: number }[] }>('/accounts/' + acctId),
      api.get<{ tickers: { symbol: string; lastPrice: number }[] }>('/market/tickers?market=USDT_M').catch(() => ({ tickers: [] })),
    ]);
    records.value = jl.records;
    eqPoints.value = detail.equityCurve ?? [];
    agg.value = detail.aggregates;
    positions.value = detail.positions ?? [];
    const t: Record<string, { lastPrice: number }> = {};
    for (const x of tk.tickers) t[x.symbol] = { lastPrice: x.lastPrice };
    tickers.value = t;
    const wins = records.value.filter((r) => (r.netPnl ?? 0) > 0).length;
    const losses = records.value.filter((r) => (r.netPnl ?? 0) < 0).length;
    journalStats.value = {
      closed: records.value.filter((r) => deriveStatus(r) === 'done' || deriveStatus(r) === 'pending').length,
      wins, losses,
      netPnl: records.value.reduce((a, r) => a + (r.netPnl ?? 0), 0),
      expectancy: (wins + losses) ? records.value.reduce((a, r) => a + (r.netPnl ?? 0), 0) / (wins + losses) : 0,
    };
    renderEff();
  } catch (e) {
    ElMessage.error('数据加载失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

function renderEff() {
  if (!effChart.value) return;
  if (!effE) effE = echarts.init(effChart.value);
  effE.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 36, right: 12, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: conversionTrend.value.map((t) => t.day), axisLabel: { color: '#6b7280', fontSize: 10 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#6b7280', fontSize: 10, formatter: '{value}%' } },
    series: [{ type: 'bar', data: conversionTrend.value.map((t) => t.v), itemStyle: { color: '#06b6d4', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 26 }],
  });
}

onMounted(async () => {
  await loadAll();
  window.addEventListener('resize', () => effE?.resize());
});
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 12px; max-width: 1440px; }
.mt8 { margin-top: 8px; }

/* KPI 条 */
.kpi-bar {
  display: flex; align-items: stretch; gap: 0;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px;
  padding: 14px 8px;
}
.kpi-block { flex: 1; text-align: right; padding: 0 18px; position: relative; }
.kpi-block.main { text-align: right; }
.kpi-label { font-size: 11px; color: var(--aw-text-dim); margin-bottom: 4px; }
.kpi-value { font-size: 22px; font-weight: 700; color: var(--aw-text-title); }
.kpi-value .kpi-sub { font-size: 12px; font-weight: 400; color: var(--aw-text-dim); }
.kpi-extra { font-size: 11px; margin-top: 2px; }
.kpi-sep { width: 1px; background: var(--aw-border); margin: 4px 0; }
.kpi-progress { height: 3px; border-radius: 2px; background: var(--aw-border); overflow: hidden; }
.kpi-progress-fill { height: 100%; background: var(--aw-todo); border-radius: 2px; transition: width 400ms var(--aw-ease); }

/* 全景 */
.panorama { padding: 0; }
.panorama-head { display: flex; align-items: center; gap: 8px; padding: 12px 20px; cursor: pointer; }
.p-title { font-weight: 600; color: var(--aw-text-title); font-size: 14px; }
.p-toggle { margin-left: auto; color: var(--aw-text-dim); font-size: 12px; }
.panorama-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 0 20px 16px; }
.pano-card { background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; padding: 14px 16px; }
.pano-title { font-size: 12px; color: var(--aw-text-dim); margin-bottom: 10px; }
.pano-row { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; font-size: 12px; cursor: default; }
.pano-label { color: var(--aw-text-dim); }
.pano-val { color: var(--aw-text-title); font-size: 12px; }
.pano-export { grid-column: 1 / -1; text-align: right; }

/* 三栏 */
.main3 { display: grid; grid-template-columns: 5fr 3fr 2fr; gap: 12px; }
.col { display: flex; flex-direction: column; min-height: 240px; }
.col-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.col-head b { font-size: 13px; color: var(--aw-text-title); }
.col-head .dim { font-size: 11px; margin-left: auto; }

/* 持仓卡片 */
.hold-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 320px; }
.hold-item {
  position: relative; border: 1px solid var(--aw-border); border-radius: 10px;
  padding: 10px 12px; background: var(--aw-bg-card); overflow: hidden;
  transition: border-color var(--aw-dur-fast) var(--aw-ease);
}
.hold-item:hover { border-color: var(--aw-border-hover); }
.hold-item.edge-up::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, #10b981, rgba(16,185,129,0.2)); }
.hold-item.edge-down::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, #ef4444, rgba(239,68,68,0.2)); }
.hold-main { display: flex; align-items: center; gap: 10px; }
.hold-sym { display: flex; align-items: center; gap: 6px; width: 140px; }
.coin-ic { width: 22px; height: 22px; border-radius: 50%; background: var(--aw-accent-dim); color: var(--aw-accent); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex: none; }
.dir-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.dir-tag.long { background: rgba(239,68,68,0.15); color: #f87171; }
.dir-tag.short { background: rgba(16,185,129,0.15); color: #34d399; }
.hold-price { display: flex; align-items: center; gap: 6px; flex: 1; font-size: 12px; color: var(--aw-text-body); }
.hold-price .arr { color: var(--aw-text-disabled); }
.hold-pnl { font-size: 14px; font-weight: 700; min-width: 80px; text-align: right; }
.hold-foot { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; }

/* 漏斗 */
.funnel { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.funnel-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
  background: rgba(255,255,255,0.02); border: 1px solid transparent;
}
.funnel-row.has { border-color: var(--aw-border); }
.funnel-row.funnel-pending { border-color: rgba(239,68,68,0.4); animation: aw-pulse 2s infinite; }
.funnel-label { display: flex; align-items: center; gap: 6px; font-size: 12px; width: 64px; }
.funnel-dot { width: 6px; height: 6px; border-radius: 50%; }
.funnel-count { font-size: 15px; font-weight: 700; color: var(--aw-text-title); }
.funnel-arrow { color: var(--aw-text-disabled); font-size: 10px; flex: 1; }
.aw-btn.mini { height: 22px; padding: 0 10px; font-size: 11px; }
.funnel-trend { border-top: 1px dashed var(--aw-border); padding-top: 8px; }
.trend-bars { display: flex; align-items: flex-end; gap: 4px; height: 56px; margin-top: 6px; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.trend-bar { width: 100%; max-width: 22px; background: var(--aw-accent); border-radius: 3px 3px 0 0; opacity: 0.75; min-height: 2px; transition: height 400ms var(--aw-ease); }
.trend-day { font-size: 9px; color: var(--aw-text-dim); }

/* 快速入口 */
.quick-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.aw-btn.quick { width: 100%; height: 36px; }
.strategy-feedback {
  border: 1px dashed var(--aw-border); border-radius: 10px; padding: 10px 12px; cursor: pointer;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.strategy-feedback:hover { border-color: var(--aw-accent); background: var(--aw-accent-dim); }
.sf-title { font-size: 12px; color: var(--aw-text-title); font-weight: 600; }
.sf-desc { font-size: 11px; color: var(--aw-text-dim); margin: 4px 0; }
.sf-link { font-size: 11px; color: var(--aw-accent); }

/* 底部折叠 */
.bottom-fold { padding: 0; }
.fold-head { display: flex; align-items: center; gap: 10px; padding: 12px 20px; cursor: pointer; }
.fold-head b { font-size: 13px; color: var(--aw-text-title); }
.fold-head .dim { font-size: 11px; }
.fold-body { padding: 0 20px 16px; }
.fold-charts { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.eff-chart { height: 160px; }
.recent-reviews { border-left: 1px solid var(--aw-border); padding-left: 16px; }
.rr-title { font-size: 12px; color: var(--aw-text-dim); margin-bottom: 8px; }
.rr-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
.rr-sym { color: var(--aw-accent); font-weight: 600; }
.rr-txt { flex: 1; color: var(--aw-text-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity 150ms var(--aw-ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.import-tip { font-size: 12px; margin-bottom: 12px; }
@media (max-width: 1200px) {
  .main3 { grid-template-columns: 1fr 1fr; }
  .panorama-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
