<template>
  <div class="journal aw-page">
    <!-- 左栏：筛选面板 240px -->
    <aside class="left-panel">
      <div class="lp-head">
        <b>筛选</b>
        <button class="aw-btn aw-btn-text" @click="clearFilters">重置</button>
      </div>
      <!-- 已选条件标签 -->
      <div v-if="activeFilterTags.length" class="sel-tags">
        <span v-for="t in activeFilterTags" :key="t.key" class="sel-tag">
          {{ t.label }} <span class="sel-x" @click="removeFilter(t.key)">×</span>
        </span>
      </div>
      <!-- 状态垂直 tab -->
      <div class="status-tabs">
        <button
          v-for="s in statusTabs"
          :key="s.key"
          class="st-tab"
          :class="{ active: f.status === s.key }"
          @click="toggleStatus(s.key)"
        >
          <span class="st-dot" :style="{ background: s.color }"></span>
          <span>{{ s.label }}</span>
          <span class="st-count mono">{{ s.count }}</span>
        </button>
      </div>
      <el-divider />
      <div class="lp-filters">
        <div class="lp-label">时间</div>
        <el-date-picker v-model="f.range" type="daterange" value-format="x" size="small" style="width: 100%" @change="applyFilter" />
        <div class="lp-label">品种</div>
        <el-input v-model="f.symbol" placeholder="如 BTCUSDT" size="small" @input="applyFilter" />
        <div class="lp-label">方向</div>
        <div class="seg2">
          <button class="s2" :class="{ active: f.direction === 'LONG' }" @click="f.direction = 'LONG'; applyFilter()">多</button>
          <button class="s2" :class="{ active: f.direction === 'SHORT' }" @click="f.direction = 'SHORT'; applyFilter()">空</button>
          <button class="s2" :class="{ active: f.direction === '' }" @click="f.direction = ''; applyFilter()">全部</button>
        </div>
        <div class="lp-label">盈亏结果</div>
        <div class="seg2">
          <button class="s2" :class="{ active: f.result === 'win' }" @click="f.result = 'win'; applyFilter()">盈利</button>
          <button class="s2" :class="{ active: f.result === 'loss' }" @click="f.result = 'loss'; applyFilter()">亏损</button>
          <button class="s2" :class="{ active: f.result === '' }" @click="f.result = ''; applyFilter()">全部</button>
        </div>
        <div class="lp-label">策略版本</div>
        <el-select v-model="f.strategy" size="small" clearable placeholder="全部" style="width: 100%" @change="applyFilter">
          <el-option v-for="s in strategyOptions" :key="s" :value="s" :label="s" />
        </el-select>
        <div class="lp-label">情绪标签</div>
        <el-select v-model="f.tags" size="small" multiple collapse-tags placeholder="标签" style="width: 100%" @change="applyFilter">
          <el-option v-for="t in TAG_OPTIONS" :key="t" :value="t" :label="t" />
        </el-select>
        <div class="lp-label">计划符合度</div>
        <el-select v-model="f.planExec" size="small" clearable placeholder="全部" style="width: 100%" @change="applyFilter">
          <el-option value="complete" label="完全执行" />
          <el-option value="partial" label="部分执行" />
          <el-option value="none" label="未执行" />
        </el-select>
        <div class="lp-label">导入来源</div>
        <el-select v-model="f.imported" size="small" clearable placeholder="全部" style="width: 100%" @change="applyFilter">
          <el-option :value="true" label="历史导入" />
          <el-option :value="false" label="手动记录" />
        </el-select>
      </div>
    </aside>

    <!-- 中栏：日志列表 -->
    <section class="mid-panel">
      <div class="list-head">
        <div class="lh-left">
          <span v-for="s in STATUS_ORDER" :key="s" class="lh-stat" @click="toggleStatus(s)">
            <span class="dot" :style="{ background: STATUS_META[s].color }"></span>
            {{ STATUS_META[s].label }} <b class="mono">{{ groupCount(s) }}</b>
          </span>
        </div>
        <button class="aw-btn aw-btn-primary" @click="openNewPlan"><el-icon><Plus /></el-icon>新建计划</button>
      </div>

      <!-- 批量操作条 -->
      <div v-if="selected.length" class="batch-bar">
        <span class="dim">已选 {{ selected.length }} 条</span>
        <button class="aw-btn aw-btn-secondary" @click="batchTagVisible = true">打标签</button>
        <button class="aw-btn aw-btn-text" @click="clearSelected">取消</button>
      </div>

      <!-- 分组列表 -->
      <div v-for="s in STATUS_ORDER" :key="s" class="group" :class="{ collapsed: collapsed[s] }">
        <div class="group-head" @click="collapsed[s] = !collapsed[s]">
          <span class="gh-dot" :style="{ background: STATUS_META[s].color }"></span>
          <b>{{ STATUS_META[s].label }}</b>
          <span class="mono gh-count">{{ groupCount(s) }}</span>
          <span class="gh-arrow">{{ collapsed[s] ? '▸' : '▾' }}</span>
        </div>
        <div v-if="!collapsed[s]" class="group-body">
          <div
            v-for="r in grouped[s]"
            :key="r.id"
            class="log-card"
            :class="{ active: detail?.id === r.id, [STATUS_META[s].cls]: true, 'pulse-border': s === 'pending' }"
            :style="{ border: STATUS_META[s].border }"
            @click="selectRecord(r)"
          >
            <span class="log-bar" :style="{ background: STATUS_META[s].color }"></span>
            <span class="log-check" @click.stop="toggleSelect(r.id)">
              <span class="cb" :class="{ checked: selected.includes(r.id) }"></span>
            </span>
            <div class="log-main">
              <div class="log-row1">
                <span class="dim mono">{{ fmtTime(r.closeTime ?? r.createdAt) }}</span>
                <b class="log-sym">{{ r.symbol }}</b>
                <span class="dir-tag" :class="r.direction === 'LONG' ? 'long' : 'short'">{{ dirLabel(r.direction) }}</span>
                <span class="aw-status" :class="STATUS_META[s].cls"><span class="dot"></span>{{ STATUS_META[s].label }}</span>
              </div>
              <div class="log-row2 mono">
                <span v-if="r.actualQty">{{ r.actualQty }} @ {{ fmtPrice(r.actualEntry ?? r.plannedEntry) }}</span>
                <span v-else-if="r.plannedSize">计划 {{ r.plannedSize }}</span>
                <span v-else>—</span>
                <span class="log-pnl" :class="(r.netPnl ?? 0) >= 0 ? 'up' : 'down'" v-if="s === 'done' || s === 'pending'">{{ fmtPnl(r.netPnl) }}</span>
                <span class="log-pnl holding" v-else-if="s === 'holding'">浮盈/亏：{{ fmtPnl(r.netPnl) }}</span>
              </div>
              <div class="log-row3" v-if="s === 'pending'">
                <span class="pending-hint">⚠ {{ pendingHint(r) }}</span>
              </div>
              <div class="log-row3" v-else-if="s === 'done'">
                <span class="done-hint">✓ {{ doneSummary(r) }}</span>
              </div>
              <div class="log-row3" v-else-if="s === 'plan'">
                <span class="dim" v-if="r.plannedEntry">入场计划 {{ fmtPrice(r.plannedEntry) }} · 止损 {{ fmtPrice(r.plannedStop) }}</span>
              </div>
            </div>
            <div class="log-actions" @click.stop>
              <template v-if="s === 'plan'">
                <button class="aw-btn aw-btn-text" @click="execRecord(r)">执行</button>
                <button class="aw-btn aw-btn-text" @click="openEdit(r)">编辑</button>
                <button class="aw-btn aw-btn-text danger" @click="removeRecord(r)">删除</button>
              </template>
              <template v-else-if="s === 'holding'">
                <button class="aw-btn aw-btn-text" @click="closeRecord(r)">平仓</button>
                <button class="aw-btn aw-btn-text" @click="selectRecord(r)">查看</button>
              </template>
              <template v-else-if="s === 'pending'">
                <button class="aw-btn aw-btn-text" @click="openReview(r)">补记/复盘</button>
                <button class="aw-btn aw-btn-text" @click="quickReview(r)">快速复盘</button>
              </template>
              <template v-else>
                <button class="aw-btn aw-btn-text" @click="selectRecord(r)">查看</button>
                <button class="aw-btn aw-btn-text" @click="toStrategy(r)">加入策略分析</button>
              </template>
            </div>
          </div>
          <div v-if="!grouped[s].length" class="group-empty dim">暂无{{ STATUS_META[s].label }}记录</div>
        </div>
      </div>
    </section>

    <!-- 右栏：详情/编辑面板 360px -->
    <aside class="right-panel">
      <!-- 未选中：引导 + 环形统计 -->
      <div v-if="!detail" class="rp-guide">
        <div class="rp-guide-title">交易日志</div>
        <div class="rp-guide-desc dim">选择一条记录查看详情，或按状态快速操作</div>
        <div ref="ringChart" class="ring-chart"></div>
        <div class="ring-legend">
          <div v-for="s in STATUS_ORDER" :key="s" class="rl-item">
            <span class="rl-dot" :style="{ background: STATUS_META[s].color }"></span>
            <span>{{ STATUS_META[s].label }}</span>
            <b class="mono">{{ counts[s] }}</b>
          </div>
        </div>
      </div>

      <!-- 已选中：按状态展示 -->
      <div v-else class="rp-detail">
        <div class="rp-head">
          <div class="rp-title">
            <b>{{ detail.symbol }}</b>
            <span class="aw-status" :class="STATUS_META[detailStatus].cls"><span class="dot"></span>{{ STATUS_META[detailStatus].label }}</span>
          </div>
          <button class="aw-btn aw-btn-text" @click="detail = null">关闭 ×</button>
        </div>

        <!-- 计划中 -->
        <template v-if="detailStatus === 'plan'">
          <div class="rp-section">
            <div class="rp-sec-title">计划详情</div>
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="品种/方向">{{ detail.symbol }} · {{ dirLabel(detail.direction) }}</el-descriptions-item>
              <el-descriptions-item label="入场计划">{{ fmtPrice(detail.plannedEntry) }}</el-descriptions-item>
              <el-descriptions-item label="止损">{{ fmtPrice(detail.plannedStop) }}</el-descriptions-item>
              <el-descriptions-item label="止盈目标">{{ (detail.plannedTargets ?? []).map(fmtPrice).join(' / ') || '—' }}</el-descriptions-item>
              <el-descriptions-item label="盈亏比">{{ detail.plannedRR ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="仓位">{{ detail.plannedSize ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="风险金额">{{ fmtNum(detail.plannedRiskAmount) }}</el-descriptions-item>
              <el-descriptions-item label="持仓周期">{{ detail.plannedHolding ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="失效条件">{{ detail.invalidation ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="策略">{{ detail.strategyName ?? '—' }} {{ detail.strategyVersion ?? '' }}</el-descriptions-item>
            </el-descriptions>
          </div>
          <div class="rp-actions">
            <button class="aw-btn aw-btn-primary" @click="execRecord(detail)">执行（转持仓中）</button>
            <button class="aw-btn aw-btn-secondary" @click="openEdit(detail)">编辑</button>
          </div>
        </template>

        <!-- 持仓中 -->
        <template v-else-if="detailStatus === 'holding'">
          <div class="rp-section">
            <div class="rp-sec-title">持仓详情</div>
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="品种/方向">{{ detail.symbol }} · {{ dirLabel(detail.direction) }}</el-descriptions-item>
              <el-descriptions-item label="开仓价">{{ fmtPrice(detail.actualEntry) }}</el-descriptions-item>
              <el-descriptions-item label="数量">{{ detail.actualQty ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="杠杆">{{ detail.leverage ?? '—' }}x</el-descriptions-item>
              <el-descriptions-item label="开仓时间">{{ fmtFullTime(detail.openTime) }}</el-descriptions-item>
              <el-descriptions-item label="当前浮盈/亏"><span class="mono" :class="(detail.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(detail.netPnl) }}</span></el-descriptions-item>
              <el-descriptions-item label="关联计划">{{ detail.strategyName || detail.tradeNo || '—' }}</el-descriptions-item>
            </el-descriptions>
          </div>
          <div class="rp-actions">
            <button class="aw-btn aw-btn-primary" @click="closeRecord(detail)">平仓（转待复盘）</button>
            <button class="aw-btn aw-btn-secondary" @click="openEdit(detail)">编辑</button>
          </div>
        </template>

        <!-- 待复盘：补记 + 复盘 -->
        <template v-else-if="detailStatus === 'pending'">
          <div class="rp-sub-tabs">
            <button class="rst" :class="{ active: reviewTab === 'log' }" @click="reviewTab = 'log'">补记日志</button>
            <button class="rst" :class="{ active: reviewTab === 'review' }" @click="reviewTab = 'review'">复盘</button>
          </div>

          <!-- 补记表单 -->
          <div v-if="reviewTab === 'log'" class="rp-section">
            <div class="rp-sec-title">补记日志（保存后仍待复盘）</div>
            <el-form label-position="top" size="small">
              <el-form-item label="交易理由">
                <el-select v-model="review.entryReasonSel" multiple filterable allow-create collapse-tags placeholder="突破/回调/止损/止盈/情绪/其他" style="width: 100%">
                  <el-option v-for="o in REASON_OPTIONS" :key="o" :value="o" :label="o" />
                </el-select>
              </el-form-item>
              <el-form-item label="自定义理由">
                <el-input v-model="review.entryReason" type="textarea" :rows="2" placeholder="为什么做这笔？" />
              </el-form-item>
              <el-form-item label="情绪状态">
                <div class="seg2">
                  <button v-for="e in EMOTION_OPTIONS" :key="e" class="s2" :class="{ active: review.emotion === e }" @click="review.emotion = e">{{ e }}</button>
                </div>
              </el-form-item>
              <el-form-item label="自信度">
                <el-slider v-model="review.confidence" :min="1" :max="10" :step="1" show-stops />
              </el-form-item>
              <el-form-item label="计划符合度">
                <el-slider v-model="review.discipline" :min="1" :max="10" :step="1" show-stops />
              </el-form-item>
              <el-form-item label="标签">
                <el-select v-model="review.tags" multiple filterable allow-create collapse-tags placeholder="如 趋势跟踪 / 逆势抄底" style="width: 100%">
                  <el-option v-for="t in TAG_OPTIONS" :key="t" :value="t" :label="t" />
                </el-select>
              </el-form-item>
            </el-form>
            <button class="aw-btn aw-btn-secondary full" @click="saveLog">保存日志</button>
          </div>

          <!-- 复盘表单 -->
          <div v-else class="rp-section">
            <div class="rp-sec-title">复盘</div>
            <el-form label-position="top" size="small">
              <el-form-item label="入场质量评分">
                <div class="score-row"><el-slider v-model="review.entryQuality" :min="1" :max="10" :step="1" show-stops /><b class="mono">{{ review.entryQuality }}/10</b></div>
                <el-input v-model="review.entryQualityNote" placeholder="一句话总结入场" />
              </el-form-item>
              <el-form-item label="出场质量评分">
                <div class="score-row"><el-slider v-model="review.exitQuality" :min="1" :max="10" :step="1" show-stops /><b class="mono">{{ review.exitQuality }}/10</b></div>
                <el-input v-model="review.exitQualityNote" placeholder="一句话总结出场" />
              </el-form-item>
              <el-form-item label="盈亏归因">
                <el-checkbox-group v-model="review.attribution">
                  <el-checkbox v-for="o in ATTRIBUTION_OPTIONS" :key="o" :value="o" size="small">{{ o }}</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
              <el-form-item label="改进点">
                <el-input v-model="review.improvements" type="textarea" :rows="3" placeholder="写具体可执行的动作" />
              </el-form-item>
              <el-form-item label="策略调整建议">
                <div class="seg2">
                  <button class="s2" :class="{ active: review.adjust === false }" @click="review.adjust = false">否</button>
                  <button class="s2" :class="{ active: review.adjust === true }" @click="review.adjust = true">是</button>
                </div>
                <template v-if="review.adjust">
                  <el-select v-model="review.adjustStrategy" size="small" placeholder="关联策略" style="width: 100%; margin-top: 6px">
                    <el-option v-for="s in strategyNameOptions" :key="s" :value="s" :label="s" />
                  </el-select>
                  <el-input v-model="review.adjustDirection" size="small" placeholder="调整方向" style="margin-top: 6px" />
                </template>
              </el-form-item>
            </el-form>
            <div class="rp-actions">
              <button class="aw-btn aw-btn-primary" @click="submitReview">提交复盘（转已复盘）</button>
              <button class="aw-btn aw-btn-secondary" @click="saveDraft">保存草稿</button>
            </div>
          </div>
        </template>

        <!-- 已复盘：只读 -->
        <template v-else>
          <div class="rp-section">
            <div class="rp-sec-title">交易记录</div>
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="品种/方向">{{ detail.symbol }} · {{ dirLabel(detail.direction) }}</el-descriptions-item>
              <el-descriptions-item label="开仓">{{ fmtPrice(detail.actualEntry) }} → {{ fmtPrice(detail.actualExit) }}</el-descriptions-item>
              <el-descriptions-item label="净盈亏"><span class="mono" :class="(detail.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(detail.netPnl) }}</span></el-descriptions-item>
              <el-descriptions-item label="R 倍数">{{ fmtNum(detail.rMultiple, 2) }}</el-descriptions-item>
              <el-descriptions-item label="时间">{{ fmtFullTime(detail.openTime) }} → {{ fmtFullTime(detail.closeTime) }}</el-descriptions-item>
              <el-descriptions-item label="计划符合度">{{ detail.planExecution === 'complete' ? '完全' : detail.planExecution === 'partial' ? '部分' : '未执行' }}</el-descriptions-item>
              <el-descriptions-item label="标签">{{ (detail.tags ?? []).join('、') || '—' }}</el-descriptions-item>
            </el-descriptions>
          </div>
          <div class="rp-section">
            <div class="rp-sec-title">复盘报告</div>
            <div v-if="detail.improvements" class="rp-quote">🔧 {{ detail.improvements }}</div>
            <div v-if="detail.strengths" class="rp-quote">✅ {{ detail.strengths }}</div>
            <div v-if="detail.entryReason" class="rp-quote">💡 {{ detail.entryReason }}</div>
            <div v-if="!detail.improvements && !detail.strengths" class="dim">该记录暂无详细复盘内容</div>
          </div>
          <div class="rp-actions">
            <button class="aw-btn aw-btn-secondary" @click="toStrategy(detail)">加入策略分析</button>
            <button class="aw-btn aw-btn-text" @click="openEdit(detail)">编辑</button>
          </div>
        </template>
      </div>
    </aside>

    <!-- 批量打标签 -->
    <el-dialog v-model="batchTagVisible" title="批量打标签" width="420px">
      <el-select v-model="batchTag" multiple filterable allow-create collapse-tags placeholder="选择或输入标签" style="width: 100%">
        <el-option v-for="t in TAG_OPTIONS" :key="t" :value="t" :label="t" />
      </el-select>
      <template #footer>
        <el-button size="small" @click="batchTagVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="batchTagging" @click="doBatchTag">应用</el-button>
      </template>
    </el-dialog>

    <!-- 新建/编辑完整表单（复用分阶段大表单，保持旧入口可用） -->
    <el-dialog v-model="fullFormVisible" :title="editingId ? '编辑交易' : '新建交易计划'" width="min(760px, 94vw)" top="4vh">
      <div class="full-form-scroll">
        <el-form label-width="92px" size="small">
          <el-form-item label="品种"><el-input v-model="form.symbol" placeholder="BTCUSDT" /></el-form-item>
          <el-form-item label="方向">
            <div class="seg2">
              <button class="s2" :class="{ active: form.direction === 'LONG' }" @click="form.direction = 'LONG'">多 ▲</button>
              <button class="s2" :class="{ active: form.direction === 'SHORT' }" @click="form.direction = 'SHORT'">空 ▼</button>
            </div>
          </el-form-item>
          <el-form-item label="市场"><el-select v-model="form.market" style="width: 100%">
            <el-option v-for="m in MARKET_OPTIONS" :key="m" :value="m" :label="m" />
          </el-select></el-form-item>
          <el-form-item label="计划开仓价"><el-input-number v-model="form.plannedEntry" :precision="4" controls-position="right" style="width: 100%" /></el-form-item>
          <el-form-item label="止损价"><el-input-number v-model="form.plannedStop" :precision="4" controls-position="right" style="width: 100%" /></el-form-item>
          <el-form-item label="止盈目标"><el-input v-model="form.targetsText" placeholder="逗号分隔，如 75000, 78000" /></el-form-item>
          <el-form-item label="仓位"><el-input v-model="form.plannedSize" placeholder="如 0.5 手" /></el-form-item>
          <el-form-item label="风险金额"><el-input-number v-model="form.plannedRiskAmount" :precision="2" controls-position="right" style="width: 100%" /></el-form-item>
          <el-form-item label="持仓周期">
            <div class="seg2">
              <button v-for="h in HOLDING_OPTIONS" :key="h" class="s2" :class="{ active: form.plannedHolding === h }" @click="form.plannedHolding = h">{{ h }}</button>
            </div>
          </el-form-item>
          <el-form-item label="策略名称"><el-input v-model="form.strategyName" placeholder="如 趋势跟踪" /></el-form-item>
          <el-form-item label="策略版本"><el-input v-model="form.strategyVersion" placeholder="如 v2.1" /></el-form-item>
          <el-form-item label="失效条件"><el-input v-model="form.invalidation" placeholder="如 跌破 65000 则放弃" /></el-form-item>
          <el-form-item label="入场理由"><el-input v-model="form.entryReason" type="textarea" :rows="2" placeholder="为什么做这笔？" /></el-form-item>
          <el-form-item label="账户">
            <el-select v-model="form.accountId" style="width: 100%">
              <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button size="small" @click="fullFormVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="savePlanForm">{{ editingId ? '保存修改' : '保存计划' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.ts';
import { accountStore, loadAccounts } from '../store.ts';
import type { TradeJournal } from '../lib/journal.ts';
import {
  STATUS_META, STATUS_ORDER, deriveStatus, fmtPnl, fmtNum, fmtPrice, fmtTime, fmtFullTime,
  dirLabel, pendingHint, doneSummary, type JournalStatus,
} from '../lib/journal.ts';

const TAG_OPTIONS = ['情绪化交易', '执行错误', '系统缺陷', '正常亏损', '正常盈利', '运气成分', '历史导入', '趋势跟踪', '逆势抄底'];
const MARKET_OPTIONS = ['现货', 'U本位合约', '币本位合约', '全仓杠杆', '逐仓杠杆'];
const HOLDING_OPTIONS = ['日内', '波段', '趋势'];
const REASON_OPTIONS = ['突破', '回调', '止损', '止盈', '情绪', '其他'];
const EMOTION_OPTIONS = ['冷静', '贪婪', '恐惧', '犹豫'];
const ATTRIBUTION_OPTIONS = ['技术', '运气', '计划执行', '情绪'];

const route = useRoute();
const router = useRouter();

const all = ref<TradeJournal[]>([]);
const detail = ref<TradeJournal | null>(null);
const collapsed = reactive<Record<JournalStatus, boolean>>({ plan: false, holding: false, pending: false, done: true });
const f = reactive<{
  status: '' | JournalStatus;
  range: [number, number] | null;
  symbol: string;
  direction: string;
  result: string;
  strategy: string;
  tags: string[];
  planExec: string;
  imported: '' | boolean;
}>({ status: '', range: null, symbol: '', direction: '', result: '', strategy: '', tags: [], planExec: '', imported: '' });
const selected = ref<string[]>([]);
const batchTagVisible = ref(false);
const batchTag = ref<string[]>([]);
const batchTagging = ref(false);
const reviewTab = ref<'log' | 'review'>('log');
const ringChart = ref<HTMLDivElement | null>(null);
let ringE: echarts.ECharts | null = null;
const fullFormVisible = ref(false);
const editingId = ref('');
const saving = ref(false);

const review = reactive<{
  entryReasonSel: string[]; entryReason: string; emotion: string; confidence: number;
  discipline: number; tags: string[]; entryQuality: number; entryQualityNote: string;
  exitQuality: number; exitQualityNote: string; attribution: string[]; improvements: string;
  adjust: boolean | null; adjustStrategy: string; adjustDirection: string;
}>({ entryReasonSel: [], entryReason: '', emotion: '冷静', confidence: 5, discipline: 5, tags: [], entryQuality: 5, entryQualityNote: '', exitQuality: 5, exitQualityNote: '', attribution: [], improvements: '', adjust: null, adjustStrategy: '', adjustDirection: '' });

const form = reactive<Record<string, any>>({
  symbol: '', direction: 'LONG', market: '现货', plannedEntry: undefined, plannedStop: undefined,
  targetsText: '', plannedSize: '', plannedRiskAmount: undefined, plannedHolding: '日内',
  strategyName: '', strategyVersion: '', invalidation: '', entryReason: '', accountId: '',
});

const counts = computed(() => {
  const c = { plan: 0, holding: 0, pending: 0, done: 0 };
  for (const r of all.value) c[deriveStatus(r)]++;
  return c;
});

const statusTabs = computed(() => [
  { key: '' as const, label: '全部', color: '#6B7280', count: all.value.length },
  ...STATUS_ORDER.map((s) => ({ key: s, label: STATUS_META[s].label, color: STATUS_META[s].color, count: counts.value[s] })),
]);

const filtered = computed(() => {
  let out = all.value;
  if (f.status) out = out.filter((r) => deriveStatus(r) === f.status);
  if (f.range?.[0] && f.range?.[1]) { const [from, to] = f.range; out = out.filter((r) => (r.closeTime ?? r.createdAt ?? 0) >= from && (r.closeTime ?? r.createdAt ?? 0) <= to); }
  if (f.symbol) out = out.filter((r) => r.symbol.toUpperCase().includes(f.symbol.toUpperCase()));
  if (f.direction) out = out.filter((r) => r.direction === f.direction);
  if (f.result) out = out.filter((r) => (f.result === 'win' ? (r.netPnl ?? 0) > 0 : (r.netPnl ?? 0) < 0));
  if (f.strategy) out = out.filter((r) => r.strategyVersion === f.strategy);
  if (f.tags.length) out = out.filter((r) => f.tags.some((t) => (r.tags ?? []).includes(t)));
  if (f.planExec) out = out.filter((r) => r.planExecution === f.planExec);
  if (f.imported !== '') out = out.filter((r) => f.imported === true ? (r.tags ?? []).includes('历史导入') : !(r.tags ?? []).includes('历史导入'));
  return out;
});

const grouped = computed(() => {
  const g: Record<JournalStatus, TradeJournal[]> = { plan: [], holding: [], pending: [], done: [] };
  for (const r of filtered.value) g[deriveStatus(r)].push(r);
  // 待复盘按盈亏绝对值降序
  g.pending.sort((a, b) => Math.abs(b.netPnl ?? 0) - Math.abs(a.netPnl ?? 0));
  return g;
});

function groupCount(s: JournalStatus): number {
  return grouped.value[s].length;
}

const activeFilterTags = computed(() => {
  const t: { key: string; label: string }[] = [];
  if (f.status) t.push({ key: 'status', label: '状态：' + STATUS_META[f.status].label });
  if (f.range?.[0]) t.push({ key: 'range', label: '时间范围' });
  if (f.symbol) t.push({ key: 'symbol', label: f.symbol });
  if (f.direction) t.push({ key: 'direction', label: f.direction === 'LONG' ? '做多' : '做空' });
  if (f.result) t.push({ key: 'result', label: f.result === 'win' ? '盈利' : '亏损' });
  if (f.strategy) t.push({ key: 'strategy', label: f.strategy });
  for (const tag of f.tags) t.push({ key: 'tag:' + tag, label: tag });
  if (f.planExec) t.push({ key: 'planExec', label: f.planExec === 'complete' ? '完全执行' : f.planExec === 'partial' ? '部分执行' : '未执行' });
  return t;
});

function removeFilter(key: string) {
  if (key === 'status') f.status = '';
  else if (key === 'range') f.range = null;
  else if (key === 'symbol') f.symbol = '';
  else if (key === 'direction') f.direction = '';
  else if (key === 'result') f.result = '';
  else if (key === 'strategy') f.strategy = '';
  else if (key.startsWith('tag:')) f.tags = f.tags.filter((t) => t !== key.slice(4));
  else if (key === 'planExec') f.planExec = '';
}

function clearFilters() {
  Object.assign(f, { status: '', range: null, symbol: '', direction: '', result: '', strategy: '', tags: [], planExec: '', imported: '' });
}
function applyFilter() {}
function toggleStatus(key: '' | JournalStatus) {
  f.status = f.status === key ? '' : key;
}

const strategyOptions = computed(() => [...new Set(all.value.map((r) => r.strategyVersion).filter(Boolean))] as string[]);
const strategyNameOptions = computed(() => [...new Set(all.value.map((r) => r.strategyName).filter(Boolean))] as string[]);

const detailStatus = computed<JournalStatus>(() => (detail.value ? deriveStatus(detail.value) : 'plan'));

function selectRecord(r: TradeJournal) {
  detail.value = r;
  reviewTab.value = 'log';
  initReview(r);
}

function initReview(r: TradeJournal) {
  Object.assign(review, {
    entryReasonSel: r.entryReason ? [r.entryReason] : [],
    entryReason: r.entryReason ?? '',
    emotion: EMOTION_OPTIONS[Math.min(Math.max(Math.round((r.emotionScore ?? 5) / 3) - 1, 0), 3)] ?? '冷静',
    confidence: r.confidenceScore ?? 5,
    discipline: r.disciplineScore ?? 5,
    tags: [...(r.tags ?? [])].filter((t) => t !== '历史导入'),
    entryQuality: r.entryQuality ?? 5,
    entryQualityNote: (r as any).entryQualityNote ?? '',
    exitQuality: (r as any).exitQuality ?? 5,
    exitQualityNote: (r as any).exitQualityNote ?? '',
    attribution: ((r as any).attributionArr ?? (r.attribution ? [r.attribution] : [])),
    improvements: r.improvements ?? '',
    adjust: null, adjustStrategy: '', adjustDirection: '',
  });
}

async function loadAll() {
  await loadAccounts();
  const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => ({ records: [] }));
  all.value = j.records;
  const q = route.query;
  if (q.search) { f.symbol = String(q.search); }
  renderRing();
}

async function execRecord(r: TradeJournal) {
  try {
    await ElMessageBox.confirm('确认执行该计划并转入「持仓中」？', '执行计划', { type: 'info', confirmButtonText: '执行', cancelButtonText: '取消' });
  } catch { return; }
  const now = Date.now();
  await api.patch('/journal/trades/' + r.id, { patch: { openTime: r.openTime ?? now, actualEntry: r.actualEntry ?? r.plannedEntry, status: 'holding' } });
  ElMessage.success('已执行，转入持仓中');
  await loadAll(); detail.value = null;
}

async function closeRecord(r: TradeJournal) {
  try {
    await ElMessageBox.confirm('确认平仓并转入「待复盘」？', '平仓', { type: 'warning', confirmButtonText: '平仓', cancelButtonText: '取消' });
  } catch { return; }
  const now = Date.now();
  await api.patch('/journal/trades/' + r.id, { patch: { closeTime: r.closeTime ?? now, actualExit: r.actualExit ?? r.actualEntry, status: 'pending' } });
  ElMessage.success('已平仓，转入待复盘');
  await loadAll(); detail.value = null;
}

async function saveLog() {
  if (!detail.value) return;
  const reason = review.entryReasonSel.length ? review.entryReasonSel.join(', ') : review.entryReason;
  const patch = {
    entryReason: reason || undefined,
    emotionScore: EMOTION_OPTIONS.indexOf(review.emotion) * 3 + 2,
    confidenceScore: review.confidence,
    disciplineScore: review.discipline,
    tags: [...new Set([...(detail.value.tags ?? []).filter((t) => t !== '历史导入'), ...review.tags])],
  };
  await api.patch('/journal/trades/' + detail.value.id, { patch });
  ElMessage.success('日志已保存，仍为待复盘');
  await loadAll();
  detail.value = all.value.find((r) => r.id === detail.value!.id) ?? null;
}

async function submitReview() {
  if (!detail.value) return;
  const patch: Record<string, unknown> = {
    improvements: review.improvements || undefined,
    disciplineScore: review.discipline,
    entryReason: review.entryReason || (review.entryReasonSel.length ? review.entryReasonSel.join(', ') : undefined),
    emotionScore: EMOTION_OPTIONS.indexOf(review.emotion) * 3 + 2,
    confidenceScore: review.confidence,
    status: 'done',
  };
  if (review.entryQuality) patch.entryQuality = review.entryQuality;
  if (review.entryQualityNote) patch.entryQualityNote = review.entryQualityNote;
  if (review.exitQuality) patch.exitQuality = review.exitQuality;
  if (review.exitQualityNote) patch.exitQualityNote = review.exitQualityNote;
  if (review.attribution.length) patch.attribution = review.attribution.join('、');
  if (review.adjust) patch.strategyAdjustment = { strategy: review.adjustStrategy, direction: review.adjustDirection };
  patch.tags = [...new Set([...(detail.value.tags ?? []), ...review.tags])];
  await api.patch('/journal/trades/' + detail.value.id, { patch });
  ElMessage.success('复盘已提交，转入已复盘');
  await loadAll(); detail.value = null;
}

async function saveDraft() {
  if (!detail.value) return;
  const patch: Record<string, unknown> = {
    improvements: review.improvements || undefined,
    disciplineScore: review.discipline,
    entryReason: review.entryReason || (review.entryReasonSel.length ? review.entryReasonSel.join(', ') : undefined),
  };
  await api.patch('/journal/trades/' + detail.value.id, { patch });
  ElMessage.success('草稿已保存，状态不变');
  await loadAll();
}

function openReview(r: TradeJournal) { selectRecord(r); reviewTab.value = 'review'; }
function quickReview(r: TradeJournal) { selectRecord(r); reviewTab.value = 'review'; }

function openNewPlan() {
  Object.assign(form, { symbol: '', direction: 'LONG', market: '现货', plannedEntry: undefined, plannedStop: undefined, targetsText: '', plannedSize: '', plannedRiskAmount: undefined, plannedHolding: '日内', strategyName: '', strategyVersion: '', invalidation: '', entryReason: '', accountId: accountStore.selectedId || '' });
  editingId.value = '';
  fullFormVisible.value = true;
}

function openEdit(r: TradeJournal) {
  editingId.value = r.id;
  Object.assign(form, {
    symbol: r.symbol, direction: r.direction, market: r.market ?? '现货',
    plannedEntry: r.plannedEntry, plannedStop: r.plannedStop,
    targetsText: (r.plannedTargets ?? []).join(', '),
    plannedSize: r.plannedSize ?? '', plannedRiskAmount: r.plannedRiskAmount,
    plannedHolding: r.plannedHolding ?? '日内', strategyName: r.strategyName ?? '',
    strategyVersion: r.strategyVersion ?? '', invalidation: r.invalidation ?? '',
    entryReason: r.entryReason ?? '', accountId: r.accountId ?? (accountStore.selectedId || ''),
  });
  fullFormVisible.value = true;
}

async function savePlanForm() {
  saving.value = true;
  try {
    const targets = form.targetsText.split(',').map((s: string) => Number(s.trim())).filter((n: number) => Number.isFinite(n));
    const record = {
      symbol: form.symbol.toUpperCase(),
      direction: form.direction,
      market: form.market,
      plannedEntry: form.plannedEntry,
      plannedStop: form.plannedStop,
      plannedTargets: targets,
      plannedSize: form.plannedSize || undefined,
      plannedRiskAmount: form.plannedRiskAmount,
      plannedHolding: form.plannedHolding,
      strategyName: form.strategyName || undefined,
      strategyVersion: form.strategyVersion || undefined,
      invalidation: form.invalidation || undefined,
      entryReason: form.entryReason || undefined,
      accountId: form.accountId || undefined,
      tradeNo: 'P' + Date.now().toString(36),
      status: 'plan',
    };
    if (editingId.value) {
      await api.patch('/journal/trades/' + editingId.value, { patch: record });
    } else {
      await api.post('/journal/trades', { record });
    }
    ElMessage.success(editingId.value ? '已保存修改' : '计划已保存（计划中）');
    fullFormVisible.value = false;
    await loadAll();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

async function removeRecord(r: TradeJournal) {
  try {
    await ElMessageBox.confirm('确认删除该记录？', '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
  } catch { return; }
  await api.del('/journal/trades/' + r.id);
  ElMessage.success('已删除');
  if (detail.value?.id === r.id) detail.value = null;
  await loadAll();
}

function toStrategy(r: TradeJournal) {
  router.push({ path: '/strategies', query: { from: r.id } });
}

function clearSelected() { selected.value = []; }
function toggleSelect(id: string) {
  const i = selected.value.indexOf(id);
  if (i >= 0) selected.value.splice(i, 1);
  else selected.value.push(id);
}

async function doBatchTag() {
  if (!batchTag.value.length) { ElMessage.warning('请选择标签'); return; }
  batchTagging.value = true;
  try {
    for (const id of selected.value) {
      const r = all.value.find((x) => x.id === id);
      if (!r) continue;
      const tags = [...new Set([...(r.tags ?? []), ...batchTag.value])];
      await api.patch('/journal/trades/' + id, { patch: { tags } });
    }
    ElMessage.success('已为 ' + selected.value.length + ' 条记录打标签');
    batchTagVisible.value = false;
    selected.value = [];
    await loadAll();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    batchTagging.value = false;
  }
}

function renderRing() {
  if (!ringChart.value) return;
  if (!ringE) ringE = echarts.init(ringChart.value);
  const c = counts.value;
  ringE.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [{
      type: 'pie', radius: ['55%', '75%'], center: ['50%', '50%'],
      label: { show: false },
      data: STATUS_ORDER.map((s) => ({ name: STATUS_META[s].label, value: c[s], itemStyle: { color: STATUS_META[s].color } })),
    }],
  });
}

watch(() => accountStore.selectedId, () => loadAll());

onMounted(async () => {
  await loadAll();
  window.addEventListener('resize', () => ringE?.resize());
  const q = route.query;
  if (q.new) openNewPlan();
  if (q.id) {
    const found = all.value.find((r) => r.id === q.id);
    if (found) selectRecord(found);
  }
});
</script>

<style scoped>
.journal { display: grid; grid-template-columns: 240px 1fr 360px; gap: 12px; align-items: start; }
@media (max-width: 1280px) { .journal { grid-template-columns: 200px 1fr; } .right-panel { grid-column: 1 / -1; } }

/* 左栏 */
.left-panel { background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; padding: 14px; position: sticky; top: 0; }
.lp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.lp-head b { font-size: 13px; color: var(--aw-text-title); }
.sel-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.sel-tag { font-size: 11px; background: var(--aw-accent-dim); color: var(--aw-accent); border-radius: 4px; padding: 1px 6px; display: inline-flex; align-items: center; gap: 4px; }
.sel-x { cursor: pointer; font-weight: 700; }
.status-tabs { display: flex; flex-direction: column; gap: 2px; }
.st-tab { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--aw-text-body); cursor: pointer; font-size: 12px; font-family: inherit; }
.st-tab:hover { background: rgba(255,255,255,0.03); }
.st-tab.active { background: var(--aw-accent-dim); border-color: rgba(6,182,212,0.3); color: var(--aw-accent); }
.st-dot { width: 7px; height: 7px; border-radius: 50%; }
.st-count { margin-left: auto; font-size: 12px; color: var(--aw-text-dim); }
.lp-filters { display: flex; flex-direction: column; gap: 4px; }
.lp-label { font-size: 11px; color: var(--aw-text-dim); margin-top: 8px; }

/* 中栏 */
.mid-panel { min-width: 0; }
.list-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.lh-left { display: flex; gap: 14px; flex: 1; flex-wrap: wrap; }
.lh-stat { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--aw-text-dim); cursor: pointer; }
.lh-stat .dot { width: 6px; height: 6px; border-radius: 50%; }
.lh-stat b { color: var(--aw-text-title); }
.batch-bar { display: flex; align-items: center; gap: 10px; background: var(--aw-accent-dim); border: 1px solid rgba(6,182,212,0.3); border-radius: 10px; padding: 6px 12px; margin-bottom: 10px; }
.group { margin-bottom: 10px; }
.group-head { display: flex; align-items: center; gap: 8px; padding: 8px 4px; cursor: pointer; user-select: none; }
.gh-dot { width: 8px; height: 8px; border-radius: 2px; }
.group-head b { font-size: 13px; color: var(--aw-text-title); }
.gh-count { font-size: 12px; color: var(--aw-text-dim); }
.gh-arrow { margin-left: auto; color: var(--aw-text-dim); font-size: 11px; }
.group-body { display: flex; flex-direction: column; gap: 6px; }
.log-card {
  position: relative; display: flex; border-radius: 10px; background: var(--aw-bg-card);
  padding: 10px 12px; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease); overflow: hidden;
}
.log-card:hover { border-color: var(--aw-border-hover) !important; }
.log-card.active { box-shadow: 0 0 0 1px var(--aw-accent); }
.log-card.pulse-border { animation: aw-pulse 2.4s infinite; }
.log-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.log-check { display: flex; align-items: center; padding: 0 8px 0 2px; }
.cb { width: 14px; height: 14px; border: 1.5px solid var(--aw-text-disabled); border-radius: 4px; display: inline-block; transition: all var(--aw-dur-fast) var(--aw-ease); flex: none; }
.cb.checked { background: var(--aw-accent); border-color: var(--aw-accent); position: relative; }
.cb.checked::after { content: '✓'; position: absolute; inset: -1px; color: #fff; font-size: 10px; display: flex; align-items: center; justify-content: center; }
.log-main { flex: 1; min-width: 0; }
.log-row1 { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.log-sym { color: var(--aw-text-title); font-size: 13px; }
.dir-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.dir-tag.long { background: rgba(239,68,68,0.15); color: #f87171; }
.dir-tag.short { background: rgba(16,185,129,0.15); color: #34d399; }
.log-row2 { display: flex; justify-content: space-between; margin-top: 4px; font-size: 12px; color: var(--aw-text-body); }
.log-pnl { font-weight: 700; }
.log-pnl.holding { color: var(--aw-info); }
.log-row3 { margin-top: 2px; font-size: 11px; }
.pending-hint { color: var(--aw-down); }
.done-hint { color: var(--aw-up); }
.log-actions { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 2px; padding-left: 8px; }
.aw-btn-text.danger { color: var(--aw-down); }
.group-empty { padding: 10px 4px; font-size: 12px; }

/* 右栏 */
.right-panel { background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; padding: 16px; position: sticky; top: 0; max-height: calc(100vh - 100px); overflow-y: auto; }
.rp-guide-title { font-size: 15px; font-weight: 600; color: var(--aw-text-title); }
.rp-guide-desc { font-size: 12px; margin: 4px 0 12px; }
.ring-chart { height: 180px; }
.ring-legend { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.rl-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--aw-text-body); }
.rl-dot { width: 8px; height: 8px; border-radius: 2px; }
.rl-item b { margin-left: auto; }
.rp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.rp-title { display: flex; align-items: center; gap: 8px; }
.rp-title b { font-size: 15px; color: var(--aw-text-title); }
.rp-section { margin-bottom: 14px; }
.rp-sec-title { font-size: 12px; color: var(--aw-text-dim); margin-bottom: 8px; border-left: 2px solid var(--aw-accent); padding-left: 8px; }
.rp-sub-tabs { display: flex; gap: 4px; margin-bottom: 12px; background: var(--aw-bg); border-radius: 8px; padding: 3px; }
.rst { flex: 1; padding: 6px 0; border: none; background: transparent; color: var(--aw-text-dim); cursor: pointer; border-radius: 6px; font-size: 12px; font-family: inherit; }
.rst.active { background: var(--aw-bg-card); color: var(--aw-accent); font-weight: 600; }
.rp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.rp-actions .aw-btn { flex: 1; }
.rp-quote { font-size: 12px; color: var(--aw-text-body); background: var(--aw-bg); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
.score-row { display: flex; align-items: center; gap: 10px; }
.score-row b { min-width: 44px; }
.aw-btn.full { width: 100%; }
.seg2 { display: flex; gap: 4px; }
.s2 { flex: 1; padding: 5px 0; border: 1px solid var(--aw-border); background: transparent; color: var(--aw-text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; }
.s2:hover { border-color: var(--aw-border-hover); }
.s2.active { border-color: var(--aw-accent); color: var(--aw-accent); background: var(--aw-accent-dim); }
.full-form-scroll { max-height: 62vh; overflow-y: auto; }
</style>
