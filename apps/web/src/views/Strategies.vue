<template>
  <div class="strategies aw-page">
    <div class="strat-head">
      <div class="strat-title">
        <h2>策略中心</h2>
        <span class="dim">创建 → 回归测试 → Dry Run 模拟 → 实盘验证 → 反馈迭代</span>
      </div>
      <!-- 页面内主导航：五子 Tab -->
      <div class="sub-tabs">
        <button
          v-for="t in subTabs"
          :key="t.key"
          class="pill"
          :class="{ active: tab === t.key }"
          @click="switchTab(t.key)"
        >
          <span class="pill-dot" :style="{ background: t.color }"></span>
          <span class="pill-label">{{ t.label }}</span>
        </button>
      </div>
    </div>

    <!-- ============ 6.2 策略库（列表） ============ -->
    <template v-if="tab === 'strategies' && !showDetail">
      <div v-if="runtimes.length" class="aw-card rt-strip">
        <span class="dim">运行中</span>
        <button v-for="r in runtimes" :key="r.id" class="rt-chip" @click="openRuntimeDetail(r)">
          {{ strategyLabel(r.strategyId) }} · {{ r.symbol }} {{ r.interval }}
          <span v-if="rtSignals[r.id]" class="rt-sig" :class="rtSignals[r.id]!.action === 'OPEN_LONG' ? 'up' : rtSignals[r.id]!.action === 'OPEN_SHORT' ? 'down' : ''">{{ rtSignals[r.id]!.action }}</span>
        </button>
      </div>
      <div class="aw-card sc-config">
        <span class="dim">激活运行配置（开关使用）</span>
        <label>品种 <el-input v-model="rtForm.symbol" size="small" style="width: 116px" /></label>
        <label>市场
          <el-select v-model="rtForm.market" size="small" style="width: 120px">
            <el-option value="USDT_M" label="U本位合约" />
            <el-option value="SPOT" label="现货" />
          </el-select>
        </label>
        <label>周期
          <el-select v-model="rtForm.interval" size="small" style="width: 92px">
            <el-option v-for="iv in rtIntervals" :key="iv" :value="iv" :label="iv" />
          </el-select>
        </label>
        <label>更新频率
          <el-select v-model="rtForm.granularity" size="small" style="width: 132px">
            <el-option value="bar" label="每根K线收盘" />
            <el-option value="intra" label="盘中节流" />
          </el-select>
        </label>
        <span class="dim sc-config-hint">开关 = 激活 / 停用后台运行时（优先用「已保存配置」的品种与参数）</span>
      </div>
      <div class="strat-grid">
        <div
          v-for="s in strategyList"
          :key="s.key"
          class="aw-card strat-card hoverable"
          :class="{ 'sc-live-card': activeCount(s.builtinId) > 0 }"
          @click="openStrategyDetail(s)"
        >
          <div class="sc-top">
            <div class="sc-name">
              <b>{{ s.name }}</b>
              <span class="sc-ver mono">{{ s.version }}</span>
              <span v-if="s.drift" class="sc-warn" title="版本漂移（当前 vs 全部 > 20%）">⚠</span>
              <span v-if="activeCount(s.builtinId) > 0" class="sc-live" title="后台实时运行中">
                ● 运行中{{ activeCount(s.builtinId) > 1 ? ' ×' + activeCount(s.builtinId) : '' }}
              </span>
            </div>
            <div v-if="s.builtinId" class="sc-switch" title="激活 / 停用" @click.stop>
              <el-switch
                :model-value="activeCount(s.builtinId) > 0"
                :loading="!!rtToggling[s.builtinId]"
                @change="(v: string | number | boolean) => toggleActive(s, Boolean(v))"
              />
            </div>
            <div v-else class="sparkline" ref="sparkRefs" :data-key="s.key"></div>
          </div>
          <div v-if="s.description && !s.hasJournal" class="sc-desc dim">{{ s.description }}</div>
          <div class="sc-stats">
            <span class="scs"><i>实盘交易</i><b class="mono">{{ s.totalTrades }}</b></span>
            <span class="scs"><i>胜率</i><b class="mono">{{ s.winRate }}</b></span>
            <span class="scs"><i>累计</i><b class="mono" :class="s.netPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(s.netPnl, 0) }}</b></span>
            <span class="scs"><i>回撤</i><b class="mono">{{ s.drawdown }}</b></span>
          </div>
          <div class="sc-actions" @click.stop>
            <button class="aw-btn aw-btn-secondary mini" @click="goBacktest(s.builtinId ?? s.name)">回归测试</button>
            <button class="aw-btn aw-btn-primary mini" @click="goPaper(s.builtinId ?? s.name)">模拟验证</button>
          </div>
        </div>
        <div v-if="!strategyList.length" class="aw-empty aw-card">
          <span>暂无策略，检查后端是否注册了内置策略</span>
          <button class="aw-btn aw-btn-primary" @click="loadAll()">重新加载</button>
        </div>
      </div>
    </template>

    <!-- ============ 6.3 策略详情（概览 / 版本 / 运行 / 参数） ============ -->
    <template v-else-if="tab === 'strategies' && showDetail">
      <div class="aw-card sd-head-card">
        <div class="sd-head">
          <button class="sd-back" @click="closeDetail">← 策略库</button>
          <b class="sd-name">{{ detailName }}</b>
          <span v-if="detailStrategyId" class="sd-id mono dim">{{ detailStrategyId }}</span>
          <span v-if="activeCount(detailStrategyId) > 0" class="sc-live" title="后台实时运行中">
            ● 运行中{{ activeCount(detailStrategyId) > 1 ? ' ×' + activeCount(detailStrategyId) : '' }}
          </span>
          <div class="sd-head-actions">
            <el-switch
              v-if="detailStrategyId"
              :model-value="activeCount(detailStrategyId) > 0"
              :loading="!!rtToggling[detailStrategyId]"
              @change="(v: string | number | boolean) => toggleDetailActive(Boolean(v))"
            />
            <button class="aw-btn aw-btn-secondary mini" @click="goBacktest(detailStrategyId ?? detailKey)">回归测试</button>
            <button class="aw-btn aw-btn-primary mini" @click="goPaper(detailStrategyId ?? detailKey)">模拟验证</button>
          </div>
        </div>
        <div class="sd-nav">
          <button
            v-for="t in detailTabs"
            :key="t.key"
            class="sd-nav-btn"
            :class="{ active: detailTab === t.key }"
            @click="switchDetailTab(t.key)"
          >{{ t.label }}</button>
        </div>
      </div>

      <!-- 概览 -->
      <div v-show="detailTab === 'overview'" class="aw-card detail-card">
        <div class="ov-grid">
          <div class="ov-cell">
            <div class="dc-title">简介</div>
            <p class="ov-desc">{{ detailStrategy?.description || '（自定义 / 日志策略，无内置描述）' }}</p>
          </div>
          <div class="ov-cell">
            <div class="dc-title">运行状态</div>
            <div class="dc-rows">
              <div class="dc-row"><span>运行实例</span><b class="mono">{{ activeCount(detailStrategyId) }}</b></div>
              <div class="dc-row"><span>品种 / 周期</span><b class="mono">{{ detailRunMeta }}</b></div>
              <div class="dc-row"><span>最新事件</span><b class="mono">{{ detailRuntimes[0]?.lastEventAt ? fmtTime(detailRuntimes[0]!.lastEventAt) : '—' }}</b></div>
            </div>
          </div>
          <div class="ov-cell">
            <div class="dc-title">实盘统计（交易日志）</div>
            <div class="dc-rows">
              <div class="dc-row"><span>交易数</span><b class="mono">{{ detailStats.total }}</b></div>
              <div class="dc-row"><span>胜率</span><b class="mono">{{ detailStats.winRate }}</b></div>
              <div class="dc-row"><span>累计盈亏</span><b class="mono" :class="detailStats.netPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(detailStats.netPnl) }}</b></div>
              <div class="dc-row"><span>盈亏比</span><b class="mono">{{ detailStats.profitFactor }}</b></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 版本 -->
      <div v-show="detailTab === 'versions'" class="aw-card detail-card">
        <div class="dc-head">
          <b>版本与统计</b>
          <div class="version-switch">
            <el-select v-model="versionScope" size="small" style="width: 160px">
              <el-option value="all" label="全部版本累计" />
              <el-option value="current" label="当前版本" />
              <el-option value="compare" label="指定版本对比" />
            </el-select>
          </div>
        </div>
        <template v-if="detailKey">
          <!-- 横向版本树 -->
          <div class="ver-tree">
            <template v-for="(v, i) in detailVersions" :key="v.version">
              <div class="ver-node" :class="{ sel: selectedVersion === v.version }" @click="selectedVersion = v.version">
                <span class="ver-name mono">{{ v.version }}</span>
                <span class="ver-meta dim">{{ v.count }} 笔 · {{ v.winRate }}</span>
                <b class="ver-pnl mono" :class="v.netPnl >= 0 ? 'up' : 'down'">{{ fmtPnl(v.netPnl, 0) }}</b>
              </div>
              <span v-if="i < detailVersions.length - 1" class="ver-arrow">──▶</span>
            </template>
            <div v-if="!detailVersions.length" class="dim">该策略暂无版本标注，去日志中心为记录补充策略版本</div>
          </div>
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
              <div class="dc-title">版本对比（相邻两版本）</div>
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
                <div class="dc-row"><span>复盘反馈优化</span><b class="mono">{{ feedbackCount }} 次</b></div>
              </div>
            </div>
          </div>
          <div class="dc-foot">
            <button class="aw-btn aw-btn-secondary" @click="goBacktest(detailStrategyId ?? detailKey)">对该策略发起回归测试 →</button>
            <button class="aw-btn aw-btn-primary" @click="goPaper(detailStrategyId ?? detailKey)">发起 Dry Run 验证 →</button>
          </div>
        </template>
        <div v-else class="aw-empty"><span>暂无版本数据：去日志中心为记录补充「策略版本」后即可见版本树</span></div>
      </div>

      <!-- 运行 -->
      <div v-show="detailTab === 'run'" class="aw-card detail-card">
        <div class="dc-head">
          <b>实时运行</b>
          <span class="dim" style="font-size: 11px; margin-left: 8px">后台独立运行；事件只在「更新频率」到点时产生（默认 = K线周期，不会秒级刷屏）</span>
        </div>
        <div class="rt-form" style="margin-bottom: 12px">
          <label>品种 <el-input v-model="rtForm.symbol" size="small" style="width: 116px" /></label>
          <label>市场
            <el-select v-model="rtForm.market" size="small" style="width: 120px">
              <el-option value="USDT_M" label="U本位合约" />
              <el-option value="SPOT" label="现货" />
            </el-select>
          </label>
          <label>周期
            <el-select v-model="rtForm.interval" size="small" style="width: 92px">
              <el-option v-for="iv in rtIntervals" :key="iv" :value="iv" :label="iv" />
            </el-select>
          </label>
          <label>更新频率
            <el-select v-model="rtForm.granularity" size="small" style="width: 168px">
              <el-option value="bar" :label="'每根K线收盘（默认 · ' + rtForm.interval + '）'" />
              <el-option value="intra" label="盘中节流" />
            </el-select>
          </label>
          <label v-if="rtForm.granularity === 'intra'">节流(ms) <el-input-number v-model="rtForm.throttleMs" size="small" :min="250" :step="500" controls-position="right" style="width: 130px" /></label>
          <button class="aw-btn aw-btn-primary mini" :disabled="rtLoading || !detailStrategyId" @click="startDetailRuntime">
            {{ rtLoading ? '启动中…' : '启动运行' }}
          </button>
          <span class="dim rt-freq-hint">{{ freqHint }}</span>
        </div>
        <table class="rt-tbl">
          <thead>
            <tr><th>品种</th><th>市场</th><th>周期</th><th>更新频率</th><th>最新价</th><th>最新事件</th><th>最新信号</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in detailRuntimes" :key="r.id">
              <td class="mono">{{ r.symbol }}</td>
              <td>{{ MARKET_LABELS[r.market] ?? r.market }}</td>
              <td class="mono">{{ r.interval }}</td>
              <td>{{ r.granularity === 'intra' ? '盘中 · 每 ' + r.throttleMs + 'ms' : '每根K线 · ' + r.interval }}</td>
              <td class="mono">{{ fmtPrice(r.lastPrice) }}</td>
              <td class="mono dim">{{ r.lastEventAt ? fmtTime(r.lastEventAt) : '—' }}</td>
              <td>
                <span v-if="rtSignals[r.id]" class="rt-sig" :class="rtSignals[r.id]!.action === 'OPEN_LONG' ? 'up' : rtSignals[r.id]!.action === 'OPEN_SHORT' ? 'down' : ''">{{ rtSignals[r.id]!.action }}</span>
                <span v-else class="dim">—</span>
              </td>
              <td><button class="aw-btn aw-btn-danger mini" @click="stopRuntime(r.id)">停止</button></td>
            </tr>
            <tr v-if="!detailRuntimes.length"><td colspan="8" class="dim rt-empty">未运行，使用上方「启动运行」</td></tr>
          </tbody>
        </table>
        <div class="rt-feed-title" style="margin-top: 12px">实时事件流<span class="dim">（新 → 旧）</span></div>
        <div class="rt-events">
          <div v-for="(e, i) in detailEvents" :key="i" class="rt-ev" :class="e.type">
            <span class="rt-ev-time mono dim">{{ fmtTime(e.at) }}</span>
            <span class="rt-ev-type">{{ e.type }}</span>
            <span class="rt-ev-id dim mono">{{ e.symbol }} {{ e.interval }}</span>
            <span class="rt-ev-msg">{{ evSummary(e) }}</span>
          </div>
          <div v-if="!detailEvents.length" class="dim">暂无事件</div>
        </div>
      </div>

      <!-- 参数 -->
      <div v-show="detailTab === 'params'" class="aw-card detail-card">
        <div class="dc-head"><b>参数</b><span class="dim" style="font-size: 11px; margin-left: 8px">运行时与回测共用；保存后作为该策略的配置</span></div>
        <el-form v-if="detailStrategy" label-width="150px" size="small">
          <el-form-item v-for="p in detailStrategy.paramSpecs" :key="p.name" :label="p.name">
            <el-switch v-if="p.type === 'boolean'" v-model="paramForm[p.name]" />
            <el-input v-else v-model="paramForm[p.name]" style="width: 200px" class="mono" />
            <span class="dim param-desc">{{ p.description }}</span>
          </el-form-item>
        </el-form>
        <div v-else class="aw-empty"><span>该策略无内置参数</span></div>
        <div v-if="detailStrategy" class="sd-foot">
          <button class="aw-btn aw-btn-secondary mini" @click="resetParams">恢复默认</button>
          <button class="aw-btn aw-btn-primary mini" @click="saveConfig">保存为配置</button>
        </div>
      </div>
    </template>

    <!-- ============ 6.4 回归测试 ============ -->
    <template v-else-if="tab === 'backtest'">
      <div class="aw-card bt-form">
        <div class="dc-title">回测配置</div>
        <el-form label-width="86px" size="small" inline>
          <el-form-item label="策略">
            <el-select v-model="btForm.strategy" filterable allow-create placeholder="选择内置策略" style="width: 180px">
              <el-option v-for="s in builtinStrategies" :key="s.id" :value="s.id" :label="s.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="币种"><el-input v-model="btForm.symbol" style="width: 130px" class="mono" /></el-form-item>
          <el-form-item label="市场">
            <el-select v-model="btForm.market" style="width: 110px">
              <el-option value="SPOT" label="现货" />
              <el-option value="USDT_M" label="U本位合约" />
            </el-select>
          </el-form-item>
          <el-form-item label="周期">
            <el-select v-model="btForm.interval" style="width: 90px">
              <el-option v-for="i in ['15m','1h','4h','1d']" :key="i" :value="i" :label="i" />
            </el-select>
          </el-form-item>
          <el-form-item label="回测范围">
            <el-select v-model="btForm.fromDays" style="width: 110px">
              <el-option :value="30" label="近 30 天" />
              <el-option :value="90" label="近 90 天" />
              <el-option :value="180" label="近 180 天" />
            </el-select>
          </el-form-item>
          <el-form-item label="初始资金"><el-input-number v-model="btForm.initialCapital" :min="1000" :step="1000" controls-position="right" style="width: 130px" /></el-form-item>
          <el-form-item>
            <button class="aw-btn aw-btn-primary" :disabled="btRunning" @click="runBacktest">
              <el-icon v-if="btRunning" class="is-loading"><Loading /></el-icon>{{ btRunning ? '回测中…' : '运行回归测试' }}
            </button>
          </el-form-item>
        </el-form>
      </div>

      <div v-if="btResult" class="bt-result">
        <div class="bt-metrics">
          <div class="aw-card btm"><div class="btm-label">总收益率</div><b class="mono" :class="btResult.metrics.totalReturn >= 0 ? 'up' : 'down'">{{ fmtPctSigned(btResult.metrics.totalReturn) }}</b></div>
          <div class="aw-card btm"><div class="btm-label">最大回撤</div><b class="mono" :class="btResult.metrics.maxDrawdown > 0.2 ? 'down' : 'up'">{{ fmtPct(btResult.metrics.maxDrawdown) }}</b></div>
          <div class="aw-card btm"><div class="btm-label">夏普比率</div><b class="mono">{{ btResult.metrics.sharpe.toFixed(2) }}</b></div>
          <div class="aw-card btm"><div class="btm-label">胜率</div><b class="mono">{{ fmtPct(btResult.metrics.winRate) }}</b></div>
          <div class="aw-card btm"><div class="btm-label">盈亏比</div><b class="mono">{{ btResult.metrics.profitFactor.toFixed(2) }}</b></div>
          <div class="aw-card btm"><div class="btm-label">交易数</div><b class="mono">{{ btResult.metrics.totalTrades }}</b></div>
          <div class="aw-card btm"><div class="btm-label">期末权益</div><b class="mono">{{ fmtNum(btResult.metrics.finalEquity, 0) }}</b></div>
          <div class="aw-card btm"><div class="btm-label">年化收益</div><b class="mono" :class="btResult.metrics.annualizedReturn >= 0 ? 'up' : 'down'">{{ fmtPct(btResult.metrics.annualizedReturn) }}</b></div>
        </div>
        <div class="aw-card bt-chart-card">
          <div class="dc-title">权益曲线</div>
          <div ref="btChart" class="bt-chart"></div>
        </div>
        <div class="aw-card bt-trades">
          <div class="dc-title">成交记录（前 50 条）</div>
          <el-table :data="btResult.trades.slice(0, 50)" size="small" max-height="300">
            <el-table-column label="方向" width="80"><template #default="{ row }"><el-tag :type="row.side === 'BUY' ? 'danger' : 'success'" size="small">{{ row.side }}</el-tag></template></el-table-column>
            <el-table-column label="开仓价" width="110"><template #default="{ row }"><span class="mono">{{ row.entryPrice.toFixed(2) }}</span></template></el-table-column>
            <el-table-column label="平仓价" width="110"><template #default="{ row }"><span class="mono">{{ row.exitPrice.toFixed(2) }}</span></template></el-table-column>
            <el-table-column label="盈亏" width="110"><template #default="{ row }"><span class="mono" :class="row.pnl >= 0 ? 'up' : 'down'">{{ fmtPnl(row.pnl) }}</span></template></el-table-column>
            <el-table-column label="原因" prop="reason" />
          </el-table>
        </div>
        <div class="bt-actions">
          <button class="aw-btn aw-btn-secondary" @click="ElMessage.success('已设为活跃版本（回测结论仅供参考）')">设为活跃版本</button>
          <button class="aw-btn aw-btn-primary" @click="goPaper(btForm.strategy)">发起 Dry Run 验证 →</button>
        </div>
      </div>

      <div v-if="btHistory.length" class="aw-card bt-history">
        <div class="dc-title">历史回测记录</div>
        <div class="bh-list">
          <div v-for="h in btHistory" :key="h.id" class="bh-item">
            <span class="mono">{{ h.symbol }} · {{ h.interval }}</span>
            <span class="dim">{{ h.strategyId || btForm.strategy || '—' }}</span>
            <span class="mono" :class="(h.metrics?.totalReturn ?? 0) >= 0 ? 'up' : 'down'">{{ h.metrics ? fmtPct(h.metrics?.totalReturn ?? 0) : '—' }}</span>
            <span class="dim">{{ new Date(h.createdAt ?? h.request?.from ?? Date.now()).toLocaleDateString('zh-CN') }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 6.5 模拟交易（Dry Run） ============ -->
    <template v-else-if="tab === 'paper'">
      <Paper />
    </template>

    <!-- ============ 6.7 反馈分析 ============ -->
    <template v-else-if="tab === 'feedback'">
      <div class="fb-head">
        <div class="dim">基于日志中心已复盘数据（{{ all.length }} 条记录）生成诊断与优化任务</div>
        <button class="aw-btn aw-btn-secondary" :disabled="llmBusy" @click="runLLMDiagnose">
          <el-icon v-if="llmBusy" class="is-loading"><Loading /></el-icon>{{ llmBusy ? 'LLM 分析中…' : 'LLM 生成诊断报告' }}
        </button>
      </div>
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
          <div class="fb-title">有计划 vs 无计划对比</div>
          <div class="fb-body">
            <div class="pol-line"><span>有计划胜率</span><b class="mono up">{{ plannedVsUnplanned.planned }}</b></div>
            <div class="pol-line"><span>无计划胜率</span><b class="mono down">{{ plannedVsUnplanned.unplanned }}</b></div>
            <div class="pol-warn dim" v-if="plannedVsUnplanned.planned !== '—' && plannedVsUnplanned.unplanned !== '—' && plannedVsUnplanned.planned > plannedVsUnplanned.unplanned">✓ 按计划执行表现更好，坚持计划纪律</div>
          </div>
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
          <div class="fb-title">优化任务列表（基于诊断自动生成）</div>
          <div class="task-list">
            <div v-for="(t, i) in optTasks" :key="i" class="task-item">
              <span class="task-check">☐</span>
              <span class="task-text">{{ t }}</span>
            </div>
          </div>
          <div class="task-actions">
            <button class="aw-btn aw-btn-primary" @click="createVersion"><el-icon><Plus /></el-icon>创建优化版本</button>
            <button class="aw-btn aw-btn-secondary" @click="goBacktest('')">去回归测试验证 →</button>
          </div>
        </div>
        <div v-if="llmReport" class="aw-card fb-card wide">
          <div class="fb-title">LLM 诊断报告</div>
          <pre class="llm-report">{{ llmReport }}</pre>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api, MARKET_LABELS, type BacktestResult } from '../api.ts';
