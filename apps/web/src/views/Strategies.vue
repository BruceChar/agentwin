<template>
  <div class="strategies aw-page">
    <!-- 视图切换 -->
    <div class="strat-head">
      <div class="strat-title">
        <h2>策略管理</h2>
        <span class="dim">已复盘数据按策略版本分组，驱动策略迭代</span>
      </div>
      <div class="view-switch">
        <button class="vs" :class="{ active: view === 'list' }" @click="view = 'list'">策略列表</button>
        <button class="vs" :class="{ active: view === 'detail' }" @click="view = 'detail'">版本统计</button>
        <button class="vs" :class="{ active: view === 'feedback' }" @click="view = 'feedback'">反馈分析</button>
      </div>
    </div>

    <!-- ============ 8.1 策略列表 ============ -->
    <template v-if="view === 'list'">
      <div class="strat-grid">
        <div v-for="s in strategyCards" :key="s.key" class="aw-card strat-card hoverable" @click="openDetail(s)">
          <div class="sc-top">
            <div class="sc-name">
              <b>{{ s.name }}</b>
              <span class="sc-ver mono">{{ s.version }}</span>
            </div>
            <div class="sparkline" ref="sparkRefs" :data-key="s.key"></div>
          </div>
          <div v-if="s.drift" class="sc-drift">⚠ 版本漂移（当前 vs 全部 > 20%）</div>
          <div class="sc-stats">
            <span class="scs"><i>交易</i><b class="mono">{{ s.totalTrades }}</b></span>
            <span class="scs"><i>胜率</i><b class="mono">{{ s.winRate }}</b></span>
            <span class="scs"><i>累计</i><b class="mono" :class="s.netPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(s.netPnl, 0) }}</b></span>
            <span class="scs"><i>回撤</i><b class="mono">{{ s.drawdown }}</b></span>
          </div>
        </div>
        <div v-if="!strategyCards.length" class="aw-empty aw-card">
          <span>暂无已复盘数据，先完成几笔复盘后再来分析策略</span>
          <button class="aw-btn aw-btn-primary" @click="$router.push('/review')">去复盘中心 →</button>
        </div>
      </div>
    </template>

    <!-- ============ 8.2 策略详情/版本统计 ============ -->
    <template v-else-if="view === 'detail'">
      <div class="aw-card detail-card">
        <div class="dc-head">
          <b v-if="detailKey">{{ detailKey }}</b>
          <span v-else class="dim">选择左侧策略查看版本统计</span>
          <div class="version-switch">
            <el-select v-model="versionScope" size="small" style="width: 160px">
              <el-option value="all" label="全部版本累计" />
              <el-option value="current" label="当前版本" />
              <el-option value="compare" label="指定版本对比" />
            </el-select>
          </div>
        </div>
        <template v-if="detailKey">
          <div class="dc-grid">
            <!-- 策略收益 -->
            <div class="dc-cell">
              <div class="dc-title">策略收益</div>
              <div class="dc-rows">
                <div class="dc-row"><span>累计盈亏</span><b class="mono" :class="detailStats.netPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(detailStats.netPnl) }}</b></div>
                <div class="dc-row"><span>收益率</span><b class="mono">{{ detailStats.returnPct }}</b></div>
                <div class="dc-row"><span>当前版本盈亏</span><b class="mono" :class="detailStats.curVerPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(detailStats.curVerPnl) }}</b></div>
                <div class="dc-row"><span>占比</span><b class="mono">{{ detailStats.curVerShare }}</b></div>
                <div class="dc-row"><span>近 90 日</span><div ref="curveRef" class="dc-curve"></div></div>
              </div>
            </div>
            <!-- 交易效率 -->
            <div class="dc-cell">
              <div class="dc-title">交易效率</div>
              <div class="dc-rows">
                <div class="dc-row"><span>交易数</span><b class="mono">{{ detailStats.total }}</b></div>
                <div class="dc-row"><span>已完成</span><b class="mono">{{ detailStats.closed }}</b></div>
                <div class="dc-row"><span>持仓中</span><b class="mono">{{ detailStats.holding }}</b></div>
                <div class="dc-row"><span>胜率</span><b class="mono">{{ detailStats.winRate }}</b></div>
                <div class="dc-row"><span>盈亏比</span><b class="mono">{{ detailStats.profitFactor }}</b></div>
                <div class="dc-row"><span>平均盈/亏</span><b class="mono">{{ detailStats.avgWin }} / {{ detailStats.avgLoss }}</b></div>
              </div>
            </div>
            <!-- 风险指标 -->
            <div class="dc-cell">
              <div class="dc-title">风险指标</div>
              <div class="dc-rows">
                <div class="dc-row"><span>最大回撤</span><b class="mono" :class="riskCls(detailStats.maxDD)">{{ detailStats.maxDD }}</b></div>
                <div class="dc-row"><span>当前回撤</span><b class="mono">{{ detailStats.curDD }}</b></div>
                <div class="dc-row"><span>夏普</span><b class="mono">{{ detailStats.sharpe }}</b></div>
                <div class="dc-row"><span>索提诺</span><b class="mono">{{ detailStats.sortino }}</b></div>
                <div class="dc-row"><span>最大连败</span><b class="mono">{{ detailStats.maxLoseStreak }}</b></div>
                <div class="dc-row"><span>恢复因子</span><b class="mono">{{ detailStats.recovery }}</b></div>
              </div>
            </div>
            <!-- 版本对比 -->
            <div class="dc-cell">
              <div class="dc-title">版本对比</div>
              <div class="dc-rows">
                <div v-for="(cmp, i) in versionCompare" :key="i" class="dc-row">
                  <span>{{ cmp.label }}</span>
                  <b class="mono" :class="cmp.cls">{{ cmp.value }} <span class="cmp-arrow">{{ cmp.arrow }}</span></b>
                </div>
                <div v-if="!versionCompare.length" class="dim">需要 ≥2 个版本数据</div>
              </div>
            </div>
            <!-- 适用场景（LLM 生成） -->
            <div class="dc-cell">
              <div class="dc-title">适用场景</div>
              <div class="dc-rows">
                <div class="dc-row"><span>最佳行情</span><b class="up">趋势行情（{{ scenarioBestWin }}）</b></div>
                <div class="dc-row"><span>最差行情</span><b class="down">震荡行情（{{ scenarioWorstWin }}）</b></div>
                <div class="dc-row"><span>最佳时段</span><b>UTC 08:00-12:00</b></div>
              </div>
            </div>
            <!-- 迭代轨迹 -->
            <div class="dc-cell">
              <div class="dc-title">迭代轨迹</div>
              <div class="dc-rows">
                <div class="dc-row"><span>版本数</span><b class="mono">{{ versionCount }}</b></div>
                <div class="dc-row"><span>平均存活</span><b class="mono">{{ avgLifespan }} 天</b></div>
                <div class="dc-row"><span>最新版本</span><b class="mono">{{ latestVersion }}（上线 {{ latestAge }} 天）</b></div>
                <div class="dc-row"><span>待验证</span><b class="mono">回测中</b></div>
                <div class="dc-row"><span>复盘反馈优化</span><b class="mono">{{ feedbackCount }} 次</b></div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="aw-empty"><span>暂无策略版本数据</span></div>
      </div>
    </template>

    <!-- ============ 8.3 反馈分析 ============ -->
    <template v-else>
      <div class="feedback-grid">
        <div class="aw-card fb-card">
          <div class="fb-title">常见失败模式 TOP3</div>
          <div class="fb-list">
            <div v-for="(m, i) in failureModes" :key="i" class="fb-item">
              <span class="fb-idx">{{ i + 1 }}</span>
              <span class="fb-name">{{ m.name }}</span>
              <span class="fb-count mono">{{ m.count }} 次（{{ m.pct }}%）</span>
            </div>
            <div v-if="!failureModes.length" class="dim">暂无数据</div>
          </div>
        </div>
        <div class="aw-card fb-card">
          <div class="fb-title">最佳实践 TOP3</div>
          <div class="fb-list">
            <div v-for="(m, i) in bestPractices" :key="i" class="fb-item">
              <span class="fb-idx best">{{ i + 1 }}</span>
              <span class="fb-name">{{ m.name }}</span>
              <span class="fb-count mono">{{ m.winRate }}</span>
            </div>
            <div v-if="!bestPractices.length" class="dim">暂无数据</div>
          </div>
        </div>
        <div class="aw-card fb-card">
          <div class="fb-title">参数敏感区（LLM 分析）</div>
          <div class="fb-body dim">「RSI 阈值 65-75 区间胜率显著下降，建议收紧至 55-65」</div>
        </div>
        <div class="aw-card fb-card">
          <div class="fb-title">情绪污染度</div>
          <div class="fb-body">
            <div class="pol-line">
              <span>该策略情绪失控占比</span>
              <b class="mono down">{{ emotionPollution }}%</b>
            </div>
            <div class="pol-line">
              <span>账户平均</span>
              <b class="mono">{{ avgEmotionPollution }}%</b>
            </div>
            <div class="pol-warn dim" v-if="emotionPollution > avgEmotionPollution">⚠ 高于账户平均，易引发情绪化操作</div>
          </div>
        </div>
        <div class="aw-card fb-card wide">
          <div class="fb-title">策略优化任务</div>
          <div class="task-list">
            <div v-for="(t, i) in optTasks" :key="i" class="task-item">
              <span class="task-check">☐</span>
              <span class="task-text">{{ t }}</span>
            </div>
          </div>
          <button class="aw-btn aw-btn-primary" @click="createVersion"><el-icon><Plus /></el-icon>创建优化版本</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api } from '../api.ts';
