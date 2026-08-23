<template>
  <div class="sentiment-page">
    <!-- ══════════ 顶部控制栏 ══════════ -->
    <div class="ctl-bar">
      <!-- 币种选择 -->
      <el-select v-model="symbol" filterable class="sym-select" placeholder="选择币种" @change="onSymbolChange">
        <el-option v-for="s in SYMBOLS" :key="s" :label="s" :value="s">
          <span class="sym-opt"><i class="sym-dot" :style="{ background: coinColor(s) }"></i>{{ s }}</span>
        </el-option>
      </el-select>

      <i class="ctl-sep"></i>

      <!-- 时间范围 -->
      <div class="seg">
        <button v-for="t in RANGES" :key="t.key" class="seg-btn" :class="{ active: range === t.key }" @click="setRange(t.key)">{{ t.label }}</button>
        <el-date-picker
          v-if="range === 'custom'"
          v-model="customRange"
          type="datetimerange"
          size="small"
          class="custom-picker"
          :clearable="false"
          start-placeholder="开始" end-placeholder="结束"
          :default-time="[new Date(2000, 0, 1, 0, 0, 0), new Date(2000, 0, 1, 23, 59, 59)]"
        />
      </div>

      <i class="ctl-sep"></i>

      <!-- 数据源筛选 -->
      <div class="src-pills">
        <button
          v-for="s in SOURCES"
          :key="s.key"
          class="src-pill"
          :class="{ on: sources.includes(s.key) }"
          :title="s.key === 'rss' ? '当前仅接入 RSS 数据源' : '该数据源暂未接入采集器'"
          @click="toggleSource(s.key)"
        >
          <span class="pill-ic">{{ s.icon }}</span>{{ s.label }}
        </button>
      </div>

      <!-- 刷新 -->
      <button class="refresh-btn" :class="{ spinning: scanning }" title="刷新舆情" @click="scan"><i>⟳</i></button>

      <!-- 极端情绪警告 -->
      <div v-if="extremeWarn" class="warn-pill">{{ extremeWarn }}</div>
    </div>

    <!-- ══════════ 上区：情绪趋势 + 聚合仪表盘 ══════════ -->
    <div class="upper">
      <div class="panel trend-panel">
        <div class="panel-head">
          <span class="panel-title">情绪趋势</span>
          <span class="panel-sub">{{ trendSub }}</span>
        </div>
        <div v-show="!chartBusy && !noData" ref="trendEl" class="trend-chart"></div>
        <div v-if="chartBusy" class="skeleton"></div>
        <div v-else-if="noData" class="empty-wrap">
          <div class="empty-ic">📡</div>
          <p>{{ firstVisit ? '选择币种并点击刷新获取舆情' : '暂无数据，点击刷新获取舆情' }}</p>
          <button class="mini-btn primary" @click="scan">⟳ 立即刷新</button>
        </div>
      </div>

      <div class="panel gauge-panel">
        <div class="gauges">
          <div class="gauge">
            <div class="g-label">综合得分</div>
            <div class="g-num mono" :class="scoreCls">{{ scoreText }}</div>
            <div class="g-desc" :class="scoreCls">{{ scoreWord }}</div>
          </div>
          <div class="gauge">
            <div class="g-label">提及量</div>
            <div class="g-num mono">{{ mentionText }}</div>
            <div class="g-desc-row">
              <span class="g-mom mono" :class="momCls">{{ momText }}</span>
              <svg class="spark" :viewBox="SPARK_VIEW" preserveAspectRatio="none"><polyline :points="sparkPoints" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round" /></svg>
            </div>
          </div>
          <div class="gauge">
            <div class="g-label">情绪分布</div>
            <div class="donut-wrap">
              <svg :viewBox="DONUT_VIEW" class="donut">
                <path :d="donutBase" fill="rgba(255,255,255,0.05)" />
                <path v-for="(s, i) in donutSegs" :key="i" :d="s.d" :fill="s.color" stroke="#111827" stroke-width="1.5" />
              </svg>
              <div class="donut-center">
                <b class="mono" :style="{ color: donutMainColor }">{{ donutMain }}</b>
                <span class="dim">{{ donutMainPct }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="gauge-foot dim">样本数 {{ countText }} · 最后更新 {{ lastUpdateText }}</div>
      </div>
    </div>

    <!-- ══════════ 下区：消息流 + 详情面板 ══════════ -->
    <div class="lower">
      <div class="panel feed-panel">
        <div class="feed-head">
          <div class="feed-title">消息流<span class="feed-count">{{ filtered.length }}</span></div>
          <el-select v-model="sortBy" size="small" class="sort-select">
            <el-option value="time" label="时间倒序" />
            <el-option value="score" label="情绪从高到低" />
            <el-option value="kws" label="提及量" />
          </el-select>
        </div>
        <div class="feed-srcs">
          <span v-for="s in selectedSourceMeta" :key="s.key" class="src-tag" title="点击移除" @click="toggleSource(s.key)">{{ s.icon }} {{ s.label }} <b>×</b></span>
          <span v-if="keywordFilter" class="src-tag kw" title="点击移除" @click="keywordFilter = null">#{{ keywordFilter }} <b>×</b></span>
        </div>

        <div v-if="sources.length === 0" class="feed-state">
          <p>请至少选择一个数据源</p>
          <button class="mini-btn primary" @click="selectAllSources">快速全选</button>
        </div>
        <div v-else-if="scanning" class="feed-state">
          <div class="progress"><i :style="{ width: progressPct + '%' }"></i></div>
          <p class="dim">已抓取 {{ progress }} / {{ progressTotal }} 条…</p>
        </div>
        <div v-else-if="!filtered.length" class="feed-state">
          <p>{{ firstVisit ? '暂无数据，点击右上角刷新按钮获取舆情' : '当前筛选条件下无消息，尝试切换数据源或时间范围' }}</p>
          <button v-if="!firstVisit" class="mini-btn" @click="resetFilters">重置筛选</button>
        </div>
        <div v-else class="feed-list">
          <div v-for="r in sorted" :key="r.id" class="msg-card" :class="{ active: selected && selected.id === r.id }" @click="select(r)">
            <div class="msg-head">
              <span class="msg-src">{{ srcIcon(r) }}</span>
              <span class="msg-src-name">{{ srcName(r) }}</span>
              <span class="msg-author">{{ authorOf(r) }}</span>
              <span class="msg-time">{{ timeAgo(r.createdAt) }}</span>
              <span class="sent-tag" :class="labelCls(r.label)"><i class="sent-dot"></i>{{ labelWord(r.label) }} {{ fmtScore(r.score) }}</span>
            </div>
            <div class="msg-body">{{ cardText(r) }}</div>
            <div class="msg-foot">
              <span class="msg-kws">
                <button v-for="k in (r.keywords || []).slice(0, 5)" :key="k" class="kw" :class="{ on: keywordFilter === k }" @click.stop="toggleKeyword(k)">#{{ k }}</button>
              </span>
              <a v-if="r.url" class="msg-link" :href="r.url" target="_blank" rel="noreferrer" @click.stop>查看原文 →</a>
              <button class="sig-btn" @click.stop="openSignal(r)">＋ 加入策略信号</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel detail-panel">
        <template v-if="!selected">
          <div class="panel-head"><span class="panel-title">舆情洞察</span></div>
          <div v-if="!noData" class="insight-body">
            <div class="dl-block">
              <div class="dl-title">关键词云</div>
              <div v-if="cloudWords.length" class="cloud">
                <span
                  v-for="k in cloudWords"
                  :key="k.word"
                  class="cloud-word"
                  :class="'c-' + k.sentiment"
                  :style="{ fontSize: cloudSize(k.count) + 'px' }"
                  :title="k.word + ' ×' + k.count"
                >{{ k.word }}</span>
              </div>
              <p v-else class="dim">暂无关键词</p>
            </div>
            <div class="dl-block">
              <div class="dl-title">数据源占比</div>
              <div class="share">
                <div v-for="s in shareRows" :key="s.key" class="share-row">
                  <span class="share-name">{{ s.icon }} {{ s.label }}</span>
                  <div class="share-bar"><i :class="'bg-' + s.key" :style="{ width: s.pct + '%' }"></i></div>
                  <span class="share-pct mono">{{ s.pct }}%</span>
                </div>
              </div>
            </div>
            <div class="dl-block">
              <div class="dl-title">热门话题</div>
              <div class="topics">
                <div v-for="t in topics" :key="t.topic" class="topic-row">
                  <span class="topic-name" :title="'点击筛选 #' + t.topic" @click="keywordFilter = t.topic">#{{ t.topic }}</span>
                  <div class="topic-bar"><i :style="{ width: topicPct(t.count) + '%' }"></i></div>
                  <span class="topic-count mono">{{ t.count }} 次</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="feed-state"><p>暂无数据</p></div>
        </template>

        <template v-else>
          <div class="panel-head">
            <span class="panel-title">消息详情</span>
            <button class="back-btn" @click="selected = null">← 返回洞察</button>
          </div>
          <div class="detail-body">
            <div class="d-top">
              <span class="msg-src">{{ srcIcon(selected) }}</span>
              <span class="msg-src-name">{{ srcName(selected) }}</span>
              <span class="msg-author">{{ authorOf(selected) }}</span>
              <span class="msg-time">{{ timeAgo(selected.createdAt) }}</span>
              <span class="sent-tag" :class="labelCls(selected.label)"><i class="sent-dot"></i>{{ labelWord(selected.label) }} {{ fmtScore(selected.score) }}</span>
            </div>
            <h3 class="d-title">{{ selected.headline }}</h3>
            <div v-if="selected.body" class="d-body" :class="{ folded }">
              <p>{{ folded && selected.body.length > 200 ? selected.body.slice(0, 200) + '…' : selected.body }}</p>
              <button v-if="selected.body.length > 200" class="mini-btn" @click="folded = !folded">{{ folded ? '展开全文' : '收起' }}</button>
            </div>
            <div class="dl-block">
              <div class="dl-title">分析摘要</div>
              <p class="d-analysis">{{ analysisText }}</p>
            </div>
            <div class="dl-block">
              <div class="dl-title">情绪得分拆解</div>
              <div class="breakdown">
                <div class="bd-row"><span class="bd-name">正向词</span><span class="bd-val up mono">{{ fmtSigned(posScore) }}</span></div>
                <div class="bd-row"><span class="bd-name">负向词</span><span class="bd-val down mono">{{ fmtSigned(negScore) }}</span></div>
                <div class="bd-row strong"><span class="bd-name">综合</span><span class="bd-val mono" :class="scoreClsOf(selected.score)">{{ fmtSigned(selected.score) }}</span></div>
              </div>
            </div>
            <div class="dl-block">
              <div class="dl-title">相关消息</div>
              <div v-if="related.length" class="related">
                <button v-for="rel in related" :key="rel.id" class="rel-item" @click="select(rel)">
                  <span class="msg-src">{{ srcIcon(rel) }}</span>
                  <span class="rel-text">{{ rel.headline }}</span>
                  <span class="sent-tag" :class="labelCls(rel.label)">{{ fmtScore(rel.score) }}</span>
                </button>
              </div>
              <p v-else class="dim">暂无相关消息</p>
            </div>
            <div class="d-actions">
              <button class="mini-btn primary" @click="openSignal(selected)">＋ 加入策略信号</button>
              <button class="mini-btn" @click="markNoise(selected)">标记为噪音</button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ══════════ 策略信号抽屉 ══════════ -->
    <el-drawer v-model="signalOpen" :title="'加入策略信号 — ' + symbol" size="420px">
      <div class="signal-form">
        <div class="sf-row">
          <label>关联策略</label>
          <el-select v-model="signalStrategyId" placeholder="选择策略" class="sf-select">
            <el-option v-for="s in strategies" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </div>
        <div class="sf-row">
          <label>触发条件</label>
          <el-select v-model="signalCond" class="sf-select">
            <el-option value="gt" label="情绪得分 &gt; 0.5 时提醒" />
            <el-option value="lt" label="情绪得分 &lt; -0.5 时提醒" />
            <el-option value="extreme" label="极端情绪（|分| &gt; 0.8）时提醒" />
            <el-option value="record" label="仅记录，不提醒" />
          </el-select>
        </div>
        <div v-if="signalRecord" class="sf-preview">
          <span class="sent-tag" :class="labelCls(signalRecord.label)"><i class="sent-dot"></i>{{ labelWord(signalRecord.label) }} {{ fmtScore(signalRecord.score) }}</span>
          <p class="dim">{{ signalRecord.headline }}</p>
        </div>
        <div class="sf-actions">
          <button class="mini-btn primary" @click="saveSignal">确认加入</button>
          <button class="mini-btn" @click="signalOpen = false">取消</button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api, type SentimentAggregate, type SentimentRecord, type StrategyConfig } from '../api.ts';

