<template>
  <div class="review aw-page">
    <div class="review-head">
      <h2>复盘中心</h2>
      <span class="dim">处理「待复盘 → 已复盘」转化 — 策略迭代的燃料</span>
    </div>

    <div class="review-body">
      <!-- 左栏：Tab 列表 -->
      <aside class="rv-left">
        <div class="rv-tabs">
          <button class="rv-tab" :class="{ active: tab === 'pending' }" @click="tab = 'pending'">
            待复盘 <b class="mono">{{ counts.pending }}</b>
          </button>
          <button class="rv-tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">
            复盘历史 <b class="mono">{{ counts.done }}</b>
          </button>
          <button class="rv-tab" :class="{ active: tab === 'period' }" @click="tab = 'period'">
            周期复盘
          </button>
        </div>

        <!-- 导入批次筛选（待复盘） -->
        <div v-if="tab === 'pending'" class="batch-filter">
          <button class="bf" :class="{ active: batchFilter === '' }" @click="batchFilter = ''">全部</button>
          <button class="bf" :class="{ active: batchFilter === 'today' }" @click="batchFilter = 'today'">今日</button>
          <button class="bf" :class="{ active: batchFilter === 'week' }" @click="batchFilter = 'week'">本周</button>
        </div>

        <!-- 待复盘列表 -->
        <div v-if="tab === 'pending'" class="rv-list">
          <div
            v-for="r in pendingList"
            :key="r.id"
            class="rv-item pending"
            :class="{ active: selected?.id === r.id }"
            @click="select(r)"
          >
            <div class="rvi-main">
              <div class="rvi-pnl mono" :class="(r.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(r.netPnl) }}</div>
              <div class="rvi-info">
                <div class="rvi-sym"><b>{{ r.symbol }}</b><span class="dir-tag" :class="r.direction === 'LONG' ? 'long' : 'short'">{{ r.direction === 'LONG' ? '多' : '空' }}</span></div>
                <div class="rvi-meta dim">持仓 {{ fmtDuration(holdMs(r)) }} · 平仓 {{ fmtTime(r.closeTime) }}</div>
              </div>
            </div>
            <div v-if="isImported(r)" class="rvi-import dim">📥 历史导入</div>
          </div>
          <div v-if="!pendingList.length" class="aw-empty">
            <span>太棒了，没有待复盘积压 🎉</span>
          </div>
        </div>

        <!-- 复盘历史 -->
        <div v-else-if="tab === 'history'" class="rv-list">
          <div v-for="r in doneList" :key="r.id" class="rv-item done" :class="{ active: selected?.id === r.id }" @click="select(r)">
            <div class="rvi-main">
              <div class="rvi-pnl mono" :class="(r.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(r.netPnl) }}</div>
              <div class="rvi-info">
                <div class="rvi-sym"><b>{{ r.symbol }}</b><span class="dir-tag" :class="r.direction === 'LONG' ? 'long' : 'short'">{{ r.direction === 'LONG' ? '多' : '空' }}</span></div>
                <div class="rvi-meta dim">执行力 {{ r.disciplineScore ?? '—' }}/10 · {{ fmtTime(r.closeTime) }}</div>
              </div>
            </div>
          </div>
          <div v-if="!doneList.length" class="aw-empty"><span>暂无已复盘记录</span></div>
        </div>

        <!-- 周期复盘 -->
        <div v-else class="rv-period-tabs">
          <button class="bf wide" :class="{ active: period === 'day' }" @click="period = 'day'">日复盘</button>
          <button class="bf wide" :class="{ active: period === 'week' }" @click="period = 'week'">周复盘</button>
          <button class="bf wide" :class="{ active: period === 'month' }" @click="period = 'month'">月复盘</button>
        </div>
      </aside>

      <!-- 右栏：复盘面板 / 周期报告 -->
      <section class="rv-right">
        <!-- 周期复盘报告 -->
        <template v-if="tab === 'period'">
          <div class="aw-card rp-report">
            <div class="rp-head2">
              <b>{{ periodLabel }}复盘报告</b>
              <span class="dim">{{ periodStats.total }} 笔已复盘交易</span>
            </div>
            <div class="rp-stats">
              <div class="rs-cell" v-for="c in periodStatCards" :key="c.label">
                <div class="rs-label">{{ c.label }}</div>
                <div class="rs-value mono" :class="c.cls">{{ c.value }}</div>
              </div>
            </div>
            <div class="rp-grid">
              <div class="rp-block">
                <div class="rb-title">情绪分布</div>
                <div ref="emoChart" class="mini-chart"></div>
              </div>
              <div class="rp-block">
                <div class="rb-title">计划符合度</div>
                <div ref="planChart" class="mini-chart"></div>
              </div>
              <div class="rp-block">
                <div class="rb-title">策略版本盈亏占比</div>
                <div ref="stratChart" class="mini-chart"></div>
              </div>
              <div class="rp-block">
                <div class="rb-title">高频错误模式 TOP3</div>
                <div class="top3-list">
                  <div v-for="(m, i) in topMistakes" :key="i" class="top3-item">
                    <span class="top3-idx">{{ i + 1 }}</span>
                    <span class="top3-text">{{ m.name }}</span>
                    <span class="top3-count mono">{{ m.count }} 次</span>
                  </div>
                  <div v-if="!topMistakes.length" class="dim">暂无数据</div>
                </div>
              </div>
            </div>
            <div class="rp-suggest">
              <div class="rb-title">策略优化建议</div>
              <div v-for="(s, i) in suggestions" :key="i" class="sg-item">• {{ s }}</div>
              <div v-if="!suggestions.length" class="dim">复盘数据不足，暂时无法生成建议</div>
            </div>
            <button class="aw-btn aw-btn-primary" @click="goStrategies"><el-icon><SetUp /></el-icon>基于本次复盘优化策略</button>
          </div>
        </template>

        <!-- 单条复盘面板 -->
        <template v-else-if="selected">
          <div class="aw-card rp-card">
            <div class="rp-head2">
              <div class="rph-left">
                <b>{{ selected.symbol }}</b>
                <span class="dir-tag" :class="selected.direction === 'LONG' ? 'long' : 'short'">{{ selected.direction === 'LONG' ? '多' : '空' }}</span>
                <span class="mono" :class="(selected.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(selected.netPnl) }}</span>
                <span class="dim">持仓 {{ fmtDuration(holdMs(selected)) }}</span>
              </div>
            </div>

            <template v-if="tab === 'pending'">
              <el-form label-position="top" size="small" class="rv-form">
                <el-form-item label="计划符合度">
                  <div class="seg3">
                    <button class="s3" :class="{ active: review.planExec === 'complete' }" @click="review.planExec = 'complete'">完全</button>
                    <button class="s3" :class="{ active: review.planExec === 'partial' }" @click="review.planExec = 'partial'">部分</button>
                    <button class="s3" :class="{ active: review.planExec === 'none' }" @click="review.planExec = 'none'">未执行</button>
                  </div>
                  <el-input v-if="review.planExec !== 'complete'" v-model="review.deviation" size="small" placeholder="偏差说明" style="margin-top: 6px" />
                </el-form-item>
                <el-form-item label="情绪控制">
                  <div class="seg3">
                    <button v-for="e in EMOTIONS" :key="e" class="s3" :class="{ active: review.emotion === e }" @click="review.emotion = e">{{ e }}</button>
                  </div>
                  <div class="score-row"><span class="dim">自信度</span><el-slider v-model="review.confidence" :min="1" :max="10" :step="1" show-stops /><b class="mono">{{ review.confidence }}</b></div>
                </el-form-item>
                <el-form-item label="入场质量">
                  <div class="score-row"><el-slider v-model="review.entryQuality" :min="1" :max="10" :step="1" show-stops /><b class="mono">{{ review.entryQuality }}/10</b></div>
                  <el-input v-model="review.entryNote" size="small" placeholder="一句话总结入场" />
                </el-form-item>
                <el-form-item label="出场质量">
                  <div class="score-row"><el-slider v-model="review.exitQuality" :min="1" :max="10" :step="1" show-stops /><b class="mono">{{ review.exitQuality }}/10</b></div>
                  <el-input v-model="review.exitNote" size="small" placeholder="一句话总结出场" />
                </el-form-item>
                <el-form-item label="盈亏归因">
                  <el-checkbox-group v-model="review.attribution">
                    <el-checkbox v-for="o in ATTRIBUTIONS" :key="o" :value="o" size="small">{{ o }}</el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
                <el-form-item label="改进点">
                  <el-input v-model="review.improvements" type="textarea" :rows="3" placeholder="写具体可执行的动作，或用 AI 生成草稿" />
                  <button class="aw-btn aw-btn-text ai-draft" @click="aiDraft"><el-icon><MagicStick /></el-icon>AI 生成草稿</button>
                </el-form-item>
                <el-form-item label="策略调整建议">
                  <div class="seg3">
                    <button class="s3" :class="{ active: review.adjust === false }" @click="review.adjust = false">否</button>
                    <button class="s3" :class="{ active: review.adjust === true }" @click="review.adjust = true">是</button>
                  </div>
                  <template v-if="review.adjust">
                    <el-select v-model="review.adjustStrategy" size="small" placeholder="选择关联策略" style="width: 100%; margin-top: 6px">
                      <el-option v-for="s in strategyNameOptions" :key="s" :value="s" :label="s" />
                    </el-select>
                    <el-input v-model="review.adjustDirection" size="small" placeholder="调整方向" style="margin-top: 6px" />
                  </template>
                </el-form-item>
              </el-form>
              <div class="rp-actions">
                <button class="aw-btn aw-btn-primary" :loading="submitting" @click="submit">提交复盘（转已复盘）</button>
                <button class="aw-btn aw-btn-secondary" @click="saveDraft">保存草稿</button>
              </div>
            </template>

            <template v-else>
              <div class="rp-readonly">
                <el-descriptions :column="1" size="small" border>
                  <el-descriptions-item label="入场 → 出场">{{ fmtPrice(selected.actualEntry) }} → {{ fmtPrice(selected.actualExit) }}</el-descriptions-item>
                  <el-descriptions-item label="净盈亏">{{ fmtPnl(selected.netPnl) }} · R {{ selected.rMultiple?.toFixed(2) ?? '—' }}</el-descriptions-item>
                  <el-descriptions-item label="计划符合度">{{ planExecLabel(selected.planExecution) }}</el-descriptions-item>
                  <el-descriptions-item label="执行力评分">{{ selected.disciplineScore ?? '—' }}/10</el-descriptions-item>
                  <el-descriptions-item label="盈亏归因">{{ selected.attribution ?? '—' }}</el-descriptions-item>
                  <el-descriptions-item label="改进点">{{ selected.improvements ?? '—' }}</el-descriptions-item>
                  <el-descriptions-item label="策略调整">{{ selected.strategyAdjustment ? '是' : '否' }}</el-descriptions-item>
                </el-descriptions>
              </div>
            </template>
          </div>
        </template>

        <div v-else class="aw-card rp-empty">
          <svg class="aw-empty-illus" viewBox="0 0 64 48"><path d="M8 30 L20 18 L30 26 L46 10 L56 20" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="18" r="2" fill="currentColor"/><circle cx="46" cy="10" r="2" fill="currentColor"/></svg>
          <span class="dim">从左侧选择一条记录开始复盘</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api } from '../api.ts';
