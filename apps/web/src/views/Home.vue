<template>
  <div class="dashboard aw-page">
    <!-- 4.1 顶部 KPI 条（固定，不可折叠） -->
    <div class="kpi-bar">
      <div class="kpi-block main" @click="go('/journal')" title="点击下钻日志中心">
        <div class="kpi-label">累计盈亏</div>
        <div class="kpi-value mono" :class="netPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(netPnl) }} <span class="kpi-sub">USDT</span></div>
        <div class="kpi-extra" :class="totalReturn >= 0 ? 'up' : 'down'">({{ fmtPctSigned(totalReturn) }})</div>
      </div>
      <div class="kpi-sep"></div>
      <!-- 账户余额（权益）：受设置页「账户余额显示」开关控制 -->
      <div class="kpi-block" @click="panoramaOpen = !panoramaOpen" title="账户权益（余额），点击展开账户全景">
        <div class="kpi-label">账户余额</div>
        <div class="kpi-value mono">{{ fundsVisible ? fmtAmt(accountEquity) : '****' }} <span v-if="fundsVisible" class="kpi-sub">USDT</span></div>
        <div class="kpi-extra dim">{{ fundsVisible ? '总权益' : '已隐藏' }}</div>
      </div>
      <div class="kpi-sep"></div>
      <div class="kpi-block" @click="go('/journal')" title="点击查看日志中心">
        <div class="kpi-label">胜率</div>
        <div class="kpi-value mono">{{ winRateKpi }}</div>
        <div class="kpi-extra dim">{{ kpiWinCount }}</div>
      </div>
      <div class="kpi-sep"></div>
      <div class="kpi-block" @click="panoramaOpen = !panoramaOpen" title="展开账户全景">
        <div class="kpi-label">盈亏比</div>
        <div class="kpi-value mono" :class="profitFactorNum === null ? '' : profitFactorNum >= 1 ? 'up' : 'down'">{{ profitFactorKpi }}</div>
        <div class="kpi-extra dim">利润因子</div>
      </div>
      <div class="kpi-sep"></div>
      <div class="kpi-block" :class="{ 'has-todo': maxDDKpi > 0.1 }" @click="panoramaOpen = !panoramaOpen" title="展开账户全景">
        <div class="kpi-label">最大回撤</div>
        <div class="kpi-value mono" :class="maxDDKpi > 0.2 ? 'down' : maxDDKpi > 0.1 ? 'todo' : 'up'">{{ fmtPct(maxDDKpi) }}</div>
        <div class="kpi-extra" :class="maxDDKpi > 0.2 ? 'down' : 'dim'">{{ maxDDKpi > 0.2 ? '高风险' : maxDDKpi > 0.1 ? '需关注' : '健康' }}</div>
      </div>
      <div class="kpi-sep"></div>
      <div class="kpi-block" :class="{ 'has-todo': counts.pending > 0 }" @click="go('/journal?tab=pending')" title="点击去处理待复盘">
        <div class="kpi-label">待复盘</div>
        <div class="kpi-value mono" :class="{ down: counts.pending > 0 }">{{ counts.pending }}</div>
        <div class="kpi-extra" :class="counts.pending > 0 ? 'down' : 'dim'">{{ counts.pending > 0 ? '需处理' : '无积压' }}</div>
      </div>
    </div>
    <div v-if="counts.pending > 0" class="kpi-progress"><div class="kpi-progress-fill" :style="{ width: pendingRatio + '%' }"></div></div>

    <!-- 4.2 今日计划 + 今日动态 + 当前持仓（左右三列） -->
    <div class="mid-grid">
      <!-- 今日计划（纵向列表，不横向滚动） -->
      <div class="aw-card col plans-col">
        <div class="sec-head">
          <b>今日计划</b>
          <span class="dim">{{ todayPlanCount }} 条今日创建<template v-if="allPlanCount > todayPlanCount"> · 共 {{ allPlanCount }} 条待执行</template></span>
          <button class="aw-btn aw-btn-text" @click="go('/journal?tab=plan')">全部计划 →</button>
        </div>
        <div class="plan-list">
          <div
            v-for="p in todayPlanCards"
            :key="p.id"
            class="plan-card"
            @click="go('/journal?tab=plan&sel=' + p.id)"
          >
            <div class="pc-row1">
              <b class="pc-sym">{{ p.symbol }}</b>
              <span class="dir-tag" :class="p.direction === 'LONG' ? 'long' : 'short'">{{ p.direction === 'LONG' ? '多' : '空' }}</span>
              <span class="pc-size mono">{{ p.plannedSize || (p.leverage && p.leverage > 1 ? p.leverage + 'x' : '—') }}</span>
            </div>
            <div class="pc-trigger" :title="p.triggerDesc || '价格 ' + fmtPrice(p.plannedEntry)">触发：{{ p.triggerDesc || ('价格 ' + fmtPrice(p.plannedEntry)) }}</div>
            <div class="pc-row3 mono dim">
              <span v-if="p.plannedEntry">入 {{ fmtPrice(p.plannedEntry) }}</span>
              <span v-if="p.plannedStop">损 {{ fmtPrice(p.plannedStop) }}</span>
              <span v-if="p.plannedTargets?.length">盈 {{ planTargetsText(p) }}</span>
            </div>
            <div class="pc-actions">
              <button class="aw-btn aw-btn-primary mini" @click.stop="planExec(p)">执行</button>
              <button class="aw-btn aw-btn-secondary mini" @click.stop="planEdit(p)">编辑</button>
            </div>
          </div>

          <!-- 「+ 快速创建」虚线行 -->
          <div class="plan-add" @click="quickVisible = true">
            <span class="pa-plus">+</span>
            <span class="pa-text">快速创建</span>
          </div>

          <!-- 无今日计划：提示行 -->
          <div v-if="!todayPlanCount" class="plan-empty" @click="quickVisible = true">
            <svg class="aw-empty-illus" viewBox="0 0 64 48"><rect x="4" y="10" width="56" height="30" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 28 L28 18 L38 26 L50 14" fill="none" stroke="currentColor" stroke-width="2"/></svg>
            <span>今日暂无交易计划，点击制定 →</span>
          </div>
        </div>
      </div>

      <!-- 今日动态（时间线） -->
      <div class="aw-card col timeline-card">
        <div class="col-head"><b>今日动态</b><span class="dim">{{ lastUpdate }}</span></div>
        <div v-if="timeline.length" class="timeline">
          <div
            v-for="(e, i) in timeline"
            :key="i"
            class="tl-item"
            :class="'tl-' + e.type"
            @click="go('/journal?tab=' + e.tab + '&sel=' + e.id)"
          >
            <span class="tl-bar" :style="{ background: e.color }"></span>
            <span class="tl-time mono">{{ fmtTime(e.ts) }}</span>
            <div class="tl-main">
              <div class="tl-title">
                <b>{{ e.symbol }}</b>
                <span class="dir-tag" :class="e.dir === 'LONG' ? 'long' : 'short'">{{ e.dir === 'LONG' ? '多' : '空' }}</span>
                <span class="tl-type" :style="{ color: e.color }">{{ e.label }}</span>
              </div>
              <div class="tl-desc dim">{{ e.desc }}</div>
            </div>
            <span v-if="e.pnl !== undefined" class="tl-pnl mono" :class="e.pnl >= 0 ? 'up' : 'down'">{{ fmtPnl(e.pnl) }}</span>
          </div>
        </div>
        <div v-else class="aw-empty">
          <svg class="aw-empty-illus" viewBox="0 0 64 48"><path d="M6 40 h52 M10 34 l10 -10 8 6 12 -14 10 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="48" cy="12" r="3" fill="currentColor"/></svg>
          <span>今日暂无交易动态</span>
          <button class="aw-btn aw-btn-text" @click="quickVisible = true">去制定计划 →</button>
        </div>
      </div>

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
          <span>当前无持仓，去制定计划</span>
          <button class="aw-btn aw-btn-text" @click="quickVisible = true">去新建计划 →</button>
        </div>
      </div>
    </div>

    <!-- 4.4 流转状态速览（横向四栏） -->
    <div class="flow-cols">
      <div
        v-for="f in flowColumns"
        :key="f.key"
        class="flow-col aw-card"
        :class="{ breathing: f.key === 'pending' && f.count > 0 }"
        @click="goFlow(f.key)"
      >
        <span class="fc-dot" :style="{ background: f.color }"></span>
        <div class="fc-body">
          <div class="fc-label">{{ f.label }}</div>
          <div class="fc-count mono">{{ f.count }}</div>
        </div>
        <button class="aw-btn aw-btn-text fc-link">{{ f.key === 'pending' && f.count > 0 ? '去处理' : '查看 →' }}</button>
      </div>
    </div>

    <!-- 4.5 账户全景面板（折叠） -->
    <div class="aw-card panorama">
      <div class="panorama-head" @click="panoramaOpen = !panoramaOpen">
        <span class="p-title">账户全景</span>
        <span class="dim">收益质量 / 盈亏结构 / 回撤连击 / 持仓特征</span>
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



    <!-- 快速创建侧板（420px） -->
    <el-drawer v-model="quickVisible" size="420px" :with-header="false" class="qc-drawer">
      <div class="qc-head">
        <b>快速创建交易计划</b>
        <span class="dim">保存为「计划中」或立即执行进入「持仓中」</span>
      </div>
      <el-form label-width="76px" size="small" class="qc-form">
        <el-form-item label="币种">
          <el-input v-model="qf.symbol" placeholder="BTCUSDT" list="qc-symbols" />
          <datalist id="qc-symbols">
            <option v-for="s in symbolSuggestions" :key="s" :value="s" />
          </datalist>
        </el-form-item>
        <el-form-item label="方向">
          <div class="seg2">
            <button class="s2" :class="{ active: qf.direction === 'LONG' }" @click="qf.direction = 'LONG'">多 ▲</button>
            <button class="s2" :class="{ active: qf.direction === 'SHORT' }" @click="qf.direction = 'SHORT'">空 ▼</button>
          </div>
        </el-form-item>
        <el-form-item label="仓位">
          <div class="qc-inline">
            <el-input v-model="qf.size" placeholder="如 0.05" class="mono" />
            <el-input-number v-model="qf.leverage" :min="1" :precision="0" controls-position="right" style="width: 110px" />
            <span class="dim">倍</span>
          </div>
        </el-form-item>
        <el-form-item label="入场条件">
          <div class="seg2 qc-mb">
            <button class="s2" :class="{ active: qf.entryType === 'price' }" @click="qf.entryType = 'price'">价格</button>
            <button class="s2" :class="{ active: qf.entryType === 'indicator' }" @click="qf.entryType = 'indicator'">指标</button>
          </div>
          <el-input-number
            v-if="qf.entryType === 'price'"
            v-model="qf.plannedEntry"
            :precision="4"
            controls-position="right"
            placeholder="计划开仓价"
            style="width: 100%"
          />
          <el-input v-else v-model="qf.triggerDesc" type="textarea" :rows="2" placeholder="如：站稳 71500 且放量突破时入场" />
        </el-form-item>
        <el-form-item label="止损"><el-input-number v-model="qf.plannedStop" :precision="4" controls-position="right" style="width: 100%" /></el-form-item>
        <el-form-item label="止盈"><el-input v-model="qf.targetsText" placeholder="逗号分隔，如 75000, 78000" class="mono" /></el-form-item>
        <el-form-item label="策略版本">
          <el-select v-model="qf.strategyVersion" filterable allow-create clearable placeholder="选择或输入版本" style="width: 100%">
            <el-option v-for="v in strategyVersionOptions" :key="v" :value="v" :label="v" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="qc-foot">
        <button class="aw-btn aw-btn-secondary" :disabled="saving" @click="saveQuickPlan('plan')">保存为计划</button>
        <button class="aw-btn aw-btn-primary" :disabled="saving" @click="saveQuickPlan('exec')">立即执行</button>
      </div>
    </el-drawer>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.ts';