// ---------- 常量 ----------
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const COIN_COLORS: Record<string, string> = {
  BTCUSDT: '#F7931A', ETHUSDT: '#627EEA', SOLUSDT: '#14F195',
  BNBUSDT: '#F3BA2F', XRPUSDT: '#00AAE4', DOGEUSDT: '#C2A633',
};
function coinColor(s: string): string { return COIN_COLORS[s] ?? '#06B6D4'; }

const RANGES = [
  { key: '24h', label: '近 24h' },
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: 'custom', label: '自定义' },
];
const SOURCES = [
  { key: 'rss', label: 'RSS', icon: '📰' },
  { key: 'twitter', label: 'Twitter', icon: '🐦' },
  { key: 'reddit', label: 'Reddit', icon: '🔴' },
  { key: 'onchain', label: '链上', icon: '⛓️' },
];
const SOURCE_NAME: Record<string, string> = { rss: 'RSS', twitter: 'Twitter', reddit: 'Reddit', onchain: '链上' };
const SPARK_VIEW = '0 0 100 24';
const DONUT_VIEW = '0 0 100 58';
/** 客户端情感词典（与后端启发式打分一致，用于关键词云着色与得分拆解） */
const BULLISH = new Set(['surge', 'rally', 'soar', 'gain', 'upgrade', 'adopt', 'launch', 'partnership', 'etf', 'approval', 'record high', 'bullish', 'breakout', 'halving', 'institutional', 'all-time high', 'integration', 'milestone', 'positive', 'growth', 'support']);
const BEARISH = new Set(['crash', 'plunge', 'drop', 'fall', 'dump', 'hack', 'exploit', 'ban', 'lawsuit', 'securities', 'fine', 'arrest', 'rug pull', 'fraud', 'bearish', 'sell-off', 'decline', 'fear', 'outflow', 'delist', 'collapse', 'warning', 'scam', 'pump and dump', 'regulation']);

