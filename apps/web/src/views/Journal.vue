<template>
  <div>
    <!-- 筛选栏 -->
    <el-card shadow="never" class="mb">
      <div class="filters">
        <el-select v-model="f.accountId" size="small" style="width: 180px" @change="onAccountFilterChange">
          <el-option value="" label="全部账户" />
          <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
        </el-select>
        <el-radio-group v-model="viewMode" size="small" @change="onViewModeChange">
          <el-radio-button value="fills">实际成交</el-radio-button>
          <el-radio-button value="journal">手写日志</el-radio-button>
        </el-radio-group>
        <el-date-picker v-model="f.range" type="daterange" value-format="x" start-placeholder="开始" end-placeholder="结束" size="small" style="width: 230px" @change="applyFilter" />
        <el-input v-model="f.symbol" placeholder="品种" size="small" style="width: 110px" @input="applyFilter" />
        <el-select v-model="f.market" size="small" style="width: 110px" clearable placeholder="市场" @change="applyFilter">
          <el-option v-for="m in ['现货','U本位合约','币本位合约','全仓杠杆','逐仓杠杆']" :key="m" :value="m" :label="m" />
        </el-select>
        <el-select v-model="f.direction" size="small" style="width: 90px" clearable placeholder="方向" @change="applyFilter">
          <el-option value="LONG" label="做多" /><el-option value="SHORT" label="做空" />
        </el-select>
        <el-select v-model="f.strategy" size="small" style="width: 140px" clearable placeholder="策略版本" @change="applyFilter">
          <el-option v-for="s in strategyOptions" :key="s" :value="s" :label="s" />
        </el-select>
        <el-select v-model="f.tags" size="small" style="width: 160px" multiple collapse-tags placeholder="标签" @change="applyFilter">
          <el-option v-for="t in TAG_OPTIONS" :key="t" :value="t" :label="t" />
        </el-select>
        <el-select v-model="f.result" size="small" style="width: 100px" clearable placeholder="结果" @change="applyFilter">
          <el-option value="win" label="盈利" /><el-option value="loss" label="亏损" />
        </el-select>
        <el-input v-model="f.keyword" placeholder="搜索备注/理由" size="small" style="width: 150px" @input="applyFilter" />
        <el-button size="small" type="primary" @click="openNew">+ 新建</el-button>
      </div>
      <!-- 统计摘要条 -->
      <div class="statstrip">
        <span v-for="c in summary" :key="c.label" class="ss"><b class="ss-label">{{ c.label }}</b><span class="ss-val mono" :class="c.cls">{{ c.text }}</span></span>
      </div>
    </el-card>

    <!-- 实际成交列表（所选账户的真实成交，默认视图） -->
    <el-card shadow="never" v-if="viewMode === 'fills'">
      <template #header><div class="row"><b>实际成交</b><span class="dim">来自所选账户（{{ acctLabel }}）的真实成交记录，点击行可补记/查看日志</span></div></template>
      <el-table :data="filteredFills" size="small" @row-click="onFillClick">
        <el-table-column label="时间" width="150" sortable :sort-by="(r:any) => r.tradedAt"><template #default="{ row }">{{ fmtDateTime(row.tradedAt) }}</template></el-table-column>
        <el-table-column prop="symbol" label="品种" width="100" sortable />
        <el-table-column label="市场" width="100"><template #default="{ row }">{{ MARKET_LABELS[row.market] ?? row.market }}</template></el-table-column>
        <el-table-column label="方向" width="60"><template #default="{ row }"><span :class="row.side === 'BUY' ? 'up' : 'down'">{{ row.side === 'BUY' ? '买' : '卖' }}</span></template></el-table-column>
        <el-table-column prop="qty" label="数量" width="90" />
        <el-table-column prop="price" label="价格" width="100" />
        <el-table-column prop="fee" label="手续费" width="90" />
        <el-table-column label="已实现盈亏" width="100" sortable :sort-by="(r:any) => r.realizedPnl ?? 0"><template #default="{ row }"><span :class="(row.realizedPnl ?? 0) >= 0 ? 'up' : 'down'">{{ row.realizedPnl?.toFixed(2) ?? '-' }}</span></template></el-table-column>
        <el-table-column label="日志" width="90">
          <template #default="{ row }">
            <el-tag v-if="fillJournal(row)" size="small" type="success" effect="plain">已记录</el-tag>
            <el-button v-else size="small" text type="primary" @click.stop="fillToJournal(row)">补记</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!filteredFills.length" description="该账户暂无实际成交记录" :image-size="50" />
    </el-card>

    <!-- 手写日志列表 -->
    <el-card shadow="never" v-else>
      <el-table :data="filtered" size="small" @row-click="openDetail" :default-sort="{ prop: 'closeTime', order: 'descending' }">
        <el-table-column prop="tradeNo" label="编号" width="105" sortable />
        <el-table-column label="日期" width="95" sortable :sort-by="(r:any) => r.closeTime ?? 0"><template #default="{ row }">{{ fmtDate(row.closeTime) }}</template></el-table-column>
        <el-table-column prop="symbol" label="品种" width="100" sortable />
        <el-table-column label="市场" width="95"><template #default="{ row }">{{ row.market }}</template></el-table-column>
        <el-table-column label="方向" width="55"><template #default="{ row }"><span :class="row.direction === 'LONG' ? 'up' : 'down'">{{ row.direction === 'LONG' ? '多' : '空' }}</span></template></el-table-column>
        <el-table-column label="开仓价" width="85"><template #default="{ row }">{{ row.actualEntry ?? '-' }}</template></el-table-column>
        <el-table-column label="平仓价" width="85"><template #default="{ row }">{{ row.actualExit ?? '-' }}</template></el-table-column>
        <el-table-column label="R" width="55" sortable><template #default="{ row }">{{ row.rMultiple?.toFixed(2) ?? '-' }}</template></el-table-column>
        <el-table-column label="净盈亏" width="90" sortable><template #default="{ row }"><span :class="(row.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ row.netPnl?.toFixed(2) ?? '-' }}</span></template></el-table-column>
        <el-table-column label="符合度" width="70" sortable><template #default="{ row }">{{ row.disciplineScore ?? '-' }}</template></el-table-column>
        <el-table-column label="标签" min-width="130"><template #default="{ row }"><el-tag v-for="t in (row.tags ?? []).slice(0, 2)" :key="t" size="small" effect="plain" class="mr">{{ t }}</el-tag></template></el-table-column>
      </el-table>
      <el-empty v-if="!filtered.length" :description="f.accountId ? '该账户暂无手写日志，可点击「+ 新建」记录' : '暂无手写日志，可点击「+ 新建」记录'" :image-size="50" />
    </el-card>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" size="560px" :title="'交易详情 ' + (detail?.tradeNo ?? '')">
      <template v-if="detail">
        <h4>基本信息</h4>
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="品种">{{ detail.symbol }}</el-descriptions-item>
          <el-descriptions-item label="方向">{{ detail.direction === 'LONG' ? '做多' : '做空' }}</el-descriptions-item>
          <el-descriptions-item label="市场">{{ detail.market }}</el-descriptions-item>
          <el-descriptions-item label="时间框架">{{ detail.timeframe ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="策略版本">{{ detail.strategyVersion ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="持仓时长">{{ detail.holdingDuration ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <h4>计划 vs 实际</h4>
        <el-table :data="planCompare" size="small" border>
          <el-table-column prop="k" label="" width="90" />
          <el-table-column prop="plan" label="计划" />
          <el-table-column prop="actual" label="实际" />
        </el-table>
        <div v-if="detail.deviationReason" class="dim mt-sm">偏差原因：{{ detail.deviationReason }}</div>
        <h4>市场条件</h4>
        <el-descriptions :column="1" size="small">
          <el-descriptions-item label="趋势">{{ detail.marketTrend ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="波动率">{{ detail.volatility ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="量能">{{ detail.volumeLiquidity ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="支撑阻力">{{ detail.supportResistance ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="指标状态">{{ detail.indicatorState ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="detail.indicators" class="mt-sm">
          <el-tag v-for="(v, k) in detail.indicators" :key="k" size="small" effect="plain" class="mr">{{ k }}: {{ v }}</el-tag>
        </div>
        <h4>情绪与决策</h4>
        <el-descriptions :column="1" size="small">
          <el-descriptions-item label="入场理由">{{ detail.entryReason ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="出场理由">{{ detail.exitReason ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="情绪/信心">{{ detail.emotionScore ?? '-' }} / {{ detail.confidenceScore ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="心理变化">{{ detail.psychologicalNote ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <h4>结果分析</h4>
        <el-descriptions :column="2" size="small">
          <el-descriptions-item label="净收益">{{ detail.netPnl ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="R 倍数">{{ detail.rMultiple ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="MFE / MAE">{{ detail.mfe ?? '-' }} / {{ detail.mae ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="归因">{{ detail.attribution ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <h4>复盘总结</h4>
        <div class="dim" v-if="detail.strengths">✅ {{ detail.strengths }}</div>
        <div class="dim" v-if="detail.improvements">🔧 {{ detail.improvements }}</div>
        <div class="dim" v-if="detail.nextPlan">📋 {{ detail.nextPlan }}</div>
        <div class="dim mt-sm">规则符合度：{{ detail.disciplineScore ?? '-' }} · 信号正确：{{ detail.signalCorrect === undefined ? '-' : (detail.signalCorrect ? '是' : '否') }}</div>
        <div class="mt">
          <el-button size="small" type="primary" @click="openEdit">编辑</el-button>
          <el-button size="small" @click="copyAsNew">复制为新模板</el-button>
          <el-button size="small" @click="exportOne">导出</el-button>
          <el-button size="small" type="danger" @click="remove(detail.id!)">删除</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 新建/编辑表单弹窗 -->
    <el-dialog v-model="formVisible" :title="editingId ? '编辑交易' : '新建交易日志'" width="720px" top="4vh">
      <el-collapse v-model="openSections">
        <el-collapse-item name="A" title="A. 基本信息">
          <el-form label-width="80px" size="small">
            <el-form-item label="交易编号"><el-input v-model="form.tradeNo" placeholder="如 20260821-001" /></el-form-item>
            <el-form-item label="品种"><el-input v-model="form.symbol" placeholder="如 BTCUSDT" /></el-form-item>
            <el-form-item label="市场"><el-select v-model="form.market" style="width: 100%"><el-option v-for="m in ['现货','U本位合约','币本位合约','全仓杠杆','逐仓杠杆','外汇','期货']" :key="m" :value="m" :label="m" /></el-select></el-form-item>
            <el-form-item label="方向"><el-radio-group v-model="form.direction"><el-radio-button value="LONG">做多</el-radio-button><el-radio-button value="SHORT">做空</el-radio-button></el-radio-group></el-form-item>
            <el-form-item label="策略版本"><el-input v-model="form.strategyVersion" placeholder="如 趋势跟踪 v2.3" /></el-form-item>
            <el-form-item label="开仓/平仓"><el-date-picker v-model="form.openTime" type="datetime" value-format="x" style="width: 48%" /> <el-date-picker v-model="form.closeTime" type="datetime" value-format="x" style="width: 48%" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <el-collapse-item name="B" title="B. 交易前计划">
          <el-form label-width="90px" size="small">
            <el-form-item label="计划入场"><el-input-number v-model="form.plannedEntry" :precision="4" style="width: 100%" /></el-form-item>
            <el-form-item label="计划止损"><el-input-number v-model="form.plannedStop" :precision="4" style="width: 100%" /></el-form-item>
            <el-form-item label="止盈目标"><el-input v-model="targetsText" placeholder="逗号分隔，如 71000,72000" /></el-form-item>
            <el-form-item label="风险回报比"><el-input v-model="form.plannedRR" placeholder="如 1:3" /></el-form-item>
            <el-form-item label="风险金额"><el-input-number v-model="form.plannedRiskAmount" :precision="2" style="width: 100%" /></el-form-item>
            <el-form-item label="失效条件"><el-input v-model="form.invalidation" type="textarea" :rows="2" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <el-collapse-item name="C" title="C. 实际执行">
          <el-form label-width="90px" size="small">
            <el-form-item label="开/平仓价"><el-input-number v-model="form.actualEntry" :precision="4" style="width: 48%" /> <el-input-number v-model="form.actualExit" :precision="4" style="width: 48%" /></el-form-item>
            <el-form-item label="数量/杠杆"><el-input-number v-model="form.actualQty" :precision="6" style="width: 48%" /> <el-input-number v-model="form.leverage" :min="1" style="width: 48%" /></el-form-item>
            <el-form-item label="按计划执行"><el-select v-model="form.planExecution" style="width: 100%"><el-option value="complete" label="完全执行" /><el-option value="partial" label="部分执行" /><el-option value="none" label="未执行" /></el-select></el-form-item>
            <el-form-item label="偏差原因"><el-input v-model="form.deviationReason" type="textarea" :rows="2" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <el-collapse-item name="E" title="E. 情绪与决策">
          <el-form label-width="90px" size="small">
            <el-form-item label="入场理由"><el-input v-model="form.entryReason" type="textarea" :rows="2" /></el-form-item>
            <el-form-item label="出场理由"><el-input v-model="form.exitReason" placeholder="止盈/止损/手动/时间" /></el-form-item>
            <el-form-item label="情绪评分"><el-rate v-model="form.emotionScore" :max="10" /></el-form-item>
            <el-form-item label="信心评分"><el-rate v-model="form.confidenceScore" :max="10" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <el-collapse-item name="D" title="D. 市场条件">
          <el-form label-width="90px" size="small">
            <el-form-item label="趋势"><el-input v-model="form.marketTrend" placeholder="看涨/看跌/震荡" /></el-form-item>
            <el-form-item label="量能"><el-input v-model="form.volumeLiquidity" placeholder="放量/缩量" /></el-form-item>
            <el-form-item label="事件"><el-input v-model="form.economicEvents" placeholder="非农/CPI" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <el-collapse-item name="G" title="G. 复盘总结">
          <el-form label-width="90px" size="small">
            <el-form-item label="规则符合度"><el-rate v-model="form.disciplineScore" :max="10" /></el-form-item>
            <el-form-item label="成功/改进"><el-input v-model="form.strengths" placeholder="成功的方面" class="mb" /><el-input v-model="form.improvements" placeholder="需要改进的方面" /></el-form-item>
            <el-form-item label="后续计划"><el-input v-model="form.nextPlan" type="textarea" :rows="2" /></el-form-item>
            <el-form-item label="标签"><el-checkbox-group v-model="form.tags"><el-checkbox v-for="t in TAG_OPTIONS" :key="t" :value="t" size="small">{{ t }}</el-checkbox></el-checkbox-group></el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
      <div class="row mt">
        <el-button type="primary" :loading="saving" @click="save">{{ editingId ? '保存修改' : '保存' }}</el-button>
        <el-button :loading="filling" @click="autofill">自动计算</el-button>
      </div>
      <el-alert v-if="notes.length" type="success" :closable="false" class="mt"><div v-for="(n, i) in notes" :key="i">· {{ n }}</div></el-alert>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, MARKET_LABELS } from '../api.ts';
import { accountLabel, accountStore, loadAccounts } from '../store.ts';

const TAG_OPTIONS = ['情绪化交易', '执行错误', '系统缺陷', '正常亏损', '正常盈利', '运气成分'];
const route = useRoute();
const router = useRouter();

interface Rec { id?: string; tradeNo?: string; accountId?: string; symbol: string; market: string; direction: string; closeTime?: number; openTime?: number; createdAt?: number; netPnl?: number; rMultiple?: number; disciplineScore?: number; tags?: string[]; planExecution?: string; strategyVersion?: string; actualEntry?: number; actualExit?: number; actualQty?: number; [k: string]: unknown }
interface Fill { id: string; symbol: string; market: string; side: string; qty: number; price: number; fee: number; realizedPnl?: number; tradedAt: number }

const all = ref<Rec[]>([]);
const filtered = ref<Rec[]>([]);
const viewMode = ref<'fills' | 'journal'>('fills');
const fills = ref<Fill[]>([]);
const filteredFills = ref<Fill[]>([]);
const detail = ref<Rec | null>(null);
const detailVisible = ref(false);
const formVisible = ref(false);
const editingId = ref('');
const saving = ref(false);
const filling = ref(false);
const notes = ref<string[]>([]);
const targetsText = ref('');
const openSections = ref(['A']);

const f = reactive<{ range: [number, number] | null; symbol: string; market: string; direction: string; strategy: string; tags: string[]; result: string; keyword: string; accountId: string }>({
  range: null, symbol: '', market: '', direction: '', strategy: '', tags: [], result: '', keyword: '', accountId: '',
});
/** 用户是否手动改过账户筛选（手动改过后不再跟随全局账户） */
let accountTouched = false;

const emptyForm = () => ({ symbol: '', market: 'U本位合约', direction: 'LONG', planExecution: 'complete', tags: [], plannedTargets: [] as number[], accountId: f.accountId || accountStore.selectedId || undefined });
const form = reactive<any>(emptyForm());

const strategyOptions = computed(() => [...new Set(all.value.map((r) => r.strategyVersion).filter(Boolean))] as string[]);

// ---------- 实际成交 / 手写日志 关联 ----------
/** 日志按 品种|市场|方向 关联实际成交 */
let journalByKey = new Map<string, Rec>();
function jKey(symbol: string, marketLabel: string, direction: string): string {
  return (symbol + '|' + (marketLabel ?? '') + '|' + direction).toUpperCase();
}
function fillKey(x: Fill): string {
  return jKey(x.symbol, MARKET_LABELS[x.market] ?? x.market, x.side === 'BUY' ? 'LONG' : 'SHORT');
}
function fillJournal(x: Fill): Rec | undefined {
  return journalByKey.get(fillKey(x));
}
const acctLabel = computed(() => {
  const a = accountStore.accounts.find((ac) => ac.id === f.accountId || (!f.accountId && ac.id === accountStore.selectedId));
  return accountLabel(a ?? null);
});

const fillSummary = computed(() => {
  const rs = filteredFills.value;
  const closed = rs.filter((x) => x.realizedPnl !== undefined && x.realizedPnl !== null);
  const wins = closed.filter((x) => x.realizedPnl! > 0);
  const losses = closed.filter((x) => x.realizedPnl! < 0);
  const net = closed.reduce((a, x) => a + (x.realizedPnl ?? 0), 0);
  const gp = wins.reduce((a, x) => a + (x.realizedPnl ?? 0), 0);
  const gl = Math.abs(losses.reduce((a, x) => a + (x.realizedPnl ?? 0), 0));
  const fees = rs.reduce((a, x) => a + (x.fee ?? 0), 0);
  const logged = rs.filter((x) => fillJournal(x)).length;
  return [
    { label: '笔数', text: String(rs.length), cls: '' },
    { label: '净收益', text: net.toFixed(2), cls: net >= 0 ? 'up' : 'down' },
    { label: '胜率', text: (closed.length ? wins.length / closed.length : 0).toFixed(1), cls: '' },
    { label: '盈亏比', text: (gl > 0 ? gp / gl : gp > 0 ? 99 : 0).toFixed(2), cls: '' },
    { label: '手续费', text: fees.toFixed(2), cls: '' },
    { label: '已记录', text: logged + '/' + rs.length, cls: '' },
  ];
});

const journalSummary = computed(() => {
  const rs = filtered.value.filter((r) => r.netPnl !== undefined);
  const wins = rs.filter((r) => r.netPnl! > 0);
  const losses = rs.filter((r) => r.netPnl! < 0);
  const net = rs.reduce((a, r) => a + r.netPnl!, 0);
  const gp = wins.reduce((a, r) => a + r.netPnl!, 0);
  const gl = Math.abs(losses.reduce((a, r) => a + r.netPnl!, 0));
  const rVals = rs.map((r) => r.rMultiple).filter((v): v is number => v !== undefined && Number.isFinite(v));
  const disc = filtered.value.map((r) => r.disciplineScore).filter((v): v is number => v !== undefined && Number.isFinite(v));
  return [
    { label: '笔数', text: String(filtered.value.length), cls: '' },
    { label: '净收益', text: net.toFixed(0), cls: net >= 0 ? 'up' : 'down' },
    { label: '胜率', text: (rs.length ? wins.length / rs.length : 0).toFixed(1), cls: '' },
    { label: '平均R', text: (rVals.length ? rVals.reduce((a, b) => a + b, 0) / rVals.length : 0).toFixed(2), cls: '' },
    { label: '盈亏比', text: (gl > 0 ? gp / gl : (gp > 0 ? 99 : 0)).toFixed(2), cls: '' },
    { label: '符合度', text: (disc.length ? disc.reduce((a, b) => a + b, 0) / disc.length : 0).toFixed(1), cls: '' },
  ];
});

const summary = computed(() => (viewMode.value === 'fills' ? fillSummary.value : journalSummary.value));

function fmtDate(ts?: number) { return ts ? new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '-'; }
function fmtDateTime(ts?: number) { return ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'; }

const planCompare = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return [
    { k: '入场', plan: d.plannedEntry ?? '-', actual: d.actualEntry ?? '-' },
    { k: '止损', plan: d.plannedStop ?? '-', actual: '-' },
    { k: '止盈', plan: ((d.plannedTargets ?? []) as number[]).join('/') || '-', actual: d.actualExit ?? '-' },
  ];
});

async function loadList() {
  const params = new URLSearchParams();
  if (f.accountId) params.set('accountId', f.accountId);
  params.set('limit', '500');
  all.value = (await api.get<{ records: Rec[] }>('/journal/trades?' + params.toString())).records;
  journalByKey = new Map(all.value.filter((r) => r.symbol && r.direction).map((r) => [jKey(r.symbol, r.market ?? '', r.direction), r]));
  applyFilter();
}

/** 加载所选账户的实际成交 */
async function loadFills() {
  const params = new URLSearchParams();
  if (f.accountId) params.set('accountId', f.accountId);
  params.set('limit', '500');
  fills.value = (await api.get<{ trades: Fill[] }>('/trades?' + params.toString())).trades;
  applyFillFilter();
}

function applyFillFilter() {
  let out = fills.value;
  if (f.range?.[0] && f.range?.[1]) out = out.filter((x) => x.tradedAt >= f.range![0] && x.tradedAt <= f.range![1]);
  if (f.symbol) out = out.filter((x) => x.symbol.toUpperCase().includes(f.symbol.toUpperCase()));
  if (f.market) out = out.filter((x) => (MARKET_LABELS[x.market] ?? x.market) === f.market);
  if (f.direction) out = out.filter((x) => (x.side === 'BUY' ? 'LONG' : 'SHORT') === f.direction);
  if (f.result === 'win') out = out.filter((x) => (x.realizedPnl ?? 0) > 0);
  if (f.result === 'loss') out = out.filter((x) => (x.realizedPnl ?? 0) < 0);
  filteredFills.value = out.slice().sort((a, b) => b.tradedAt - a.tradedAt);
}

function applyFilter() {
  // 手写日志过滤
  let out = all.value;
  if (f.range?.[0] && f.range?.[1]) out = out.filter((r) => (r.closeTime ?? r.createdAt ?? 0) >= f.range![0] && (r.closeTime ?? r.createdAt ?? 0) <= f.range![1]);
  if (f.symbol) out = out.filter((r) => r.symbol.toUpperCase().includes(f.symbol.toUpperCase()));
  if (f.market) out = out.filter((r) => r.market === f.market);
  if (f.direction) out = out.filter((r) => r.direction === f.direction);
  if (f.strategy) out = out.filter((r) => r.strategyVersion === f.strategy);
  if (f.tags.length) out = out.filter((r) => f.tags.every((t) => (r.tags ?? []).includes(t)));
  if (f.result === 'win') out = out.filter((r) => (r.netPnl ?? 0) > 0);
  if (f.result === 'loss') out = out.filter((r) => (r.netPnl ?? 0) < 0);
  if (f.keyword) {
    const kw = f.keyword.toLowerCase();
    out = out.filter((r) => JSON.stringify({ e: r.entryReason, x: r.exitReason, n: r.nextPlan, i: r.improvements, s: r.strengths }).toLowerCase().includes(kw));
  }
  filtered.value = out;
  applyFillFilter();
}

function onViewModeChange() {
  // 视图切换：过滤已各自维护
}

function onAccountFilterChange() {
  accountTouched = true;
  loadList();
  loadFills();
}

function onFillClick(row: Fill) {
  const jr = fillJournal(row);
  if (jr?.id) {
    openDetail(jr);
  } else {
    fillToJournal(row);
  }
}

/** 从实际成交补记手写日志（预填关键字段） */
function fillToJournal(row: Fill) {
  openNew();
  Object.assign(form, {
    symbol: row.symbol,
    market: MARKET_LABELS[row.market] ?? row.market,
    direction: row.side === 'BUY' ? 'LONG' : 'SHORT',
    closeTime: row.tradedAt,
    actualEntry: row.price,
    actualQty: row.qty,
  });
}

function openDetail(row: Rec) { detail.value = row; detailVisible.value = true; }

function openNew() {
  Object.assign(form, emptyForm());
  editingId.value = '';
  targetsText.value = '';
  notes.value = [];
  openSections.value = ['A'];
  formVisible.value = true;
}

function openEdit() {
  if (!detail.value) return;
  editingId.value = detail.value.id ?? '';
  Object.assign(form, detail.value);
  targetsText.value = ((detail.value.plannedTargets as number[]) ?? []).join(',');
  notes.value = [];
  openSections.value = ['A', 'C'];
  formVisible.value = true;
}

function copyAsNew() {
  if (!detail.value) return;
  openNew();
  const { id, tradeNo, closeTime, createdAt, ...rest } = detail.value;
  Object.assign(form, rest);
  targetsText.value = ((detail.value.plannedTargets as number[]) ?? []).join(',');
}

function formPayload() {
  const targets = targetsText.value.split(',').map((s) => parseFloat(s.trim())).filter((n) => Number.isFinite(n));
  return { ...form, plannedTargets: targets.length ? targets : undefined };
}

async function autofill() {
  filling.value = true;
  try {
    const res = await api.post<{ record: Rec; notes: string[] }>('/journal/trades/autofill', { record: formPayload() });
    Object.assign(form, res.record);
    notes.value = res.notes;
    ElMessage.success('已自动计算');
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    filling.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    if (editingId.value) {
      await api.patch('/journal/trades/' + editingId.value, { patch: formPayload() });
      ElMessage.success('已保存修改');
    } else {
      await api.post('/journal/trades', { record: formPayload() });
      ElMessage.success('已记录');
    }
    formVisible.value = false;
    await refresh();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

async function remove(id: string) {
  await ElMessageBox.confirm('确认删除这笔交易日志？', '提示', { type: 'warning' });
  await api.del('/journal/trades/' + id);
  ElMessage.success('已删除');
  detailVisible.value = false;
  await refresh();
}

/** 同时刷新手写日志与实际成交（补记后关联状态即时更新） */
async function refresh() {
  await loadList();
  await loadFills();
}

function exportOne() {
  if (!detail.value) return;
  const blob = new Blob([JSON.stringify(detail.value, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (detail.value.tradeNo ?? detail.value.id) + '.json';
  a.click();
}

onMounted(async () => {
  await loadAccounts();
  if (!accountStore.selectedId) {
    // 无任何账户时不默认跟随
  } else if (!accountTouched) {
    f.accountId = accountStore.selectedId;
  }
  await refresh();
  watch(
    () => accountStore.selectedId,
    (id) => {
      // 跟随全局账户（除非用户手动改过本页筛选）
      if (!accountTouched) {
        f.accountId = id || '';
        refresh();
      }
    },
  );
  const q = route.query;
  if (q['new']) openNew();
  else if (q['id']) {
    const rec = all.value.find((r) => r.id === q['id']);
    if (rec) openDetail(rec);
  } else if (q['quick']) {
    try {
      const pre = JSON.parse(String(q['quick']));
      openNew();
      Object.assign(form, pre);
    } catch { /* ignore */ }
  }
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.mt { margin-top: 10px; }
.mt-sm { margin-top: 8px; }
.mr { margin-right: 4px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.statstrip { display: flex; gap: 22px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.ss { display: flex; flex-direction: column; }
.ss-label { color: var(--text-dim); font-size: 11px; }
.ss-val { font-size: 15px; font-weight: 700; }
.mono { font-family: var(--mono); }
.up { color: var(--up); }
.down { color: var(--down); }
.dim { color: var(--text-dim); font-size: 12px; }
.row { display: flex; align-items: center; gap: 10px; }
h4 { margin: 14px 0 8px; color: var(--text-dim); font-size: 12px; letter-spacing: 1px; }
</style>