import { accountStore, loadAccounts, uiPrefs } from '../store.ts';
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

/** 今日创建的计划数 */
const todayPlanCount = computed(() => {
  const start = dayStart();
  return records.value.filter((r) => deriveStatus(r) === 'plan' && (r.createdAt ?? 0) >= start).length;
});
const allPlanCount = computed(() => records.value.filter((r) => deriveStatus(r) === 'plan').length);

/** 今日计划卡片（横向滚动区） */
const todayPlanCards = computed(() => {
  const start = dayStart();
  return records.value
    .filter((r) => deriveStatus(r) === 'plan' && (r.createdAt ?? 0) >= start)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 12);
});

/** 4.1 KPI：胜率 / 盈亏比 / 最大回撤 */
const winRateKpi = computed(() => {
  if (agg.value?.winRate !== undefined) return (agg.value.winRate * 100).toFixed(1) + '%';
  const closed = closedRecords.value;
  const wins = closed.filter((r) => (r.netPnl ?? 0) > 0).length;
  return closed.length ? (wins / closed.length * 100).toFixed(1) + '%' : '—';
});
const kpiWinCount = computed(() => {
  const closed = closedRecords.value;
  const wins = closed.filter((r) => (r.netPnl ?? 0) > 0).length;
  return closed.length ? wins + ' / ' + closed.length + ' 胜' : '暂无平仓记录';
});
const profitFactorNum = computed<number | null>(() => {
  if (agg.value?.profitFactor !== undefined) return agg.value.profitFactor;
  const gp = closedRecords.value.filter((r) => (r.netPnl ?? 0) > 0).reduce((a, r) => a + (r.netPnl ?? 0), 0);
  const gl = Math.abs(closedRecords.value.filter((r) => (r.netPnl ?? 0) < 0).reduce((a, r) => a + (r.netPnl ?? 0), 0));
  return gl > 0 ? gp / gl : gp > 0 ? Infinity : null;
});
const profitFactorKpi = computed(() => profitFactorNum.value === null ? '—' : profitFactorNum.value === Infinity ? '∞' : profitFactorNum.value.toFixed(2));
const maxDDKpi = computed(() => maxDrawdown().max);