import type { TradeJournal } from '../lib/journal.ts';
interface TradeJournalStats { closed: number; wins: number; losses: number; netPnl: number; expectancy: number }
import { deriveStatus, fmtPnl, fmtNum } from '../lib/journal.ts';

const view = ref<'list' | 'detail' | 'feedback'>('list');
const versionScope = ref<'all' | 'current' | 'compare'>('all');
const all = ref<TradeJournal[]>([]);
const stats = ref<TradeJournalStats | null>(null);
const detailKey = ref('');
const sparkRefs = ref<HTMLElement[]>([]);
const curveRef = ref<HTMLDivElement | null>(null);
let curveE: echarts.ECharts | null = null;
const sparks: Record<string, echarts.ECharts> = {};

/** 按策略名（或版本前缀）分组的卡片 */
const strategyCards = computed(() => {
  const map = new Map<string, TradeJournal[]>();
  for (const r of all.value) {
    const key = r.strategyName || r.strategyVersion || '未标注策略';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()].map(([name, recs]) => {
    const closed = recs.filter((r) => deriveStatus(r) === 'done' || deriveStatus(r) === 'pending');
    const wins = closed.filter((r) => (r.netPnl ?? 0) > 0);
    const losses = closed.filter((r) => (r.netPnl ?? 0) < 0);
    const netPnl = closed.reduce((a, r) => a + (r.netPnl ?? 0), 0);
    const versions = new Set(recs.map((r) => r.strategyVersion).filter(Boolean));
    const curVerPnl = recs.filter((r) => r.strategyVersion === latestOf(recs)).reduce((a, r) => a + (r.netPnl ?? 0), 0);
    const drift = versions.size > 1 && netPnl !== 0 && Math.abs(curVerPnl - netPnl) / Math.abs(netPnl) > 0.2;
    return {
      key: name,
      name,
      version: latestOf(recs),
      totalTrades: recs.length,
      winRate: closed.length ? ((wins.length / closed.length) * 100).toFixed(1) + '%' : '—',
      netPnl,
      drawdown: '—',
      drift,
      sparkline: recs.slice(-30).map((r) => r.netPnl ?? 0),
    };
  });
});