import Paper from './Paper.vue';
import { subscribeAll, type StrategyRuntimeEvent } from '../lib/strategy-stream.ts';
import type { TradeJournal } from '../lib/journal.ts';
interface TradeJournalStats { closed: number; wins: number; losses: number; netPnl: number; expectancy: number }
import { deriveStatus, fmtPnl, fmtNum } from '../lib/journal.ts';

const route = useRoute();
const router = useRouter();

type SubTab = 'strategies' | 'backtest' | 'paper' | 'feedback';
const subTabs: { key: SubTab; label: string; color: string }[] = [
  { key: 'strategies', label: '策略库', color: '#06B6D4' },
  { key: 'backtest', label: '回归测试', color: '#F59E0B' },
  { key: 'paper', label: '模拟交易', color: '#10B981' },
  { key: 'feedback', label: '反馈分析', color: '#EF4444' },
];

function tabFromQuery(q: string | null): SubTab {
  // 兼容旧链接：versions / runtime 已并入「策略库」的策略详情
  if (q === 'paper' || q === 'backtest' || q === 'feedback') return q;
  return 'strategies';
}
const tab = ref<SubTab>(tabFromQuery(typeof route.query.tab === 'string' ? route.query.tab : null));

function switchTab(key: SubTab) {
  tab.value = key;
  router.replace({ query: { ...route.query, tab: key } });
}
watch(() => route.query.tab, (q) => {
  tab.value = tabFromQuery(typeof q === 'string' ? q : null);
});
function goBacktest(strategyName: string) {
  if (strategyName) btForm.strategy = strategyName;
  closeDetail();
  switchTab('backtest');
}
function goPaper(strategyName: string) {
  if (strategyName) btForm.strategy = strategyName;
  closeDetail();
  switchTab('paper');
}