import { accountStore, loadAccounts } from '../store.ts';
import type { TradeJournal } from '../lib/journal.ts';
import { deriveStatus, fmtPnl, fmtPrice, fmtTime, fmtDuration } from '../lib/journal.ts';

const EMOTIONS = ['冷静', '贪婪', '恐惧', '犹豫'];
const ATTRIBUTIONS = ['技术', '运气', '计划执行', '情绪'];

const router = useRouter();
const tab = ref<'pending' | 'history' | 'period'>('pending');
const batchFilter = ref('');
const period = ref<'day' | 'week' | 'month'>('week');
const all = ref<TradeJournal[]>([]);
const selected = ref<TradeJournal | null>(null);
const submitting = ref(false);
const emoChart = ref<HTMLDivElement | null>(null);
const planChart = ref<HTMLDivElement | null>(null);
const stratChart = ref<HTMLDivElement | null>(null);
let emoE: echarts.ECharts | null = null;
let planE: echarts.ECharts | null = null;
let stratE: echarts.ECharts | null = null;

const review = reactive<{
  planExec: string; deviation: string; emotion: string; confidence: number;
  entryQuality: number; entryNote: string; exitQuality: number; exitNote: string;
  attribution: string[]; improvements: string; adjust: boolean | null;
  adjustStrategy: string; adjustDirection: string;
}>({ planExec: 'complete', deviation: '', emotion: '冷静', confidence: 5, entryQuality: 5, entryNote: '', exitQuality: 5, exitNote: '', attribution: [], improvements: '', adjust: null, adjustStrategy: '', adjustDirection: '' });