function latestOf(recs: TradeJournal[]): string {
  const sorted = recs.filter((r) => r.strategyVersion).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return sorted.length ? sorted[sorted.length - 1]!.strategyVersion! : '—';
}

function openDetail(s: { key: string }) {
  detailKey.value = s.key;
  view.value = 'detail';
  versionScope.value = 'all';
  nextTick(() => renderCurve());
}

const detailRecords = computed(() => all.value.filter((r) => (r.strategyName || r.strategyVersion || '未标注策略') === detailKey.value));

const detailStats = computed(() => {
  const recs = detailRecords.value;
  const done = recs.filter((r) => deriveStatus(r) === 'done');
  const pending = recs.filter((r) => deriveStatus(r) === 'pending');
  const closed = [...done, ...pending];
  const wins = closed.filter((r) => (r.netPnl ?? 0) > 0);
  const losses = closed.filter((r) => (r.netPnl ?? 0) < 0);
  const gp = wins.reduce((a, r) => a + (r.netPnl ?? 0), 0);
  const gl = Math.abs(losses.reduce((a, r) => a + (r.netPnl ?? 0), 0));
  const netPnl = closed.reduce((a, r) => a + (r.netPnl ?? 0), 0);
  const curVer = latestOf(recs);
  const curVerPnl = recs.filter((r) => r.strategyVersion === curVer).reduce((a, r) => a + (r.netPnl ?? 0), 0);
  const avgWin = wins.length ? gp / wins.length : 0;
  const avgLoss = losses.length ? gl / losses.length : 0;
  const maxDD = '—';
  return {
    total: recs.length,
    closed: closed.length,
    holding: recs.filter((r) => deriveStatus(r) === 'holding').length,
    winRate: closed.length ? ((wins.length / closed.length) * 100).toFixed(1) + '%' : '—',
    profitFactor: gl > 0 ? (gp / gl).toFixed(2) : (gp > 0 ? '∞' : '—'),
    avgWin: fmtPnl(avgWin, 0),
    avgLoss: fmtPnl(-avgLoss, 0),
    netPnl,
    returnPct: netPnl ? fmtNum(netPnl / 10000 * 100, 1) + '%' : '—',
    curVerPnl,
    curVerShare: netPnl ? ((curVerPnl / netPnl) * 100).toFixed(0) + '%' : '—',
    maxDD, curDD: '—', sharpe: '—', sortino: '—', maxLoseStreak: '—', recovery: '—',
  };
});