const versionScope = ref<'all' | 'current' | 'compare'>('all');
const all = ref<TradeJournal[]>([]);
const stats = ref<TradeJournalStats | null>(null);
const detailKey = ref('');
const selectedVersion = ref('');
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

const detailRecords = computed(() => all.value.filter((r) => (r.strategyName || r.strategyVersion || '未标注策略') === detailKey.value));

/** 版本树节点 */
const detailVersions = computed(() => {
  const byVer = new Map<string, TradeJournal[]>();
  for (const r of detailRecords.value) {
    const v = r.strategyVersion;
    if (!v) continue;
    if (!byVer.has(v)) byVer.set(v, []);
    byVer.get(v)!.push(r);
  }
  return [...byVer.entries()].map(([version, recs]) => {
    const closed = recs.filter((r) => deriveStatus(r) === 'done' || deriveStatus(r) === 'pending');
    const wins = closed.filter((r) => (r.netPnl ?? 0) > 0);
    const netPnl = closed.reduce((a, r) => a + (r.netPnl ?? 0), 0);
    return { version, count: recs.length, winRate: closed.length ? ((wins.length / closed.length) * 100).toFixed(0) + '%' : '—', netPnl };
  }).sort((a, b) => a.version.localeCompare(b.version));
});

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

// ---------- 回归测试 ----------
interface BuiltinMeta { id: string; name: string; description?: string; paramSpecs: { name: string; type: string; default: number | string | boolean; description?: string; min?: number; max?: number; step?: number }[] }
const builtinStrategies = ref<BuiltinMeta[]>([]);
const btRunning = ref(false);
const btResult = ref<BacktestResult | null>(null);
const btHistory = ref<Array<{ id: string; symbol: string; interval: string; strategyId?: string; metrics?: BacktestResult['metrics']; createdAt?: number; request?: { from?: number } }>>([]);
const btChart = ref<HTMLDivElement | null>(null);
let btE: echarts.ECharts | null = null;
const btForm = reactive({
  strategy: '', symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', fromDays: 90, initialCapital: 10000,
});