const closedRecords = computed(() => records.value.filter((r) => deriveStatus(r) === 'pending' || deriveStatus(r) === 'done'));

/** 4.4 流转状态速览 */
const flowColumns = computed(() => STATUS_ORDER.map((key) => ({
  key,
  label: STATUS_META[key].label,
  color: STATUS_META[key].color,
  count: counts.value[key],
})));
function goFlow(key: string) {
  go('/journal?tab=' + key);
}

/** 4.3 今日动态时间线 */
interface TlEvent { id: string; type: 'plan' | 'exec' | 'close' | 'review'; label: string; color: string; tab: string; ts: number; symbol: string; dir: string; desc: string; pnl?: number }
const timeline = computed(() => {
  const ev: TlEvent[] = [];
  const start = dayStart();
  const push = (e: TlEvent) => { if (e.ts && e.ts >= start) ev.push(e); };
  for (const r of records.value) {
    const st = deriveStatus(r);
    const sym = r.symbol;
    const dir = r.direction;
    if (st === 'plan') {
      push({ id: r.id, type: 'plan', label: '计划', color: '#F59E0B', tab: 'plan', ts: r.createdAt ?? 0, symbol: sym, dir, desc: (r.triggerDesc || '价格 ' + fmtPrice(r.plannedEntry)) + (r.plannedSize ? ' · 仓位 ' + r.plannedSize : '') });
    } else if (st === 'holding') {
      push({ id: r.id, type: 'exec', label: '执行', color: '#06B6D4', tab: 'holding', ts: r.openTime ?? r.createdAt ?? 0, symbol: sym, dir, desc: '开仓 ' + fmtPrice(r.actualEntry) + (r.actualQty ? ' @ ' + r.actualQty : '') });
    } else if (st === 'pending') {
      push({ id: r.id, type: 'close', label: '平仓', color: '#10B981', tab: 'pending', ts: r.closeTime ?? 0, symbol: sym, dir, desc: '平仓于 ' + fmtPrice(r.actualExit), pnl: r.netPnl });
    } else if (st === 'done') {
      if (r.openTime) push({ id: r.id, type: 'exec', label: '执行', color: '#06B6D4', tab: 'holding', ts: r.openTime, symbol: sym, dir, desc: '开仓 ' + fmtPrice(r.actualEntry) });
      if (r.closeTime) push({ id: r.id, type: 'close', label: '平仓', color: '#10B981', tab: 'pending', ts: r.closeTime, symbol: sym, dir, desc: '平仓于 ' + fmtPrice(r.actualExit), pnl: r.netPnl });
      push({ id: r.id, type: 'review', label: '复盘', color: '#10B981', tab: 'done', ts: r.updatedAt ?? r.closeTime ?? 0, symbol: sym, dir, desc: '执行力 ' + (r.disciplineScore ?? '—') + '/10' + (r.improvements ? ' · ' + r.improvements.slice(0, 30) : '') });
    }
  }
  return ev.sort((a, b) => b.ts - a.ts).slice(0, 14);
});