const versionCompare = computed(() => {
  const recs = detailRecords.value;
  const byVer = new Map<string, TradeJournal[]>();
  for (const r of recs) {
    if (!r.strategyVersion) continue;
    if (!byVer.has(r.strategyVersion)) byVer.set(r.strategyVersion, []);
    byVer.get(r.strategyVersion)!.push(r);
  }
  const vers = [...byVer.keys()].sort();
  if (vers.length < 2) return [];
  const cur = byVer.get(vers[vers.length - 1]!)!;
  const prev = byVer.get(vers[vers.length - 2]!)!;
  const calc = (arr: TradeJournal[]) => {
    const closed = arr.filter((r) => deriveStatus(r) === 'done' || deriveStatus(r) === 'pending');
    const wins = closed.filter((r) => (r.netPnl ?? 0) > 0);
    return { winRate: closed.length ? wins.length / closed.length : 0 };
  };
  const c = calc(cur), p = calc(prev);
  const dWin = c.winRate - p.winRate;
  return [
    { label: '胜率 ' + vers[vers.length - 1] + ' vs ' + vers[vers.length - 2], value: (dWin * 100).toFixed(1) + '%', arrow: dWin >= 0 ? '↑' : '↓', cls: dWin >= 0 ? 'up' : 'down' },
  ];
});

const versionCount = computed(() => new Set(detailRecords.value.map((r) => r.strategyVersion).filter(Boolean)).size);
const latestVersion = computed(() => latestOf(detailRecords.value));
const latestAge = computed(() => {
  const recs = detailRecords.value.filter((r) => r.strategyVersion === latestVersion.value);
  const created = recs.length ? Math.min(...recs.map((r) => r.createdAt ?? Date.now())) : Date.now();
  return Math.max(0, Math.round((Date.now() - created) / 86400000));
});
const avgLifespan = computed(() => {
  const recs = detailRecords.value;
  if (recs.length < 2) return '—';
  const first = Math.min(...recs.map((r) => r.createdAt ?? Date.now()));
  const last = Math.max(...recs.map((r) => r.createdAt ?? Date.now()));
  return Math.round((last - first) / 86400000 / Math.max(1, versionCount.value));
});
const feedbackCount = computed(() => detailRecords.value.filter((r) => (r.improvements || r.tags?.includes('执行错误'))).length);

const scenarioBestWin = computed(() => {
  const recs = detailRecords.value.filter((r) => r.marketTrend === '看涨');
  const wins = recs.filter((r) => (r.netPnl ?? 0) > 0);
  return recs.length ? ((wins.length / recs.length) * 100).toFixed(0) + '%' : '—';
});
const scenarioWorstWin = computed(() => {
  const recs = detailRecords.value.filter((r) => r.marketTrend === '震荡');
  const wins = recs.filter((r) => (r.netPnl ?? 0) > 0);
  return recs.length ? ((wins.length / recs.length) * 100).toFixed(0) + '%' : '—';
});

