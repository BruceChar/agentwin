<template>
  <div class="journal aw-page">
    <!-- 左栏：筛选面板 200px（状态筛选已升级为页内主导航 Tab，不再出现在这里） -->
    <aside class="left-panel">
      <div class="lp-head">
        <b>筛选</b>
        <button class="aw-btn aw-btn-text" @click="clearFilters">重置</button>
      </div>
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

    <!-- 中栏：Tab 导航 + 记录列表 -->
    <section class="mid-panel">
      <!-- Tab 栏：页面内主导航主轴 -->
      <div class="tab-bar">
        <div class="tabs">
          <button
            v-for="t in statusTabs"
            :key="t.key"
            class="pill"
            :class="{
              active: activeTab === t.key,
              all: t.key === '', plan: t.key === 'plan', holding: t.key === 'holding',
              pending: t.key === 'pending', done: t.key === 'done',
              urgent: t.key === 'pending' && t.count > 0 && activeTab !== 'pending',
              breathing: t.key === 'pending' && pendingUrgent,
            }"
            :title="tabHint(t.key)"
            @click="switchTab(t.key)"
          >
            <span class="pill-dot" :style="{ background: t.key === '' && activeTab === '' ? '#fff' : t.color }"></span>
            <span class="pill-label">{{ t.label }}</span>
            <span class="pill-count mono" :class="{ zero: t.count === 0, flash: flashKey === t.key }">{{ t.count }}</span>
          </button>
        </div>
        <!-- 待复盘 urgency 提醒点 -->
        <span
          v-if="counts.pending > 0 && activeTab !== 'pending'"
          class="remind-dot"
          :title="'有 ' + counts.pending + ' 条记录待复盘'"
        ></span>
        <button class="aw-btn aw-btn-primary new-btn" @click="openNewPlan"><el-icon><Plus /></el-icon>新建</button>
      </div>

      <!-- 已选条件标签条：Tab 栏下方、记录列表上方 -->
      <div v-if="activeFilterTags.length" class="sel-tags">
        <span v-for="t in activeFilterTags" :key="t.key" class="sel-tag">
          {{ t.label }} <span class="sel-x" @click="removeFilter(t.key)">×</span>
        </span>
        <button class="aw-btn aw-btn-text clear-all" @click="clearFilters">清除全部</button>
      </div>

      <!-- 批量操作条 -->
      <div v-if="selected.length" class="batch-bar">
        <span class="dim">已选 {{ selected.length }} 条</span>
        <button class="aw-btn aw-btn-secondary" @click="batchTagVisible = true">打标签</button>
        <button class="aw-btn aw-btn-text" @click="clearSelected">取消</button>
      </div>

      <!-- 当前 Tab 对应的记录列表（Tab 切换动画） -->
      <Transition name="tab-switch" mode="out-in">
        <div :key="activeTab" class="list-area">
          <div
            v-for="r in visibleList"
            :key="r.id"
            class="log-card"
            :class="{ active: detail?.id === r.id, [STATUS_META[stOf(r)].cls]: true }"
            :style="{ border: STATUS_META[stOf(r)].border }"
            @click="selectRecord(r)"
          >
            <span class="log-bar" :style="{ background: STATUS_META[stOf(r)].color }"></span>
            <span class="log-check" @click.stop="toggleSelect(r.id)">
              <span class="cb" :class="{ checked: selected.includes(r.id) }"></span>
            </span>
            <div class="log-main">
              <div class="log-row1">
                <span class="dim mono">{{ fmtTime(cardTime(r)) }}</span>
                <b class="log-sym">{{ r.symbol }}</b>
                <span class="dir-tag" :class="r.direction === 'LONG' ? 'long' : 'short'">{{ dirLabel(r.direction) }}</span>
                <span class="aw-status" :class="STATUS_META[stOf(r)].cls"><span class="dot"></span>{{ STATUS_META[stOf(r)].label }}</span>
                <span class="src-tag">{{ sourceTagOf(r) }}</span>
              </div>

              <!-- 计划中 -->
              <template v-if="stOf(r) === 'plan'">
                <div class="log-row2 mono">
                  <span>计划 {{ r.plannedSize ?? '—' }}<template v-if="(r.leverage ?? 0) > 1"> · {{ r.leverage }}x</template> · 触发 {{ r.triggerDesc || '—' }}</span>
                </div>
                <div class="log-row3 mono dim">
                  入场 {{ fmtPrice(r.plannedEntry) }} · 止损 {{ fmtPrice(r.plannedStop) }} · 止盈 {{ (r.plannedTargets ?? []).map(fmtPrice).join(' / ') || '—' }}
                </div>
              </template>

              <!-- 持仓中 -->
              <template v-else-if="stOf(r) === 'holding'">
                <div class="log-row2 mono">
                  <span>开仓 {{ fmtPrice(r.actualEntry) }} → 现价 {{ fmtPrice(livePrice(r.symbol)) }}</span>
                  <span class="log-pnl holding" :class="{ 'pnl-flash': flashPnl[r.id] }">浮盈/亏 {{ fmtPnl(floatPnl(r)) }}</span>
                </div>
                <div class="log-row3 mono dim">
                  持仓 {{ fmtDuration(holdingDuration(r)) }} · {{ r.strategyName || r.tradeNo || '无关联计划' }} · 止损 {{ fmtPrice(r.plannedStop) }}
                </div>
              </template>

              <!-- 待复盘 -->
              <template v-else-if="stOf(r) === 'pending'">
                <div class="log-row2 mono">
                  <span>平仓 {{ fmtPrice(r.actualExit) }}</span>
                  <span class="log-pnl" :class="(r.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(r.netPnl) }}</span>
                </div>
                <div class="log-row3 mono dim">
                  平仓于 {{ fmtTime(r.closeTime) }} · 持仓 {{ fmtDuration(holdingDuration(r)) }} · {{ pendingHint(r) }}
                </div>
              </template>

              <!-- 已复盘 -->
              <template v-else>
                <div class="log-row2 mono">
                  <span>盈亏 {{ fmtPnl(r.netPnl) }}</span>
                  <span class="log-pnl" :class="(r.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ reviewScore(r) }}</span>
                </div>
                <div class="log-row3 mono dim">
                  策略 {{ r.strategyVersion || '—' }} · 复盘于 {{ fmtTime(r.closeTime ?? r.updatedAt) }}
                </div>
              </template>
            </div>

            <div class="log-actions" @click.stop>
              <template v-if="stOf(r) === 'plan'">
                <button class="aw-btn aw-btn-text" @click="execRecord(r)">执行</button>
                <button class="aw-btn aw-btn-text" @click="openEdit(r)">编辑</button>
                <button class="aw-btn aw-btn-text danger" @click="removeRecord(r)">删除</button>
              </template>
              <template v-else-if="stOf(r) === 'holding'">
                <button class="aw-btn aw-btn-text" @click="closeRecord(r)">平仓</button>
                <button class="aw-btn aw-btn-text" @click="selectRecord(r)">查看详情</button>
              </template>
              <template v-else-if="stOf(r) === 'pending'">
                <button class="aw-btn aw-btn-text" @click="openReview(r)">补记</button>
                <button class="aw-btn aw-btn-text" @click="quickReview(r)">快速复盘</button>
              </template>
              <template v-else>
                <button class="aw-btn aw-btn-text" @click="selectRecord(r)">查看复盘报告</button>
                <button class="aw-btn aw-btn-text" @click="toStrategy(r)">加入策略分析</button>
              </template>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-if="!visibleList.length" class="empty-state">
            <template v-if="activeTab === 'plan'">暂无交易计划，<a class="link" @click="openNewPlan">去新建计划 →</a></template>
            <template v-else-if="activeTab === 'holding'">当前无持仓</template>
            <template v-else-if="activeTab === 'pending'">暂无待复盘记录，保持好节奏</template>
            <template v-else-if="activeTab === 'done'">暂无已复盘记录</template>
            <template v-else>无匹配记录</template>
          </div>
        </div>
      </Transition>
    </section>

    <!-- 右栏：详情/编辑面板 360px -->
    <aside class="right-panel">
      <!-- 未选中：按当前 Tab 显示引导 -->
      <div v-if="!detail" class="rp-guide">
        <!-- 全部：今日流转迷你图 + 状态分布环形图 -->
        <template v-if="activeTab === ''">
          <div class="rp-guide-title">交易日志</div>
          <div class="rp-guide-desc dim">选择一条记录查看详情，或按状态快速操作</div>
          <div class="today-flow">
            <div class="tf-item"><b class="mono">{{ todayFlow.plan }}</b><span>计划</span></div>
            <span class="tf-arrow">→</span>
            <div class="tf-item"><b class="mono">{{ todayFlow.holding }}</b><span>持仓</span></div>
            <span class="tf-arrow">→</span>
            <div class="tf-item"><b class="mono">{{ todayFlow.pending }}</b><span>待复盘</span></div>
            <span class="tf-arrow">→</span>
            <div class="tf-item"><b class="mono">{{ todayFlow.done }}</b><span>已复盘</span></div>
          </div>
          <div class="tf-caption dim">今日流转</div>
          <div ref="ringChart" class="ring-chart"></div>
          <div class="ring-legend">
            <div v-for="s in STATUS_ORDER" :key="s" class="rl-item">
              <span class="rl-dot" :style="{ background: STATUS_META[s].color }"></span>
              <span>{{ STATUS_META[s].label }}</span>
              <b class="mono">{{ counts[s] }}</b>
            </div>
          </div>
        </template>

        <!-- 计划中：计划待执行提示 + 今日计划摘要 -->
        <template v-else-if="activeTab === 'plan'">
          <div class="rp-guide-title">计划待执行</div>
          <div class="rp-guide-desc dim">共 {{ counts.plan }} 条计划待执行，筛选条件在当前状态内进一步过滤</div>
          <div class="guide-card">
            <div class="gc-row"><span>今日新建</span><b class="mono">{{ todayPlanCount }} 条</b></div>
            <div class="gc-row"><span>最早创建</span><b class="mono dim">{{ earliestPlanTime }}</b></div>
            <div class="gc-row"><span>平均风险金额</span><b class="mono">{{ avgPlanRisk }}</b></div>
          </div>
          <button class="aw-btn aw-btn-secondary full" @click="openNewPlan">去新建计划 →</button>
        </template>

        <!-- 持仓中：持仓总览 -->
        <template v-else-if="activeTab === 'holding'">
          <div class="rp-guide-title">持仓总览</div>
          <div class="rp-guide-desc dim">共 {{ counts.holding }} 笔持仓，浮盈亏实时刷新</div>
          <div class="guide-card">
            <div class="gc-row"><span>持仓品种</span><b class="mono">{{ holdingDist.length }}</b></div>
            <div class="gc-row"><span>总浮盈亏</span><b class="mono" :class="(holdingTotalPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(holdingTotalPnl) }}</b></div>
          </div>
          <div class="pos-dist">
            <div v-for="p in holdingDist" :key="p.symbol" class="pd-item">
              <span class="pd-sym">{{ p.symbol }}</span><span class="pd-n mono">{{ p.count }} 笔</span>
            </div>
          </div>
        </template>

        <!-- 待复盘：补记引导（核心工作 Tab） -->
        <template v-else-if="activeTab === 'pending'">
          <div class="rp-guide-title">补记引导</div>
          <div class="rp-guide-desc">
            有 <b class="mono accent">{{ counts.pending }}</b> 条记录待复盘，开始补记 →
          </div>
          <button class="aw-btn aw-btn-primary full" @click="startFirstPending">开始补记</button>
          <button class="aw-btn aw-btn-secondary full" style="margin-top: 8px" @click="startFirstReview">快速复盘</button>
        </template>

        <!-- 已复盘：复盘统计 -->
        <template v-else>
          <div class="rp-guide-title">复盘统计</div>
          <div class="rp-guide-desc dim">保持节奏，及时沉淀每一笔交易</div>
          <div class="guide-card">
            <div class="gc-row"><span>本周复盘</span><b class="mono">{{ doneStats.weekCount }} 条</b></div>
            <div class="gc-row"><span>平均评分</span><b class="mono">{{ doneStats.avg !== undefined ? doneStats.avg.toFixed(1) + ' / 10' : '—' }}</b></div>
            <div class="gc-row"><span>累计复盘</span><b class="mono">{{ doneStats.total }} 条</b></div>
          </div>
        </template>
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
              <el-descriptions-item label="触发条件">{{ detail.triggerDesc || '—' }}</el-descriptions-item>
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
              <el-descriptions-item label="当前价"><span class="mono">{{ fmtPrice(livePrice(detail.symbol)) }}</span></el-descriptions-item>
              <el-descriptions-item label="数量">{{ detail.actualQty ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="杠杆">{{ detail.leverage ?? '—' }}x</el-descriptions-item>
              <el-descriptions-item label="开仓时间">{{ fmtFullTime(detail.openTime) }}</el-descriptions-item>
              <el-descriptions-item label="持仓时长">{{ fmtDuration(holdingDuration(detail)) }}</el-descriptions-item>
              <el-descriptions-item label="当前浮盈/亏"><span class="mono" :class="(floatPnl(detail) ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPnl(floatPnl(detail)) }}</span></el-descriptions-item>
              <el-descriptions-item label="止损/止盈">{{ fmtPrice(detail.plannedStop) }} / {{ (detail.plannedTargets ?? []).map(fmtPrice).join('、') || '—' }}</el-descriptions-item>
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
              <el-form-item label="来源标签（必选）">
                <div class="seg2">
                  <button v-for="s in SOURCE_TAGS" :key="s" class="s2" :class="{ active: review.source === s }" @click="review.source = s">{{ s }}</button>
                </div>
              </el-form-item>
              <template v-if="review.source === '无计划'">
                <el-form-item label="为什么没有按计划执行？（强制归因）">
                  <el-select v-model="review.noPlanReasons" multiple filterable allow-create collapse-tags placeholder="选择原因" style="width: 100%">
                    <el-option v-for="o in NO_PLAN_REASONS" :key="o" :value="o" :label="o" />
                  </el-select>
                  <el-input v-model="review.noPlanReasonCustom" size="small" placeholder="自定义原因（可选）" style="margin-top: 6px" />
                </el-form-item>
              </template>
              <el-form-item label="自定义标签">
                <el-select v-model="review.tags" multiple filterable allow-create collapse-tags placeholder="如 趋势跟踪 / 逆势抄底" style="width: 100%">
                  <el-option v-for="t in CUSTOM_TAG_OPTIONS" :key="t" :value="t" :label="t" />
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
              <el-descriptions-item label="复盘评分">{{ reviewScore(detail) }}</el-descriptions-item>
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
          <el-form-item label="杠杆"><el-input-number v-model="form.leverage" :min="1" :precision="0" controls-position="right" style="width: 100%" /></el-form-item>
          <el-form-item label="计划开仓价"><el-input-number v-model="form.plannedEntry" :precision="4" controls-position="right" style="width: 100%" /></el-form-item>
          <el-form-item label="预期执行时间"><el-date-picker v-model="form.plannedAt" type="datetime" value-format="x" style="width: 100%" /></el-form-item>
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
          <el-form-item label="触发条件"><el-input v-model="form.triggerDesc" type="textarea" :rows="2" placeholder="如：BTC 站稳 71500 且放量突破时入场" /></el-form-item>
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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.ts';
import { accountStore, loadAccounts } from '../store.ts';
import type { TradeJournal } from '../lib/journal.ts';
import {
  STATUS_META, STATUS_ORDER, deriveStatus, fmtPnl, fmtNum, fmtPrice, fmtTime, fmtFullTime,
  dirLabel, pendingHint, holdingDuration, fmtDuration, type JournalStatus,
} from '../lib/journal.ts';

const TAG_OPTIONS = ['情绪化交易', '执行错误', '系统缺陷', '正常亏损', '正常盈利', '运气成分', '历史导入', '趋势跟踪', '逆势抄底'];
// 核心标签组：交易来源（系统预设，不可删除）——空心边框样式；自定义标签——常规样式
const SOURCE_TAGS = ['计划执行', '无计划', '策略信号', '历史导入'];
// 「无计划」强制归因选项
const NO_PLAN_REASONS = ['忘记计划', '临时起意', '情绪冲动', '系统/行情突变', '其他'];
const CUSTOM_TAG_OPTIONS = TAG_OPTIONS.filter((t) => !SOURCE_TAGS.includes(t));
/** 从记录提取来源标签：命中预设 → 有计划字段 → 计划执行；否则无计划 */
function sourceTagOf(r: Pick<TradeJournal, 'tags' | 'plannedEntry' | 'plannedStop' | 'plannedTargets'>): string {
  const hit = (r.tags ?? []).find((t) => SOURCE_TAGS.includes(t));
  if (hit) return hit;
  const hasPlan = !!(r.plannedEntry || r.plannedStop || (r.plannedTargets?.length ?? 0) > 0);
  return hasPlan ? '计划执行' : '无计划';
}
const MARKET_OPTIONS = ['现货', 'U本位合约', '币本位合约', '全仓杠杆', '逐仓杠杆'];
const HOLDING_OPTIONS = ['日内', '波段', '趋势'];
const REASON_OPTIONS = ['突破', '回调', '止损', '止盈', '情绪', '其他'];
const EMOTION_OPTIONS = ['冷静', '贪婪', '恐惧', '犹豫'];
const ATTRIBUTION_OPTIONS = ['技术', '运气', '计划执行', '情绪'];

/** 中文市场名 → 行情 API 的 Market 枚举 */
const MARKET_TO_ENUM: Record<string, string> = {
  '现货': 'SPOT', 'U本位合约': 'USDT_M', '币本位合约': 'COIN_M', '全仓杠杆': 'MARGIN', '逐仓杠杆': 'MARGIN_ISOLATED',
};
const TAB_HINT: Record<string, string> = { '': '1', plan: '2', holding: '3', pending: '4', done: '5' };

const route = useRoute();
const router = useRouter();

const all = ref<TradeJournal[]>([]);
const detail = ref<TradeJournal | null>(null);
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

/** 实时价格（持仓标的轮询） */
const livePrices = ref<Record<string, number>>({});
/** 角标数字闪烁 */
const flashKey = ref<string | null>(null);
const flashPnl = reactive<Record<string, boolean>>({});
let flashTimer: number | undefined;
let pnlFlashTimer: number | undefined;
let tickerTimer: number | undefined;
let reloadTimer: number | undefined;
let reloading = false;

const f = reactive<{
  range: [number, number] | null;
  symbol: string;
  direction: string;
  result: string;
  strategy: string;
  tags: string[];
  planExec: string;
  imported: '' | boolean;
}>({ range: null, symbol: '', direction: '', result: '', strategy: '', tags: [], planExec: '', imported: '' });

const review = reactive<{
  entryReasonSel: string[]; entryReason: string; emotion: string; confidence: number;
  discipline: number; tags: string[]; source: string; noPlanReasons: string[]; noPlanReasonCustom: string;
  entryQuality: number; entryQualityNote: string;
  exitQuality: number; exitQualityNote: string; attribution: string[]; improvements: string;
  adjust: boolean | null; adjustStrategy: string; adjustDirection: string;
}>({ entryReasonSel: [], entryReason: '', emotion: '冷静', confidence: 5, discipline: 5, tags: [], source: '无计划', noPlanReasons: [], noPlanReasonCustom: '', entryQuality: 5, entryQualityNote: '', exitQuality: 5, exitQualityNote: '', attribution: [], improvements: '', adjust: null, adjustStrategy: '', adjustDirection: '' });

const form = reactive<Record<string, any>>({
  symbol: '', direction: 'LONG', market: '现货', leverage: 1, plannedEntry: undefined, plannedAt: undefined,
  plannedStop: undefined, targetsText: '', plannedSize: '', plannedRiskAmount: undefined, plannedHolding: '日内',
  strategyName: '', strategyVersion: '', triggerDesc: '', invalidation: '', entryReason: '', accountId: '',
});

// ---------------- Tab 导航（页面内主导航） ----------------

function tabFromQuery(q: string | null): '' | JournalStatus {
  if (q === 'plan' || q === 'holding' || q === 'pending' || q === 'done') return q;
  return '';
}
const activeTab = ref<'' | JournalStatus>(tabFromQuery(typeof route.query.tab === 'string' ? route.query.tab : null));

function tabHint(key: '' | JournalStatus): string {
  const n = TAB_HINT[key];
  return n ? (key === '' ? '全部（快捷键 ' + n + '）' : STATUS_META[key].label + '（快捷键 ' + n + '）') : '';
}

function switchTab(key: '' | JournalStatus) {
  if (activeTab.value === key) return;
  activeTab.value = key;
  detail.value = null;
  router.replace({ query: { ...route.query, tab: key === '' ? 'all' : key } });
}

watch(() => route.query.tab, (q) => {
  const k = tabFromQuery(typeof q === 'string' ? q : null);
  if (k !== activeTab.value) { activeTab.value = k; detail.value = null; }
});

function onKeydown(e: KeyboardEvent) {
  if (fullFormVisible.value || batchTagVisible.value) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const map: Record<string, '' | JournalStatus> = { '1': '', '2': 'plan', '3': 'holding', '4': 'pending', '5': 'done' };
  const k = map[e.key];
  if (k !== undefined) switchTab(k);
}

// ---------------- 派生数据 ----------------

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

/** 当前 Tab 展示的列表：Tab 过滤 + 各自排序 */
const visibleList = computed(() => {
  let out = filtered.value;
  if (activeTab.value) out = out.filter((r) => deriveStatus(r) === activeTab.value);
  const t = activeTab.value;
  if (t === 'pending') return [...out].sort((a, b) => Math.abs(b.netPnl ?? 0) - Math.abs(a.netPnl ?? 0));
  if (t === 'holding') return [...out].sort((a, b) => (b.openTime ?? b.createdAt ?? 0) - (a.openTime ?? a.createdAt ?? 0));
  if (t === 'done') return [...out].sort((a, b) => (b.closeTime ?? b.updatedAt ?? 0) - (a.closeTime ?? a.updatedAt ?? 0));
  if (t === 'plan') return [...out].sort((a, b) => ((b as any).plannedAt ?? b.createdAt ?? 0) - ((a as any).plannedAt ?? a.createdAt ?? 0));
  // 全部：按时间倒序
  return [...out].sort((a, b) => (cardTime(b) ?? 0) - (cardTime(a) ?? 0));
});

const pendingRecords = computed(() =>
  [...filtered.value.filter((r) => deriveStatus(r) === 'pending')].sort((a, b) => Math.abs(b.netPnl ?? 0) - Math.abs(a.netPnl ?? 0)),
);

const activeFilterTags = computed(() => {
  const t: { key: string; label: string }[] = [];
  if (f.range?.[0]) t.push({ key: 'range', label: '时间范围' });
  if (f.symbol) t.push({ key: 'symbol', label: '品种：' + f.symbol });
  if (f.direction) t.push({ key: 'direction', label: '方向：' + (f.direction === 'LONG' ? '做多' : '做空') });
  if (f.result) t.push({ key: 'result', label: '结果：' + (f.result === 'win' ? '盈利' : '亏损') });
  if (f.strategy) t.push({ key: 'strategy', label: '策略：' + f.strategy });
  for (const tag of f.tags) t.push({ key: 'tag:' + tag, label: '标签：' + tag });
  if (f.planExec) t.push({ key: 'planExec', label: '符合度：' + (f.planExec === 'complete' ? '完全执行' : f.planExec === 'partial' ? '部分执行' : '未执行') });
  if (f.imported !== '') t.push({ key: 'imported', label: '来源：' + (f.imported === true ? '历史导入' : '手动记录') });
  return t;
});

function removeFilter(key: string) {
  if (key === 'range') f.range = null;
  else if (key === 'symbol') f.symbol = '';
  else if (key === 'direction') f.direction = '';
  else if (key === 'result') f.result = '';
  else if (key === 'strategy') f.strategy = '';
  else if (key.startsWith('tag:')) f.tags = f.tags.filter((t) => t !== key.slice(4));
  else if (key === 'planExec') f.planExec = '';
  else if (key === 'imported') f.imported = '';
}

function clearFilters() {
  Object.assign(f, { range: null, symbol: '', direction: '', result: '', strategy: '', tags: [], planExec: '', imported: '' });
}
function applyFilter() {}

const strategyOptions = computed(() => [...new Set(all.value.map((r) => r.strategyVersion).filter(Boolean))] as string[]);
const strategyNameOptions = computed(() => [...new Set(all.value.map((r) => r.strategyName).filter(Boolean))] as string[]);

const detailStatus = computed<JournalStatus>(() => (detail.value ? deriveStatus(detail.value) : 'plan'));

// ---------------- 实时行情 / 浮盈亏 ----------------

function livePrice(sym: string): number | undefined { return livePrices.value[sym]; }

function floatPnl(r: TradeJournal): number | undefined {
  const p = livePrices.value[r.symbol];
  if (p !== undefined && r.actualEntry !== undefined && Number.isFinite(r.actualEntry) && (r.actualQty ?? 0) > 0) {
    const qty = r.actualQty as number;
    return (p - r.actualEntry) * qty * (r.direction === 'SHORT' ? -1 : 1);
  }
  return r.netPnl;
}

const holdingPnlMap = computed(() => {
  const m = new Map<string, number>();
  for (const r of all.value) {
    if (deriveStatus(r) === 'holding') { const p = floatPnl(r); if (p !== undefined) m.set(r.id, p); }
  }
  return m;
});

const holdingDist = computed(() => {
  const m = new Map<string, number>();
  for (const r of all.value) if (deriveStatus(r) === 'holding') m.set(r.symbol, (m.get(r.symbol) ?? 0) + 1);
  return [...m.entries()].map(([symbol, count]) => ({ symbol, count }));
});

const holdingTotalPnl = computed(() => {
  let sum = 0; let any = false;
  for (const r of all.value) {
    if (deriveStatus(r) === 'holding') { const p = floatPnl(r); if (p !== undefined) { sum += p; any = true; } }
  }
  return any ? sum : undefined;
});

async function refreshTickers() {
  const holding = all.value.filter((r) => deriveStatus(r) === 'holding');
  const symbols = [...new Set(holding.map((r) => r.symbol))];
  if (!symbols.length) { if (Object.keys(livePrices.value).length) livePrices.value = {}; return; }
  const markets = [...new Set(holding.map((r) => MARKET_TO_ENUM[r.market ?? ''] ?? 'USDT_M'))];
  const results = await Promise.all(markets.map((m) =>
    api.get<{ tickers: { symbol: string; lastPrice: number }[] }>('/market/tickers?market=' + encodeURIComponent(m)).catch(() => null),
  ));
  const map: Record<string, number> = {};
  for (const res of results) if (res) for (const t of res.tickers) if (symbols.includes(t.symbol)) map[t.symbol] = t.lastPrice;
  livePrices.value = map;
}

// ---------------- 右侧面板引导统计 ----------------

function dayStart(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function weekStart(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7; // 周一=1 … 周日=7
  d.setDate(d.getDate() - (day - 1));
  return d.getTime();
}

const todayFlow = computed(() => {
  const t = dayStart();
  const s = { plan: 0, holding: 0, pending: 0, done: 0 };
  for (const r of all.value) {
    const st = deriveStatus(r);
    if (st === 'plan' && (r.createdAt ?? 0) >= t) s.plan++;
    else if (st === 'holding' && (r.openTime ?? 0) >= t) s.holding++;
    else if (st === 'pending' && (r.closeTime ?? 0) >= t) s.pending++;
    else if (st === 'done' && (r.closeTime ?? 0) >= t) s.done++;
  }
  return s;
});

const todayPlanCount = computed(() => {
  const t = dayStart();
  return all.value.filter((r) => deriveStatus(r) === 'plan' && (r.createdAt ?? 0) >= t).length;
});

const earliestPlanTime = computed(() => {
  const plans = all.value.filter((r) => deriveStatus(r) === 'plan');
  const ts = plans.reduce((m, r) => Math.min(m, r.createdAt ?? Infinity), Infinity);
  return Number.isFinite(ts) ? fmtTime(ts) : '—';
});

const avgPlanRisk = computed(() => {
  const plans = all.value.filter((r) => deriveStatus(r) === 'plan');
  const rs = plans.map((r) => r.plannedRiskAmount).filter((n): n is number => n !== undefined && Number.isFinite(n));
  if (!rs.length) return '—';
  return fmtNum(rs.reduce((a, b) => a + b, 0) / rs.length);
});

const doneStats = computed(() => {
  const ws = weekStart();
  const done = all.value.filter((r) => deriveStatus(r) === 'done');
  const weekCount = done.filter((r) => (r.closeTime ?? r.updatedAt ?? 0) >= ws).length;
  const scores = done.map((r) => scoreNum(r)).filter((n): n is number => n !== undefined);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
  return { weekCount, avg, total: done.length };
});

/** 待复盘超 24 小时未处理 → 呼吸红 */
const pendingUrgent = computed(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return all.value.some((r) => deriveStatus(r) === 'pending' && (r.closeTime ?? 0) > 0 && (r.closeTime as number) < cutoff);
});

// ---------------- 记录工具 ----------------

function stOf(r: TradeJournal): JournalStatus { return deriveStatus(r); }

function cardTime(r: TradeJournal): number | undefined {
  const st = deriveStatus(r);
  if (st === 'plan') return (r as any).plannedAt ?? r.createdAt;
  if (st === 'done') return r.closeTime ?? r.updatedAt ?? r.createdAt;
  if (st === 'holding') return r.openTime ?? r.createdAt;
  return r.closeTime ?? r.createdAt;
}

function scoreNum(r: TradeJournal): number | undefined {
  const q = r.entryQuality; const x = r.exitQuality;
  if (q !== undefined && x !== undefined) return (q + x) / 2;
  return q ?? x ?? r.disciplineScore;
}

function reviewScore(r: TradeJournal): string {
  const base = scoreNum(r);
  return base !== undefined ? '评分 ' + base.toFixed(1) + '/10' : '—';
}

// ---------------- 交互 ----------------

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
    source: sourceTagOf(r),
    tags: [...(r.tags ?? [])].filter((t) => !SOURCE_TAGS.includes(t)),
    noPlanReasons: ((r as any).deviationReason ? String((r as any).deviationReason).split(/[、,，]/).map((s: string) => s.trim()).filter(Boolean) : []),
    noPlanReasonCustom: '',
    entryQuality: r.entryQuality ?? 5,
    entryQualityNote: (r as any).entryQualityNote ?? '',
    exitQuality: (r as any).exitQuality ?? 5,
    exitQualityNote: (r as any).exitQualityNote ?? '',
    attribution: ((r as any).attributionArr ?? (r.attribution ? [r.attribution] : [])),
    improvements: r.improvements ?? '',
    adjust: null, adjustStrategy: '', adjustDirection: '',
  });
}