const counts = computed(() => {
  const c = { plan: 0, holding: 0, pending: 0, done: 0 };
  for (const r of all.value) c[deriveStatus(r)]++;
  return c;
});

const pendingList = computed(() => {
  const now = Date.now();
  let out = all.value.filter((r) => deriveStatus(r) === 'pending');
  if (batchFilter.value === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    out = out.filter((r) => (r.closeTime ?? 0) >= start.getTime());
  } else if (batchFilter.value === 'week') {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay() + 1);
    out = out.filter((r) => (r.closeTime ?? 0) >= start.getTime());
  }
  return out.sort((a, b) => Math.abs(b.netPnl ?? 0) - Math.abs(a.netPnl ?? 0));
});

const doneList = computed(() => all.value
  .filter((r) => deriveStatus(r) === 'done')
  .sort((a, b) => (b.closeTime ?? b.updatedAt ?? 0) - (a.closeTime ?? a.updatedAt ?? 0)));

const strategyNameOptions = computed(() => [...new Set(all.value.map((r) => r.strategyName).filter(Boolean))] as string[]);

function holdMs(r: TradeJournal): number | undefined {
  if (r.openTime && r.closeTime) return r.closeTime - r.openTime;
  return undefined;
}
function isImported(r: TradeJournal): boolean {
  return (r.tags ?? []).includes('历史导入');
}
function planExecLabel(v?: string): string {
  return v === 'complete' ? '完全' : v === 'partial' ? '部分' : v === 'none' ? '未执行' : '—';
}