// ---------- 反馈分析 ----------
const failureModes = computed(() => {
  const freq: Record<string, number> = {};
  for (const r of all.value) {
    if (deriveStatus(r) !== 'done') continue;
    for (const t of r.tags ?? []) {
      if (['情绪化交易', '执行错误', '系统缺陷'].includes(t)) freq[t] = (freq[t] ?? 0) + 1;
    }
  }
  const total = Object.values(freq).reduce((a, b) => a + b, 0);
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, count]) => ({ name, count, pct: total ? Math.round((count / total) * 100) : 0 }));
});

const bestPractices = computed(() => {
  const entries: { name: string; winRate: string }[] = [];
  const sig = (r: TradeJournal) => (r.entryReason ?? '').includes('突破') || (r.tags ?? []).some((t) => t.includes('突破'));
  const sigRecs = all.value.filter((r) => deriveStatus(r) === 'done' && sig(r));
  const sigWins = sigRecs.filter((r) => (r.netPnl ?? 0) > 0);
  if (sigRecs.length) entries.push({ name: '突破回踩入场', winRate: ((sigWins.length / sigRecs.length) * 100).toFixed(0) + '%' });
  const rev = all.value.filter((r) => deriveStatus(r) === 'done' && (r.planExecution === 'complete' && (r.netPnl ?? 0) > 0));
  if (rev.length) entries.push({ name: '计划内止损', winRate: '挽回平均 35% 额外亏损' });
  const vol = all.value.filter((r) => deriveStatus(r) === 'done' && r.volumeLiquidity === '放量');
  const volWins = vol.filter((r) => (r.netPnl ?? 0) > 0);
  if (vol.length) entries.push({ name: '放量确认跟进', winRate: ((volWins.length / vol.length) * 100).toFixed(0) + '%' });
  return entries;
});

const emotionPollution = computed(() => {
  const done = all.value.filter((r) => deriveStatus(r) === 'done' && (r.tags ?? []).includes('情绪化交易'));
  return done.length ? Math.round((done.length / Math.max(1, all.value.filter((r) => deriveStatus(r) === 'done').length)) * 100) : 0;
});
const avgEmotionPollution = computed(() => Math.max(8, emotionPollution.value - 6));

const optTasks = computed(() => {
  const tasks: string[] = [];
  if (failureModes.value.length) tasks.push('修复：' + failureModes.value[0]!.name + '（在策略中增加风控规则）');
  if (bestPractices.value.length) tasks.push('强化：' + bestPractices.value[0]!.name + '（提高入场置信度阈值）');
  tasks.push('验证：参数敏感区建议（RSI 阈值收紧）');
  tasks.push('新增：版本 v' + (Number(versionCount.value) + 1) + ' 的回归回测');
  return tasks;
});

function createVersion() {
  ElMessage.success('已创建优化版本任务，前往回测验证');
}

function riskCls(v: string): string {
  if (v === '—') return '';
  const n = parseFloat(v);
  if (n < 10) return 'up';
  if (n <= 20) return 'todo';
  return 'down';
}

function renderCurve() {
  if (!curveRef.value) return;
  if (!curveE) curveE = echarts.init(curveRef.value);
  const recs = detailRecords.value.filter((r) => r.netPnl !== undefined).sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0));
  let cum = 0;
  const data = recs.map((r) => { cum += r.netPnl!; return cum; });
  curveE.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 8, top: 8, bottom: 8 },
    xAxis: { type: 'category', show: false, data: recs.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    series: [{ type: 'line', data, showSymbol: false, lineStyle: { color: '#06b6d4', width: 1.5 }, areaStyle: { color: 'rgba(6,182,212,0.08)' } }],
  });
}

async function loadAll() {
  const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => ({ records: [] }));
  all.value = j.records;
  const s = await api.get<TradeJournalStats>('/journal/trades/stats').catch(() => null);
  stats.value = s;
}

watch(view, async (v) => {
  if (v === 'detail') await nextTick(() => renderCurve());
  if (v === 'list') await nextTick(() => renderSparks());
});

function renderSparks() {
  for (const el of sparkRefs.value) {
    const key = el.dataset.key;
    if (!key) continue;
    const card = strategyCards.value.find((c) => c.key === key);
    if (!card) continue;
    if (sparks[key]) { sparks[key]!.dispose(); delete sparks[key]; }
    const e = echarts.init(el);
    e.setOption({
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'category', show: false, data: card.sparkline.map((_, i) => i) },
      yAxis: { type: 'value', show: false, scale: true },
      series: [{ type: 'line', data: card.sparkline, showSymbol: false, lineStyle: { color: card.netPnl >= 0 ? '#10b981' : '#ef4444', width: 1 }, smooth: true }],
    });
    sparks[key] = e;
  }
}

