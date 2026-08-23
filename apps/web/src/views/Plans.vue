<template>
  <div class="plans aw-page">
    <div class="plans-head">
      <div class="plans-title">
        <h2>交易计划</h2>
        <span class="dim">管理「计划中」状态 — 交易日志的上游</span>
      </div>
      <button class="aw-btn aw-btn-primary" @click="openNew"><el-icon><Plus /></el-icon>新建计划</button>
    </div>

    <!-- 今日计划时间线 -->
    <div class="aw-card timeline-card">
      <div class="tc-head"><b>今日计划时间线</b><span class="dim">00:00 — 24:00</span></div>
      <div class="timeline">
        <div class="tl-track">
          <span v-for="h in 24" :key="h" class="tl-hour" :style="{ left: ((h - 1) / 24 * 100) + '%' }">{{ h - 1 }}:00</span>
        </div>
        <div class="tl-plans">
          <div
            v-for="p in todayPlans"
            :key="p.id"
            class="tl-plan"
            :class="{ expired: isExpired(p) }"
            :style="{ left: tlPos(p) + '%', width: '9%' }"
            :title="p.symbol + ' ' + (p.plannedEntry ?? '')"
            @click="select(p)"
          >
            <div class="tl-sym">{{ p.symbol }}</div>
            <div class="tl-dir" :class="p.direction === 'LONG' ? 'long' : 'short'">{{ p.direction === 'LONG' ? '多' : '空' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 卡片网格 -->
    <div class="plan-grid">
      <div
        v-for="p in planList"
        :key="p.id"
        class="aw-card plan-card hoverable"
        :class="{ archived: isArchived(p), selected: selectedId === p.id }"
        @click="select(p)"
      >
        <div class="pc-top">
          <div class="pc-sym">
            <span class="coin-ic">{{ p.symbol.slice(0, 1) }}</span>
            <b>{{ p.symbol }}</b>
            <span class="dir-tag" :class="p.direction === 'LONG' ? 'long' : 'short'">{{ p.direction === 'LONG' ? '多' : '空' }}</span>
            <span v-if="p.leverage && p.leverage > 1" class="lev-tag mono">{{ p.leverage }}x</span>
          </div>
          <span class="aw-status aw-status-plan" v-if="deriveStatus(p) === 'plan'"><span class="dot"></span>计划中</span>
          <span class="aw-status aw-status-holding" v-else-if="deriveStatus(p) === 'holding'"><span class="dot"></span>已执行</span>
        </div>
        <div class="pc-trigger">
          <div class="pc-trigger-line">
            <span class="dim">触发</span>
            <b class="mono">{{ p.symbol }} {{ p.direction === 'LONG' ? '≥' : '≤' }} {{ fmtPrice(p.plannedEntry) }}</b>
          </div>
          <div class="pc-sl">
            <span class="dim">止损 <b class="mono down">{{ fmtPrice(p.plannedStop) }}</b></span>
            <span class="dim">止盈 <b class="mono up">{{ (p.plannedTargets ?? [])[0] !== undefined ? fmtPrice((p.plannedTargets ?? [])[0]) : '—' }}</b></span>
          </div>
        </div>
        <div class="pc-foot">
          <div class="pc-meta">
            <span class="dim">仓位 <b class="mono">{{ p.plannedSize ?? '—' }}</b></span>
            <span class="dim">策略 <b>{{ p.strategyVersion ?? p.strategyName ?? '—' }}</b></span>
            <span class="dim">创建 {{ fmtTime(p.createdAt) }}</span>
          </div>
          <div class="pc-actions" @click.stop>
            <button class="aw-btn aw-btn-text" @click="execPlan(p)">执行</button>
            <button class="aw-btn aw-btn-text" @click="openEdit(p)">编辑</button>
            <button class="aw-btn aw-btn-text" @click="delayPlan(p)">延期</button>
            <button class="aw-btn aw-btn-text danger" @click="removePlan(p)">删除</button>
          </div>
        </div>
      </div>
      <div v-if="!planList.length" class="aw-empty aw-card">
        <svg class="aw-empty-illus" viewBox="0 0 64 48"><rect x="4" y="6" width="56" height="36" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 20h10M12 28h16M34 20h10M34 28h6" stroke="currentColor" stroke-width="2"/></svg>
        <span>暂无交易计划，点击右上角「新建计划」</span>
        <button class="aw-btn aw-btn-primary" @click="openNew">+ 新建计划</button>
      </div>
    </div>

    <!-- 已执行/归档列表 -->
    <div class="aw-card archived-card" v-if="archivedList.length">
      <div class="ac-head"><b>已执行计划（归档）</b><span class="dim">{{ archivedList.length }} 条</span></div>
      <div class="archived-grid">
        <div v-for="p in archivedList" :key="p.id" class="arch-item" @click="select(p)">
          <b class="mono">{{ p.symbol }}</b>
          <span class="dim">{{ p.direction === 'LONG' ? '多' : '空' }}</span>
          <span class="dim mono">入场 {{ fmtPrice(p.actualEntry ?? p.plannedEntry) }}</span>
          <span class="dim">{{ fmtTime(p.openTime ?? p.createdAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="formVisible" :title="editingId ? '编辑计划' : '新建交易计划'" width="min(720px, 94vw)" top="5vh">
      <el-form label-width="100px" size="small">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="品种"><el-input v-model="form.symbol" placeholder="BTCUSDT" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="方向">
            <div class="seg2">
              <button class="s2" :class="{ active: form.direction === 'LONG' }" @click="form.direction = 'LONG'">多 ▲</button>
              <button class="s2" :class="{ active: form.direction === 'SHORT' }" @click="form.direction = 'SHORT'">空 ▼</button>
            </div>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="市场">
            <el-select v-model="form.market" style="width: 100%"><el-option v-for="m in MARKET_OPTIONS" :key="m" :value="m" :label="m" /></el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="杠杆"><el-input-number v-model="form.leverage" :min="1" :precision="0" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="触发条件">
            <el-input-number v-model="form.plannedEntry" :precision="4" controls-position="right" style="width: 100%" placeholder="计划开仓价" />
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="预期执行时间">
            <el-date-picker v-model="form.plannedAt" type="datetime" value-format="x" style="width: 100%" />
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="止损价"><el-input-number v-model="form.plannedStop" :precision="4" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="止盈目标">
            <el-input v-model="form.targetsText" placeholder="逗号分隔" />
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="计划仓位"><el-input v-model="form.plannedSize" placeholder="如 0.5 手 / 100 USDT" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="风险金额"><el-input-number v-model="form.plannedRiskAmount" :precision="2" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="持仓周期">
            <div class="seg2"><button v-for="h in HOLDING_OPTIONS" :key="h" class="s2" :class="{ active: form.plannedHolding === h }" @click="form.plannedHolding = h">{{ h }}</button></div>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="策略版本"><el-input v-model="form.strategyVersion" placeholder="如 v2.1" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="触发条件描述">
            <el-input v-model="form.triggerDesc" type="textarea" :rows="2" placeholder="如：BTC 站稳 71500 且放量突破时入场" />
          </el-form-item></el-col>
          <el-col :span="24"><el-form-item label="失效条件">
            <el-input v-model="form.invalidation" type="textarea" :rows="2" placeholder="如：跌破 70000 或 24h 未触发则作废" />
          </el-form-item></el-col>
          <el-col :span="24"><el-form-item label="账户">
            <el-select v-model="form.accountId" style="width: 100%">
              <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button size="small" @click="formVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="save">保存计划</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.ts';
import { accountStore, loadAccounts } from '../store.ts';
import type { TradeJournal } from '../lib/journal.ts';
import { deriveStatus, fmtPrice, fmtTime, fmtFullTime } from '../lib/journal.ts';

const MARKET_OPTIONS = ['现货', 'U本位合约', '币本位合约', '全仓杠杆', '逐仓杠杆'];
const HOLDING_OPTIONS = ['日内', '波段', '趋势'];

const route = useRoute();
const router = useRouter();
const all = ref<TradeJournal[]>([]);
const selectedId = ref('');
const formVisible = ref(false);
const editingId = ref('');
const saving = ref(false);

const form = reactive<Record<string, any>>({
  symbol: '', direction: 'LONG', market: '现货', leverage: 1, plannedEntry: undefined,
  plannedAt: undefined, plannedStop: undefined, targetsText: '', plannedSize: '',
  plannedRiskAmount: undefined, plannedHolding: '日内', strategyVersion: '', triggerDesc: '',
  invalidation: '', accountId: '',
});

const planList = computed(() => all.value
  .filter((p) => deriveStatus(p) === 'plan')
  .sort((a, b) => (a.plannedAt ?? a.createdAt ?? 0) - (b.plannedAt ?? b.createdAt ?? 0)));

const archivedList = computed(() => all.value.filter((p) => deriveStatus(p) !== 'plan'));

const todayPlans = computed(() => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return planList.value.filter((p) => {
    const t = p.plannedAt ?? p.createdAt ?? 0;
    return t >= start.getTime() && t <= end.getTime();
  });
});

function tlPos(p: TradeJournal): number {
  const t = p.plannedAt ?? p.createdAt ?? Date.now();
  const d = new Date(t);
  return Math.max(0, Math.min(91, (d.getHours() + d.getMinutes() / 60) / 24 * 100));
}
function isExpired(p: TradeJournal): boolean {
  const t = p.plannedAt ?? p.createdAt ?? 0;
  return t > 0 && t < Date.now() - 3600_000;
}
function isArchived(p: TradeJournal): boolean { return deriveStatus(p) !== 'plan'; }

function select(p: TradeJournal) { selectedId.value = p.id; }
function openNew() {
  Object.assign(form, { symbol: '', direction: 'LONG', market: '现货', leverage: 1, plannedEntry: undefined, plannedAt: Date.now() + 3600_000, plannedStop: undefined, targetsText: '', plannedSize: '', plannedRiskAmount: undefined, plannedHolding: '日内', strategyVersion: '', triggerDesc: '', invalidation: '', accountId: accountStore.selectedId || '' });
  editingId.value = '';
  formVisible.value = true;
}
function openEdit(p: TradeJournal) {
  editingId.value = p.id;
  Object.assign(form, {
    symbol: p.symbol, direction: p.direction, market: p.market ?? '现货', leverage: p.leverage ?? 1,
    plannedEntry: p.plannedEntry, plannedAt: (p as any).plannedAt ?? p.createdAt,
    plannedStop: p.plannedStop, targetsText: (p.plannedTargets ?? []).join(', '),
    plannedSize: p.plannedSize ?? '', plannedRiskAmount: p.plannedRiskAmount,
    plannedHolding: p.plannedHolding ?? '日内', strategyVersion: p.strategyVersion ?? '',
    triggerDesc: (p as any).triggerDesc ?? p.entryReason ?? '', invalidation: p.invalidation ?? '',
    accountId: p.accountId ?? (accountStore.selectedId || ''),
  });
  formVisible.value = true;
}

async function save() {
  if (!form.symbol.trim()) { ElMessage.warning('请填写品种'); return; }
  saving.value = true;
  try {
    const targets = form.targetsText.split(',').map((s: string) => Number(s.trim())).filter((n: number) => Number.isFinite(n));
    const record = {
      symbol: form.symbol.toUpperCase(),
      direction: form.direction,
      market: form.market,
      leverage: form.leverage,
      plannedEntry: form.plannedEntry,
      plannedAt: form.plannedAt,
      plannedStop: form.plannedStop,
      plannedTargets: targets,
      plannedSize: form.plannedSize || undefined,
      plannedRiskAmount: form.plannedRiskAmount,
      plannedHolding: form.plannedHolding,
      strategyVersion: form.strategyVersion || undefined,
      triggerDesc: form.triggerDesc || undefined,
      invalidation: form.invalidation || undefined,
      accountId: form.accountId || undefined,
      tradeNo: 'P' + Date.now().toString(36),
      status: 'plan',
    };
    if (editingId.value) {
      await api.patch('/journal/trades/' + editingId.value, { patch: record });
    } else {
      await api.post('/journal/trades', { record });
    }
    ElMessage.success(editingId.value ? '计划已更新' : '计划已创建（计划中）');
    formVisible.value = false;
    await loadAll();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

async function execPlan(p: TradeJournal) {
  try {
    await ElMessageBox.confirm('确认执行「' + p.symbol + '」计划？成交后转入持仓中。', '执行计划', { type: 'info', confirmButtonText: '执行并确认成交', cancelButtonText: '取消' });
  } catch { return; }
  const now = Date.now();
  await api.patch('/journal/trades/' + p.id, { patch: { openTime: now, actualEntry: p.actualEntry ?? p.plannedEntry, status: 'holding', planExecution: 'complete' } });
  ElMessage.success('已执行，转入持仓中');
  await loadAll();
}

async function delayPlan(p: TradeJournal) {
  const t = (p as any).plannedAt ?? p.createdAt ?? Date.now();
  const newT = t + 24 * 3600_000;
  await api.patch('/journal/trades/' + p.id, { patch: { plannedAt: newT } });
  ElMessage.success('已延期 24 小时');
  await loadAll();
}

async function removePlan(p: TradeJournal) {
  try {
    await ElMessageBox.confirm('确认删除该计划？', '删除计划', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
  } catch { return; }
  await api.del('/journal/trades/' + p.id);
  ElMessage.success('已删除');
  await loadAll();
}

async function loadAll() {
  await loadAccounts();
  const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => ({ records: [] }));
  all.value = j.records;
}

onMounted(async () => {
  await loadAll();
  if (route.query.new) openNew();
});
</script>

<style scoped>
.plans { display: flex; flex-direction: column; gap: 12px; }
.plans-head { display: flex; align-items: center; }
.plans-title h2 { margin: 0; font-size: 18px; color: var(--aw-text-title); }
.plans-title .dim { font-size: 12px; margin-left: 10px; }
.plans-head .aw-btn { margin-left: auto; }

/* 时间线 */
.timeline-card { padding: 14px 20px; }
.tc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.tc-head b { font-size: 13px; color: var(--aw-text-title); }
.timeline { position: relative; height: 72px; }
.tl-track { position: absolute; top: 0; left: 0; right: 0; height: 20px; border-bottom: 1px solid var(--aw-border); }
.tl-hour { position: absolute; top: 0; font-size: 9px; color: var(--aw-text-disabled); transform: translateX(-50%); white-space: nowrap; }
.tl-plans { position: absolute; top: 22px; left: 0; right: 0; height: 44px; }
.tl-plan {
  position: absolute; height: 40px; border-radius: 8px; background: var(--aw-accent-dim);
  border: 1px solid rgba(6, 182, 212, 0.35); cursor: pointer; padding: 4px 8px;
  display: flex; flex-direction: column; justify-content: center; gap: 2px; overflow: hidden;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.tl-plan:hover { border-color: var(--aw-accent); transform: translateY(-2px); }
.tl-plan.expired { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.4); }
.tl-sym { font-size: 10px; font-weight: 600; color: var(--aw-text-title); }
.tl-dir { font-size: 9px; }

/* 卡片网格 */
.plan-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.plan-card { cursor: pointer; display: flex; flex-direction: column; gap: 10px; }
.plan-card.selected { box-shadow: 0 0 0 1px var(--aw-accent); }
.plan-card.archived { opacity: 0.6; }
.pc-top { display: flex; align-items: center; gap: 8px; }
.pc-sym { display: flex; align-items: center; gap: 6px; }
.coin-ic { width: 24px; height: 24px; border-radius: 50%; background: var(--aw-accent-dim); color: var(--aw-accent); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.dir-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.dir-tag.long { background: rgba(239,68,68,0.15); color: #f87171; }
.dir-tag.short { background: rgba(16,185,129,0.15); color: #34d399; }
.lev-tag { font-size: 10px; background: var(--aw-bg-elev); color: var(--aw-text-dim); border-radius: 4px; padding: 1px 5px; }
.pc-top .aw-status { margin-left: auto; }
.pc-trigger { background: var(--aw-bg); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.pc-trigger-line { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
.pc-trigger-line .dim { font-size: 11px; }
.pc-sl { display: flex; justify-content: space-between; font-size: 12px; }
.pc-sl .dim b { font-size: 12px; }
.pc-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
.pc-meta { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
.pc-actions { display: flex; gap: 2px; }
.aw-btn-text.danger { color: var(--aw-down); }

/* 归档 */
.archived-card { padding: 14px 20px; }
.ac-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.ac-head b { font-size: 13px; color: var(--aw-text-title); }
.archived-grid { display: flex; flex-direction: column; gap: 4px; }
.arch-item { display: flex; gap: 14px; align-items: center; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.arch-item:hover { background: rgba(255,255,255,0.03); }

.seg2 { display: flex; gap: 4px; }
.s2 { flex: 1; padding: 5px 0; border: 1px solid var(--aw-border); background: transparent; color: var(--aw-text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; }
.s2:hover { border-color: var(--aw-border-hover); }
.s2.active { border-color: var(--aw-accent); color: var(--aw-accent); background: var(--aw-accent-dim); }
</style>