// ---------- 状态 ----------
const symbol = ref('BTCUSDT');
const range = ref('24h');
const customRange = ref<[Date, Date] | null>(null);
const sources = ref<string[]>(['rss']);
const scanning = ref(false);
const progress = ref(0);
const progressTotal = ref(50);
const loading = ref(false);
const firstVisit = ref(true);
const data = ref<SentimentAggregate | null>(null);
const selected = ref<SentimentRecord | null>(null);
const folded = ref(true);
const keywordFilter = ref<string | null>(null);
const noiseIds = ref<Set<string>>(new Set());
const sortBy = ref('time');

const signalOpen = ref(false);
const signalRecord = ref<SentimentRecord | null>(null);
const signalStrategyId = ref('');
const signalCond = ref('gt');
const strategies = ref<StrategyConfig[]>([]);

// ---------- 数据 ----------
const hours = computed(() => {
  if (range.value === '24h') return 24;
  if (range.value === '7d') return 168;
  if (range.value === '30d') return 720;
  if (customRange.value?.[0] && customRange.value?.[1]) {
    return Math.max(1, Math.round((customRange.value[1].getTime() - customRange.value[0].getTime()) / 3_600_000));
  }
  return 168;
});

async function load() {
  loading.value = true;
  try {
    const agg = await api.get<SentimentAggregate>('/sentiment/' + symbol.value + '?hours=' + hours.value);
    data.value = agg;
    firstVisit.value = false;
    if (selected.value && !agg.latest.some((r) => r.id === selected.value!.id)) selected.value = null;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}

async function scan() {
  if (scanning.value) return;
  scanning.value = true;
  progress.value = 0;
  progressTotal.value = 50;
  const tick = setInterval(() => {
    if (progress.value < progressTotal.value - 4) progress.value += 1 + Math.floor(Math.random() * 3);
  }, 220);
  try {
    const res = await api.post<{ scanned: number; stored: number; averageScore: number }>('/sentiment/scan', { symbol: symbol.value, useLLM: true });
    progress.value = progressTotal.value;
    ElMessage.success('扫描完成：抓取 ' + res.scanned + ' 条，相关 ' + res.stored + ' 条，平均分 ' + res.averageScore);
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    clearInterval(tick);
    setTimeout(() => { scanning.value = false; }, 350);
  }
}

function onSymbolChange() {
  selected.value = null;
  keywordFilter.value = null;
  load();
}
function setRange(k: string) {
  range.value = k;
  if (k === 'custom' && !customRange.value) {
    customRange.value = [new Date(Date.now() - 7 * 86_400_000), new Date()];
  }
  if (k !== 'custom') load();
}
watch(customRange, () => { if (range.value === 'custom') load(); });

function toggleSource(key: string) {
  const i = sources.value.indexOf(key);
  if (i >= 0) sources.value.splice(i, 1);
  else sources.value.push(key);
}
function selectAllSources() { sources.value = SOURCES.map((s) => s.key); }
function resetFilters() {
  sources.value = ['rss'];
  keywordFilter.value = null;
  sortBy.value = 'time';
  selected.value = null;
}
function toggleKeyword(k: string) { keywordFilter.value = keywordFilter.value === k ? null : k; }

function select(r: SentimentRecord) {
  selected.value = r;
  folded.value = true;
}

function markNoise(r: SentimentRecord) {
  noiseIds.value.add(r.id);
  if (selected.value?.id === r.id) selected.value = null;
  ElMessage.success('已标记为噪音，已从消息流移除');
}

// ---------- 派生数据 ----------
const chartBusy = computed(() => loading.value || scanning.value);
const noData = computed(() => !data.value || data.value.count === 0);
const records = computed(() => data.value?.latest ?? []);

function sourceGroup(s: string): string {
  const v = s.toLowerCase();
  if (v === 'rss' || v === 'news' || v === 'cointelegraph' || v === 'coindesk' || v === 'decrypt') return 'rss';
  if (v.includes('twitter') || v === 'social') return 'twitter';
  if (v.includes('reddit')) return 'reddit';
  if (v.includes('chain') || v.includes('onchain') || v.includes('链上')) return 'onchain';
  return v;
}

const filtered = computed(() =>
  records.value.filter((r) =>
    sources.value.includes(sourceGroup(r.source)) &&
    (!keywordFilter.value || (r.keywords ?? []).some((k) => k.toLowerCase() === keywordFilter.value)) &&
    !noiseIds.value.has(r.id),
  ),
);
const sorted = computed(() => {
  const arr = [...filtered.value];
  if (sortBy.value === 'score') arr.sort((a, b) => b.score - a.score);
  else if (sortBy.value === 'kws') arr.sort((a, b) => (b.keywords?.length ?? 0) - (a.keywords?.length ?? 0));
  else arr.sort((a, b) => b.createdAt - a.createdAt);
  return arr;
});
const selectedSourceMeta = computed(() => SOURCES.filter((s) => sources.value.includes(s.key)));

const trendSub = computed(() => {
  if (!data.value) return '';
  const label = RANGES.find((x) => x.key === range.value)?.label ?? '自定义';
  return label + ' · ' + data.value.count + ' 条记录' + (data.value.series.length ? ' · ' + data.value.series.length + ' 个时间桶' : '');
});

// ---------- 仪表盘 ----------
function scoreClsOf(s: number): string { return s > 0.15 ? 'up' : (s < -0.15 ? 'down' : 'neutral'); }
const scoreText = computed(() => (data.value ? fmtSigned(data.value.averageScore) : '--'));
const scoreCls = computed(() => (data.value ? scoreClsOf(data.value.averageScore) : 'neutral'));
const scoreWord = computed(() => {
  const a = data.value?.averageScore;
  if (a == null) return '暂无数据';
  if (a > 0.15) return '偏乐观';
  if (a < -0.15) return '偏悲观';
  return '中性';
});
const mentionText = computed(() => (data.value && data.value.count > 0 ? data.value.count.toLocaleString('zh-CN') : '--'));
const series = computed(() => data.value?.series ?? []);
const momText = computed(() => {
  const s = series.value;
  if (s.length < 2) return '--';
  const last = s[s.length - 1]!.count;
  const prev = s[s.length - 2]!.count;
  if (prev === 0 && last === 0) return '--';
  const pct = prev === 0 ? 100 : Math.round(((last - prev) / prev) * 100);
  return (pct >= 0 ? '↑ +' : '↓ ') + pct + '%';
});
const momCls = computed(() => (momText.value.startsWith('↑') ? 'up' : (momText.value.startsWith('↓') ? 'down' : 'neutral')));
const sparkPoints = computed(() => {
  const s = series.value.slice(-14);
  if (s.length < 2) return '';
  const max = Math.max(...s.map((x) => x.count), 1);
  return s.map((x, i) => (i / (s.length - 1)) * 100 + ',' + (24 - 1 - (x.count / max) * 21)).join(' ');
});

const donutSegs = computed(() => {
  const d = data.value?.distribution ?? { bullish: 0, neutral: 0, bearish: 0 };
  const total = d.bullish + d.neutral + d.bearish;
  if (!total) return [];
  const items = [
    { frac: d.bullish / total, color: '#10B981' },
    { frac: d.neutral / total, color: '#6B7280' },
    { frac: d.bearish / total, color: '#EF4444' },
  ].filter((x) => x.frac > 0);
  const cx = 50, cy = 52, rOut = 46, rIn = 34;
  let acc = 0;
  return items.map((it) => {
    const a0 = Math.PI - 2 * Math.PI * acc;
    const a1 = Math.PI - 2 * Math.PI * (acc + it.frac);
    acc += it.frac;
    const large = it.frac > 0.5 ? 1 : 0;
    const p = (x: number, y: number) => x.toFixed(2) + ' ' + y.toFixed(2);
    const x0 = cx + rOut * Math.cos(a0), y0 = cy + rOut * Math.sin(a0);
    const x1 = cx + rOut * Math.cos(a1), y1 = cy + rOut * Math.sin(a1);
    const xi0 = cx + rIn * Math.cos(a1), yi0 = cy + rIn * Math.sin(a1);
    const xi1 = cx + rIn * Math.cos(a0), yi1 = cy + rIn * Math.sin(a0);
    const d = ['M', p(x0, y0), 'A', rOut, rOut, 0, large, 1, p(x1, y1), 'L', p(xi0, yi0), 'A', rIn, rIn, 0, large, 0, p(xi1, yi1), 'Z'].join(' ');
    return { d, color: it.color };
  });
});
const donutBase = computed(() => {
  const cx = 50, cy = 52, rOut = 46, rIn = 34;
  return ['M', cx - rOut, cy, 'A', rOut, rOut, 0, 0, 1, cx + rOut, cy, 'L', cx + rIn, cy, 'A', rIn, rIn, 0, 0, 0, cx - rIn, cy, 'Z'].join(' ');
});
const donutMain = computed(() => {
  const d = data.value?.distribution;
  if (!d || d.bullish + d.neutral + d.bearish === 0) return '—';
  const max = Math.max(d.bullish, d.neutral, d.bearish);
  return max === d.bullish ? '乐观' : (max === d.bearish ? '悲观' : '中性');
});
const donutMainPct = computed(() => {
  const d = data.value?.distribution;
  if (!d) return '';
  const t = d.bullish + d.neutral + d.bearish;
  if (!t) return '';
  const max = Math.max(d.bullish, d.neutral, d.bearish);
  return Math.round((max / t) * 100) + '%';
});
const donutMainColor = computed(() => (donutMain.value === '乐观' ? '#10B981' : (donutMain.value === '悲观' ? '#EF4444' : '#9CA3AF')));

const countText = computed(() => (data.value && data.value.count > 0 ? data.value.count.toLocaleString('zh-CN') : '0'));
const lastUpdateText = computed(() => (data.value?.lastAt ? timeAgo(data.value.lastAt) : '—'));

// ---------- 洞察面板 ----------
const cloudWords = computed(() => data.value?.keywords.slice(0, 24) ?? []);
const maxKw = computed(() => Math.max(...cloudWords.value.map((k) => k.count), 1));
function cloudSize(count: number): number { return 12 + Math.round((count / maxKw.value) * 14); }

const shareRows = computed(() => {
  const src = data.value?.sources ?? {};
  const total = Object.values(src).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return SOURCES.map((s) => ({ ...s, pct: Math.round(((src[s.key] ?? 0) / total) * 100) })).filter((s) => s.pct > 0);
});
const topics = computed(() => data.value?.topics ?? []);
const maxTopic = computed(() => Math.max(...topics.value.map((t) => t.count), 1));
function topicPct(c: number): number { return Math.round((c / maxTopic.value) * 100); }

// ---------- 详情面板 ----------
const posScore = computed(() => {
  const kws = selected.value?.keywords ?? [];
  const pos = kws.filter((k) => BULLISH.has(k.toLowerCase())).length;
  const neg = kws.filter((k) => BEARISH.has(k.toLowerCase())).length;
  const total = pos + neg;
  return total ? Math.round((pos / total) * 100) / 100 : 0;
});
const negScore = computed(() => {
  const kws = selected.value?.keywords ?? [];
  const pos = kws.filter((k) => BULLISH.has(k.toLowerCase())).length;
  const neg = kws.filter((k) => BEARISH.has(k.toLowerCase())).length;
  const total = pos + neg;
  return total ? -Math.round((neg / total) * 100) / 100 : 0;
});
const analysisText = computed(() => {
  const r = selected.value;
  if (!r) return '';
  const kws = (r.keywords ?? []).slice(0, 6);
  const kwText = kws.length ? '提及 ' + kws.map((k) => '「' + k + '」').join('、') : '未提取到关键话题';
  const lean = r.score > 0.15 ? '偏向积极' : (r.score < -0.15 ? '偏向消极' : '无明显倾向');
  return '该消息表达了' + labelWord(r.label) + '情绪，综合得分 ' + fmtSigned(r.score) + '，' + kwText + '，整体' + lean + '。';
});
const related = computed(() => {
  const r = selected.value;
  if (!r) return [];
  const kws = new Set((r.keywords ?? []).map((k) => k.toLowerCase()));
  return records.value
    .filter((x) => x.id !== r.id && !noiseIds.value.has(x.id) && (x.keywords ?? []).some((k) => kws.has(k.toLowerCase())))
    .slice(0, 5);
});

// ---------- 展示辅助 ----------
function srcIcon(r: SentimentRecord): string { return SOURCES.find((s) => s.key === sourceGroup(r.source))?.icon ?? '📰'; }
function srcName(r: SentimentRecord): string { return SOURCE_NAME[sourceGroup(r.source)] ?? r.source; }
function authorOf(r: SentimentRecord): string {
  const s = r.source.toLowerCase();
  if (s === 'cointelegraph') return '@CoinTelegraph';
  if (s === 'coindesk') return '@CoinDesk';
  if (s === 'decrypt') return '@Decrypt';
  if (s === 'manual') return '手动录入';
  if (s.includes('twitter')) return '@' + r.source;
  if (s.includes('reddit')) return 'r/CryptoCurrency';
  if (sourceGroup(s) === 'onchain') return '链上数据';
  return '@' + r.source;
}
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
  return Math.floor(diff / 86_400_000) + ' 天前';
}
function labelWord(l: string): string { return l === 'bullish' ? '乐观' : (l === 'bearish' ? '悲观' : '中性'); }
function labelCls(l: string): string { return l === 'bullish' ? 'up' : (l === 'bearish' ? 'down' : 'neutral'); }
function fmtScore(s: number): string { return (s >= 0 ? '+' : '') + s.toFixed(2); }
function fmtSigned(s: number): string { return (s >= 0 ? '+' : '') + s.toFixed(2); }
function cardText(r: SentimentRecord): string { return r.body ? r.headline + ' — ' + r.body : r.headline; }