function select(r: TradeJournal) {
  selected.value = r;
  initReview(r);
}

function initReview(r: TradeJournal) {
  Object.assign(review, {
    planExec: r.planExecution ?? 'complete',
    deviation: r.deviationReason ?? '',
    emotion: EMOTIONS[Math.min(Math.max(Math.round((r.emotionScore ?? 5) / 3) - 1, 0), 3)] ?? '冷静',
    confidence: r.confidenceScore ?? 5,
    entryQuality: (r as any).entryQuality ?? 5,
    entryNote: (r as any).entryQualityNote ?? '',
    exitQuality: (r as any).exitQuality ?? 5,
    exitNote: (r as any).exitQualityNote ?? '',
    attribution: (r.attribution ?? '').split('、').filter(Boolean),
    improvements: r.improvements ?? '',
    adjust: null, adjustStrategy: '', adjustDirection: '',
  });
}

async function submit() {
  if (!selected.value) return;
  submitting.value = true;
  try {
    const patch: Record<string, unknown> = {
      planExecution: review.planExec,
      deviationReason: review.deviation || undefined,
      emotionScore: EMOTIONS.indexOf(review.emotion) * 3 + 2,
      confidenceScore: review.confidence,
      entryQuality: review.entryQuality,
      entryQualityNote: review.entryNote || undefined,
      exitQuality: review.exitQuality,
      exitQualityNote: review.exitNote || undefined,
      attribution: review.attribution.join('、') || undefined,
      improvements: review.improvements || undefined,
      status: 'done',
    };
    if (review.adjust) patch.strategyAdjustment = { strategy: review.adjustStrategy, direction: review.adjustDirection };
    await api.patch('/journal/trades/' + selected.value.id, { patch });
    ElMessage.success('复盘已提交，记录流转为「已复盘」并进入策略反馈分析池');
    selected.value = null;
    await loadAll();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function saveDraft() {
  if (!selected.value) return;
  const patch: Record<string, unknown> = {
    planExecution: review.planExec,
    deviationReason: review.deviation || undefined,
    emotionScore: EMOTIONS.indexOf(review.emotion) * 3 + 2,
    confidenceScore: review.confidence,
    entryQuality: review.entryQuality,
    entryQualityNote: review.entryNote || undefined,
    exitQuality: review.exitQuality,
    exitQualityNote: review.exitNote || undefined,
    attribution: review.attribution.join('、') || undefined,
    improvements: review.improvements || undefined,
  };
  await api.patch('/journal/trades/' + selected.value.id, { patch });
  ElMessage.success('草稿已保存（状态不变）');
  await loadAll();
}

async function aiDraft() {
  if (!selected.value) return;
  try {
    ElMessage.info('AI 正在根据交易数据生成复盘草稿…');
    const r = selected.value;
    const prompt = '根据以下交易数据生成复盘改进点草稿：品种 ' + r.symbol + '，方向 ' + (r.direction === 'LONG' ? '多' : '空') + '，净盈亏 ' + (r.netPnl ?? 0) + '，入场 ' + (r.actualEntry ?? r.plannedEntry) + '，出场 ' + (r.actualExit ?? '') + '。请用一句话指出关键改进点。';
    const res = await api.post<{ reply: string }>('/llm/chat', { message: prompt }).catch(() => null);
    if (res?.reply) review.improvements = res.reply.slice(0, 200);
    else review.improvements = '建议：严格按计划执行，控制情绪化操作，等待确认信号后再入场。';
  } catch {
    review.improvements = '建议：严格按计划执行，控制情绪化操作。';
  }
}

// ---------- 周期复盘 ----------
const periodWindow = computed(() => {
  const now = new Date();
  let start: Date;
  if (period.value === 'day') { start = new Date(now); start.setHours(0, 0, 0, 0); }
  else if (period.value === 'week') { start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay() + 1); }
  else { start = new Date(now.getFullYear(), now.getMonth(), 1); }
  return { start: start.getTime(), end: now.getTime() };
});
const periodLabel = computed(() => period.value === 'day' ? '日' : period.value === 'week' ? '周' : '月');

const periodRecords = computed(() => all.value.filter((r) => {
  if (deriveStatus(r) !== 'done') return false;
  const t = r.closeTime ?? r.updatedAt ?? 0;
  return t >= periodWindow.value.start && t <= periodWindow.value.end;
}));

const periodStats = computed(() => {
  const recs = periodRecords.value;
  const wins = recs.filter((r) => (r.netPnl ?? 0) > 0);
  const losses = recs.filter((r) => (r.netPnl ?? 0) < 0);
  const gp = wins.reduce((a, r) => a + (r.netPnl ?? 0), 0);
  const gl = Math.abs(losses.reduce((a, r) => a + (r.netPnl ?? 0), 0));
  return {
    total: recs.length,
    winRate: recs.length ? wins.length / recs.length : 0,
    netPnl: recs.reduce((a, r) => a + (r.netPnl ?? 0), 0),
    profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
    avgPnl: recs.length ? recs.reduce((a, r) => a + (r.netPnl ?? 0), 0) / recs.length : 0,
    wins: wins.length,
    losses: losses.length,
  };
});

const periodStatCards = computed(() => {
  const s = periodStats.value;
  return [
    { label: '交易笔数', value: String(s.total), cls: '' },
    { label: '胜率', value: (s.winRate * 100).toFixed(1) + '%', cls: '' },
    { label: '净盈亏', value: fmtPnl(s.netPnl), cls: s.netPnl >= 0 ? 'up' : 'down' },
    { label: '盈亏比', value: s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2), cls: '' },
    { label: '平均盈亏', value: fmtPnl(s.avgPnl), cls: s.avgPnl >= 0 ? 'up' : 'down' },
    { label: '盈利/亏损', value: s.wins + '/' + s.losses, cls: '' },
  ];
});

