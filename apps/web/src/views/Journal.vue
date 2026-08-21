<!-- 结构化交易日志：JSONL 主存储 + SQLite 镜像；自动提取指标/盈亏 -->
<template>
  <el-tabs v-model="tab">
    <el-tab-pane label="交易日志（A-G）" name="trades">
      <el-row :gutter="16">
        <el-col :span="9">
          <el-card shadow="never">
            <template #header>
              <div class="row">
                <b>{{ editingId ? '编辑交易' : '记录一笔交易' }}</b>
                <el-button v-if="editingId" size="small" type="info" @click="resetForm">新建</el-button>
              </div>
            </template>
            <el-collapse v-model="openSections">
              <el-collapse-item name="A" title="A. 基本信息">
                <el-form label-width="90px" size="small">
                  <el-form-item label="交易编号"><el-input v-model="form.tradeNo" placeholder="如 20260821-001" /></el-form-item>
                  <el-form-item label="品种"><el-input v-model="form.symbol" placeholder="如 BTCUSDT" /></el-form-item>
                  <el-form-item label="市场">
                    <el-select v-model="form.market" style="width: 100%">
                      <el-option v-for="m in ['现货','U本位合约','币本位合约','全仓杠杆','逐仓杠杆','外汇','A股','期货']" :key="m" :value="m" :label="m" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="方向">
                    <el-radio-group v-model="form.direction">
                      <el-radio-button value="LONG">做多</el-radio-button>
                      <el-radio-button value="SHORT">做空</el-radio-button>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item label="时间框架"><el-input v-model="form.timeframe" placeholder="5分钟/1小时/日线" /></el-form-item>
                  <el-form-item label="策略版本"><el-input v-model="form.strategyVersion" placeholder="如 趋势跟踪 v2.3" /></el-form-item>
                  <el-form-item label="开仓时间"><el-date-picker v-model="form.openTime" type="datetime" value-format="x" style="width: 100%" /></el-form-item>
                  <el-form-item label="平仓时间"><el-date-picker v-model="form.closeTime" type="datetime" value-format="x" style="width: 100%" /></el-form-item>
                </el-form>
              </el-collapse-item>
              <el-collapse-item name="B" title="B. 交易前计划">
                <el-form label-width="110px" size="small">
                  <el-form-item label="计划入场价"><el-input-number v-model="form.plannedEntry" :precision="4" style="width: 100%" /></el-form-item>
                  <el-form-item label="计划止损价"><el-input-number v-model="form.plannedStop" :precision="4" style="width: 100%" /></el-form-item>
                  <el-form-item label="止盈目标"><el-input v-model="targetsText" placeholder="逗号分隔多个，如 71000,72000" /></el-form-item>
                  <el-form-item label="风险回报比"><el-input v-model="form.plannedRR" placeholder="如 1:3" /></el-form-item>
                  <el-form-item label="计划仓位"><el-input v-model="form.plannedSize" placeholder="如 0.5 手" /></el-form-item>
                  <el-form-item label="风险金额"><el-input-number v-model="form.plannedRiskAmount" :precision="2" style="width: 100%" /></el-form-item>
                  <el-form-item label="风险百分比%"><el-input-number v-model="form.plannedRiskPct" :precision="2" style="width: 100%" /></el-form-item>
                  <el-form-item label="持仓周期"><el-input v-model="form.plannedHolding" placeholder="日内/波段/趋势" /></el-form-item>
                  <el-form-item label="失效条件"><el-input v-model="form.invalidation" type="textarea" :rows="2" /></el-form-item>
                </el-form>
              </el-collapse-item>
              <el-collapse-item name="C" title="C. 实际执行">
                <el-form label-width="110px" size="small">
                  <el-form-item label="实际开仓价"><el-input-number v-model="form.actualEntry" :precision="4" style="width: 100%" /></el-form-item>
                  <el-form-item label="实际平仓价"><el-input-number v-model="form.actualExit" :precision="4" style="width: 100%" /></el-form-item>
                  <el-form-item label="实际数量"><el-input-number v-model="form.actualQty" :precision="6" style="width: 100%" /></el-form-item>
                  <el-form-item label="杠杆倍数"><el-input-number v-model="form.leverage" :min="1" style="width: 100%" /></el-form-item>
                  <el-form-item label="订单类型"><el-input v-model="form.orderType" placeholder="市价单/限价单/条件单" /></el-form-item>
                  <el-form-item label="滑点"><el-input-number v-model="form.slippage" :precision="4" style="width: 100%" /></el-form-item>
                  <el-form-item label="按计划执行">
                    <el-select v-model="form.planExecution" style="width: 100%">
                      <el-option value="complete" label="完全执行" /><el-option value="partial" label="部分执行" /><el-option value="none" label="未执行" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="偏差原因"><el-input v-model="form.deviationReason" type="textarea" :rows="2" /></el-form-item>
                </el-form>
              </el-collapse-item>
              <el-collapse-item name="D" title="D. 市场条件">
                <el-form label-width="110px" size="small">
                  <el-form-item label="市场趋势"><el-input v-model="form.marketTrend" placeholder="看涨/看跌/震荡" /></el-form-item>
                  <el-form-item label="波动率"><el-input v-model="form.volatility" placeholder="ATR/布林宽度（可自动提取）" /></el-form-item>
                  <el-form-item label="量能流动性"><el-input v-model="form.volumeLiquidity" placeholder="放量/缩量" /></el-form-item>
                  <el-form-item label="支撑阻力"><el-input v-model="form.supportResistance" type="textarea" :rows="2" /></el-form-item>
                  <el-form-item label="重要事件"><el-input v-model="form.economicEvents" placeholder="非农/CPI/利率决议" /></el-form-item>
                  <el-form-item label="指标状态"><el-input v-model="form.indicatorState" type="textarea" :rows="2" /></el-form-item>
                  <el-form-item label="相关品种"><el-input v-model="form.relatedSymbols" /></el-form-item>
                  <el-form-item label="交易时段"><el-input v-model="form.session" placeholder="亚盘/欧盘/美盘" /></el-form-item>
                </el-form>
              </el-collapse-item>
              <el-collapse-item name="E" title="E. 情绪与决策">
                <el-form label-width="110px" size="small">
                  <el-form-item label="入场理由"><el-input v-model="form.entryReason" type="textarea" :rows="2" /></el-form-item>
                  <el-form-item label="出场理由"><el-input v-model="form.exitReason" placeholder="止盈/止损/手动离场/时间离场" /></el-form-item>
                  <el-form-item label="情绪评分"><el-rate v-model="form.emotionScore" :max="10" /><span class="dim">1=冷静 10=恐惧/贪婪</span></el-form-item>
                  <el-form-item label="信心评分"><el-rate v-model="form.confidenceScore" :max="10" /></el-form-item>
                  <el-form-item label="心理变化"><el-input v-model="form.psychologicalNote" type="textarea" :rows="2" /></el-form-item>
                  <el-form-item label="受情绪影响"><el-switch v-model="form.emotionAffected" /></el-form-item>
                </el-form>
              </el-collapse-item>
              <el-collapse-item name="F" title="F. 结果分析（可自动计算）">
                <el-alert type="info" :closable="false" class="mb" title="填好 开/平仓价+数量+方向+风险金额 后点「自动计算」，可自动得到盈亏/R倍数/MFE/MAE/RSI/ATR 等" />
                <el-form label-width="110px" size="small">
                  <el-form-item label="盈亏金额"><el-input-number v-model="form.pnl" :precision="4" style="width: 100%" /></el-form-item>
                  <el-form-item label="净收益"><el-input-number v-model="form.netPnl" :precision="4" style="width: 100%" /></el-form-item>
                  <el-form-item label="R 倍数"><el-input-number v-model="form.rMultiple" :precision="3" style="width: 100%" /></el-form-item>
                  <el-form-item label="MFE/MAE"><el-input :model-value="(form.mfe ?? '-') + ' / ' + (form.mae ?? '-')" disabled /></el-form-item>
                  <el-form-item label="盈亏归因">
                    <el-select v-model="form.attribution" style="width: 100%">
                      <el-option v-for="a in ['系统信号','执行质量','市场运气','情绪干扰']" :key="a" :value="a" :label="a" />
                    </el-select>
                  </el-form-item>
                </el-form>
              </el-collapse-item>
              <el-collapse-item name="G" title="G. 复盘总结与迭代">
                <el-form label-width="110px" size="small">
                  <el-form-item label="规则符合度"><el-rate v-model="form.disciplineScore" :max="10" /></el-form-item>
                  <el-form-item label="信号正确"><el-switch v-model="form.signalCorrect" /></el-form-item>
                  <el-form-item label="成功方面"><el-input v-model="form.strengths" type="textarea" :rows="2" /></el-form-item>
                  <el-form-item label="改进方面"><el-input v-model="form.improvements" type="textarea" :rows="2" /></el-form-item>
                  <el-form-item label="后续计划"><el-input v-model="form.nextPlan" type="textarea" :rows="2" /></el-form-item>
                  <el-form-item label="标签">
                    <el-checkbox-group v-model="form.tags">
                      <el-checkbox v-for="t in TAG_OPTIONS" :key="t" :value="t">{{ t }}</el-checkbox>
                    </el-checkbox-group>
                  </el-form-item>
                  <el-form-item label="走势验证"><el-input v-model="form.postCloseVerification" type="textarea" :rows="2" /></el-form-item>
                </el-form>
              </el-collapse-item>
            </el-collapse>
            <div class="row mt">
              <el-button type="primary" :loading="saving" @click="save">{{ editingId ? '保存修改' : '保存交易' }}</el-button>
              <el-button :loading="filling" @click="autofill">自动计算</el-button>
            </div>
            <el-alert v-if="notes.length" type="success" :closable="false" class="mt">
              <div v-for="(n, i) in notes" :key="i">· {{ n }}</div>
            </el-alert>
          </el-card>
        </el-col>
        <el-col :span="15">
          <el-card shadow="never" class="mb">
            <template #header>统计（迭代交易系统）</template>
            <el-row :gutter="8">
              <el-col :span="3" v-for="c in statCards" :key="c.label">
                <div class="stat"><div class="slabel">{{ c.label }}</div><div class="svalue">{{ c.text }}</div></div>
              </el-col>
            </el-row>
            <div v-if="stats?.tagFrequency && Object.keys(stats.tagFrequency).length" class="mt-sm">
              <el-tag v-for="(cnt, tag) in stats.tagFrequency" :key="tag" size="small" class="mr-sm" type="info" effect="plain">{{ tag }} ×{{ cnt }}</el-tag>
            </div>
          </el-card>
          <el-card shadow="never">
            <template #header>
              <div class="row">
                <span>交易记录</span>
                <el-input v-model="filterSymbol" placeholder="搜索品种" size="small" style="width: 140px" @input="loadList" />
                <el-select v-model="filterMarket" size="small" style="width: 120px" clearable placeholder="市场" @change="loadList">
                  <el-option v-for="m in ['现货','U本位合约','币本位合约','全仓杠杆','逐仓杠杆']" :key="m" :value="m" :label="m" />
                </el-select>
                <el-button size="small" @click="loadStats">刷新统计</el-button>
              </div>
            </template>
            <el-table :data="records" size="small" max-height="520" @row-click="editRow">
              <el-table-column prop="tradeNo" label="编号" width="110" />
              <el-table-column prop="symbol" label="品种" width="100" />
              <el-table-column label="方向" width="60"><template #default="{ row }"><el-tag :type="row.direction === 'LONG' ? 'danger' : 'success'" size="small">{{ row.direction === 'LONG' ? '多' : '空' }}</el-tag></template></el-table-column>
              <el-table-column label="净盈亏" width="90"><template #default="{ row }"><span :class="(row.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ row.netPnl?.toFixed(2) ?? '-' }}</span></template></el-table-column>
              <el-table-column label="R" width="60"><template #default="{ row }">{{ row.rMultiple?.toFixed(2) ?? '-' }}</template></el-table-column>
              <el-table-column label="符合度" width="60"><template #default="{ row }">{{ row.disciplineScore ?? '-' }}</template></el-table-column>
              <el-table-column prop="strategyVersion" label="策略版本" />
              <el-table-column label="时间"><template #default="{ row }">{{ row.closeTime ? new Date(row.closeTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-' }}</template></el-table-column>
              <el-table-column label="" width="60"><template #default="{ row }"><el-button size="small" type="danger" text @click.stop="remove(row.id!)">删除</el-button></template></el-table-column>
            </el-table>
          </el-card>
        </el-col>
      </el-row>
    </el-tab-pane>
    <el-tab-pane label="速记笔记" name="notes">
      <el-row :gutter="16">
        <el-col :span="8">
          <el-card shadow="never">
            <template #header>写笔记</template>
            <el-form label-width="60px">
              <el-form-item label="类型">
                <el-select v-model="noteForm.kind" style="width: 100%">
                  <el-option value="insight" label="心得" /><el-option value="review" label="复盘" /><el-option value="note" label="备忘" />
                </el-select>
              </el-form-item>
              <el-form-item label="标题"><el-input v-model="noteForm.title" /></el-form-item>
              <el-form-item label="内容"><el-input type="textarea" :rows="5" v-model="noteForm.body" /></el-form-item>
              <el-form-item label="标签"><el-input v-model="tagsText" placeholder="逗号分隔" /></el-form-item>
              <el-form-item><el-button type="primary" @click="saveNote">保存</el-button></el-form-item>
            </el-form>
          </el-card>
        </el-col>
        <el-col :span="16">
          <el-card shadow="never">
            <template #header>笔记列表</template>
            <el-timeline v-if="notesList.length">
              <el-timeline-item v-for="e in notesList" :key="e.id" :timestamp="new Date(e.createdAt).toLocaleString('zh-CN')">
                <b>{{ e.title }}</b>
                <div class="dim">{{ e.body }}</div>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else description="暂无笔记" />
          </el-card>
        </el-col>
      </el-row>
    </el-tab-pane>
  </el-tabs>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.ts';