const lastUpdate = computed(() => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));

/** 设置页「账户余额显示」开关：关闭时仪表板余额以 **** 掩码 */
const fundsVisible = computed(() => uiPrefs.fundsVisible);
/** 账户余额（总权益）：取权益曲线末点 */
const accountEquity = computed<number | null>(() => {
  const eq = eqPoints.value;
  return eq.length ? eq[eq.length - 1]!.equity : null;
});
function fmtAmt(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : v.toFixed(2);
}

/** 持仓列表：优先真实账户持仓，否则日志中的持仓中记录 */
const holdings = computed(() => {
  const out: { symbol: string; side: string; entry: number; current: number; pnl: number; planRef: string; duration: string }[] = [];
  for (const p of positions.value) {
    const t = tickers.value[p.symbol]?.lastPrice;
    const cur = t ?? p.avgEntryPrice;
    const pnl = p.unrealizedPnl ?? 0;
    out.push({ symbol: p.symbol, side: p.side === 'SHORT' ? 'SHORT' : 'LONG', entry: p.avgEntryPrice, current: cur, pnl, planRef: '', duration: '实时' });
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

/** 账户全景 2×3 网格 */
const panoramaCards = computed(() => {
  const st = journalStats.value;
  const a = agg.value;
  const wins = st?.wins ?? 0;
  const losses = st?.losses ?? 0;
  const closed = st?.closed ?? 0;
  const firstT = records.value.length ? Math.min(...records.value.map((r) => r.createdAt ?? Date.now())) : Date.now();
  const years = Math.max((Date.now() - firstT) / (365 * 86400000), 0);
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
        { label: '平均盈利', value: wins ? fmtPnl(records.value.filter(r => (r.netPnl ?? 0) > 0).reduce((a, r) => a + (r.netPnl ?? 0), 0) / wins) : '—', hint: '' },
        { label: '平均亏损', value: losses ? fmtPnl(records.value.filter(r => (r.netPnl ?? 0) < 0).reduce((a, r) => a + (r.netPnl ?? 0), 0) / losses) : '—', hint: '' },
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

// ---------- 快速创建侧板 ----------
const quickVisible = ref(false);
const saving = ref(false);
const qf = reactive({
  symbol: '', direction: 'LONG' as 'LONG' | 'SHORT', market: 'U本位合约', leverage: 1,
  size: '', entryType: 'price' as 'price' | 'indicator',
  plannedEntry: undefined as number | undefined, triggerDesc: '',
  plannedStop: undefined as number | undefined, targetsText: '', strategyVersion: '',
});

const symbolSuggestions = computed(() => {
  const set = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']);
  for (const r of records.value) set.add(r.symbol);
  return [...set].slice(0, 12);
});
const strategyVersionOptions = computed(() => {
  const set = new Set<string>();
  for (const r of records.value) if (r.strategyVersion) set.add(r.strategyVersion);
  for (const s of strategyNames.value) set.add(s);
  return [...set].slice(0, 20);
});
function planTargetsText(p: TradeJournal): string {
  return (p.plannedTargets ?? []).map((t) => fmtPrice(t)).join('/');
}
const strategyNames = ref<string[]>([]);

async function saveQuickPlan(mode: 'plan' | 'exec') {
  const sym = qf.symbol.trim().toUpperCase();
  if (!sym) { ElMessage.warning('请填写币种'); return; }
  saving.value = true;
  try {
    const targets = qf.targetsText.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const now = Date.now();
    const record: Record<string, unknown> = {
      symbol: sym,
      direction: qf.direction,
      market: qf.market,
      leverage: qf.leverage,
      plannedSize: qf.size || undefined,
      plannedEntry: qf.entryType === 'price' ? qf.plannedEntry : undefined,
      triggerDesc: qf.entryType === 'indicator' && qf.triggerDesc ? qf.triggerDesc : (qf.entryType === 'price' && qf.plannedEntry ? '价格 ' + qf.plannedEntry : undefined),
      plannedStop: qf.plannedStop,
      plannedTargets: targets,
      strategyVersion: qf.strategyVersion || undefined,
      plannedHolding: '日内',
      plannedAt: now,
      accountId: accountStore.selectedId || undefined,
      tradeNo: 'P' + now.toString(36),
      status: 'plan',
      tags: ['计划执行'],
    };
    if (mode === 'exec') {
      record.status = 'holding';
      record.openTime = now;
      record.actualEntry = qf.entryType === 'price' ? qf.plannedEntry : undefined;
    }
    await api.post('/journal/trades', { record });
    ElMessage.success(mode === 'exec' ? '已立即执行，转入日志中心「持仓中」' : '计划已保存，进入日志中心「计划中」');
    quickVisible.value = false;
    await loadAll();
  } catch (e) {
    ElMessage.error('保存失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    saving.value = false;
  }
}

/** 仪表盘计划卡片：执行 → 确认成交 → 持仓中 */
async function planExec(p: TradeJournal) {
  try {
    await ElMessageBox.confirm('确认执行「' + p.symbol + ' ' + (p.direction === 'LONG' ? '多' : '空') + '」并转入「持仓中」？', '执行计划', { type: 'info', confirmButtonText: '执行', cancelButtonText: '取消' });
  } catch { return; }
  const now = Date.now();
  await api.patch('/journal/trades/' + p.id, { patch: { openTime: p.openTime ?? now, actualEntry: p.actualEntry ?? p.plannedEntry, status: 'holding' } });
  ElMessage.success('已执行，转入持仓中');
  await loadAll();
}
function planEdit(p: TradeJournal) {
  go('/journal?tab=plan&edit=' + p.id);
}

function dayStart(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

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
    // 策略版本下拉数据
    try {
      const sv = await api.get<{ strategies: { name: string }[] }>('/strategies').catch(() => null);
      if (sv) strategyNames.value = sv.strategies.map((s) => s.name);
    } catch { /* ignore */ }
  } catch (e) {
    ElMessage.error('数据加载失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

onMounted(async () => {
  await loadAll();
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
.kpi-block { flex: 1; text-align: right; padding: 0 18px; position: relative; cursor: pointer; border-radius: 8px; transition: background var(--aw-dur-fast) var(--aw-ease); }
.kpi-block:hover { background: rgba(255,255,255,0.03); }
.kpi-block.has-todo { background: rgba(245,158,11,0.05); }
.kpi-label { font-size: 11px; color: var(--aw-text-dim); margin-bottom: 4px; }
.kpi-value { font-size: 22px; font-weight: 700; color: var(--aw-text-title); font-family: var(--aw-mono); }
.kpi-value .kpi-sub { font-size: 12px; font-weight: 400; color: var(--aw-text-dim); font-family: var(--aw-mono); }
.kpi-extra { font-size: 11px; margin-top: 2px; }
.kpi-sep { width: 1px; background: var(--aw-border); margin: 4px 0; }
.kpi-progress { height: 3px; border-radius: 2px; background: var(--aw-border); overflow: hidden; }
.kpi-progress-fill { height: 100%; background: var(--aw-todo); border-radius: 2px; transition: width 400ms var(--aw-ease); }

/* 区块标题 */
.sec-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.sec-head b { font-size: 13px; color: var(--aw-text-title); }
.sec-head .dim { font-size: 11px; flex: 1; }
.sec-head .aw-btn-text { font-size: 11px; }

/* 今日计划（纵向列表，无横向滚动） */
.plans-col { min-width: 0; }
.plan-list { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; }
.plan-card {
  flex: none; border: 1px solid var(--aw-border); border-radius: 10px; padding: 10px 12px;
  background: var(--aw-bg-card); cursor: pointer;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.plan-card:hover { border-color: rgba(245,158,11,0.5); background: rgba(245,158,11,0.04); }
.pc-row1 { display: flex; align-items: center; gap: 6px; }
.pc-sym { font-size: 13px; color: var(--aw-text-title); }
.pc-size { margin-left: auto; font-size: 11px; color: var(--aw-text-dim); }
.pc-trigger { font-size: 11px; color: var(--aw-text-body); margin: 6px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-row3 { display: flex; gap: 8px; font-size: 10px; flex-wrap: wrap; }
.pc-actions { display: flex; gap: 6px; margin-top: 8px; }
.aw-btn.mini { height: 22px; padding: 0 10px; font-size: 11px; }
.plan-add {
  flex: none; min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px dashed var(--aw-accent); border-radius: 10px; color: var(--aw-accent);
  background: transparent; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease);
}
.plan-add:hover { background: var(--aw-accent-dim); }
.pa-plus { font-size: 16px; line-height: 1; }
.pa-text { font-size: 12px; }
.plan-empty {
  flex: none; display: flex; align-items: center; justify-content: center; gap: 12px;
  min-height: 88px; border: 1px dashed var(--aw-border); border-radius: 10px;
  color: var(--aw-text-dim); font-size: 13px; cursor: pointer;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.plan-empty:hover { border-color: var(--aw-accent); color: var(--aw-accent); background: var(--aw-accent-dim); }

/* 流转状态速览 */
.flow-cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.flow-col { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease); }
.flow-col:hover { transform: translateY(-1px); border-color: var(--aw-border-hover); }
.flow-col.breathing { border-color: rgba(245,158,11,0.6); animation: aw-pulse 2s infinite; }
.fc-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.fc-body { flex: 1; }
.fc-label { font-size: 11px; color: var(--aw-text-dim); }
.fc-count { font-size: 26px; font-weight: 700; color: var(--aw-text-title); line-height: 1.15; }
.fc-link { font-size: 11px; padding: 0; }

/* 今日计划 + 今日动态 + 持仓：左右三列 */
.mid-grid { display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 12px; }
@media (max-width: 1100px) { .mid-grid { grid-template-columns: 1fr 1fr; } .mid-grid .col:last-child { grid-column: 1 / -1; } }
.timeline-card .col-head .dim { margin-left: auto; }
.timeline { display: flex; flex-direction: column; max-height: 400px; overflow-y: auto; }
.tl-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 8px; border-radius: 8px; cursor: pointer; transition: background var(--aw-dur-fast) var(--aw-ease); }
.tl-item:hover { background: rgba(255,255,255,0.03); }
.tl-bar { width: 3px; align-self: stretch; border-radius: 2px; flex: none; }
.tl-time { font-size: 11px; color: var(--aw-text-dim); width: 74px; flex: none; padding-top: 1px; }
.tl-main { flex: 1; min-width: 0; }
.tl-title { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.tl-title b { color: var(--aw-text-title); }
.tl-type { font-size: 10px; }
.tl-desc { font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-pnl { font-size: 12px; font-weight: 700; }

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

/* 通用列 */
.col { display: flex; flex-direction: column; min-height: 220px; }
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



/* 快速创建侧板 */
.qc-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
.qc-head b { font-size: 15px; color: var(--aw-text-title); }
.qc-head .dim { font-size: 11px; }
.qc-inline { display: flex; align-items: center; gap: 8px; width: 100%; }
.qc-inline .el-input { flex: 1; }
.qc-mb { margin-bottom: 8px; }
.qc-foot { display: flex; gap: 10px; margin-top: 20px; }
.qc-foot .aw-btn { flex: 1; height: 36px; }
.seg2 { display: flex; gap: 6px; }
.s2 {
  flex: 1; height: 28px; border-radius: 6px; border: 1px solid var(--aw-border);
  background: transparent; color: var(--aw-text-dim); font-size: 12px; cursor: pointer;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.s2:hover { border-color: var(--aw-border-hover); }
.s2.active { border-color: var(--aw-accent); color: var(--aw-accent); background: var(--aw-accent-dim); }

/* 过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity 150ms var(--aw-ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 1200px) {
  .flow-cols { grid-template-columns: repeat(2, 1fr); }
  .panorama-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