// ---------- 极端情绪警告 ----------
const extremeWarn = computed(() => {
  const a = data.value?.averageScore;
  if (a == null || Math.abs(a) <= 0.8) return '';
  return a > 0
    ? symbol.value + ' 舆情极端乐观，注意回调风险'
    : symbol.value + ' 舆情极端悲观，留意反弹机会';
});

// ---------- 策略信号 ----------
async function openSignal(r: SentimentRecord) {
  signalRecord.value = r;
  if (!strategies.value.length) {
    try {
      const res = await api.get<{ strategies: StrategyConfig[] }>('/strategies');
      strategies.value = res.strategies ?? [];
    } catch { /* 策略列表加载失败不阻塞 */ }
  }
  signalOpen.value = true;
}
function saveSignal() {
  if (!signalStrategyId.value) { ElMessage.warning('请选择关联策略'); return; }
  const st = strategies.value.find((s) => s.id === signalStrategyId.value);
  const rules = JSON.parse(localStorage.getItem('aw_signal_rules') ?? '[]') as unknown[];
  rules.push({
    id: 'sig-' + Date.now(),
    recordId: signalRecord.value?.id,
    symbol: symbol.value,
    strategyId: signalStrategyId.value,
    strategyName: st?.name ?? signalStrategyId.value,
    condition: signalCond.value,
    score: signalRecord.value?.score,
    createdAt: Date.now(),
  });
  localStorage.setItem('aw_signal_rules', JSON.stringify(rules));
  ElMessage.success('已加入策略信号：' + (st?.name ?? ''));
  signalOpen.value = false;
}