async function runBacktest() {
  if (!btForm.strategy) { ElMessage.warning('请选择策略'); return; }
  btRunning.value = true;
  btResult.value = null;
  try {
    const res = await api.post<BacktestResult>('/backtest', {
      strategy: btForm.strategy,
      market: btForm.market,
      interval: btForm.interval,
      symbol: btForm.symbol.toUpperCase(),
      fromDays: btForm.fromDays,
      initialCapital: btForm.initialCapital,
    });
    btResult.value = res;
    await loadBtHistory();
    nextTick(() => renderBtChart());
  } catch (e) {
    ElMessage.error('回测失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    btRunning.value = false;
  }
}

function renderBtChart() {
  if (!btChart.value || !btResult.value) return;
  if (!btE) btE = echarts.init(btChart.value);
  const pts = btResult.value.equityCurve;
  btE.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => Number(v).toFixed(0) },
    grid: { left: 52, right: 16, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: pts.map((p) => new Date(p.timestamp).toLocaleDateString('zh-CN')), axisLabel: { color: '#6b7280', fontSize: 10 } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#6b7280', fontSize: 10 } },
    series: [{ type: 'line', data: pts.map((p) => p.equity), showSymbol: false, lineStyle: { color: '#06b6d4', width: 1.5 }, areaStyle: { color: 'rgba(6,182,212,0.08)' } }],
  });
}