interface TradeJournalView {
  id?: string; tradeNo?: string; symbol: string; market: string; direction: 'LONG' | 'SHORT';
  timeframe?: string; strategyVersion?: string; openTime?: number; closeTime?: number;
  plannedEntry?: number; plannedStop?: number; plannedTargets?: number[]; plannedRR?: string;
  plannedSize?: string; plannedRiskAmount?: number; plannedRiskPct?: number; plannedHolding?: string; invalidation?: string;
  actualEntry?: number; actualExit?: number; actualQty?: number; leverage?: number; orderType?: string; slippage?: number;
  planExecution: string; deviationReason?: string;
  marketTrend?: string; volatility?: string; volumeLiquidity?: string; supportResistance?: string; economicEvents?: string;
  indicatorState?: string; relatedSymbols?: string; session?: string;
  entryReason?: string; exitReason?: string; emotionScore?: number; confidenceScore?: number; psychologicalNote?: string; emotionAffected?: boolean;
  pnl?: number; pnlPct?: number; fees?: number; netPnl?: number; rMultiple?: number; mfe?: number; mae?: number; attribution?: string;
  disciplineScore?: number; signalCorrect?: boolean; strengths?: string; improvements?: string; nextPlan?: string;
  tags: string[]; postCloseVerification?: string; indicators?: Record<string, number | string | boolean | null>;
}