// ---------- 趋势图 ----------
const trendEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let ro: ResizeObserver | null = null;

const progressPct = computed(() => Math.round((progress.value / progressTotal.value) * 100));

function renderTrend() {
  const el = trendEl.value;
  if (!el || noData.value) return;
  if (!chart) chart = echarts.init(el);
  const s = series.value;
  const pos: [number, number | null][] = s.map((x) => [x.t, x.score != null && x.score > 0 ? x.score : null]);
  const neg: [number, number | null][] = s.map((x) => [x.t, x.score != null && x.score < 0 ? x.score : null]);
  const bars: [number, number][] = s.map((x) => [x.t, x.count]);
  const events = [...records.value]
    .filter((r) => Math.abs(r.score) >= 0.4)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3)
    .map((r) => ({
      coord: [r.createdAt, r.score] as [number, number],
      value: r.headline,
      itemStyle: { color: '#F59E0B', borderColor: '#0B0F19', borderWidth: 1.5 },
    }));
  chart.setOption(
    {
      animationDuration: 350,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1A1F2E',
        borderColor: 'rgba(255,255,255,0.12)',
        textStyle: { color: '#d1d5db', fontSize: 12 },
        axisPointer: { type: 'cross', lineStyle: { color: 'rgba(255,255,255,0.2)' }, label: { backgroundColor: '#1A1F2E' } },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const first = list[0] as { value?: [number, number] } | undefined;
          const t = first?.value?.[0];
          if (!t) return '';
          const head = new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
          const parts = ['<b>' + head + '</b>'];
          for (const p of list as { seriesName?: string; value?: [number, number] }[]) {
            const v = p.value?.[1];
            if (p.seriesName === '事件' && v != null) parts.push('<span style="color:#f59e0b">⚡ ' + p.value![1] + '</span>');
            else if (p.seriesName === '提及量') parts.push('提及量：<b>' + (v ?? 0) + '</b>');
            else if (v != null) parts.push('情绪得分：<b>' + (+v).toFixed(2) + '</b>');
          }
          return parts.join('<br/>');
        },
      },
      grid: { left: 8, right: 8, top: 20, bottom: 4, containLabel: true },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.14)' } },
        axisLabel: { color: '#6b7280', fontSize: 10, formatter: (v: number) => new Date(v).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' }) },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value', min: -1, max: 1,
          axisLabel: { color: '#6b7280', fontSize: 10, formatter: (v: number) => v.toFixed(1) },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)', type: 'dashed' } },
        },
        { type: 'value', position: 'right', axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        {
          name: '提及量', type: 'bar', data: bars, yAxisIndex: 1, barWidth: '45%',
          itemStyle: { color: 'rgba(156,163,175,0.25)', borderRadius: [2, 2, 0, 0] }, z: 1,
        },
        {
          name: '情绪(正)', type: 'line', data: pos, connectNulls: false, smooth: 0.3, showSymbol: false,
          lineStyle: { width: 2, color: '#10B981' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(16,185,129,0.32)' },
              { offset: 1, color: 'rgba(16,185,129,0.02)' },
            ]),
          },
          z: 3,
        },
        {
          name: '情绪(负)', type: 'line', data: neg, connectNulls: false, smooth: 0.3, showSymbol: false,
          lineStyle: { width: 2, color: '#EF4444' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(239,68,68,0.02)' },
              { offset: 1, color: 'rgba(239,68,68,0.32)' },
            ]),
          },
          z: 3,
        },
        {
          name: '零线', type: 'line',
          data: s.length ? [[s[0]!.t, 0], [s[s.length - 1]!.t, 0]] : [],
          lineStyle: { color: '#6B7280', type: 'dashed', width: 1 }, symbol: 'none', silent: true, z: 2,
        },
        { name: '事件', type: 'scatter', data: events, symbolSize: 9, z: 5 },
      ],
    },
    true,
  );
}