function openReview(r: TradeJournal) { selectRecord(r); reviewTab.value = 'log'; }
function quickReview(r: TradeJournal) { selectRecord(r); reviewTab.value = 'review'; }

function startFirstPending() {
  const first = pendingRecords.value[0];
  if (!first) { ElMessage.info('暂无待复盘记录'); return; }
  selectRecord(first); reviewTab.value = 'log';
}
function startFirstReview() {
  const first = pendingRecords.value[0];
  if (!first) { ElMessage.info('暂无待复盘记录'); return; }
  selectRecord(first); reviewTab.value = 'review';
}

async function loadAll() {
  await loadAccounts();
  const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => ({ records: [] }));
  all.value = j.records;
  const q = route.query;
  if (q.search) { f.symbol = String(q.search); }
  // 仪表盘/今日动态跳转：sel=ID 选中并高亮该记录
  if (q.sel) {
    const target = all.value.find((r) => r.id === String(q.sel));
    if (target) selectRecord(target);
  }
  // 仪表盘计划卡片「编辑」：edit=ID 打开编辑表单
  if (q.edit) {
    const target = all.value.find((r) => r.id === String(q.edit));
    if (target) openEdit(target);
  }
  renderRing();
}

async function silentReload() {
  if (reloading) return;
  reloading = true;
  try {
    const j = await api.get<{ records: TradeJournal[] }>('/journal/trades?limit=1000').catch(() => null);
    if (j) {
      all.value = j.records;
      if (detail.value) detail.value = all.value.find((r) => r.id === detail.value!.id) ?? null;
      refreshTickers();
    }
  } finally { reloading = false; }
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
  const noPlan = [...review.noPlanReasons];
  if (review.noPlanReasonCustom) noPlan.push(review.noPlanReasonCustom);
  const patch = {
    entryReason: reason || undefined,
    emotionScore: EMOTION_OPTIONS.indexOf(review.emotion) * 3 + 2,
    confidenceScore: review.confidence,
    disciplineScore: review.discipline,
    deviationReason: review.source === '无计划' && noPlan.length ? noPlan.join('、') : undefined,
    tags: [...new Set([...(detail.value.tags ?? []).filter((t) => !SOURCE_TAGS.includes(t)), review.source, ...review.tags])],
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
  const noPlan = [...review.noPlanReasons];
  if (review.noPlanReasonCustom) noPlan.push(review.noPlanReasonCustom);
  if (review.source === '无计划' && noPlan.length) patch.deviationReason = noPlan.join('、');
  patch.tags = [...new Set([...(detail.value.tags ?? []).filter((t) => !SOURCE_TAGS.includes(t)), review.source, ...review.tags])];
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

function openNewPlan() {
  Object.assign(form, { symbol: '', direction: 'LONG', market: '现货', leverage: 1, plannedEntry: undefined, plannedAt: Date.now() + 3600_000, plannedStop: undefined, targetsText: '', plannedSize: '', plannedRiskAmount: undefined, plannedHolding: '日内', strategyName: '', strategyVersion: '', triggerDesc: '', invalidation: '', entryReason: '', accountId: accountStore.selectedId || '' });
  editingId.value = '';
  fullFormVisible.value = true;
}

function openEdit(r: TradeJournal) {
  editingId.value = r.id;
  Object.assign(form, {
    symbol: r.symbol, direction: r.direction, market: r.market ?? '现货', leverage: r.leverage ?? 1,
    plannedEntry: r.plannedEntry, plannedAt: (r as any).plannedAt ?? r.createdAt, plannedStop: r.plannedStop,
    targetsText: (r.plannedTargets ?? []).join(', '),
    plannedSize: r.plannedSize ?? '', plannedRiskAmount: r.plannedRiskAmount,
    plannedHolding: r.plannedHolding ?? '日内', strategyName: r.strategyName ?? '',
    strategyVersion: r.strategyVersion ?? '', triggerDesc: (r as any).triggerDesc ?? r.entryReason ?? '',
    invalidation: r.invalidation ?? '', entryReason: r.entryReason ?? '', accountId: r.accountId ?? (accountStore.selectedId || ''),
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
      leverage: form.leverage,
      plannedEntry: form.plannedEntry,
      plannedAt: form.plannedAt,
      plannedStop: form.plannedStop,
      plannedTargets: targets,
      plannedSize: form.plannedSize || undefined,
      plannedRiskAmount: form.plannedRiskAmount,
      plannedHolding: form.plannedHolding,
      strategyName: form.strategyName || undefined,
      strategyVersion: form.strategyVersion || undefined,
      triggerDesc: form.triggerDesc || undefined,
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

// ---------------- 环形图 ----------------

function ensureRing(): boolean {
  if (!ringChart.value) return false;
  if (ringE && !ringE.getDom().isConnected) { try { ringE.dispose(); } catch { /* ignore */ } ringE = null; }
  if (!ringE) ringE = echarts.init(ringChart.value);
  return true;
}

function renderRing() {
  if (!ensureRing()) return;
  ringE!.resize();
  const c = counts.value;
  ringE!.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [{
      type: 'pie', radius: ['55%', '75%'], center: ['50%', '50%'],
      label: { show: false },
      data: STATUS_ORDER.map((s) => ({ name: STATUS_META[s].label, value: c[s], itemStyle: { color: STATUS_META[s].color } })),
    }],
  });
}

function onResize() {
  if (ringE && ringE.getDom().isConnected) ringE.resize();
}

// ---------------- 数字闪烁 ----------------

watch(counts, (c, prev) => {
  if (!prev) return;
  const changed = STATUS_ORDER.find((s) => c[s] !== prev[s]);
  if (changed) {
    flashKey.value = changed;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { flashKey.value = null; }, 400);
  }
});

watch(holdingPnlMap, (m, prev) => {
  if (!prev) return;
  let any = false;
  for (const [id, v] of m) {
    const p = prev.get(id);
    if (p !== undefined && p !== v) { flashPnl[id] = true; any = true; }
  }
  if (any) {
    clearTimeout(pnlFlashTimer);
    pnlFlashTimer = window.setTimeout(() => {
      for (const k of Object.keys(flashPnl)) delete flashPnl[k];
    }, 400);
  }
});

// ---------------- 生命周期 ----------------

watch(() => accountStore.selectedId, () => loadAll());

// 已在日志页时通过 URL 参数触发（组件不会重新挂载，需 watch）
watch(() => route.query.new, (v) => {
  if (v) {
    openNewPlan();
    const q = { ...route.query };
    delete q.new;
    router.replace({ query: q });
  }
});

watch(() => route.query.id, (v) => {
  if (v && typeof v === 'string') {
    const found = all.value.find((r) => r.id === v);
    if (found) selectRecord(found);
  }
});

watch(activeTab, async (tab) => {
  if (tab === '') { await nextTick(); renderRing(); }
});

watch(detail, async () => {
  await nextTick();
  if (!detail.value && activeTab.value === '') renderRing();
});

onMounted(async () => {
  await loadAll();
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeydown);
  refreshTickers();
  tickerTimer = window.setInterval(refreshTickers, 15_000);
  reloadTimer = window.setInterval(silentReload, 60_000);
  const q = route.query;
  if (q.new) openNewPlan();
  if (q.id) {
    const found = all.value.find((r) => r.id === q.id);
    if (found) selectRecord(found);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKeydown);
  clearInterval(tickerTimer);
  clearInterval(reloadTimer);
  clearTimeout(flashTimer);
  clearTimeout(pnlFlashTimer);
  ringE?.dispose();
  ringE = null;
});
</script>

<style scoped>
.journal { display: grid; grid-template-columns: 200px 1fr 360px; gap: 12px; align-items: start; }
@media (max-width: 1280px) { .journal { grid-template-columns: 200px 1fr; } .right-panel { grid-column: 1 / -1; } }

/* ---------- 左栏 ---------- */
.left-panel { background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; padding: 14px; position: sticky; top: 0; }
.lp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.lp-head b { font-size: 13px; color: var(--aw-text-title); }
.lp-filters { display: flex; flex-direction: column; gap: 4px; }
.lp-label { font-size: 11px; color: var(--aw-text-dim); margin-top: 8px; }

/* ---------- 中栏：Tab 导航 ---------- */
.mid-panel { min-width: 0; }
.tab-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tabs { display: flex; gap: 8px; flex: 1; flex-wrap: wrap; }
.pill {
  display: inline-flex; align-items: center; gap: 8px;
  height: 32px; padding: 0 16px; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent; color: var(--aw-text-dim);
  cursor: pointer; font-size: 12px; font-family: inherit;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.pill:hover { border-color: var(--aw-border-hover); color: var(--aw-text-body); }
.pill-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.pill-label { white-space: nowrap; }
.pill-count { font-size: 12px; font-variant-numeric: tabular-nums; }
.pill-count.zero { color: #6b7280; font-weight: 400; }
.pill-count:not(.zero) { color: #f9fafb; font-weight: 700; }
.pill-count.flash { animation: aw-num-flash 400ms var(--aw-ease); }

/* 激活态：填充底色 + 轻微上浮 */
.pill.active { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); }
.pill.active.all { background: #06b6d4; border-color: #06b6d4; color: #fff; }
.pill.active.plan { background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.55); color: #f59e0b; }
.pill.active.holding { background: rgba(6, 182, 212, 0.15); border-color: rgba(6, 182, 212, 0.55); color: #06b6d4; }
.pill.active.pending { background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.55); color: #ef4444; }
.pill.active.done { background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.55); color: #10b981; }

/* 待复盘 urgency：未激活且有量 → 猩红呼吸边框 */
.pill.urgent { border-color: rgba(239, 68, 68, 0.6); animation: aw-pulse 2s infinite; }
/* 超 24 小时未复盘 → 呼吸红（含激活态） */
.pill.breathing { border-color: rgba(239, 68, 68, 0.7); animation: aw-pulse 1.8s infinite; }

.remind-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: #f59e0b;
  animation: aw-remind 1.6s infinite;
}
.new-btn { flex: none; }

/* 已选条件标签条（Tab 栏下方） */
.sel-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.sel-tag { font-size: 11px; background: var(--aw-accent-dim); color: var(--aw-accent); border-radius: 4px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 4px; }
.sel-x { cursor: pointer; font-weight: 700; }
.clear-all { height: 24px; font-size: 11px; }

.batch-bar { display: flex; align-items: center; gap: 10px; background: var(--aw-accent-dim); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 10px; padding: 6px 12px; margin-bottom: 10px; }

/* Tab 切换动画 */
.tab-switch-enter-active, .tab-switch-leave-active { transition: opacity 150ms var(--aw-ease), transform 150ms var(--aw-ease); }
.tab-switch-enter-from { opacity: 0; transform: translateY(4px); }
.tab-switch-leave-to { opacity: 0; transform: translateY(-4px); }

.list-area { display: flex; flex-direction: column; gap: 6px; }

/* 记录卡片 */
.log-card {
  position: relative; display: flex; border-radius: 10px; background: var(--aw-bg-card);
  padding: 10px 12px; cursor: pointer; transition: all var(--aw-dur-fast) var(--aw-ease); overflow: hidden;
}
.log-card:hover { border-color: var(--aw-border-hover) !important; }
.log-card.active { box-shadow: 0 0 0 1px var(--aw-accent); }
.log-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
.log-check { display: flex; align-items: center; padding: 0 8px 0 2px; }
.cb { width: 14px; height: 14px; border: 1.5px solid var(--aw-text-disabled); border-radius: 4px; display: inline-block; transition: all var(--aw-dur-fast) var(--aw-ease); flex: none; }
.cb.checked { background: var(--aw-accent); border-color: var(--aw-accent); position: relative; }
.cb.checked::after { content: '✓'; position: absolute; inset: -1px; color: #fff; font-size: 10px; display: flex; align-items: center; justify-content: center; }
.log-main { flex: 1; min-width: 0; }
.log-row1 { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.log-sym { color: var(--aw-text-title); font-size: 13px; }
.dir-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.dir-tag.long { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.dir-tag.short { background: rgba(16, 185, 129, 0.15); color: #34d399; }
.log-row2 { display: flex; justify-content: space-between; margin-top: 4px; font-size: 12px; color: var(--aw-text-body); gap: 8px; }
.log-row3 { margin-top: 2px; font-size: 11px; color: var(--aw-text-dim); }
.log-pnl { font-weight: 700; }
.log-pnl.holding { color: var(--aw-info); }
.log-pnl.pnl-flash { animation: aw-num-flash 400ms var(--aw-ease); }
.log-actions { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 2px; padding-left: 8px; }
.aw-btn-text.danger { color: var(--aw-down); }

/* 空状态 */
.empty-state {
  padding: 40px 16px; text-align: center; color: var(--aw-text-dim); font-size: 12px;
  border: 1px dashed var(--aw-border); border-radius: 10px;
}
.empty-state .link { color: var(--aw-accent); cursor: pointer; }
.empty-state .link:hover { text-decoration: underline; }

/* ---------- 右栏 ---------- */
.right-panel { background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 12px; padding: 16px; position: sticky; top: 0; max-height: calc(100vh - 100px); overflow-y: auto; }
.rp-guide-title { font-size: 15px; font-weight: 600; color: var(--aw-text-title); }
.rp-guide-desc { font-size: 12px; margin: 4px 0 12px; }
.rp-guide-desc .accent { color: var(--aw-accent); font-size: 14px; }

/* 今日流转迷你图 */
.today-flow { display: flex; align-items: center; gap: 6px; background: var(--aw-bg); border-radius: 10px; padding: 10px 12px; margin: 8px 0 2px; }
.tf-item { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; flex: 1; }
.tf-item b { font-size: 14px; color: var(--aw-text-title); }
.tf-item span { font-size: 10px; color: var(--aw-text-dim); }
.tf-arrow { color: var(--aw-text-disabled); font-size: 12px; flex: none; }
.tf-caption { font-size: 10px; color: var(--aw-text-dim); text-align: center; margin-bottom: 8px; }

/* 引导统计卡 */
.guide-card { background: var(--aw-bg); border-radius: 10px; padding: 10px 12px; margin: 8px 0; display: flex; flex-direction: column; gap: 8px; }
.gc-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--aw-text-body); gap: 8px; }
.gc-row b { color: var(--aw-text-title); }

.pos-dist { display: flex; flex-direction: column; gap: 4px; }
.pd-item { display: flex; justify-content: space-between; font-size: 12px; padding: 6px 10px; background: var(--aw-bg); border-radius: 8px; }
.pd-sym { color: var(--aw-text-title); font-family: var(--aw-mono); }
.pd-n { color: var(--aw-text-dim); }

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

/* 来源标签（空心边框）——与状态标签（实心底色）视觉区分 */
.src-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  border: 1px solid rgba(6,182,212,0.45); color: #22d3ee;
  background: transparent; flex: none;
}

/* 数字变化闪烁 */
@keyframes aw-num-flash {
  0% { color: #fff; text-shadow: 0 0 10px currentColor; }
  100% { color: inherit; text-shadow: none; }
}
@keyframes aw-remind {
  0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.45); }
  70% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
  100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}
</style>