const TAG_OPTIONS = ['情绪化交易', '执行错误', '系统缺陷', '正常亏损', '正常盈利', '运气成分'];

const tab = ref('trades');
const openSections = ref(['A']);
const editingId = ref('');
const saving = ref(false);
const filling = ref(false);
const notes = ref<string[]>([]);
const records = ref<TradeJournalView[]>([]);
const stats = ref<Record<string, unknown> | null>(null);
const filterSymbol = ref('');
const filterMarket = ref('');
const targetsText = ref('');

const emptyForm = (): TradeJournalView => ({ symbol: '', market: 'U本位合约', direction: 'LONG', planExecution: 'complete', tags: [], plannedTargets: [] });
const form = reactive<TradeJournalView>(emptyForm());

const statCards = computed(() => {
  const s = (stats.value ?? {}) as Record<string, number | string>;
  const pf = s.profitFactor === Infinity ? '∞' : (Number(s.profitFactor ?? 0)).toFixed(2);
  return [
    { label: '胜率', text: (Number(s.winRate ?? 0) * 100).toFixed(1) + '%' },
    { label: '盈亏比', text: pf },
    { label: '平均R', text: Number(s.avgR ?? 0).toFixed(2) },
    { label: '期望值', text: Number(s.expectancy ?? 0).toFixed(2) },
    { label: '净盈亏', text: Number(s.netPnl ?? 0).toFixed(2) },
    { label: '符合度', text: Number(s.avgDiscipline ?? 0).toFixed(1) },
    { label: '情绪', text: Number(s.avgEmotion ?? 0).toFixed(1) },
    { label: '交易数', text: String(s.total ?? 0) },
  ];
});