watch(data, () => { nextTick(renderTrend); });

onMounted(() => {
  load();
  ro = new ResizeObserver(() => chart?.resize());
  if (trendEl.value) ro.observe(trendEl.value);
});
onActivated(() => { nextTick(() => chart?.resize()); });
onBeforeUnmount(() => { ro?.disconnect(); chart?.dispose(); chart = null; });
</script>

<style scoped>
.sentiment-page { display: flex; flex-direction: column; gap: 12px; height: calc(100vh - 80px); min-height: 580px; }

/* ---------- 顶部控制栏 ---------- */
.ctl-bar {
  display: flex; align-items: center; gap: 10px; height: 48px; padding: 6px 20px;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; flex: 0 0 auto;
}
.sym-select { width: 150px; }
.sym-select :deep(.el-select__wrapper) { height: 32px; box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.35) inset; }
.sym-opt { display: inline-flex; align-items: center; gap: 7px; }
.sym-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.ctl-sep { width: 1px; height: 20px; background: rgba(255, 255, 255, 0.08); margin: 0 2px; }
.seg { display: flex; align-items: center; gap: 2px; background: rgba(255, 255, 255, 0.04); border-radius: 8px; padding: 2px; }
.seg-btn { border: none; background: transparent; color: var(--aw-text-dim); font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease); font-family: inherit; }
.seg-btn:hover { color: var(--aw-text-body); }
.seg-btn.active { background: var(--aw-accent); color: #fff; font-weight: 600; }
.custom-picker { width: 300px; margin-left: 4px; }
.src-pills { display: flex; gap: 6px; }
.src-pill {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14); background: transparent; color: var(--aw-text-dim);
  font-size: 12px; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease); font-family: inherit;
}
.src-pill:hover { border-color: var(--aw-border-hover); color: var(--aw-text-body); }
.src-pill.on { background: var(--aw-accent); border-color: var(--aw-accent); color: #fff; }
.pill-ic { font-size: 12px; }
.refresh-btn {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent; color: var(--aw-text-body); cursor: pointer; display: inline-flex;
  align-items: center; justify-content: center; font-size: 17px; transition: border-color var(--aw-dur-fast) var(--aw-ease), color var(--aw-dur-fast) var(--aw-ease);
}
.refresh-btn:hover { border-color: var(--aw-accent); color: var(--aw-accent); }
.refresh-btn i { font-style: normal; display: inline-block; transition: transform 400ms var(--aw-ease); }
.refresh-btn:hover i { transform: rotate(180deg); }
.refresh-btn.spinning i { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.warn-pill {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px;
  border-radius: 999px; font-size: 12px; color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.1); white-space: nowrap;
}
.warn-pill::before { content: '⚠'; }

/* ---------- 面板通用 ---------- */
.panel { background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; display: flex; flex-direction: column; min-height: 0; }
.panel-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px 0; flex: 0 0 auto; }
.panel-title { font-size: 13px; font-weight: 600; color: var(--aw-text-title); }
.panel-sub { font-size: 11px; color: var(--aw-text-dim); }