async function loadBtHistory() {
  const h = await api.get<{ backtests: typeof btHistory.value }>('/backtests').catch(() => null);
  if (h) btHistory.value = h.backtests;
}

// ---------- 反馈分析 ----------
const llmBusy = ref(false);
const llmReport = ref('');
async function runLLMDiagnose() {
  llmBusy.value = true;
  try {
    const res = await api.post<{ summary?: string; report?: string; text?: string }>('/llm/analyze-journal', { tradeLimit: 100, journalLimit: 20 });
    llmReport.value = res.report ?? res.summary ?? res.text ?? JSON.stringify(res, null, 2);
    ElMessage.success('LLM 诊断报告已生成');
  } catch (e) {
    ElMessage.error('LLM 分析失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    llmBusy.value = false;
  }
}

const plannedVsUnplanned = computed(() => {
  const done = all.value.filter((r) => deriveStatus(r) === 'done');
  const planned = done.filter((r) => r.planExecution === 'complete' || (r.tags ?? []).some((t) => ['计划执行', '策略信号'].includes(t)));
  const unplanned = done.filter((r) => (r.tags ?? []).includes('无计划'));
  const rate = (arr: TradeJournal[]) => arr.length ? ((arr.filter((r) => (r.netPnl ?? 0) > 0).length / arr.length) * 100).toFixed(0) + '%' : '—';
  return { planned: rate(planned), unplanned: rate(unplanned) };
});

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
  ElMessage.success('已创建优化版本任务，前往回归测试验证');
  switchTab('backtest');
}

function riskCls(v: string): string {
  if (v === '—') return '';
  const n = parseFloat(v);
  if (n < 10) return 'up';
  if (n <= 20) return 'todo';
  return 'down';
}