function resetForm() {
  Object.assign(form, emptyForm());
  editingId.value = '';
  notes.value = [];
  targetsText.value = '';
  openSections.value = ['A'];
}

function formPayload() {
  const targets = targetsText.value.split(',').map((s) => parseFloat(s.trim())).filter((n) => Number.isFinite(n));
  return { ...form, plannedTargets: targets.length ? targets : undefined };
}

async function autofill() {
  filling.value = true;
  try {
    const res = await api.post<{ record: TradeJournalView; notes: string[] }>('/journal/trades/autofill', { record: formPayload() });
    Object.assign(form, res.record);
    notes.value = res.notes;
    if (res.record.plannedTargets?.length) targetsText.value = res.record.plannedTargets.join(',');
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
      ElMessage.success('已记录交易');
    }
    resetForm();
    await Promise.all([loadList(), loadStats()]);
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

function editRow(row: TradeJournalView) {
  editingId.value = row.id ?? '';
  Object.assign(form, row);
  targetsText.value = (row.plannedTargets ?? []).join(',');
  notes.value = [];
  openSections.value = ['A', 'C', 'F', 'G'];
}

async function remove(id: string) {
  await ElMessageBox.confirm('确认删除这笔交易日志？', '提示', { type: 'warning' });
  await api.del('/journal/trades/' + id);
  ElMessage.success('已删除');
  await Promise.all([loadList(), loadStats()]);
}

async function loadList() {
  const params = new URLSearchParams();
  if (filterSymbol.value) params.set('symbol', filterSymbol.value);
  if (filterMarket.value) params.set('market', filterMarket.value);
  const res = await api.get<{ records: TradeJournalView[] }>('/journal/trades?' + params.toString());
  records.value = res.records;
}

async function loadStats() {
  stats.value = await api.get('/journal/trades/stats');
}

const noteForm = reactive({ kind: 'note', title: '', body: '' });
const tagsText = ref('');
const notesList = ref<{ id: string; kind: string; title: string; body: string; createdAt: number }[]>([]);
async function saveNote() {
  await api.post('/journal', { kind: noteForm.kind, title: noteForm.title, body: noteForm.body, tags: tagsText.value.split(',').map((s) => s.trim()).filter(Boolean) });
  ElMessage.success('已保存');
  noteForm.kind = 'note'; noteForm.title = ''; noteForm.body = ''; tagsText.value = '';
  await loadNotes();
}
async function loadNotes() {
  notesList.value = (await api.get<{ entries: typeof notesList.value }>('/journal?limit=50')).entries;
}

onMounted(async () => {
  await Promise.all([loadList(), loadStats(), loadNotes()]);
});
</script>

<style scoped>
.row { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.mt { margin-top: 12px; }
.mb { margin-bottom: 12px; }
.mt-sm { margin-top: 8px; }
.mr-sm { margin-right: 6px; }
.dim { color: #999; font-size: 12px; }
.stat { text-align: center; }
.slabel { color: #999; font-size: 12px; }
.svalue { font-size: 16px; font-weight: 700; }
.up { color: #f56c6c; }
.down { color: #67c23a; }
</style>