/* ---------- 上区 ---------- */
.upper { display: flex; gap: 12px; flex: 0 0 auto; height: 300px; }
.trend-panel { flex: 1.9; }
.gauge-panel { flex: 1; }
.trend-chart { flex: 1; min-height: 0; margin: 8px 12px 12px; }
.skeleton { flex: 1; margin: 8px 12px 12px; border-radius: 8px; background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.empty-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--aw-text-dim); font-size: 12px; }
.empty-wrap p { margin: 0; }
.empty-ic { font-size: 34px; opacity: 0.5; }
.mini-btn { border: 1px solid rgba(255, 255, 255, 0.12); background: transparent; color: var(--aw-text-body); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease); font-family: inherit; }
.mini-btn:hover { border-color: var(--aw-accent); color: var(--aw-accent); }
.mini-btn.primary { background: var(--aw-accent); border-color: var(--aw-accent); color: #fff; font-weight: 600; }
.mini-btn.primary:hover { filter: brightness(1.1); }

/* ---------- 聚合仪表盘 ---------- */
.gauges { flex: 1; display: flex; min-height: 0; }
.gauge { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-width: 0; position: relative; }
.gauge + .gauge::before { content: ''; position: absolute; left: 0; top: 18%; bottom: 18%; width: 1px; background: rgba(255, 255, 255, 0.04); }
.g-label { font-size: 11px; color: var(--aw-text-dim); }
.g-num { font-size: 30px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: var(--aw-text-title); }
.g-desc { font-size: 12px; }
.g-desc-row { display: flex; align-items: center; gap: 6px; }
.g-mom { font-size: 12px; font-weight: 600; }
.spark { width: 62px; height: 22px; }
.donut-wrap { position: relative; width: 104px; height: 60px; }
.donut { width: 100%; height: 100%; }
.donut-center { position: absolute; left: 0; right: 0; bottom: 2px; display: flex; flex-direction: column; align-items: center; gap: 1px; }
.donut-center b { font-size: 15px; }
.donut-center span { font-size: 10px; }
.gauge-foot { padding: 8px 16px; border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 11px; text-align: center; flex: 0 0 auto; }

/* ---------- 下区 ---------- */
.lower { flex: 1; display: flex; gap: 12px; min-height: 0; }
.feed-panel { flex: 1.25; }
.detail-panel { flex: 1; }

/* 消息流头部 */
.feed-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px 8px; flex: 0 0 auto; }
.feed-title { font-size: 13px; font-weight: 600; color: var(--aw-text-title); display: flex; align-items: center; }
.feed-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--aw-accent-dim); color: var(--aw-accent); font-size: 11px; font-weight: 600; margin-left: 6px; }
.sort-select { width: 138px; margin-left: auto; }
.feed-srcs { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; flex: 0 0 auto; }
.src-tag {
  display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px;
  font-size: 11px; color: var(--aw-text-body); background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3);
  cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease);
}
.src-tag b { font-weight: 400; opacity: 0.6; margin-left: 2px; }
.src-tag:hover { border-color: var(--aw-down); color: var(--aw-down); }
.src-tag.kw { color: var(--aw-accent); }

/* 消息流状态 / 进度 */
.feed-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--aw-text-dim); font-size: 12px; padding: 24px 16px; }
.feed-state p { margin: 0; }
.progress { width: min(320px, 70%); height: 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.06); overflow: hidden; }
.progress i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #06B6D4, #22d3ee); transition: width 220ms linear; }