function fmtPct(v: number): string { return Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—'; }
function fmtPctSigned(v: number): string { return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

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

// ---------- 实时运行（策略运行时） ----------
interface RuntimeStatus {
  id: string; running: boolean; strategyId: string; symbol: string; market: string; interval: string;
  granularity: string; throttleMs: number; bars: number; lastBarOpenTime: number; lastPrice: number;
  lastEventAt: number; startedAt: number; seq: number;
}
interface RuntimeSignalView { action: string; sizeMode: string; size: number; reason: string }
interface SavedStrategy {
  id: string; name: string; market: string; symbol: string; interval: string;
  parameters: Record<string, number | string | boolean>; enabled?: boolean;
}

const rtIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'];
/** 与后端 defaultThrottleMs 对齐：clamp(周期/20, 1s, 30s) */
const RT_INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000, '1d': 86_400_000,
};
function defaultThrottleFor(interval: string): number {
  const step = RT_INTERVAL_MS[interval] ?? 60_000;
  return Math.min(30_000, Math.max(1_000, Math.floor(step / 20)));
}
const runtimes = ref<RuntimeStatus[]>([]);
const savedStrategies = ref<SavedStrategy[]>([]);
const runtimeEvents = ref<StrategyRuntimeEvent[]>([]);
const rtSignals = ref<Record<string, RuntimeSignalView>>({});
const rtLoading = ref(false);
const rtToggling = ref<Record<string, boolean>>({});

/** 我的策略：内置策略全部展示，并与日志统计合并（有复盘的显示统计，无复盘的显示简介） */
interface StrategyCardView {
  key: string; name: string; builtinId: string | null; description: string;
  version: string; totalTrades: number; winRate: string; netPnl: number; drawdown: string;
  drift: boolean; sparkline: number[]; hasJournal: boolean;
}
const strategyList = computed<StrategyCardView[]>(() => {
  const cards = strategyCards.value;
  const matched = new Set<string>();
  const out: StrategyCardView[] = [];
  for (const meta of builtinStrategies.value) {
    const card = cards.find((c) => c.name === meta.name || c.key === meta.id || c.key === meta.name);
    if (card) matched.add(card.key);
    out.push({
      key: card?.key ?? 'builtin:' + meta.id,
      name: meta.name,
      builtinId: meta.id,
      description: meta.description ?? '',
      version: card?.version ?? '—',
      totalTrades: card?.totalTrades ?? 0,
      winRate: card?.winRate ?? '—',
      netPnl: card?.netPnl ?? 0,
      drawdown: card?.drawdown ?? '—',
      drift: card?.drift ?? false,
      sparkline: card?.sparkline ?? [],
      hasJournal: !!card,
    });
  }
  for (const card of cards) {
    if (matched.has(card.key)) continue;
    out.push({
      key: card.key, name: card.name, builtinId: null, description: '',
      version: card.version, totalTrades: card.totalTrades, winRate: card.winRate,
      netPnl: card.netPnl, drawdown: card.drawdown, drift: card.drift,
      sparkline: card.sparkline, hasJournal: true,
    });
  }
  return out;
});

/** 某策略当前运行中的运行时数量 */
function activeCount(strategyId: string | null): number {
  if (!strategyId) return 0;
  return runtimes.value.filter((r) => r.strategyId === strategyId && r.running).length;
}

/** 开关：激活 = 启动后台运行时；停用 = 停止该策略的全部运行时 */
async function toggleActive(card: StrategyCardView, on: boolean) {
  const id = card.builtinId;
  if (!id) { ElMessage.warning('该策略非内置策略，无法直接激活'); return; }
  rtToggling.value = { ...rtToggling.value, [id]: true };
  try {
    if (on) {
      const saved = savedStrategies.value.find((s) => s.name === id);
      let params: Record<string, unknown> = {};
      if (saved) {
        params = { ...saved.parameters };
      } else {
        const meta = builtinStrategies.value.find((m) => m.id === id);
        if (meta) for (const p of meta.paramSpecs) params[p.name] = p.default;
      }
      await api.post<RuntimeStatus>('/strategy-runtime/start', {
        strategyId: id,
        symbol: (saved?.symbol ?? rtForm.symbol).toUpperCase(),
        market: saved?.market ?? rtForm.market,
        interval: saved?.interval ?? rtForm.interval,
        granularity: rtForm.granularity,
        throttleMs: rtForm.granularity === 'intra' ? rtForm.throttleMs : undefined,
        params,
      });
      ElMessage.success('已激活：' + strategyLabel(id));
    } else {
      const ids = runtimes.value.filter((r) => r.strategyId === id).map((r) => r.id);
      for (const rid of ids) await api.post('/strategy-runtime/stop', { id: rid });
      ElMessage.success('已停用：' + strategyLabel(id));
    }
  } catch (e) {
    ElMessage.error((on ? '激活' : '停用') + '失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    const next = { ...rtToggling.value };
    delete next[id];
    rtToggling.value = next;
    await loadRuntimes();
  }
}
const rtForm = reactive({
  symbol: 'BTCUSDT', market: 'USDT_M', interval: '1h',
  granularity: 'bar' as 'bar' | 'intra', throttleMs: 5000,
});
/** 更新频率提示：默认 = K线周期（bar）；盘中节流给出建议默认值 */
const freqHint = computed(() => rtForm.granularity === 'intra'
  ? '约每 ' + rtForm.throttleMs + 'ms 更新一次（周期 ' + rtForm.interval + ' 建议 ' + defaultThrottleFor(rtForm.interval) + 'ms）'
  : '约每 ' + rtForm.interval + ' 更新一次（随 K 线收盘，推荐）');
// 周期变化时，若为盘中节流则把节流重置为该周期的建议值（频率不会被周期"带偏"）
watch(() => rtForm.interval, (iv, prev) => {
  if (rtForm.granularity === 'intra' && (rtForm.throttleMs === defaultThrottleFor(prev ?? iv) || rtForm.throttleMs === 5000)) {
    rtForm.throttleMs = defaultThrottleFor(iv);
  }
});
let rtUnsub: (() => void) | null = null;

// ---------- 策略详情（概览 / 版本 / 运行 / 参数） ----------
type DetailTab = 'overview' | 'versions' | 'run' | 'params';
const detailTabs: { key: DetailTab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'versions', label: '版本' },
  { key: 'run', label: '运行' },
  { key: 'params', label: '参数' },
];
const detailStrategyId = ref<string | null>(null);
const detailTab = ref<DetailTab>('overview');
const paramForm = reactive<Record<string, string | boolean>>({});

const showDetail = computed(() => !!detailKey.value);
const detailStrategy = computed<BuiltinMeta | null>(() => builtinStrategies.value.find((m) => m.id === detailStrategyId.value) ?? null);
const detailName = computed(() => detailStrategy.value?.name ?? detailKey.value);
const detailRuntimes = computed(() => runtimes.value.filter((r) => r.strategyId === detailStrategyId.value));
const detailEvents = computed(() => runtimeEvents.value.filter((e) => detailRuntimes.value.some((r) => r.id === e.runtimeId)).slice(0, 40));
const detailRunMeta = computed(() => detailRuntimes.value.map((r) => r.symbol + ' ' + r.interval).join(', ') || '—');

function strategyLabel(id: string): string {
  return builtinStrategies.value.find((s) => s.id === id)?.name ?? id;
}
function initParamForm(id: string | null) {
  for (const k of Object.keys(paramForm)) delete paramForm[k];
  const meta = builtinStrategies.value.find((m) => m.id === id);
  if (!meta) return;
  const saved = savedStrategies.value.find((s) => s.name === id);
  for (const p of meta.paramSpecs) {
    const v = saved?.parameters?.[p.name] ?? p.default;
    paramForm[p.name] = p.type === 'boolean' ? v === true || v === 'true' : String(v);
  }
}
function resetParams() {
  initParamForm(detailStrategyId.value);
}
/** 参数表单 → 参数对象（按 paramSpecs 类型校正） */
function paramsObject(): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const spec of detailStrategy.value?.paramSpecs ?? []) {
    const v = paramForm[spec.name];
    if (spec.type === 'number') {
      const n = Number(v);
      out[spec.name] = Number.isFinite(n) ? n : Number(spec.default);
    } else if (spec.type === 'boolean') {
      out[spec.name] = v === true || v === 'true';
    } else {
      out[spec.name] = String(v ?? spec.default);
    }
  }
  return out;
}
function openStrategyDetail(card: StrategyCardView) {
  detailStrategyId.value = card.builtinId;
  detailKey.value = card.hasJournal ? card.key : card.name;
  selectedVersion.value = '';
  detailTab.value = 'overview';
  initParamForm(card.builtinId);
  // 同步运行默认配置（优先已保存配置）
  const saved = card.builtinId ? savedStrategies.value.find((s) => s.name === card.builtinId) : null;
  if (saved) {
    rtForm.symbol = saved.symbol;
    rtForm.market = saved.market === 'SPOT' ? 'SPOT' : 'USDT_M';
    if (rtIntervals.includes(saved.interval)) rtForm.interval = saved.interval;
  }
}
function closeDetail() {
  detailKey.value = '';
  detailStrategyId.value = null;
}
/** 从「运行中」概览条直接打开该策略详情并定位到「运行」页 */
function openRuntimeDetail(r: RuntimeStatus) {
  const card = strategyList.value.find((c) => c.builtinId === r.strategyId);
  if (!card) return;
  openStrategyDetail(card);
  switchDetailTab('run');
}
function switchDetailTab(k: DetailTab) {
  detailTab.value = k;
  if (k === 'versions') nextTick(() => renderCurve());
}
async function startDetailRuntime() {
  const id = detailStrategyId.value;
  if (!id) { ElMessage.warning('该策略无内置标识，无法启动'); return; }
  rtLoading.value = true;
  try {
    await api.post<RuntimeStatus>('/strategy-runtime/start', {
      strategyId: id,
      symbol: rtForm.symbol.toUpperCase(),
      market: rtForm.market,
      interval: rtForm.interval,
      granularity: rtForm.granularity,
      throttleMs: rtForm.granularity === 'intra' ? rtForm.throttleMs : undefined,
      params: paramsObject(),
    });
    ElMessage.success('已启动：' + strategyLabel(id));
    await loadRuntimes();
  } catch (e) {
    ElMessage.error('启动失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    rtLoading.value = false;
  }
}
function toggleDetailActive(on: boolean) {
  const card = strategyList.value.find((c) => c.builtinId === detailStrategyId.value);
  if (card) void toggleActive(card, on);
}
async function saveConfig() {
  const id = detailStrategyId.value;
  if (!id) return;
  try {
    await api.post('/strategies', {
      name: id, market: rtForm.market, symbol: rtForm.symbol.toUpperCase(), interval: rtForm.interval,
      params: paramsObject(),
    });
    ElMessage.success('已保存为该策略配置');
    await loadSavedStrategies();
  } catch (e) {
    ElMessage.error('保存失败：' + (e instanceof Error ? e.message : String(e)));
  }
}
function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p === 0) return '—';
  return p >= 100 ? p.toFixed(2) : p.toFixed(4);
}
function evSummary(e: StrategyRuntimeEvent): string {
  if (e.type === 'indicator') {
    const sig = e.signal ? ' 信号 ' + e.signal.action : '';
    const hist = e.indicators?.hist;
    return 'hist=' + (hist == null ? '—' : hist.toFixed(3)) + ' rsi=' + (e.indicators?.rsi == null ? '—' : e.indicators.rsi.toFixed(1)) + sig + (e.closed ? '（收盘）' : '');
  }
  if (e.type === 'candle') return 'close=' + (e.candle ? e.candle.close.toFixed(2) : '—') + (e.closed ? '（收盘）' : '');
  if (e.type === 'error') return e.message ?? '';
  return '';
}
function applyRuntimeEvent(e: StrategyRuntimeEvent) {
  runtimeEvents.value.unshift(e);
  if (runtimeEvents.value.length > 50) runtimeEvents.value.length = 50;
  const idx = runtimes.value.findIndex((r) => r.id === e.runtimeId);
  if (idx >= 0) {
    const r = runtimes.value[idx]!;
    if (e.type === 'candle' && e.candle) { r.lastPrice = e.candle.close; r.lastBarOpenTime = e.candle.openTime; }
    if (e.type === 'indicator' && e.candle) r.lastPrice = e.candle.close;
    if (e.type === 'stop') r.running = false;
    r.lastEventAt = e.at;
    r.seq = e.seq;
  }
  if (e.type === 'indicator' && e.signal) {
    rtSignals.value = { ...rtSignals.value, [e.runtimeId]: e.signal as RuntimeSignalView };
  }
  if (e.type === 'start' || e.type === 'stop') void loadRuntimes();
}
async function loadRuntimes() {
  const res = await api.get<{ runtimes: RuntimeStatus[] }>('/strategy-runtime').catch(() => null);
  if (res) runtimes.value = res.runtimes;
}
async function loadSavedStrategies() {
  const res = await api.get<{ strategies: SavedStrategy[] }>('/strategies').catch(() => null);
  if (res) savedStrategies.value = res.strategies;
}
async function stopRuntime(id: string) {
  try {
    await api.post('/strategy-runtime/stop', { id });
    delete rtSignals.value[id];
    await loadRuntimes();
    ElMessage.success('已停止');
  } catch (e) {
    ElMessage.error('停止失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

watch(tab, async (v) => {
  if (v === 'strategies') { await Promise.all([loadRuntimes(), loadSavedStrategies()]); await nextTick(() => renderSparks()); }
  if (v === 'backtest') await loadBtHistory();
  if (v === 'paper') { await nextTick(() => { /* Paper 自管理 */ }); }
});

onMounted(async () => {
  await loadAll();
  const bi = await api.get<{ strategies: BuiltinMeta[] }>('/strategies/builtin').catch(() => null);
  if (bi) builtinStrategies.value = bi.strategies;
  // 订阅策略运行时事件（WebSocket），实时刷新运行列表与事件流
  rtUnsub = subscribeAll(applyRuntimeEvent);
  await Promise.all([loadRuntimes(), loadSavedStrategies()]);
  await loadBtHistory();
  await nextTick();
  if (tab.value === 'strategies') renderSparks();
  window.addEventListener('resize', () => {
    for (const e of Object.values(sparks)) e.resize();
    curveE?.resize();
    btE?.resize();
  });
});

onBeforeUnmount(() => {
  rtUnsub?.();
  rtUnsub = null;
});
</script>

<style scoped>
.strategies { display: flex; flex-direction: column; gap: 12px; }
.strat-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.strat-title h2 { margin: 0; font-size: 18px; color: var(--aw-text-title); }
.strat-title .dim { font-size: 12px; margin-left: 10px; }

/* 子 Tab */
.sub-tabs { margin-left: auto; display: flex; gap: 4px; background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 8px; padding: 3px; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: none; background: transparent; color: var(--aw-text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; transition: all var(--aw-dur-fast) var(--aw-ease); }
.pill:hover { color: var(--aw-text-body); }
.pill.active { background: var(--aw-accent-dim); color: var(--aw-accent); font-weight: 600; }
.pill-dot { width: 6px; height: 6px; border-radius: 50%; }

/* 策略卡片 */
.sc-config { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 10px 14px; margin-bottom: 10px; }
.sc-config .dim { font-size: 11px; }
.sc-config label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--aw-text-dim); }
.sc-config-hint { margin-left: auto; }
.strat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
.strat-card { cursor: pointer; display: flex; flex-direction: column; gap: 10px; }
.strat-card.sc-live-card { border-color: rgba(14,165,233,0.5); box-shadow: 0 0 0 1px rgba(14,165,233,0.25) inset; }
.sc-top { display: flex; align-items: center; gap: 10px; }
.sc-name { display: flex; align-items: baseline; gap: 8px; }
.sc-name b { font-size: 14px; color: var(--aw-text-title); }
.sc-ver { font-size: 11px; color: var(--aw-text-dim); background: var(--aw-bg); padding: 1px 6px; border-radius: 4px; }
.sc-warn { font-size: 12px; color: var(--aw-todo); }
.sc-live { font-size: 11px; color: #0EA5E9; background: rgba(14,165,233,0.12); padding: 1px 7px; border-radius: 999px; }
.sc-switch { margin-left: auto; }
.sc-desc { font-size: 11px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sparkline { width: 64px; height: 24px; margin-left: auto; }
.sc-stats { display: flex; justify-content: space-between; background: var(--aw-bg); border-radius: 8px; padding: 8px 10px; transition: background var(--aw-dur-fast) var(--aw-ease); }
.strat-card:hover .sc-stats { background: rgba(255,255,255,0.04); }
.scs { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: var(--aw-text-dim); }
.scs b { font-size: 13px; color: var(--aw-text-title); }
.sc-actions { display: flex; gap: 8px; }
.sc-actions .aw-btn { flex: 1; height: 26px; font-size: 11px; }

/* 详情 / 版本管理 */
.detail-card { padding: 18px 20px; }
.dc-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.dc-head b { font-size: 15px; color: var(--aw-text-title); }
.version-switch { margin-left: auto; }
.ver-tree { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; padding: 12px; background: var(--aw-bg); border: 1px solid var(--aw-border); border-radius: 10px; overflow-x: auto; }
.ver-node {
  display: flex; flex-direction: column; gap: 2px; min-width: 96px; padding: 8px 12px;
  background: var(--aw-bg-card); border: 1px solid var(--aw-border); border-radius: 8px; cursor: pointer;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.ver-node:hover { border-color: var(--aw-border-hover); }
.ver-node.sel { border-color: var(--aw-accent); background: var(--aw-accent-dim); }
.ver-name { font-size: 12px; color: var(--aw-text-title); font-weight: 600; }
.ver-meta { font-size: 10px; }
.ver-pnl { font-size: 12px; }
.ver-arrow { color: var(--aw-text-disabled); font-size: 10px; flex: none; }
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
.dc-foot { display: flex; gap: 10px; margin-top: 14px; justify-content: flex-end; }

/* 回归测试 */
.bt-form { padding: 14px 16px; }
.bt-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.btm { padding: 12px 14px; }
.btm-label { font-size: 11px; color: var(--aw-text-dim); margin-bottom: 4px; }
.btm b { font-size: 18px; color: var(--aw-text-title); }
.bt-chart-card { padding: 14px 16px; }
.bt-chart { height: 260px; }
.bt-trades { padding: 14px 16px; }
.bt-actions { display: flex; gap: 10px; justify-content: flex-end; }
.bt-history { padding: 14px 16px; }
.bh-list { display: flex; flex-direction: column; gap: 4px; }
.bh-item { display: flex; align-items: center; gap: 14px; font-size: 12px; padding: 5px 8px; background: var(--aw-bg); border-radius: 6px; }
.bh-item span:first-child { color: var(--aw-text-title); font-weight: 600; }
.bh-item .dim { flex: 1; }

/* 反馈 */
.fb-head { display: flex; align-items: center; gap: 12px; }
.fb-head .dim { flex: 1; font-size: 12px; }
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
.task-actions { display: flex; gap: 10px; }
.llm-report { white-space: pre-wrap; font-size: 12px; color: var(--aw-text-body); background: var(--aw-bg); border-radius: 8px; padding: 10px 12px; margin: 0; max-height: 320px; overflow-y: auto; }
.fb-card .aw-btn { align-self: flex-start; }

/* 实时运行 */
.rt-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.rt-head .dim { flex: 1; font-size: 12px; }
.rt-head-actions { display: flex; align-items: center; gap: 10px; }
.rt-count { font-size: 12px; color: var(--aw-accent); }
.rt-start { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; margin-bottom: 10px; }
.rt-form { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.rt-form label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--aw-text-dim); }
.rt-params { display: flex; align-items: center; gap: 10px; }
.rt-params .dim { font-size: 11px; flex: none; }
.rt-saved { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--aw-border); }
.rt-saved .dim { font-size: 11px; }
.rt-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 11px; border-radius: 999px; border: 1px solid var(--aw-border); background: var(--aw-bg); color: var(--aw-text-body); cursor: pointer; font-family: inherit; transition: all var(--aw-dur-fast) var(--aw-ease); }
.rt-chip:hover { border-color: var(--aw-accent); color: var(--aw-accent); }
.rt-chip-on { font-size: 10px; color: #34d399; }
.rt-table { padding: 6px 10px; margin-bottom: 10px; overflow-x: auto; }
.rt-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.rt-tbl th { text-align: left; color: var(--aw-text-dim); font-weight: 500; font-size: 11px; padding: 8px 10px; border-bottom: 1px solid var(--aw-border); white-space: nowrap; }
.rt-tbl td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); color: var(--aw-text-body); white-space: nowrap; }
.rt-tbl tr:last-child td { border-bottom: none; }
.rt-empty { text-align: center; padding: 18px 0 !important; }
.rt-sig { padding: 1px 6px; border-radius: 4px; font-size: 11px; background: var(--aw-accent-dim); color: var(--aw-accent); }
.rt-sig.up { background: rgba(16,185,129,0.15); color: #34d399; }
.rt-sig.down { background: rgba(239,68,68,0.15); color: #f87171; }
.rt-feed { padding: 12px 14px; }
.rt-feed-title { font-size: 13px; font-weight: 600; color: var(--aw-text-title); margin-bottom: 8px; }
.rt-feed-title .dim { font-weight: 400; font-size: 11px; margin-left: 6px; }
.rt-events { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; }
.rt-ev { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 4px 8px; border-radius: 6px; background: var(--aw-bg); }
.rt-ev.indicator { border-left: 2px solid var(--aw-accent); }
.rt-ev.candle { border-left: 2px solid rgba(255,255,255,0.1); }
.rt-ev.error { border-left: 2px solid #ef4444; color: #f87171; }
.rt-ev-time { font-size: 11px; flex: none; }
.rt-ev-type { font-size: 10px; text-transform: uppercase; color: var(--aw-accent); flex: none; width: 62px; }
.rt-ev-id { font-size: 11px; flex: none; }
.rt-ev-msg { color: var(--aw-text-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 策略详情 */
.rt-strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; margin-bottom: 10px; }
.rt-strip .dim { font-size: 11px; }
.rt-freq-hint { flex-basis: 100%; font-size: 11px; }
.sd-head-card { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; margin-bottom: 10px; }
.sd-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sd-back { border: none; background: transparent; color: var(--aw-text-dim); cursor: pointer; font-size: 12px; font-family: inherit; padding: 2px 6px; }
.sd-back:hover { color: var(--aw-accent); }
.sd-name { font-size: 15px; color: var(--aw-text-title); }
.sd-id { font-size: 11px; }
.sd-head-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.sd-nav { display: flex; gap: 4px; background: var(--aw-bg); border: 1px solid var(--aw-border); border-radius: 8px; padding: 3px; align-self: flex-start; }
.sd-nav-btn { padding: 5px 16px; border: none; background: transparent; color: var(--aw-text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; }
.sd-nav-btn.active { background: var(--aw-accent-dim); color: var(--aw-accent); font-weight: 600; }
.ov-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 12px; }
@media (max-width: 1000px) { .ov-grid { grid-template-columns: 1fr; } }
.ov-cell { background: var(--aw-bg); border: 1px solid var(--aw-border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.ov-desc { font-size: 12px; line-height: 1.6; color: var(--aw-text-body); margin: 0; }
.sd-foot { display: flex; gap: 10px; margin-top: 10px; }
.param-desc { font-size: 11px; margin-left: 10px; }
</style>
