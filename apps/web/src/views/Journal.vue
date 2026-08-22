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
          <el-radio-button value="journal">交易日志</el-radio-button>
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
        <el-select v-model="f.stage" size="small" style="width: 100px" clearable placeholder="阶段" @change="applyFilter">
          <el-option value="plan" label="计划完成" />
          <el-option value="exec" label="执行完成" />
          <el-option value="review" label="复盘完成" />
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

    <!-- 交易日志列表 -->
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
        <el-table-column label="阶段" width="140" sortable :sort-by="(r:any) => stageScore(r)">
          <template #default="{ row }">
            <div class="stage-mini">
              <span class="sp" :class="planDoneOf(row) ? 'ok' : ''" title="交易计划">计</span>
              <span class="sp" :class="execDoneOf(row) ? 'ok' : ''" title="实际执行">执</span>
              <span class="sp" :class="reviewDoneOf(row) ? 'ok' : ''" title="复盘总结">复</span>
              <el-tag v-if="row.planExecution === 'partial'" size="small" type="warning" effect="plain">部分执行</el-tag>
              <el-tag v-else-if="row.planExecution === 'none'" size="small" type="danger" effect="plain">未执行</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="标签" min-width="120"><template #default="{ row }"><el-tag v-for="t in (row.tags ?? []).slice(0, 2)" :key="t" size="small" effect="plain" class="mr">{{ t }}</el-tag></template></el-table-column>
      </el-table>
      <el-empty v-if="!filtered.length" :description="f.accountId ? '该账户暂无交易日志，可点击「+ 新建」记录' : '暂无交易日志，可点击「+ 新建」记录'" :image-size="50" />
    </el-card>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" size="560px" :title="'交易详情 ' + (detail?.tradeNo ?? '')">
      <template v-if="detail">
        <div class="row mt-sm">
          <div class="stage-mini">
            <span class="sp" :class="planDoneOf(detail) ? 'ok' : ''" title="交易计划">计</span>
            <span class="sp" :class="execDoneOf(detail) ? 'ok' : ''" title="实际执行">执</span>
            <span class="sp" :class="reviewDoneOf(detail) ? 'ok' : ''" title="复盘总结">复</span>
          </div>
          <el-tag size="small" :type="planExecTag(detail).type" effect="plain">{{ planExecTag(detail).label }}</el-tag>
          <el-tag size="small" :type="(detail.netPnl ?? 0) >= 0 ? 'success' : 'danger'" effect="plain">{{ (detail.netPnl ?? 0) >= 0 ? '盈利' : '亏损' }}</el-tag>
          <el-tag v-if="detail.timeframe" size="small" effect="plain">{{ detail.timeframe }}</el-tag>
        </div>
        <h4>基本信息</h4>
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="品种">{{ detail.symbol }}</el-descriptions-item>
          <el-descriptions-item label="方向">{{ detail.direction === 'LONG' ? '做多' : '做空' }}</el-descriptions-item>
          <el-descriptions-item label="市场">{{ detail.market }}</el-descriptions-item>
          <el-descriptions-item label="时间框架">{{ detail.timeframe ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="策略版本">{{ detail.strategyVersion ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="账户">{{ detail.subAccount ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <h4>计划 vs 实际</h4>
        <el-table :data="planCompare" size="small" border>
          <el-table-column prop="k" label="" width="90" />
          <el-table-column prop="plan" label="计划" />
          <el-table-column prop="actual" label="实际" />
        </el-table>
        <div v-if="detail.deviationReason" class="dim mt-sm">偏差原因：{{ detail.deviationReason }}</div>
        <div v-if="detail.orderType || detail.slippage !== undefined" class="dim mt-sm">订单类型：{{ detail.orderType ?? '-' }} · 滑点：{{ detail.slippage ?? '-' }} · 持仓时长：{{ detail.holdingDuration ?? '-' }}</div>
        <h4>结果分析</h4>
        <el-descriptions :column="2" size="small">
          <el-descriptions-item label="毛盈亏">{{ detail.pnl ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="盈亏%">{{ detail.pnlPct ?? '-' }}%</el-descriptions-item>
          <el-descriptions-item label="费用">{{ detail.fees ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="净收益"><span :class="(detail.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ detail.netPnl ?? '-' }}</span></el-descriptions-item>
          <el-descriptions-item label="R 倍数">{{ detail.rMultiple ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="MFE / MAE">{{ detail.mfe ?? '-' }} / {{ detail.mae ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="归因" :span="2">{{ detail.attribution ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <h4>市场条件</h4>
        <el-descriptions :column="1" size="small">
          <el-descriptions-item label="趋势">{{ detail.marketTrend ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="波动率">{{ detail.volatility ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="量能">{{ detail.volumeLiquidity ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="支撑阻力">{{ detail.supportResistance ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="事件/时段">{{ detail.economicEvents ?? '-' }} / {{ detail.session ?? '-' }}</el-descriptions-item>
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
          <el-descriptions-item label="情绪影响">{{ detail.emotionAffected ? '是' : '否' }}</el-descriptions-item>
        </el-descriptions>
        <h4>复盘总结</h4>
        <div class="dim" v-if="detail.strengths">✅ {{ detail.strengths }}</div>
        <div class="dim" v-if="detail.improvements">🔧 {{ detail.improvements }}</div>
        <div class="dim" v-if="detail.nextPlan">📋 {{ detail.nextPlan }}</div>
        <div class="dim mt-sm">规则符合度：{{ detail.disciplineScore ?? '-' }} · 信号正确：{{ detail.signalCorrect === undefined ? '不确定' : (detail.signalCorrect ? '是' : '否') }}</div>
        <div v-if="detail.postCloseVerification" class="dim mt-sm">走势验证：{{ detail.postCloseVerification }}</div>
        <div class="mt">
          <el-button size="small" type="primary" @click="openEdit">编辑</el-button>
          <el-button size="small" @click="copyAsNew">复制为新模板</el-button>
          <el-button size="small" @click="exportOne">导出</el-button>
          <el-button size="small" type="danger" @click="remove(detail.id!)">删除</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 新建/编辑表单：分阶段填写（计划 → 执行 → 复盘） -->
    <el-dialog v-model="formVisible" :title="editingId ? '编辑交易 ' + form.tradeNo : '新建交易日志'" width="min(880px, 96vw)" top="4vh">
      <div class="dlg-top">
        <!-- 阶段时间线 -->
        <div class="stagebar">
          <div
            v-for="(s, i) in stageMeta"
            :key="s.key"
            class="stage"
            :class="{ active: s.active, done: s.done }"
            @click="goStage(s.key)"
            :title="'进入「' + s.title + '」阶段'"
          >
            <span class="stage-num">{{ s.done ? '✓' : i + 1 }}</span>
            <span class="stage-txt"><b>{{ s.title }}</b><em>{{ s.sub }}{{ s.done ? ' · 已完成' : '' }}</em></span>
          </div>
        </div>
        <div class="dlg-hint">
          <span class="dim">💡 开仓前填「交易计划」→ 平仓后补「实际执行」→ 点「自动计算」生成盈亏 → 完成「复盘总结」。保存时若成交字段齐全会自动计算。</span>
          <el-switch v-model="showMore" size="small" active-text="更多字段" />
        </div>
      </div>

      <el-collapse v-model="openSections">
        <!-- A. 基本信息 -->
        <el-collapse-item name="A">
          <template #title><span class="sec-title">A · 基本信息 <span v-if="sectionDone('A')" class="sec-ok">✓</span></span></template>
          <el-form label-width="92px" size="small">
            <el-form-item label="交易编号">
              <el-input v-model="form.tradeNo" readonly placeholder="自动生成">
                <template #suffix><el-icon class="clickable" @click="form.tradeNo = genTradeNo()"><component :is="RefreshLeft" /></el-icon></template>
              </el-input>
            </el-form-item>
            <el-form-item label="品种 / 市场">
              <el-select v-model="form.symbol" filterable allow-create default-first-option placeholder="如 BTCUSDT（可搜索/输入）" style="width: 58%">
                <el-option v-for="s in symbolOptions" :key="s" :value="s" :label="s" />
              </el-select>
              <el-select v-model="form.market" style="width: 38%">
                <el-option v-for="m in MARKET_OPTIONS" :key="m" :value="m" :label="m" />
              </el-select>
            </el-form-item>
            <el-form-item label="交易方向">
              <div class="seg">
                <button class="seg-btn big" :class="{ active: form.direction === 'LONG', up: form.direction === 'LONG' }" @click="form.direction = 'LONG'">▲ 做多</button>
                <button class="seg-btn big" :class="{ active: form.direction === 'SHORT', down: form.direction === 'SHORT' }" @click="form.direction = 'SHORT'">▼ 做空</button>
              </div>
            </el-form-item>
            <el-form-item label="时间框架">
              <div class="seg">
                <button v-for="t in TIMEFRAME_OPTIONS" :key="t" class="seg-btn mini" :class="{ active: form.timeframe === t }" @click="form.timeframe = t">{{ t }}</button>
              </div>
            </el-form-item>
            <el-form-item label="策略版本">
              <el-select v-model="form.strategyVersion" filterable allow-create default-first-option clearable placeholder="如 趋势跟踪 v2.3" style="width: 100%">
                <el-option v-for="s in strategyOptions" :key="s" :value="s" :label="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="账户 / 子账户">
              <el-select v-model="form.subAccount" filterable allow-create default-first-option clearable placeholder="选择或输入" style="width: 100%">
                <el-option v-for="a in accountOptions" :key="a.id" :value="a.label" :label="a.label" />
              </el-select>
            </el-form-item>
            <el-form-item label="开仓 / 平仓">
              <el-date-picker v-model="form.openTime" type="datetime" value-format="x" placeholder="开仓时间" style="width: 49%" />
              <el-date-picker v-model="form.closeTime" type="datetime" value-format="x" placeholder="平仓时间" style="width: 49%" />
            </el-form-item>
            <el-form-item v-if="showMore" label="数据账户">
              <el-select v-model="form.accountId" clearable placeholder="用于关联实际成交（默认跟随筛选账户）" style="width: 100%">
                <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- B. 交易前计划 -->
        <el-collapse-item name="B">
          <template #title><span class="sec-title">B · 交易前计划 <span v-if="sectionDone('B')" class="sec-ok">✓</span></span></template>
          <el-form label-width="100px" size="small">
            <el-form-item label="计划入场区间">
              <div class="row">
                <el-input-number v-model="form.entryLo" :precision="4" controls-position="right" placeholder="最低价" style="width: 46%" />
                <span class="dim">—</span>
                <el-input-number v-model="form.entryHi" :precision="4" controls-position="right" placeholder="最高价" style="width: 46%" />
              </div>
              <div class="hint-line">
                <span class="dim" v-if="entryMid !== undefined">计划入场价（中点）：<b class="mono">{{ fmtNum(entryMid) }}</b></span>
                <span class="dim" v-if="entryTolerance !== undefined">容差：<b class="mono">{{ fmtNum(entryTolerance, 1) }}%</b></span>
              </div>
            </el-form-item>
            <el-form-item label="计划止损价">
              <div class="row">
                <el-input-number v-model="form.plannedStop" :precision="4" controls-position="right" style="width: 46%" placeholder="止损价（必填）" />
                <span class="dim" v-if="stopDistPct !== undefined">距入场价 <b class="mono">{{ fmtNum(stopDistPct, 2) }}%</b></span>
              </div>
            </el-form-item>
            <el-form-item label="计划止盈目标">
              <div class="w100">
                <div v-for="(t, i) in form.targets" :key="i" class="tgt-row">
                  <el-input-number v-model="t.price" :precision="4" controls-position="right" placeholder="目标价" style="width: 150px" />
                  <el-input-number v-model="t.ratio" :min="0" :max="100" :precision="0" controls-position="right" placeholder="仓位%" style="width: 100px" />
                  <span class="dim" v-if="i === 0">目标1 用于计算风险回报比</span>
                  <el-button circle text type="danger" :icon="Delete" @click="form.targets.splice(i, 1)" />
                </div>
                <el-button size="small" text type="primary" :icon="Plus" @click="form.targets.push({ price: undefined, ratio: undefined })">添加目标</el-button>
              </div>
            </el-form-item>
            <el-form-item label="风险回报比">
              <div class="row">
                <template v-if="!form.rrManual">
                  <b class="mono rr-val">{{ planRR ? '1 : ' + planRR.ratio.toFixed(1) : '-' }}</b>
                  <span class="dim">（目标1 ÷ 止损距离，自动）</span>
                  <el-button size="small" text type="primary" @click="form.rrManual = true">手动覆盖</el-button>
                </template>
                <template v-else>
                  <el-input v-model="form.rrOverride" placeholder="如 1:3" style="width: 140px" />
                  <el-button size="small" text @click="form.rrManual = false">恢复自动</el-button>
                </template>
              </div>
            </el-form-item>
            <el-form-item label="计划仓位 / 数量">
              <div class="row">
                <el-input-number v-model="form.plannedSizeNum" :precision="4" controls-position="right" placeholder="数量" style="width: 130px" />
                <el-select v-model="form.plannedSizeUnit" size="small" style="width: 90px">
                  <el-option v-for="u in SIZE_UNITS" :key="u" :value="u" :label="u" />
                </el-select>
                <span class="dim" v-if="notionalPlan !== undefined">占用保证金 ≈ <b class="mono">{{ fmtNum(notionalPlan) }}</b></span>
              </div>
            </el-form-item>
            <el-form-item label="最大风险金额">
              <div class="row">
                <el-input-number v-model="form.plannedRiskAmount" :precision="2" controls-position="right" style="width: 140px" @change="onRiskAmountChange" />
                <span class="dim" v-if="riskByDist !== undefined">按止损距离估算：<b class="mono">{{ fmtNum(riskByDist) }}</b></span>
                <el-button size="small" text type="primary" :disabled="riskByDist === undefined" @click="form.plannedRiskAmount = riskByDist">一键估算</el-button>
              </div>
            </el-form-item>
            <el-form-item label="风险百分比">
              <div class="row">
                <el-input-number v-model="form.plannedRiskPct" :min="0" :max="100" :precision="2" controls-position="right" placeholder="%" style="width: 90px" @change="onRiskPctChange" />
                <span class="dim">× 账户权益</span>
                <el-input-number v-model="form.riskEquity" :min="0" :precision="0" controls-position="right" placeholder="账户权益" style="width: 130px" @change="onRiskAmountChange" />
                <span class="dim" v-if="riskPctComputed !== null">≈ {{ fmtNum(riskPctComputed, 2) }}%</span>
              </div>
            </el-form-item>
            <el-form-item label="计划持仓周期">
              <div class="seg">
                <button v-for="h in HOLDING_OPTIONS" :key="h" class="seg-btn" :class="{ active: form.plannedHolding === h }" @click="form.plannedHolding = h">{{ h }}</button>
              </div>
            </el-form-item>
            <el-form-item label="失效条件">
              <div class="w100">
                <el-input v-model="form.invalidation" type="textarea" :rows="2" placeholder="如：价格跌破 65000 则放弃" />
                <div class="tmpl-row">
                  <el-tag v-for="t in INVALIDATION_TEMPLATES" :key="t" size="small" effect="plain" class="tmpl clickable" @click="applyTemplate(t)">{{ t }}</el-tag>
                </div>
              </div>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- C. 实际执行 -->
        <el-collapse-item name="C">
          <template #title><span class="sec-title">C · 实际执行 <span v-if="sectionDone('C')" class="sec-ok">✓</span></span></template>
          <el-form label-width="100px" size="small">
            <el-form-item label="实际开仓价">
              <el-input-number v-model="form.actualEntry" :precision="4" controls-position="right" style="width: 46%" placeholder="成交价（自动/手动）" />
              <span class="dim" v-if="slippageCalc !== undefined && form.actualEntry !== undefined">较计划：<b class="mono" :class="slippageCalc >= 0 ? 'up' : 'down'">{{ slippageCalc >= 0 ? '+' : '' }}{{ fmtNum(slippageCalc) }}</b></span>
            </el-form-item>
            <el-form-item label="实际平仓价">
              <el-input-number v-model="form.actualExit" :precision="4" controls-position="right" style="width: 46%" placeholder="平仓价" />
            </el-form-item>
            <el-form-item label="数量 / 杠杆">
              <el-input-number v-model="form.actualQty" :precision="6" controls-position="right" style="width: 46%" placeholder="数量" />
              <el-input-number v-model="form.leverage" :min="1" :precision="1" controls-position="right" style="width: 46%" placeholder="杠杆" />
            </el-form-item>
            <el-form-item label="订单类型">
              <el-select v-model="form.orderType" style="width: 46%">
                <el-option v-for="o in ORDER_TYPE_OPTIONS" :key="o" :value="o" :label="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="滑点">
              <div class="row">
                <el-input-number v-model="form.slippage" :precision="4" controls-position="right" style="width: 130px" placeholder="自动计算" />
                <span class="dim" v-if="slippageCalc !== undefined">自动：{{ slippageCalc >= 0 ? '+' : '' }}{{ fmtNum(slippageCalc) }}</span>
                <el-button size="small" text type="primary" :disabled="slippageCalc === undefined" @click="form.slippage = slippageCalc">按计划价计算</el-button>
              </div>
            </el-form-item>
            <el-form-item label="持仓时长">
              <span class="mono">{{ holdDur ?? form.holdingDuration ?? '自动计算（需开/平仓时间）' }}</span>
            </el-form-item>
            <el-form-item label="是否按计划执行">
              <div class="seg">
                <button v-for="o in PLAN_EXEC_OPTIONS" :key="o.value" class="seg-btn" :class="['seg-btn', { active: form.planExecution === o.value }, o.cls]" @click="form.planExecution = o.value">{{ o.label }}</button>
              </div>
            </el-form-item>
            <el-form-item v-if="form.planExecution !== 'complete'" label="偏差原因">
              <div class="w100">
                <el-select v-model="form.deviationReason" filterable allow-create default-first-option clearable placeholder="选择或输入常见原因" style="width: 100%">
                  <el-option v-for="o in DEVIATION_OPTIONS" :key="o" :value="o" :label="o" />
                </el-select>
              </div>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- F. 结果分析 -->
        <el-collapse-item name="F">
          <template #title><span class="sec-title">F · 结果分析（自动计算） <span v-if="sectionDone('F')" class="sec-ok">✓</span></span></template>
          <el-form label-width="100px" size="small">
            <el-form-item label="自动计算区">
              <div class="calcgrid w100">
                <div class="calc-cell"><span class="dim">毛盈亏</span><b :class="(pnlPreview ?? form.pnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtNum(pnlPreview ?? form.pnl) }}</b></div>
                <div class="calc-cell"><span class="dim">费用</span><el-input-number v-model="form.fees" :precision="2" size="small" controls-position="right" style="width: 110px" /></div>
                <div class="calc-cell"><span class="dim">净收益</span><b :class="(netPnlPreview ?? form.netPnl ?? 0) >= 0 ? 'up' : 'down'">{{ fmtNum(netPnlPreview ?? form.netPnl) }}</b></div>
                <div class="calc-cell"><span class="dim">盈亏 %</span><b>{{ fmtNum(pnlPctPreview ?? form.pnlPct) }}%</b></div>
                <div class="calc-cell">
                  <span class="dim">R 倍数</span>
                  <b>{{ fmtNum(rPreview ?? form.rMultiple) }}</b>
                  <span v-if="rPreview === undefined && form.rMultiple === undefined && toNum(form.plannedRiskAmount) === undefined" class="dim warn">需计划风险金额</span>
                </div>
                <div class="calc-cell"><span class="dim">占用保证金</span><b>{{ fmtNum(notionalV) }}</b></div>
              </div>
              <div class="dim mt-sm">点击底部「自动计算」从真实行情提取开仓点指标（RSI/ATR/EMA）与持仓期 MFE/MAE。</div>
            </el-form-item>
            <el-form-item v-if="showMore" label="最大浮盈/浮亏">
              <el-input-number v-model="form.mfe" :precision="2" controls-position="right" placeholder="MFE" style="width: 46%" />
              <el-input-number v-model="form.mae" :precision="2" controls-position="right" placeholder="MAE" style="width: 46%" />
            </el-form-item>
            <el-form-item label="盈亏归因">
              <div class="w100">
                <el-select v-model="form.attributionSel" multiple filterable allow-create default-first-option placeholder="选择或输入归因（可多选）" style="width: 100%">
                  <el-option v-for="o in ATTRIBUTION_OPTIONS" :key="o" :value="o" :label="o" />
                </el-select>
                <div v-if="form.attributionSel.length" class="attr-w">
                  <span v-for="s in form.attributionSel" :key="s" class="attr-w-item">
                    {{ s }} <el-input-number v-model="form.attributionW[s]" :min="0" :max="100" :precision="0" size="small" controls-position="right" style="width: 74px" />%
                  </span>
                </div>
              </div>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- D. 市场条件 -->
        <el-collapse-item name="D">
          <template #title><span class="sec-title">D · 市场条件 <span v-if="sectionDone('D')" class="sec-ok">✓</span></span></template>
          <el-form label-width="100px" size="small">
            <el-form-item label="市场趋势">
              <div class="seg">
                <button v-for="o in TREND_OPTIONS" :key="o" class="seg-btn" :class="{ active: form.marketTrend === o, [trendCls(o)]: form.marketTrend === o }" @click="form.marketTrend = o">{{ o }}</button>
              </div>
            </el-form-item>
            <el-form-item label="波动率">
              <el-input v-model="form.volatility" placeholder="如 ATR 1.2%（「自动计算」可提取）" style="width: 60%" />
            </el-form-item>
            <el-form-item label="成交量">
              <div class="seg">
                <button v-for="o in VOLUME_OPTIONS" :key="o" class="seg-btn" :class="{ active: form.volumeLiquidity === o }" @click="form.volumeLiquidity = o">{{ o }}</button>
              </div>
            </el-form-item>
            <el-form-item label="支撑阻力">
              <el-input v-model="form.supportResistance" type="textarea" :rows="2" placeholder="如：支撑 65000-65500 / 阻力 68000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="重要事件">
              <el-input v-model="form.economicEvents" placeholder="如：非农、CPI、美联储利率决议" style="width: 100%" />
            </el-form-item>
            <el-form-item label="技术指标">
              <el-select v-model="form.indicatorSel" multiple filterable allow-create default-first-option collapse-tags placeholder="选择或输入指标状态（如 MACD 金叉）" style="width: 100%">
                <el-option v-for="o in INDICATOR_OPTIONS" :key="o" :value="o" :label="o" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="showMore" label="相关品种">
              <el-input v-model="form.relatedSymbols" placeholder="如：ETH 联动走强" style="width: 100%" />
            </el-form-item>
            <el-form-item v-if="showMore" label="交易时段">
              <div class="seg">
                <button v-for="o in SESSION_OPTIONS" :key="o" class="seg-btn" :class="{ active: form.session === o }" @click="form.session = o">{{ o }}</button>
              </div>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- E. 情绪与决策 -->
        <el-collapse-item name="E">
          <template #title><span class="sec-title">E · 情绪与决策 <span v-if="sectionDone('E')" class="sec-ok">✓</span></span></template>
          <el-form label-width="100px" size="small">
            <el-form-item label="入场理由">
              <div class="w100">
                <el-select v-model="form.signalType" clearable placeholder="信号类型（可选）" style="width: 100%">
                  <el-option v-for="o in SIGNAL_OPTIONS" :key="o" :value="o" :label="o" />
                </el-select>
                <el-input v-model="form.entryReason" type="textarea" :rows="2" placeholder="为什么进场（结合信号类型与市场结构）" class="mt-sm" />
              </div>
            </el-form-item>
            <el-form-item label="出场理由">
              <el-select v-model="form.exitSel" multiple filterable allow-create default-first-option collapse-tags placeholder="止盈 / 止损 / 手动…" style="width: 100%">
                <el-option v-for="o in EXIT_OPTIONS" :key="o" :value="o" :label="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="情绪评分">
              <div class="slider-cell">
                <div class="slider-head">
                  <span class="emoji">{{ emotionMeta(form.emotionScore).emoji }}</span>
                  <span class="dim">{{ emotionMeta(form.emotionScore).label }}</span>
                  <span class="mono val">{{ form.emotionScore }}/10</span>
                </div>
                <el-slider v-model="form.emotionScore" :min="1" :max="10" :step="1" show-stops :marks="{ 1: '冷静', 10: '恐惧/贪婪' }" />
              </div>
            </el-form-item>
            <el-form-item label="信心评分">
              <div class="slider-cell">
                <div class="slider-head">
                  <span class="emoji">{{ confidenceMeta(form.confidenceScore).emoji }}</span>
                  <span class="dim">{{ confidenceMeta(form.confidenceScore).label }}</span>
                  <span class="mono val">{{ form.confidenceScore }}/10</span>
                </div>
                <el-slider v-model="form.confidenceScore" :min="1" :max="10" :step="1" show-stops :marks="{ 1: '没把握', 10: '很有把握' }" />
              </div>
            </el-form-item>
            <el-form-item label="心理变化">
              <el-select v-model="form.psychSel" multiple filterable allow-create default-first-option collapse-tags placeholder="选择持仓心理（可自定义）" style="width: 100%">
                <el-option v-for="o in PSYCH_OPTIONS" :key="o" :value="o" :label="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="情绪影响">
              <el-switch v-model="form.emotionAffected" active-text="受情绪影响操作" inactive-text="按计划执行" />
            </el-form-item>
            <el-form-item v-if="form.emotionAffected || form.psychCustom" label="具体描述">
              <el-input v-model="form.psychCustom" type="textarea" :rows="2" placeholder="情绪如何影响了操作（如：想提前平仓、移动止损、加仓冲动）" style="width: 100%" />
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- G. 复盘总结 -->
        <el-collapse-item name="G">
          <template #title><span class="sec-title">G · 复盘总结 <span v-if="sectionDone('G')" class="sec-ok">✓</span></span></template>
          <el-form label-width="100px" size="small">
            <el-form-item label="规则符合度">
              <div class="slider-cell">
                <div class="slider-head">
                  <span class="dim">{{ discLabel(form.disciplineScore) }}</span>
                  <span class="mono val">{{ form.disciplineScore }}/10</span>
                </div>
                <el-slider v-model="form.disciplineScore" :min="1" :max="10" :step="1" show-stops :marks="{ 1: '不符合', 10: '完全符合' }" />
              </div>
            </el-form-item>
            <el-form-item label="信号是否正确">
              <div class="seg">
                <button class="seg-btn" :class="{ active: form.signalCorrect === true }" @click="form.signalCorrect = true">是</button>
                <button class="seg-btn" :class="{ active: form.signalCorrect === false }" @click="form.signalCorrect = false">否</button>
                <button class="seg-btn" :class="{ active: form.signalCorrect === undefined }" @click="form.signalCorrect = undefined">不确定</button>
              </div>
            </el-form-item>
            <el-form-item label="成功的方面">
              <el-input v-model="form.strengths" type="textarea" :rows="2" placeholder="一行一条，如：严格按计划止损 / 仓位控制到位" style="width: 100%" />
            </el-form-item>
            <el-form-item label="需要改进">
              <el-input v-model="form.improvements" type="textarea" :rows="2" placeholder="写具体可执行的动作，如：下次突破后等待回踩确认再入场" style="width: 100%" />
            </el-form-item>
            <el-form-item label="后续计划">
              <el-input v-model="form.nextPlan" type="textarea" :rows="2" placeholder="如：继续跟踪 BTC 关键支撑 / 关注 ETH 放量" style="width: 100%" />
            </el-form-item>
            <el-form-item label="标签">
              <el-select v-model="form.tags" multiple filterable allow-create default-first-option collapse-tags placeholder="选择或输入标签" style="width: 100%">
                <el-option v-for="t in TAG_OPTIONS" :key="t" :value="t" :label="t" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="showMore" label="走势验证">
              <el-input v-model="form.postCloseVerification" type="textarea" :rows="2" placeholder="平仓后市场走势是否验证了判断（可稍后回填）" style="width: 100%" />
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>

      <div class="row mt foot">
        <el-button :icon="MagicStick" :loading="filling" @click="autofill">自动计算</el-button>
        <el-button @click="copyPlanToActual">计划复制到实际</el-button>
        <div class="spacer" />
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ editingId ? '保存修改' : '保存' }}</el-button>
      </div>
      <el-alert v-if="notes.length" type="success" :closable="false" class="mt"><div v-for="(n, i) in notes" :key="i">· {{ n }}</div></el-alert>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, MagicStick, Plus, RefreshLeft } from '@element-plus/icons-vue';
import { api, MARKET_LABELS } from '../api.ts';
import { accountLabel, accountStore, loadAccounts } from '../store.ts';

// ================= 预设选项（标签化输入） =================
const TAG_OPTIONS = ['情绪化交易', '执行错误', '系统缺陷', '正常亏损', '正常盈利', '运气成分'];
const MARKET_OPTIONS = ['现货', 'U本位合约', '币本位合约', '全仓杠杆', '逐仓杠杆', '外汇', 'A股', '期货'];
const TIMEFRAME_OPTIONS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const COMMON_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT'];
const HOLDING_OPTIONS = ['日内', '波段', '趋势'];
const ORDER_TYPE_OPTIONS = ['市价单', '限价单', '条件单(止损)', '条件单(止盈)', '移动止损', '手动'];
const PLAN_EXEC_OPTIONS = [
  { value: 'complete', label: '完全执行', cls: 'ok' },
  { value: 'partial', label: '部分执行', cls: 'warn' },
  { value: 'none', label: '未执行', cls: 'bad' },
];
const EXIT_OPTIONS = ['止盈', '止损', '手动离场', '时间离场', '信号消失', '部分止盈'];
const SIGNAL_OPTIONS = ['均线交叉', '突破', '支撑位反弹', '阻力位回落', '趋势延续', '背离', '量价配合', '缺口回补', '其他'];
const DEVIATION_OPTIONS = ['情绪手动干预', '信号变化', '滑点过大', '止损设置不当', '仓位过重', '执行延迟', '行情跳空', '其他'];
const TREND_OPTIONS = ['看涨', '看跌', '震荡'];
const VOLUME_OPTIONS = ['放量', '缩量', '正常'];
const SESSION_OPTIONS = ['亚盘', '欧盘', '美盘'];
const INDICATOR_OPTIONS = ['RSI 超买', 'RSI 超卖', '均线金叉', '均线死叉', 'MACD 金叉', 'MACD 死叉', '布林上轨', '布林下轨', 'ATR 放大', 'ATR 收缩'];
const PSYCH_OPTIONS = ['想提前平仓', '移动止损', '加仓冲动', '犹豫不敢进场', '报复性交易', '过度自信'];
const ATTRIBUTION_OPTIONS = ['系统信号', '执行质量', '市场运气', '情绪干扰'];
const INVALIDATION_TEMPLATES = ['价格跌破 {X} 则放弃', '价格突破 {X} 则放弃', '{X} 内未启动则时间止损', '信号消失则放弃', '达到最大浮亏 {X}% 则离场'];
const SIZE_UNITS = ['USDT', '张', '枚', '手'];

/** 三阶段填写（对应设计：交易计划 / 实际执行 / 复盘总结） */
const STAGES = [
  { key: 1, title: '交易计划', sub: '开仓前填写', sections: ['A', 'B'] as string[] },
  { key: 2, title: '实际执行', sub: '平仓后填写', sections: ['C', 'F'] as string[] },
  { key: 3, title: '复盘总结', sub: '平仓后填写', sections: ['D', 'E', 'G'] as string[] },
];

const EMOTION_LEVELS = [
  { max: 2, emoji: '😌', label: '冷静' },
  { max: 4, emoji: '🙂', label: '平和' },
  { max: 6, emoji: '😟', label: '紧张' },
  { max: 8, emoji: '😰', label: '焦虑' },
  { max: 10, emoji: '😱', label: '恐惧/贪婪' },
];
const CONFIDENCE_LEVELS = [
  { max: 2, emoji: '🤔', label: '没把握' },
  { max: 5, emoji: '😐', label: '一般' },
  { max: 8, emoji: '🙂', label: '较有把握' },
  { max: 10, emoji: '💪', label: '很有把握' },
];

function emotionMeta(v: number): { max: number; emoji: string; label: string } {
  for (const l of EMOTION_LEVELS) if (v <= l.max) return l;
  return EMOTION_LEVELS[EMOTION_LEVELS.length - 1]!;
}
function confidenceMeta(v: number): { max: number; emoji: string; label: string } {
  for (const l of CONFIDENCE_LEVELS) if (v <= l.max) return l;
  return CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1]!;
}
function discLabel(v: number): string {
  return v >= 9 ? '完全符合' : v >= 7 ? '大部分符合' : v >= 4 ? '部分符合' : '不符合';
}
function trendCls(o: string): string {
  if (o === '看涨') return 'up';
  if (o === '看跌') return 'down';
  return 'flat';
}
function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '不足 1 分钟';
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return h + ' 小时' + (rm ? ' ' + rm + ' 分钟' : '');
  const d = Math.floor(h / 24);
  return d + ' 天 ' + (h % 24) + ' 小时';
}
function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function fmtNum(v: unknown, digits = 2): string {
  const n = toNum(v);
  return n === undefined ? '-' : n.toFixed(digits);
}

const route = useRoute();

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
const showMore = ref(false);
const stageActive = ref(1);
const openSections = ref<string[]>(['A']);

const f = reactive<{ range: [number, number] | null; symbol: string; market: string; direction: string; strategy: string; stage: string; tags: string[]; result: string; keyword: string; accountId: string }>({
  range: null, symbol: '', market: '', direction: '', strategy: '', stage: '', tags: [], result: '', keyword: '', accountId: '',
});
/** 用户是否手动改过账户筛选（手动改过后不再跟随全局账户） */
let accountTouched = false;

// ================= 表单（模型字段 + UI 派生字段） =================
const emptyForm = () => ({
  // —— UI 派生字段（不直接落库） ——
  entryLo: undefined as number | undefined,
  entryHi: undefined as number | undefined,
  plannedSizeNum: undefined as number | undefined,
  plannedSizeUnit: 'USDT',
  targets: [] as { price?: number; ratio?: number }[],
  riskEquity: undefined as number | undefined,
  rrManual: false,
  rrOverride: '',
  attributionSel: [] as string[],
  attributionW: {} as Record<string, number>,
  signalType: '',
  psychSel: [] as string[],
  psychCustom: '',
  indicatorSel: [] as string[],
  exitSel: [] as string[],
  // —— 模型字段 ——
  tradeNo: '', symbol: '', market: 'U本位合约', direction: 'LONG', timeframe: '1h', strategyVersion: '', subAccount: '',
  accountId: f.accountId || accountStore.selectedId || undefined,
  openTime: undefined as number | string | undefined, closeTime: undefined as number | string | undefined,
  plannedEntry: undefined as number | undefined, plannedStop: undefined as number | undefined,
  plannedTargets: [] as number[], plannedRR: '', plannedSize: '', plannedRiskAmount: undefined as number | undefined,
  plannedRiskPct: undefined as number | undefined, plannedHolding: '日内', invalidation: '',
  actualEntry: undefined as number | undefined, actualExit: undefined as number | undefined,
  actualQty: undefined as number | undefined, leverage: 1, orderType: '市价单',
  slippage: undefined as number | undefined, holdingDuration: '', planExecution: 'complete', deviationReason: '',
  marketTrend: '', volatility: '', volumeLiquidity: '', supportResistance: '', economicEvents: '',
  indicatorState: '', relatedSymbols: '', session: '',
  entryReason: '', exitReason: '', emotionScore: 5, confidenceScore: 5, psychologicalNote: '', emotionAffected: false,
  pnl: undefined as number | undefined, pnlPct: undefined as number | undefined, fees: undefined as number | undefined,
  netPnl: undefined as number | undefined, rMultiple: undefined as number | undefined,
  mfe: undefined as number | undefined, mae: undefined as number | undefined, attribution: '',
  disciplineScore: 5, signalCorrect: undefined as boolean | undefined, strengths: '', improvements: '', nextPlan: '',
  tags: [] as string[], postCloseVerification: '',
});
const form = reactive<any>(emptyForm());

// ================= 实时计算（前端预览） =================
const entryMid = computed(() => {
  const lo = toNum(form.entryLo);
  const hi = toNum(form.entryHi);
  if (lo !== undefined && hi !== undefined) return (lo + hi) / 2;
  return toNum(form.plannedEntry);
});
const entryTolerance = computed(() => {
  const lo = toNum(form.entryLo);
  const hi = toNum(form.entryHi);
  if (lo !== undefined && hi !== undefined && hi > lo) return ((hi - lo) / ((hi + lo) / 2)) * 100;
  return undefined;
});
const stopDistPct = computed(() => {
  const e = entryMid.value;
  const s = toNum(form.plannedStop);
  return e !== undefined && s !== undefined ? (Math.abs(s - e) / e) * 100 : undefined;
});
const planRR = computed<{ risk: number; reward: number; ratio: number } | null>(() => {
  const e = entryMid.value;
  const s = toNum(form.plannedStop);
  if (e === undefined || s === undefined || e === s) return null;
  const risk = Math.abs(e - s);
  const first = form.targets.map((t: any) => toNum(t.price)).find((n: unknown): n is number => n !== undefined);
  if (first === undefined) return null;
  const reward = Math.abs(first - e);
  return { risk, reward, ratio: reward / risk };
});
const riskByDist = computed(() => {
  const q = toNum(form.plannedSizeNum);
  const e = entryMid.value;
  const s = toNum(form.plannedStop);
  return q !== undefined && e !== undefined && s !== undefined ? Math.abs(s - e) * q : undefined;
});
const notionalPlan = computed(() => {
  const q = toNum(form.plannedSizeNum);
  const e = entryMid.value;
  if (q === undefined || e === undefined) return undefined;
  const lv = toNum(form.leverage) ?? 1;
  return Math.abs(e * q) / Math.max(lv, 1);
});
const riskPctComputed = computed(() => {
  const amt = toNum(form.plannedRiskAmount);
  const eq = toNum(form.riskEquity);
  if (amt !== undefined && eq !== undefined && eq > 0) return (amt / eq) * 100;
  return null;
});
const dirSign = computed(() => (form.direction === 'SHORT' ? -1 : 1));
const pnlPreview = computed(() => {
  const e = toNum(form.actualEntry);
  const x = toNum(form.actualExit);
  const q = toNum(form.actualQty);
  return e !== undefined && x !== undefined && q !== undefined ? (x - e) * q * dirSign.value : undefined;
});
const feesV = computed(() => toNum(form.fees) ?? 0);
const netPnlPreview = computed(() => (pnlPreview.value === undefined ? undefined : pnlPreview.value - feesV.value));
const notionalV = computed(() => {
  const e = toNum(form.actualEntry);
  const q = toNum(form.actualQty);
  if (e === undefined || q === undefined) return undefined;
  const lv = toNum(form.leverage) ?? 1;
  return Math.abs(e * q) / Math.max(lv, 1);
});
const pnlPctPreview = computed(() => {
  const nt = notionalV.value;
  const np = netPnlPreview.value;
  return nt !== undefined && np !== undefined && nt > 0 ? (np / nt) * 100 : undefined;
});
const rPreview = computed(() => {
  const np = netPnlPreview.value;
  const rk = toNum(form.plannedRiskAmount);
  return np !== undefined && rk !== undefined && rk > 0 ? np / rk : undefined;
});
const holdDur = computed(() => {
  const o = toNum(form.openTime);
  const c = toNum(form.closeTime);
  return o !== undefined && c !== undefined && c > o ? fmtDuration(c - o) : undefined;
});
const slippageCalc = computed(() => {
  const a = toNum(form.actualEntry);
  const p = entryMid.value;
  return a !== undefined && p !== undefined ? a - p : undefined;
});

// ================= 阶段完成度 =================
function sectionDone(sec: string): boolean {
  if (sec === 'A') return !!form.symbol;
  if (sec === 'B') return toNum(form.plannedStop) !== undefined && entryMid.value !== undefined;
  if (sec === 'C') return toNum(form.actualEntry) !== undefined && toNum(form.actualExit) !== undefined;
  if (sec === 'F') return toNum(form.netPnl) !== undefined;
  if (sec === 'D') return !!(form.marketTrend || form.indicatorState || form.volatility);
  if (sec === 'E') return !!(form.entryReason || toNum(form.emotionScore) !== undefined);
  if (sec === 'G') return !!(form.disciplineScore !== undefined || form.strengths || form.tags.length);
  return false;
}
function stageDone(k: number): boolean {
  const st = STAGES.find((s) => s.key === k);
  return !!st && st.sections.every((s) => sectionDone(s));
}
const stageMeta = computed(() =>
  STAGES.map((s) => ({ ...s, done: stageDone(s.key), active: stageActive.value === s.key })),
);
function goStage(k: number) {
  stageActive.value = k;
  const st = STAGES.find((s) => s.key === k);
  if (st) openSections.value = [...st.sections];
}

// 记录维度（列表/详情）的阶段判断
function planDoneOf(j: Rec | null | undefined): boolean {
  return !!j && (toNum(j.plannedEntry) !== undefined || toNum(j.plannedStop) !== undefined || toNum(j.plannedRiskAmount) !== undefined);
}
function execDoneOf(j: Rec | null | undefined): boolean {
  return !!j && toNum(j.actualEntry) !== undefined && toNum(j.actualExit) !== undefined;
}
function reviewDoneOf(j: Rec | null | undefined): boolean {
  return !!j && (toNum(j.disciplineScore) !== undefined || !!j.marketTrend || !!j.strengths || !!j.improvements
    || ((j.tags as string[]) ?? []).length > 0 || toNum(j.emotionScore) !== undefined);
}
function stageScore(j: Rec): number {
  return (planDoneOf(j) ? 1 : 0) + (execDoneOf(j) ? 2 : 0) + (reviewDoneOf(j) ? 4 : 0);
}
function planExecTag(j: Rec): { label: string; type: 'success' | 'warning' | 'danger' | 'info' } {
  if (j.planExecution === 'partial') return { label: '部分执行', type: 'warning' };
  if (j.planExecution === 'none') return { label: '未执行', type: 'danger' };
  return { label: '完全执行', type: 'success' };
}

// ================= 字符串/数组辅助（预设 chips + 自定义） =================
function splitJoined(str: unknown, presets: string[]): { sel: string[]; rest: string } {
  if (!str) return { sel: [], rest: '' };
  const parts = String(str).split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean);
  const sel = parts.filter((x) => presets.includes(x));
  const rest = parts.filter((x) => !presets.includes(x));
  return { sel, rest: rest.join('、') };
}
function parseAttribution(str: unknown): { sel: string[]; w: Record<string, number>; custom: string } {
  const sel: string[] = [];
  const w: Record<string, number> = {};
  const custom: string[] = [];
  if (!str) return { sel, w, custom: '' };
  for (const part of String(str).split(/[、,，;；]/)) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(.+?)(?:((d+)%))?$/);
    if (!m) continue;
    const name = m[1]!.trim();
    if (ATTRIBUTION_OPTIONS.includes(name)) {
      sel.push(name);
      if (m[2]) w[name] = parseInt(m[2], 10);
    } else {
      custom.push(t);
    }
  }
  return { sel, w, custom: custom.join('、') };
}
function parseSize(s: unknown): { num?: number; unit: string } {
  if (!s) return { num: undefined, unit: 'USDT' };
  const m = String(s).trim().match(/^([d.]+)s*([^d]*)$/);
  if (m && m[1]) return { num: parseFloat(m[1]), unit: m[2] || 'USDT' };
  return { num: undefined, unit: 'USDT' };
}
function extractSignalType(r: unknown): string {
  if (!r) return '';
  const s = String(r);
  for (const sig of SIGNAL_OPTIONS) if (s.startsWith(sig + '：')) return sig;
  return '';
}

// ================= 表单 ↔ 记录 同步 =================
function allParts(s: unknown): string[] {
  return String(s ?? '').split(/[、,，;；]/).map((x) => x.trim()).filter(Boolean);
}
function syncUiFromRecord(rec: any) {
  // allow-create 芯片数组需保留自定义项，载入全部片段（预设 + 自定义）
  form.indicatorSel = allParts(rec.indicatorState);
  form.exitSel = allParts(rec.exitReason);
  const ps = splitJoined(rec.psychologicalNote, PSYCH_OPTIONS);
  form.psychSel = ps.sel;
  form.psychCustom = ps.rest;
  const at = parseAttribution(rec.attribution);
  form.attributionSel = at.sel;
  form.attributionW = at.w;
  const sz = parseSize(rec.plannedSize);
  form.plannedSizeNum = sz.num;
  form.plannedSizeUnit = sz.unit;
  form.targets = Array.isArray(rec.plannedTargets) ? rec.plannedTargets.map((p: number) => ({ price: p, ratio: undefined })) : [];
  const pe = toNum(rec.plannedEntry);
  form.entryLo = pe;
  form.entryHi = pe;
  form.signalType = extractSignalType(rec.entryReason);
}
function snapshotUi() {
  return {
    entryLo: form.entryLo, entryHi: form.entryHi,
    plannedSizeNum: form.plannedSizeNum, plannedSizeUnit: form.plannedSizeUnit,
    targets: form.targets.map((t: any) => ({ ...t })),
    riskEquity: form.riskEquity, rrManual: form.rrManual, rrOverride: form.rrOverride,
    attributionSel: [...form.attributionSel], attributionW: { ...form.attributionW },
    psychSel: [...form.psychSel], psychCustom: form.psychCustom,
    indicatorSel: [...form.indicatorSel], exitSel: [...form.exitSel], signalType: form.signalType,
  };
}
function restoreUi(ui: ReturnType<typeof snapshotUi>) {
  Object.assign(form, ui);
  if (Array.isArray(form.plannedTargets)) {
    form.targets = (form.plannedTargets as number[]).map((p: number) => ({ price: p, ratio: undefined }));
  }
  if (typeof form.attribution === 'string' && form.attribution) {
    const at = parseAttribution(form.attribution);
    form.attributionSel = at.sel;
    form.attributionW = at.w;
  }
}
function applyAutoResult(rec: Record<string, unknown> | undefined, n: string[]) {
  if (!rec) return;
  const ui = snapshotUi();
  Object.assign(form, rec);
  restoreUi(ui);
  notes.value = n ?? [];
}

// ================= 提交载荷 =================
function buildRR(): string | undefined {
  if (form.rrManual && form.rrOverride) return String(form.rrOverride);
  if (planRR.value) return '1:' + planRR.value.ratio.toFixed(1);
  return undefined;
}
function buildSize(): string | undefined {
  const n = toNum(form.plannedSizeNum);
  if (n === undefined) return undefined;
  return form.plannedSizeUnit && form.plannedSizeUnit !== 'USDT' ? n + ' ' + form.plannedSizeUnit : String(n);
}
function buildAttribution(): string {
  const parts: string[] = [];
  for (const s of form.attributionSel) {
    const w = toNum(form.attributionW[s]);
    parts.push(w ? s + '(' + w + '%)' : s);
  }
  return parts.join('、');
}
function buildPayload(): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const pick = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') p[k] = v; };

  // A 基本信息
  pick('tradeNo', form.tradeNo);
  pick('symbol', String(form.symbol ?? '').trim().toUpperCase());
  pick('market', form.market);
  p['direction'] = form.direction;
  pick('timeframe', form.timeframe);
  pick('strategyVersion', form.strategyVersion);
  pick('subAccount', form.subAccount);
  pick('accountId', form.accountId);
  pick('openTime', form.openTime);
  pick('closeTime', form.closeTime);

  // B 交易前计划
  pick('plannedEntry', entryMid.value);
  pick('plannedStop', toNum(form.plannedStop));
  p['plannedTargets'] = form.targets.map((t: any) => toNum(t.price)).filter((n: unknown): n is number => n !== undefined);
  pick('plannedRR', buildRR());
  pick('plannedSize', buildSize());
  pick('plannedRiskAmount', toNum(form.plannedRiskAmount));
  const rp = riskPctComputed.value;
  pick('plannedRiskPct', rp !== null ? Math.round(rp * 100) / 100 : toNum(form.plannedRiskPct));
  pick('plannedHolding', form.plannedHolding);
  pick('invalidation', form.invalidation);

  // C 实际执行
  pick('actualEntry', toNum(form.actualEntry));
  pick('actualExit', toNum(form.actualExit));
  pick('actualQty', toNum(form.actualQty));
  pick('leverage', toNum(form.leverage));
  pick('orderType', form.orderType);
  pick('slippage', toNum(form.slippage) ?? slippageCalc.value);
  p['planExecution'] = form.planExecution;
  pick('deviationReason', form.deviationReason);

  // D 市场条件
  pick('marketTrend', form.marketTrend);
  pick('volatility', form.volatility);
  pick('volumeLiquidity', form.volumeLiquidity);
  pick('supportResistance', form.supportResistance);
  pick('economicEvents', form.economicEvents);
  form.indicatorState = [...form.indicatorSel].filter(Boolean).join('、');
  pick('indicatorState', form.indicatorState);
  pick('relatedSymbols', form.relatedSymbols);
  pick('session', form.session);

  // E 情绪与决策
  const sig = form.signalType || '';
  const er = String(form.entryReason ?? '').trim();
  pick('entryReason', sig ? (er ? (er.startsWith(sig) ? er : sig + '：' + er) : sig) : er);
  form.exitReason = [...form.exitSel].filter(Boolean).join('、');
  pick('exitReason', form.exitReason);
  pick('emotionScore', toNum(form.emotionScore));
  pick('confidenceScore', toNum(form.confidenceScore));
  form.psychologicalNote = [...form.psychSel, form.psychCustom].filter(Boolean).join('、');
  pick('psychologicalNote', form.psychologicalNote);
  pick('emotionAffected', form.emotionAffected);

  // F 结果分析（盈亏族由后端自动计算，这里只透传可手填项）
  pick('fees', toNum(form.fees));
  pick('mfe', toNum(form.mfe));
  pick('mae', toNum(form.mae));
  form.attribution = buildAttribution();
  pick('attribution', form.attribution);

  // G 复盘总结
  pick('disciplineScore', toNum(form.disciplineScore));
  pick('signalCorrect', form.signalCorrect);
  pick('strengths', form.strengths);
  pick('improvements', form.improvements);
  pick('nextPlan', form.nextPlan);
  p['tags'] = form.tags;
  pick('postCloseVerification', form.postCloseVerification);

  return p;
}

// ================= 交互动作 =================
function genTradeNo(): string {
  const d = new Date();
  const ymd = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const todayCount = all.value.filter((r) => String(r.tradeNo ?? '').startsWith(ymd)).length;
  return ymd + '-' + String(todayCount + 1).padStart(3, '0');
}
function applyTemplate(t: string) {
  form.invalidation = form.invalidation ? form.invalidation + '；' + t : t;
}
function onRiskAmountChange() {
  const eq = toNum(form.riskEquity);
  const amt = toNum(form.plannedRiskAmount);
  if (eq !== undefined && eq > 0 && amt !== undefined) form.plannedRiskPct = Math.round((amt / eq) * 10000) / 100;
}
function onRiskPctChange() {
  const eq = toNum(form.riskEquity);
  const pct = toNum(form.plannedRiskPct);
  if (eq !== undefined && eq > 0 && pct !== undefined) form.plannedRiskAmount = Math.round((pct / 100) * eq * 100) / 100;
}
function copyPlanToActual() {
  const copied: string[] = [];
  if (toNum(form.actualEntry) === undefined && entryMid.value !== undefined) {
    form.actualEntry = entryMid.value;
    copied.push('开仓价');
  }
  const q = toNum(form.plannedSizeNum) ?? toNum(form.plannedSize);
  if (toNum(form.actualQty) === undefined && q !== undefined) {
    form.actualQty = q;
    copied.push('数量');
  }
  if (copied.length) ElMessage.success('已从计划复制：' + copied.join('、') + '（可在「实际执行」中修改偏差）');
  else ElMessage.info('无可复制的计划字段（实际值已存在，或计划未填写）');
}
async function autofill() {
  if (!form.symbol) { ElMessage.warning('请先填写品种'); return; }
  filling.value = true;
  try {
    const res = await api.post<{ record: Record<string, unknown>; notes: string[] }>('/journal/trades/autofill', { record: buildPayload() });
    applyAutoResult(res.record, res.notes);
    ElMessage.success('已自动计算');
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    filling.value = false;
  }
}
async function save() {
  const payload = buildPayload();
  if (!payload.symbol) { ElMessage.warning('请填写品种'); return; }
  const auto = toNum(payload.actualEntry) !== undefined && toNum(payload.actualExit) !== undefined && toNum(payload.actualQty) !== undefined;
  saving.value = true;
  try {
    if (editingId.value) {
      const res = await api.patch<{ journal: Record<string, unknown>; notes: string[] }>('/journal/trades/' + editingId.value, { patch: payload, autofill: auto });
      applyAutoResult(res.journal, res.notes);
    } else {
      const res = await api.post<{ journal: Record<string, unknown>; notes: string[] }>('/journal/trades', { record: payload, autofill: auto });
      applyAutoResult(res.journal, res.notes);
    }
    ElMessage.success(auto ? '已保存并自动计算盈亏' : '已保存');
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

// ================= 列表 / 筛选 =================
const strategyOptions = computed(() => [...new Set(all.value.map((r) => r.strategyVersion).filter(Boolean))] as string[]);
const symbolOptions = computed(() => {
  const s = new Set<string>(COMMON_SYMBOLS);
  for (const r of all.value) if (r.symbol) s.add(String(r.symbol));
  for (const x of fills.value) s.add(x.symbol);
  return [...s].sort();
});
const accountOptions = computed(() =>
  accountStore.accounts.map((a) => ({ id: a.id, label: (a.type === 'real' ? '真实 ' : '模拟 ') + a.name })),
);
const acctLabel = computed(() => {
  const a = accountStore.accounts.find((ac) => ac.id === f.accountId || (!f.accountId && ac.id === accountStore.selectedId));
  return accountLabel(a ?? null);
});

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
  const stages = filtered.value.map((r) => stageScore(r));
  const reviewed = stages.filter((s) => s >= 7).length;
  return [
    { label: '笔数', text: String(filtered.value.length), cls: '' },
    { label: '净收益', text: net.toFixed(0), cls: net >= 0 ? 'up' : 'down' },
    { label: '胜率', text: (rs.length ? wins.length / rs.length : 0).toFixed(1), cls: '' },
    { label: '平均R', text: (rVals.length ? rVals.reduce((a, b) => a + b, 0) / rVals.length : 0).toFixed(2), cls: '' },
    { label: '盈亏比', text: (gl > 0 ? gp / gl : (gp > 0 ? 99 : 0)).toFixed(2), cls: '' },
    { label: '符合度', text: (disc.length ? disc.reduce((a, b) => a + b, 0) / disc.length : 0).toFixed(1), cls: '' },
    { label: '已复盘', text: reviewed + '/' + filtered.value.length, cls: '' },
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
    { k: '止盈', plan: ((d.plannedTargets as number[]) ?? []).join('/') || '-', actual: d.actualExit ?? '-' },
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
  let out = all.value;
  if (f.range?.[0] && f.range?.[1]) out = out.filter((r) => (r.closeTime ?? r.createdAt ?? 0) >= f.range![0] && (r.closeTime ?? r.createdAt ?? 0) <= f.range![1]);
  if (f.symbol) out = out.filter((r) => r.symbol.toUpperCase().includes(f.symbol.toUpperCase()));
  if (f.market) out = out.filter((r) => r.market === f.market);
  if (f.direction) out = out.filter((r) => r.direction === f.direction);
  if (f.strategy) out = out.filter((r) => r.strategyVersion === f.strategy);
  if (f.stage === 'plan') out = out.filter((r) => planDoneOf(r));
  if (f.stage === 'exec') out = out.filter((r) => execDoneOf(r));
  if (f.stage === 'review') out = out.filter((r) => reviewDoneOf(r));
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
function onViewModeChange() { /* 过滤已各自维护 */ }
function onAccountFilterChange() {
  accountTouched = true;
  loadList();
  loadFills();
}
function onFillClick(row: Fill) {
  const jr = fillJournal(row);
  if (jr?.id) openDetail(jr);
  else fillToJournal(row);
}

// ================= 新建 / 编辑 / 复制 =================
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
  form.tradeNo = genTradeNo();
  editingId.value = '';
  notes.value = [];
  stageActive.value = 1;
  openSections.value = ['A'];
  formVisible.value = true;
}
function openEdit() {
  if (!detail.value) return;
  editingId.value = String(detail.value.id);
  Object.assign(form, emptyForm());
  const rec = detail.value;
  for (const k of Object.keys(emptyForm())) {
    if (rec[k] !== undefined) form[k] = rec[k];
  }
  form.tags = Array.isArray(rec.tags) ? [...(rec.tags as string[])] : [];
  syncUiFromRecord(rec);
  notes.value = [];
  stageActive.value = 2;
  openSections.value = ['A', 'C'];
  formVisible.value = true;
}
function copyAsNew() {
  if (!detail.value) return;
  openNew();
  const { id, tradeNo, closeTime, createdAt, updatedAt, ...rest } = detail.value;
  Object.assign(form, rest);
  form.tags = Array.isArray(rest.tags) ? [...(rest.tags as string[])] : [];
  syncUiFromRecord(rest);
}
function exportOne() {
  if (!detail.value) return;
  const blob = new Blob([JSON.stringify(detail.value, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (detail.value.tradeNo ?? detail.value.id) + '.json';
  a.click();
}
/** 同时刷新手写日志与实际成交（补记后关联状态即时更新） */
async function refresh() {
  await loadList();
  await loadFills();
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
.w100 { width: 100%; }
.spacer { flex: 1; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.statstrip { display: flex; gap: 22px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.ss { display: flex; flex-direction: column; }
.ss-label { color: var(--text-dim); font-size: 11px; }
.ss-val { font-size: 15px; font-weight: 700; }
.mono { font-family: var(--mono); }
.up { color: var(--up); }
.down { color: var(--down); }
.dim { color: var(--text-dim); font-size: 12px; }
.warn { color: #e6a23c; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.clickable { cursor: pointer; }
h4 { margin: 14px 0 8px; color: var(--text-dim); font-size: 12px; letter-spacing: 1px; }

/* —— 阶段时间线（表单顶部） —— */
.dlg-top { margin-bottom: 12px; }
.stagebar { display: flex; align-items: stretch; gap: 8px; }
.stage { flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; background: transparent; opacity: 0.72; transition: all 0.15s; }
.stage:hover { opacity: 1; }
.stage.active { border-color: var(--accent); background: rgba(77, 163, 255, 0.1); opacity: 1; }
.stage.done { border-color: var(--up); }
.stage-num { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; background: var(--bg-elev); color: var(--text-dim); flex: none; }
.stage.done .stage-num { background: var(--up); color: #fff; }
.stage.active .stage-num { background: var(--accent); color: #fff; }
.stage-txt { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.stage-txt b { font-size: 13px; }
.stage-txt em { font-size: 11px; color: var(--text-dim); font-style: normal; white-space: nowrap; }
.dlg-hint { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; flex-wrap: wrap; }

/* —— 分段按钮（方向/趋势/执行情况等大按钮） —— */
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg-btn { padding: 4px 13px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text); font-size: 12px; cursor: pointer; transition: all 0.15s; font-family: inherit; }
.seg-btn:hover { border-color: var(--accent); color: var(--accent); }
.seg-btn.big { padding: 7px 22px; font-size: 13px; font-weight: 600; }
.seg-btn.mini { padding: 3px 8px; font-size: 11px; font-family: var(--mono); }
.seg-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(77, 163, 255, 0.1); font-weight: 600; }
.seg-btn.active.up { border-color: var(--up); color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
.seg-btn.active.down { border-color: var(--down); color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
.seg-btn.active.ok { border-color: var(--up); color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
.seg-btn.active.warn { border-color: #e6a23c; color: #e6a23c; background: rgba(230, 162, 60, 0.12); }
.seg-btn.active.bad { border-color: var(--down); color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }

/* —— 折叠面板标题 —— */
.sec-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.sec-ok { color: var(--up); font-size: 12px; }

/* —— 计划字段联动展示 —— */
.hint-line { display: flex; gap: 14px; margin-top: 6px; }
.tgt-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.rr-val { font-size: 15px; }
.tmpl-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.attr-w { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.attr-w-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); }

/* —— 滑块 —— */
.slider-cell { width: 100%; }
.slider-head { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.emoji { font-size: 22px; }
.val { font-size: 12px; color: var(--text-dim); margin-left: auto; }

/* —— 结果分析自动计算网格 —— */
.calcgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; }
.calc-cell { border: 1px dashed var(--border); border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.calc-cell b { font-size: 14px; font-family: var(--mono); }

/* —— 阶段小圆点（列表/详情） —— */
.stage-mini { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.sp { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--border); color: var(--text-dim); font-size: 10px; display: inline-flex; align-items: center; justify-content: center; }
.sp.ok { background: var(--up); border-color: var(--up); color: #fff; }

.foot { border-top: 1px solid var(--border); padding-top: 12px; }

@media (max-width: 640px) {
  .stagebar { flex-direction: column; }
}
</style>