/* 消息卡片 */
.feed-list { flex: 1; overflow-y: auto; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.msg-card { position: relative; border: 1px solid var(--aw-border); border-radius: 10px; padding: 10px 12px; background: rgba(255, 255, 255, 0.015); cursor: pointer; transition: border-color var(--aw-dur-fast) var(--aw-ease), background var(--aw-dur-fast) var(--aw-ease); }
.msg-card:hover { border-color: rgba(6, 182, 212, 0.35); background: rgba(6, 182, 212, 0.05); }
.msg-card.active { border-color: rgba(6, 182, 212, 0.6); background: rgba(6, 182, 212, 0.07); }
.msg-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.msg-src { font-size: 14px; line-height: 1; }
.msg-src-name { font-weight: 600; color: var(--aw-text-title); }
.msg-author { color: var(--aw-text-dim); font-size: 11px; }
.msg-time { color: var(--aw-text-dim); font-size: 11px; margin-left: auto; white-space: nowrap; }
.sent-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; border-radius: 999px; padding: 1px 8px; border: 1px solid; white-space: nowrap; line-height: 16px; }
.sent-tag.up { color: #10b981; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); }
.sent-tag.down { color: #ef4444; border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08); }
.sent-tag.neutral { color: #9ca3af; border-color: rgba(156, 163, 175, 0.3); background: rgba(156, 163, 175, 0.06); }
.sent-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.msg-body { margin-top: 8px; font-size: 12px; color: var(--aw-text-body); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.msg-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.msg-kws { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
.kw { border: none; background: transparent; padding: 0; color: #06b6d4; font-size: 11px; cursor: pointer; font-family: inherit; }
.kw:hover { text-decoration: underline; }
.kw.on { color: #22d3ee; font-weight: 600; }
.msg-link { color: var(--aw-text-dim); font-size: 11px; text-decoration: none; white-space: nowrap; }
.msg-link:hover { color: var(--aw-accent); }
.sig-btn { border: none; background: transparent; color: #22d3ee; font-size: 11px; cursor: pointer; padding: 2px 6px; border-radius: 6px; opacity: 0; transition: opacity var(--aw-dur-fast) var(--aw-ease), background var(--aw-dur-fast) var(--aw-ease); font-family: inherit; white-space: nowrap; }
.sig-btn:hover { background: rgba(6, 182, 212, 0.12); }
.msg-card:hover .sig-btn { opacity: 1; }

/* 洞察面板 */
.insight-body { flex: 1; overflow-y: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 18px; }
.dl-block { flex: 0 0 auto; }
.dl-title { font-size: 12px; font-weight: 600; color: var(--aw-text-title); margin-bottom: 10px; }
.cloud { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; min-height: 72px; }
.cloud-word { cursor: default; line-height: 1.5; }
.cloud-word.c-positive { color: #34d399; }
.cloud-word.c-negative { color: #f87171; }
.cloud-word.c-neutral { color: #9ca3af; }
.share { display: flex; flex-direction: column; gap: 9px; }
.share-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.share-name { width: 76px; color: var(--aw-text-dim); white-space: nowrap; }
.share-bar { flex: 1; height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.05); overflow: hidden; }
.share-bar i { display: block; height: 100%; border-radius: 999px; transition: width 400ms var(--aw-ease); }
.bg-rss { background: #06b6d4; }
.bg-twitter { background: #1da1f2; }
.bg-reddit { background: #ff4500; }
.bg-onchain { background: #10b981; }
.share-pct { width: 38px; text-align: right; color: var(--aw-text-dim); }
.topics { display: flex; flex-direction: column; gap: 9px; }
.topic-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.topic-name { color: #06b6d4; cursor: pointer; width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topic-name:hover { text-decoration: underline; }
.topic-bar { flex: 1; height: 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.05); overflow: hidden; }
.topic-bar i { display: block; height: 100%; border-radius: 999px; background: rgba(6, 182, 212, 0.55); }
.topic-count { width: 42px; text-align: right; color: var(--aw-text-dim); }

/* 详情面板 */
.detail-body { flex: 1; overflow-y: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
.d-top { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.d-title { font-size: 14px; color: var(--aw-text-title); line-height: 1.5; margin: 0; }
.d-body { font-size: 12px; color: var(--aw-text-body); line-height: 1.7; }
.d-body p { margin: 0 0 8px; }
.d-analysis { font-size: 12px; color: var(--aw-text-dim); line-height: 1.7; margin: 0; }
.breakdown { display: flex; flex-direction: column; gap: 4px; }
.bd-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; padding: 5px 0; border-bottom: 1px dashed rgba(255, 255, 255, 0.06); }
.bd-row.strong { border-bottom: none; padding-top: 7px; }
.bd-name { color: var(--aw-text-dim); }
.bd-val { font-weight: 600; font-variant-numeric: tabular-nums; }
.related { display: flex; flex-direction: column; gap: 6px; }
.rel-item { display: flex; align-items: center; gap: 8px; border: 1px solid var(--aw-border); background: rgba(255, 255, 255, 0.015); border-radius: 8px; padding: 6px 8px; font-size: 11px; color: var(--aw-text-body); cursor: pointer; text-align: left; width: 100%; transition: border-color var(--aw-dur-fast) var(--aw-ease); font-family: inherit; }
.rel-item:hover { border-color: rgba(6, 182, 212, 0.4); }
.rel-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.d-actions { display: flex; gap: 8px; padding-top: 4px; }
.back-btn { margin-left: auto; border: none; background: transparent; color: var(--aw-text-dim); font-size: 12px; cursor: pointer; font-family: inherit; }
.back-btn:hover { color: var(--aw-accent); }

/* 策略信号抽屉 */
.signal-form { display: flex; flex-direction: column; gap: 16px; padding: 4px 0; }
.sf-row { display: flex; flex-direction: column; gap: 8px; }
.sf-row label { font-size: 12px; color: var(--aw-text-dim); }
.sf-select { width: 100%; }
.sf-preview { border: 1px solid var(--aw-border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.sf-preview p { margin: 0; font-size: 12px; color: var(--aw-text-body); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.sf-actions { display: flex; gap: 8px; justify-content: flex-end; }

.up { color: #10b981; }
.down { color: #ef4444; }
.neutral { color: #9ca3af; }
.dim { color: var(--aw-text-dim); }
.mono { font-family: var(--aw-mono); font-variant-numeric: tabular-nums; }
</style>