const topMistakes = computed(() => {
  const freq: Record<string, number> = {};
  for (const r of periodRecords.value) {
    for (const t of r.tags ?? []) freq[t] = (freq[t] ?? 0) + 1;
  }
  return Object.entries(freq)
    .filter(([k]) => ['情绪化交易', '执行错误', '系统缺陷'].includes(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));
});

const suggestions = computed(() => {
  const s = periodStats.value;
  const out: string[] = [];
  if (s.total >= 3) {
    if (s.winRate < 0.5) out.push('胜率偏低（' + (s.winRate * 100).toFixed(0) + '%），建议收紧入场过滤条件，等待更高胜率的信号。');
    else out.push('胜率表现良好（' + (s.winRate * 100).toFixed(0) + '%），可保持当前入场逻辑。');
    if (s.profitFactor < 1.5) out.push('盈亏比不足（' + s.profitFactor.toFixed(2) + '），建议扩大止盈目标或提前止损，改善盈亏结构。');
    if (topMistakes.value.length) out.push('高频错误：' + topMistakes.value.map((m) => m.name + '（' + m.count + '次）').join('、') + '，建议在策略中加入对应风控规则。');
  }
  return out;
});

function renderPeriodCharts() {
  const recs = periodRecords.value;
  // 情绪分布
  if (emoChart.value) {
    if (!emoE) emoE = echarts.init(emoChart.value);
    const emoFreq: Record<string, number> = {};
    for (const r of recs) {
      const s = Math.round((r.emotionScore ?? 5) / 3);
      const label = s >= 3 ? '恐惧/贪婪' : s === 2 ? '紧张' : '冷静';
      emoFreq[label] = (emoFreq[label] ?? 0) + 1;
    }
    emoE.setOption({
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: ['40%', '70%'], label: { color: '#d1d5db', fontSize: 10 }, data: Object.entries(emoFreq).map(([name, value]) => ({ name, value })) }],
    });
  }
  // 计划符合度
  if (planChart.value) {
    if (!planE) planE = echarts.init(planChart.value);
    const pd = { complete: 0, partial: 0, none: 0 };
    for (const r of recs) {
      const k = r.planExecution ?? 'complete';
      if (k in pd) pd[k as keyof typeof pd]++;
      else pd.none++;
    }
    planE.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 30, right: 8, top: 12, bottom: 20 },
      xAxis: { type: 'category', data: ['完全', '部分', '未执行'], axisLabel: { color: '#6b7280', fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { color: '#6b7280', fontSize: 10 } },
      series: [{ type: 'bar', data: [pd.complete, pd.partial, pd.none], itemStyle: { color: '#06b6d4', borderRadius: [4, 4, 0, 0] } }],
    });
  }
  // 策略版本盈亏占比
  if (stratChart.value) {
    if (!stratE) stratE = echarts.init(stratChart.value);
    const byStrat: Record<string, number> = {};
    for (const r of recs) {
      const k = r.strategyVersion ?? '未标注';
      byStrat[k] = (byStrat[k] ?? 0) + (r.netPnl ?? 0);
    }
    stratE.setOption({
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: ['40%', '70%'], label: { color: '#d1d5db', fontSize: 10 }, data: Object.entries(byStrat).map(([name, value]) => ({ name, value })) }],
    });
  }
}