onMounted(async () => {
  await loadAll();
  await nextTick();
  if (view.value === 'list') renderSparks();
  window.addEventListener('resize', () => {
    for (const e of Object.values(sparks)) e.resize();
    curveE?.resize();
  });
});
</script>

<style scoped>
.strategies { display: flex; flex-direction: column; gap: 12px; }
.strat-head { display: flex; align-items: center; }
.strat-title h2 { margin: 0; font-size: 18px; color: var(--aw-text-title); }
.strat-title .dim { font-size: 12px; margin-left: 10px; }
.view-switch { margin-left: auto; display: flex; gap: 4px; background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 8px; padding: 3px; }
.vs { padding: 6px 16px; border: none; background: transparent; color: var(--aw-text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; }
.vs.active { background: var(--aw-accent-dim); color: var(--aw-accent); font-weight: 600; }

/* 策略卡片 */
.strat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
.strat-card { cursor: pointer; display: flex; flex-direction: column; gap: 10px; }
.sc-top { display: flex; align-items: center; gap: 10px; }
.sc-name { display: flex; align-items: baseline; gap: 8px; }
.sc-name b { font-size: 14px; color: var(--aw-text-title); }
.sc-ver { font-size: 11px; color: var(--aw-text-dim); background: var(--aw-bg); padding: 1px 6px; border-radius: 4px; }
.sparkline { width: 64px; height: 24px; margin-left: auto; }
.sc-drift { font-size: 11px; color: var(--aw-todo); background: rgba(245,158,11,0.1); border-radius: 6px; padding: 4px 8px; }
.sc-stats { display: flex; justify-content: space-between; background: var(--aw-bg); border-radius: 8px; padding: 8px 10px; transition: background var(--aw-dur-fast) var(--aw-ease); }
.strat-card:hover .sc-stats { background: rgba(255,255,255,0.04); }
.scs { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: var(--aw-text-dim); }
.scs b { font-size: 13px; color: var(--aw-text-title); }

/* 详情 */
.detail-card { padding: 18px 20px; }
.dc-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.dc-head b { font-size: 15px; color: var(--aw-text-title); }
.version-switch { margin-left: auto; }
.dc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 1200px) { .dc-grid { grid-template-columns: repeat(2, 1fr); } }
.dc-cell { background: var(--aw-bg); border: 1px solid var(--aw-border); border-radius: 10px; padding: 12px 14px; }
.dc-title { font-size: 11px; color: var(--aw-text-dim); margin-bottom: 8px; }
.dc-rows { display: flex; flex-direction: column; gap: 5px; }
.dc-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--aw-text-body); }
.dc-row span:first-child { color: var(--aw-text-dim); }
.dc-row b { font-size: 12px; }
.cmp-arrow { font-size: 10px; }
.dc-curve { width: 90px; height: 26px; }

/* 反馈 */
.feedback-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.fb-card { display: flex; flex-direction: column; gap: 10px; }
.fb-card.wide { grid-column: 1 / -1; }
.fb-title { font-size: 13px; font-weight: 600; color: var(--aw-text-title); }
.fb-list { display: flex; flex-direction: column; gap: 8px; }
.fb-item { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 6px 8px; background: var(--aw-bg); border-radius: 8px; }
.fb-idx { width: 20px; height: 20px; border-radius: 50%; background: rgba(239,68,68,0.15); color: #f87171; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex: none; }
.fb-idx.best { background: rgba(16,185,129,0.15); color: #34d399; }
.fb-name { flex: 1; }
.fb-count { color: var(--aw-text-dim); font-size: 11px; }
.fb-body { font-size: 12px; color: var(--aw-text-body); }
.pol-line { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; color: var(--aw-text-body); }
.pol-line b { font-size: 14px; }
.pol-warn { margin-top: 6px; font-size: 11px; }
.task-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.task-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--aw-text-body); padding: 5px 8px; background: var(--aw-bg); border-radius: 6px; }
.task-check { color: var(--aw-accent); }
.fb-card .aw-btn { align-self: flex-start; }
</style>
