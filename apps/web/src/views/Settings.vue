<template>
  <div class="settings aw-page">
    <!-- 2×2 网格：币安连接 / 代理与网络 / 存储状态 / 危险操作 -->
    <div class="set-grid">
      <!-- ============ 币安连接 ============ -->
      <div class="aw-card set-card">
        <div class="sc-title">币安连接</div>

        <!-- 顶部状态行 -->
        <div class="status-row">
          <span class="st-item">
            <span class="st-dot" :class="connCls"></span>{{ connText }}
          </span>
          <span class="st-sep">│</span>
          <span class="st-item">Key: <b :class="keyOk ? 'up' : 'down'">{{ keyText }}</b></span>
          <span class="st-sep">│</span>
          <span class="st-item">主域名: <b :class="bs?.reachable ? 'up' : 'down'">{{ bs?.reachable ? '可达' : '不可达' }}</b></span>
          <span class="st-sep">│</span>
          <span class="st-item">代理: <b :class="bs?.proxy?.enabled ? 'up' : ''">{{ bs?.proxy?.enabled ? '已开启' : '关闭' }}</b></span>
        </div>

        <!-- 关键指标 -->
        <div class="kv-list">
          <div class="kv-row">
            <span class="kv-label">最近同步</span>
            <span class="kv-value mono">{{ fmtLastSync }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">账户</span>
            <span class="kv-value">{{ realCount }} 个真实账户</span>
          </div>
        </div>

        <!-- 同步日志（折叠） -->
        <div class="sync-log">
          <div class="sl-summary" @click="logOpen = !logOpen">
            <span class="sl-dot" :class="syncOkCls"></span>
            <span class="sl-text">同步结果: {{ syncSummary }}</span>
            <button class="aw-btn aw-btn-text sl-toggle">{{ logOpen ? '收起 ▲' : '查看详情 ▾' }}</button>
          </div>
          <transition name="fade">
            <div v-if="logOpen" class="sl-body mono">
              <div v-for="(l, i) in syncLines" :key="i" class="sl-line" :class="{ err: l.err }">{{ l.text }}</div>
              <div v-if="!syncLines.length" class="sl-line dim">暂无同步记录</div>
            </div>
          </transition>
        </div>

        <!-- 操作按钮 -->
        <div class="set-actions">
          <button class="aw-btn aw-btn-primary btn-lg" :disabled="syncing" @click="sync">
            <el-icon v-if="syncing" class="is-loading"><Loading /></el-icon>从币安同步
          </button>
          <button class="aw-btn aw-btn-secondary btn-lg" :disabled="diagnosing" @click="diagnose">诊断</button>
        </div>
        <pre v-if="diag" class="diag mono">{{ diag }}</pre>

        <!-- 界面显示：账户余额开关 + 行情刷新周期（并入币安连接底部） -->
        <div class="sc-divider"></div>
        <div class="pref-row">
          <div>
            <b>账户余额显示</b>
            <div class="pref-desc dim">在仪表盘显示账户余额（权益）；关闭后余额以 <span class="mono">****</span> 隐藏</div>
          </div>
          <el-switch v-model="fundsVisible" @change="onFundsToggle" />
        </div>
        <div class="pref-row">
          <div>
            <b>行情刷新周期</b>
            <div class="pref-desc dim">K 线图自动刷新间隔（1–60 秒），默认 1 秒；数据无变化时自动跳过，不触发限流</div>
          </div>
          <el-input-number
            v-model="marketRefresh"
            :min="1"
            :max="60"
            size="small"
            class="refresh-input"
            @change="onMarketRefresh"
          />
          <span class="dim">秒</span>
        </div>
      </div>

      <!-- ============ 代理与网络 ============ -->
      <div class="aw-card set-card">
        <div class="sc-title">代理与网络</div>

        <!-- 代理开关（switch）：开=走代理，关=直连 -->
        <div class="kv-row">
          <span class="kv-label">使用代理</span>
          <el-switch v-model="proxySwitch" active-text="走代理" inactive-text="直连" />
        </div>

        <!-- 代理地址输入 -->
        <div class="kv-row">
          <span class="kv-label">代理地址</span>
          <div class="proxy-input-wrap">
            <el-input
              v-model="proxyUrl"
              :disabled="proxyMode === 'off'"
              placeholder="http://127.0.0.1:7890"
              class="proxy-input mono"
              @keyup.enter="applyProxy"
            />
          </div>
        </div>
        <div class="set-actions">
          <button class="aw-btn aw-btn-primary btn-lg" :disabled="proxySaving" @click="applyProxy">
            <el-icon v-if="proxySaving" class="is-loading"><Loading /></el-icon>应用
          </button>
        </div>

        <!-- 出口信息 -->
        <div class="exit-line dim">
          出口国家: <b :class="proxyExitRestricted ? 'down' : 'up'">{{ proxyExitCountry }}</b>
          <span class="exit-note">（{{ proxyExitState }}）</span>
        </div>
      </div>

      <!-- ============ 存储状态 ============ -->
      <div class="aw-card set-card">
        <div class="sc-title">存储状态</div>
        <div class="kv-list">
          <div class="kv-row">
            <span class="kv-label">引擎</span>
            <span class="kv-value mono">{{ health?.storage ?? '—' }}</span>
          </div>
          <div class="kv-tree">
            <div class="kv-row sub"><span class="kv-label">├─ 主存储</span><span class="kv-value mono">JSONL (data/trade-journal.jsonl)</span></div>
            <div class="kv-row sub"><span class="kv-label">└─ 辅助查询</span><span class="kv-value mono">SQLite (查询/恢复)</span></div>
          </div>
          <div class="kv-row">
            <span class="kv-label">交易日志</span>
            <span class="kv-value mono">{{ jstat?.total ?? 0 }} 条</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">账户</span>
            <span class="kv-value mono">{{ accounts.length }} 个（{{ realCount }} 真实）</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">主存储目录</span>
            <span class="kv-value mono" :title="storage?.dataDir ?? ''">{{ storage?.dataDir ?? '—' }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">交易日志文件</span>
            <span class="kv-value mono" :title="storage?.journalPath ?? ''">{{ storage?.journalPath ?? '—' }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">辅助数据库</span>
            <span class="kv-value mono" :title="storage?.dbPath ?? ''">{{ storage?.dbPath ?? '—' }}</span>
          </div>
          <div class="storage-edit">
            <el-input
              v-model="storageInput"
              placeholder="输入存储目录（自动追加 trade-journal.jsonl）或 .jsonl 文件路径"
              class="mono"
              @keyup.enter="saveStorage"
            />
            <button class="aw-btn aw-btn-primary btn-lg" :disabled="storageSaving" @click="saveStorage">
              <el-icon v-if="storageSaving" class="is-loading"><Loading /></el-icon>保存路径
            </button>
          </div>
        </div>
        <div class="sc-note dim">JSONL 为主存储，SQLite 辅助查询/恢复。修改主存储路径即时生效并持久化，重启后继续使用。</div>
      </div>

      <!-- ============ 危险操作 ============ -->
      <div class="aw-card set-card danger-card">
        <div class="sc-title danger-title">⚠️ 清空数据库并重新同步</div>
        <p class="danger-desc">
          此操作将删除全部本地数据（账户/成交/日志/策略等），
          并立即从币安重新同步历史成交。模拟账户将被关闭。
        </p>
        <div class="danger-actions">
          <button class="aw-btn aw-btn-secondary btn-lg" :disabled="!armed || resetting" @click="armed = false">取消</button>
          <button class="aw-btn aw-btn-danger btn-lg" :disabled="resetting" @click="onResetClick">
            <el-icon v-if="resetting" class="is-loading"><Loading /></el-icon>{{ armed ? '再次点击，确认清空' : '确认清空' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api.ts';
import { loadAccounts, setFundsVisible, uiPrefs } from '../store.ts';

interface ProxyCfg { mode?: 'off' | 'on' | 'auto'; url?: string; enabled?: boolean }
interface BinanceStatus {
  configured?: boolean; hasKey?: boolean; hasSecret?: boolean; missing?: string[];
  reachable?: boolean; message?: string; spotHost?: string; futuresHost?: string;
  proxy?: ProxyCfg; lastSync?: { at?: number; ok?: boolean; message?: string; balancesUpserted?: number };
}
interface SyncReport {
  ok: boolean; balancesUpserted?: number; futuresPositions?: number;
  tradesSynced?: number; tradesSkipped?: number; equityAppended?: boolean; message?: string; at?: number;
}

const bs = ref<BinanceStatus | null>(null);
interface StoragePaths { dataDir: string; journalPath: string; dbPath: string }
const storage = ref<StoragePaths | null>(null);
const storageInput = ref('');
const storageSaving = ref(false);
const health = ref<{ storage?: string; binance?: { ok?: boolean; detail?: string } } | null>(null);
const accounts = ref<{ id: string; name: string; type: string }[]>([]);
const jstat = ref<{ total?: number } | null>(null);
const syncing = ref(false);
const diagnosing = ref(false);
const diag = ref('');
const proxyUrl = ref('');
const proxyMode = ref<'off' | 'on'>('off');
const proxySaving = ref(false);
const proxyExitCountry = ref('-');
const proxyExitRestricted = ref(false);
const proxyExitState = ref('未检测');

/** 代理地址默认值；本地记住用户填过的地址，切换直连/走代理或刷新都不清空 */
const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890';
const PROXY_URL_KEY = 'aw-proxy-url';
function rememberedProxyUrl(): string {
  return localStorage.getItem(PROXY_URL_KEY) || DEFAULT_PROXY_URL;
}
watch(proxyUrl, (v) => localStorage.setItem(PROXY_URL_KEY, v ?? ''));
const syncLog = ref<SyncReport | null>(null);
const logOpen = ref(false);
const armed = ref(false);
const resetting = ref(false);

/** 账户余额显示开关（仪表板） */
const fundsVisible = computed<boolean>({
  get: () => uiPrefs.fundsVisible,
  set: (v: boolean) => setFundsVisible(v),
});
function onFundsToggle(v: string | number | boolean) {
  ElMessage.success(v ? '已显示账户余额' : '已隐藏账户余额（仪表板余额以 **** 显示）');
}

/** 行情刷新周期（秒，1–60）：K 线图自动刷新间隔，localStorage 持久化，默认 1s */
const marketRefresh = ref<number>(Math.max(1, Math.min(60, Number(localStorage.getItem('aw-market-refresh')) || 1)));
function onMarketRefresh(v: number | undefined) {
  const s = Math.max(1, Math.min(60, Number(v) || 1));
  marketRefresh.value = s;
  localStorage.setItem('aw-market-refresh', String(s));
  ElMessage.success('行情刷新周期已设为 ' + s + ' 秒');
}

/** 连接状态：未配置=断开(红) / 配置但不可达=异常(琥珀) / 正常=已连接(绿) */
const connCls = computed(() => (!bs.value?.configured ? 'off' : !bs.value?.reachable ? 'warn' : 'ok'));
const connText = computed(() => (!bs.value?.configured ? '断开' : !bs.value?.reachable ? '异常' : '已连接'));
const keyOk = computed(() => !!bs.value?.hasSecret);
const keyText = computed(() => {
  if (bs.value?.hasSecret) return '已配置';
  if (bs.value?.hasKey) return '缺 Secret';
  return '未配置';
});
const realCount = computed(() => accounts.value.filter((a) => a.type === 'real').length);

const fmtLastSync = computed(() => {
  const at = bs.value?.lastSync?.at;
  if (!at) return '—';
  return new Date(at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
});

/** 同步摘要：取最近一次手动同步结果，否则取状态里的 lastSync */
const activeSync = computed<SyncReport | null>(() => {
  if (syncLog.value) return syncLog.value;
  const l = bs.value?.lastSync;
  if (!l) return null;
  return { ok: l.ok === true, message: l.message, balancesUpserted: l.balancesUpserted, at: l.at } as SyncReport;
});
const syncOkCls = computed(() => (activeSync.value ? (activeSync.value.ok ? 'ok' : 'err') : 'na'));
const syncSummary = computed(() => {
  const s = activeSync.value;
  if (!s) return '暂无记录';
  return s.ok ? '成功' : ('异常' + (s.message ? '：' + s.message : ''));
});
const syncLines = computed(() => {
  const s = activeSync.value;
  if (!s) return [];
  const lines: { text: string; err?: boolean }[] = [];
  if (s.message) lines.push({ text: s.message, err: !s.ok });
  lines.push({ text: '余额更新: ' + (s.balancesUpserted ?? 0) + ' 项' });
  lines.push({ text: '合约持仓: ' + (s.futuresPositions ?? 0) });
  lines.push({ text: '成交同步: ' + (s.tradesSynced ?? 0) + ' 条（跳过 ' + (s.tradesSkipped ?? 0) + '）' });
  lines.push({ text: '权益记录: ' + (s.equityAppended ? '已追加' : '未追加') });
  return lines;
});

/** 代理开关（switch）：开=走代理(on)，关=直连(off)；切换不主动清空地址 */
const proxySwitch = computed<boolean>({
  get: () => proxyMode.value === 'on',
  set: (v: boolean) => {
    proxyMode.value = v ? 'on' : 'off';
  },
});

async function load() {
  health.value = await api.get<{ storage?: string; binance?: { ok?: boolean; detail?: string } }>('/health').catch(() => null);
  bs.value = await api.get<BinanceStatus>('/binance/status').catch(() => null);
  accounts.value = (await api.get<{ accounts: { id: string; name: string; type: string }[] }>('/accounts')).accounts;
  jstat.value = await api.get<{ total?: number }>('/journal/trades/stats').catch(() => null);
  storage.value = await api.get<StoragePaths>('/settings/storage').catch(() => null);
  if (storage.value) storageInput.value = storage.value.dataDir;
  if (bs.value?.proxy) {
    proxyMode.value = bs.value.proxy.mode === 'off' ? 'off' : 'on';
    proxyUrl.value = bs.value.proxy.url || rememberedProxyUrl();
  }
  const d = await api.get<{ proxyExit?: { country?: string; countryCode?: string; success?: boolean; error?: string } }>('/binance/diagnose').catch(() => null);
  const pe = d?.proxyExit;
  if (pe) {
    if (pe.error) {
      proxyExitCountry.value = '—';
      proxyExitState.value = '异常';
    } else if (pe.country) {
      proxyExitCountry.value = pe.country;
      proxyExitRestricted.value = ['United States', 'US', '美国'].includes(pe.country) || (pe.countryCode === 'US');
      proxyExitState.value = pe.success === false ? '异常' : '正常';
    }
  } else {
    proxyExitCountry.value = '-';
    proxyExitState.value = '未检测';
  }
}

async function sync() {
  syncing.value = true;
  try {
    const res = await api.post<SyncReport>('/binance/sync');
    syncLog.value = res;
    ElMessage.success(res.ok ? '同步成功' : '同步失败：' + (res.message ?? ''));
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    syncing.value = false;
  }
}

async function diagnose() {
  diagnosing.value = true;
  try {
    const d = await api.get('/binance/diagnose').catch(() => null);
    diag.value = d ? JSON.stringify(d, null, 2) : '';
  } finally {
    diagnosing.value = false;
  }
}

async function applyProxy() {
  proxySaving.value = true;
  try {
    const cfg = await api.post<{ enabled: boolean; url?: string }>('/binance/proxy', { mode: proxyMode.value, url: proxyMode.value === 'on' ? proxyUrl.value : undefined });
    proxyMode.value = cfg.enabled ? 'on' : 'off';
    proxyUrl.value = cfg.url || proxyUrl.value || rememberedProxyUrl();
    ElMessage.success('代理已切换：' + (cfg.enabled ? '走 ' + proxyUrl.value : '直连'));
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    proxySaving.value = false;
  }
}

/** 保存存储路径：目录输入自动补 trade-journal.jsonl；后端即时迁移并持久化 */
async function saveStorage() {
  if (!storageInput.value.trim()) {
    ElMessage.warning('请输入存储路径');
    return;
  }
  storageSaving.value = true;
  try {
    const res = await api.post<StoragePaths>('/settings/storage', { journalPath: storageInput.value });
    storage.value = res;
    storageInput.value = res.dataDir;
    ElMessage.success('存储路径已更新：' + res.journalPath);
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    storageSaving.value = false;
  }
}

/** 危险操作：第一次点击武装，第二次执行（配合「取消」解除） */
function onResetClick() {
  if (!armed.value) {
    armed.value = true;
    ElMessage.warning('再次点击「确认清空」执行，此操作不可恢复');
    return;
  }
  doReset();
}

/** 清空数据库并从币安重新同步历史成交（增量起点 = 最新本地记录） */
async function doReset() {
  resetting.value = true;
  try {
    const res = await api.post<{ ok: boolean; sync: { tradesSynced: number; tradesSkipped: number; balancesUpserted: number; ok: boolean; message?: string } }>('/admin/reset');
    ElMessage.success('已清空并同步：成交 ' + (res.sync?.tradesSynced ?? 0) + ' 条（跳过 ' + (res.sync?.tradesSkipped ?? 0) + '）');
    armed.value = false;
    await loadAccounts();
    await load();
  } catch (e) {
    ElMessage.error('清空失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    resetting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settings { width: 100%; } /* 自适应：双列铺满内容区，避免右侧空白 */

/* 2×2 网格：所有卡片等宽，整体对齐 */
.set-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 980px) { .set-grid { grid-template-columns: 1fr; } }

.set-card { padding: 24px; display: flex; flex-direction: column; gap: 16px; min-width: 0; /* 防止长文本(如同步错误信息)把 1fr 网格列撑爆 */ }
.sc-title {
  font-size: 14px; font-weight: 700; color: var(--aw-text-title);
  padding-bottom: 14px; border-bottom: 1px solid var(--aw-border);
}
.sc-divider { height: 1px; background: var(--aw-border); }

/* ---------- 币安连接 ---------- */
.status-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 13px; color: var(--aw-text-body); }
.st-item { display: inline-flex; align-items: center; gap: 6px; }
.st-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--aw-text-disabled); flex: none; }
.st-dot.ok { background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.5); }
.st-dot.warn { background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.5); }
.st-dot.off { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); }
.st-sep { color: var(--aw-text-disabled); font-size: 12px; }

.kv-list { display: flex; flex-direction: column; gap: 12px; }
.kv-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.kv-row.sub { padding-left: 14px; }
.kv-label { color: var(--aw-text-dim); flex: none; }
.kv-value { color: var(--aw-text-body); text-align: right; word-break: break-all; }
.kv-tree { display: flex; flex-direction: column; gap: 6px; }

/* 同步日志 */
.sync-log { border: 1px solid var(--aw-border); border-radius: 10px; overflow: hidden; }
.sl-summary { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; font-size: 13px; transition: background var(--aw-dur-fast) var(--aw-ease); }
.sl-summary:hover { background: rgba(255, 255, 255, 0.03); }
.sl-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--aw-text-disabled); flex: none; }
.sl-dot.ok { background: #10b981; }
.sl-dot.err { background: #ef4444; }
.sl-dot.na { background: var(--aw-text-disabled); }
.sl-text { flex: 1; color: var(--aw-text-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl-toggle { height: 24px; font-size: 11px; }
.sl-body {
  background: #0b0f19; border-top: 1px solid var(--aw-border); border-radius: 0 0 10px 10px;
  padding: 12px; display: flex; flex-direction: column; gap: 4px;
}
.sl-line { font-size: 12px; color: #9ca3af; }
.sl-line.err { color: #ef4444; }

.set-actions { display: flex; gap: 12px; }
.btn-lg { height: 36px; }

/* 界面显示（并入币安连接） */
.pref-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.refresh-input { width: 96px; }
.pref-row b { color: var(--aw-text-title); }
.pref-desc { font-size: 12px; margin-top: 3px; }

/* ---------- 代理与网络 ---------- */
.proxy-input-wrap { flex: 1; min-width: 0; display: flex; justify-content: flex-end; }
.proxy-input { width: 100%; max-width: 300px; }
.exit-line { font-size: 12px; margin-top: auto; padding-top: 14px; border-top: 1px solid var(--aw-border); }
.exit-line b { font-weight: 600; }

/* ---------- 存储状态 ---------- */
.storage-edit { display: flex; align-items: center; gap: 8px; }
.storage-edit .el-input { flex: 1; min-width: 0; }
.sc-note { font-size: 12px; margin-top: auto; }

/* ---------- 危险操作 ---------- */
.danger-card {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.03);
}
.danger-title { color: #f87171; border-bottom-color: rgba(239, 68, 68, 0.2); }
.danger-desc { font-size: 13px; color: #9ca3af; line-height: 1.7; margin: 0; }
.danger-actions { display: flex; gap: 12px; margin-top: auto; }

/* 诊断输出 */
.diag {
  background: #0b0f19; border: 1px solid var(--aw-border); border-radius: 8px;
  padding: 10px 12px; font-size: 11px; max-height: 200px; overflow: auto;
  color: #9ca3af; margin: 0; white-space: pre-wrap;
}

/* 过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity 150ms var(--aw-ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