function goStrategies() { router.push('/strategies'); }

async function loadAll() {
  await loadAccounts();
  const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => ({ records: [] }));
  all.value = j.records;
}

watch([tab, period], async () => {
  if (tab.value === 'period') {
    await nextTick();
    renderPeriodCharts();
  }
});

onMounted(async () => {
  await loadAll();
  window.addEventListener('resize', () => { emoE?.resize(); planE?.resize(); stratE?.resize(); });
});
</script>

<style scoped>
.review { display: flex; flex-direction: column; gap: 12px; }
.review-head { display: flex; align-items: baseline; gap: 12px; }
.review-head h2 { margin: 0; font-size: 18px; color: var(--aw-text-title); }
.review-head .dim { font-size: 12px; }
.review-body { display: grid; grid-template-columns: 320px 1fr; gap: 12px; align-items: start; }
@media (max-width: 1100px) { .review-body { grid-template-columns: 1fr; } }

.rv-left { background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; padding: 12px; }
.rv-tabs { display: flex; gap: 4px; margin-bottom: 10px; background: var(--aw-bg); border-radius: 8px; padding: 3px; }
.rv-tab { flex: 1; padding: 7px 0; border: none; background: transparent; color: var(--aw-text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; }
.rv-tab b { margin-left: 4px; }
.rv-tab.active { background: var(--aw-bg-card); color: var(--aw-accent); font-weight: 600; }
.batch-filter { display: flex; gap: 6px; margin-bottom: 10px; }
.bf { padding: 4px 12px; border: 1px solid var(--aw-border); background: transparent; color: var(--aw-text-dim); border-radius: 999px; cursor: pointer; font-size: 11px; font-family: inherit; }
.bf.active { border-color: var(--aw-accent); color: var(--aw-accent); background: var(--aw-accent-dim); }
.bf.wide { flex: 1; border-radius: 8px; padding: 6px 0; }
.rv-list { display: flex; flex-direction: column; gap: 6px; max-height: calc(100vh - 260px); overflow-y: auto; }
.rv-item { padding: 10px 12px; border: 1px solid var(--aw-border); border-radius: 10px; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease); background: var(--aw-bg); }
.rv-item:hover { border-color: var(--aw-border-hover); }
.rv-item.active { box-shadow: 0 0 0 1px var(--aw-accent); border-color: var(--aw-accent); }
.rv-item.pending { border-color: rgba(239,68,68,0.35); }
.rv-item.done { border-color: rgba(16,185,129,0.3); }
.rvi-main { display: flex; align-items: center; gap: 10px; }
.rvi-pnl { font-size: 16px; font-weight: 700; min-width: 76px; text-align: right; }
.rvi-info { flex: 1; min-width: 0; }
.rvi-sym { display: flex; align-items: center; gap: 6px; }
.rvi-sym b { font-size: 13px; color: var(--aw-text-title); }
.rvi-meta { font-size: 11px; margin-top: 2px; }
.rvi-import { font-size: 10px; margin-top: 6px; }
.dir-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.dir-tag.long { background: rgba(239,68,68,0.15); color: #f87171; }
.dir-tag.short { background: rgba(16,185,129,0.15); color: #34d399; }

.rv-right { min-width: 0; }
.rp-card, .rp-report { padding: 18px 20px; }
.rp-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 20px; }
.rp-head2 { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.rp-head2 b { font-size: 14px; color: var(--aw-text-title); }
.rph-left { display: flex; align-items: center; gap: 10px; }
.rph-left .dim { font-size: 11px; margin-left: 6px; }
.rv-form .el-form-item { margin-bottom: 12px; }
.seg3 { display: flex; gap: 4px; }
.s3 { flex: 1; padding: 6px 0; border: 1px solid var(--aw-border); background: transparent; color: var(--aw-text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; }
.s3:hover { border-color: var(--aw-border-hover); }
.s3.active { border-color: var(--aw-accent); color: var(--aw-accent); background: var(--aw-accent-dim); }
.score-row { display: flex; align-items: center; gap: 10px; }
.score-row b { min-width: 26px; }
.score-row .el-slider { flex: 1; }
.ai-draft { margin-top: 4px; }
.rp-actions { display: flex; gap: 8px; margin-top: 4px; }
.rp-actions .aw-btn { flex: 1; }
.rp-readonly .el-descriptions { font-size: 12px; }
.rp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.rs-cell { background: var(--aw-bg); border-radius: 8px; padding: 10px 12px; }
.rs-label { font-size: 11px; color: var(--aw-text-dim); }
.rs-value { font-size: 16px; font-weight: 700; margin-top: 2px; }
.rp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.rp-block { background: var(--aw-bg); border-radius: 8px; padding: 12px; }
.rb-title { font-size: 12px; color: var(--aw-text-dim); margin-bottom: 8px; }
.mini-chart { height: 150px; }
.top3-list { display: flex; flex-direction: column; gap: 6px; }
.top3-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.top3-idx { width: 18px; height: 18px; border-radius: 50%; background: var(--aw-accent-dim); color: var(--aw-accent); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
.top3-text { flex: 1; }
.top3-count { color: var(--aw-text-dim); }
.rp-suggest { background: var(--aw-bg); border-radius: 8px; padding: 12px; margin-bottom: 14px; }
.sg-item { font-size: 12px; color: var(--aw-text-body); padding: 3px 0; }
</style>
