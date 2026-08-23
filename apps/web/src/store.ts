// ================= 全局账户状态 =================
// 顶栏账户选择器 + 各页面数据源的统一入口：页面数据跟随当前选中的账户。
import { computed, reactive } from 'vue';
import { api } from './api.ts';

export interface AccountOption {
  id: string;
  name: string;
  type: 'real' | 'paper';
}

export const accountStore = reactive<{
  accounts: AccountOption[];
  loaded: boolean;
  selectedId: string;
}>({
  accounts: [],
  loaded: false,
  selectedId: localStorage.getItem('aw-account') ?? '',
});

export const selectedAccount = computed<AccountOption | null>(
  () => accountStore.accounts.find((a) => a.id === accountStore.selectedId) ?? null,
);

// ---------- 界面偏好（localStorage 持久化） ----------
/** 仪表板是否显示账户余额（权益）。设置页「账户余额显示」开关控制，默认显示。 */
export const uiPrefs = reactive<{ fundsVisible: boolean }>({
  fundsVisible: localStorage.getItem('aw-show-funds') !== '0',
});

export function setFundsVisible(v: boolean): void {
  uiPrefs.fundsVisible = v;
  localStorage.setItem('aw-show-funds', v ? '1' : '0');
}

export function accountLabel(a: AccountOption | null): string {
  return a ? (a.type === 'real' ? '真实 · ' : '模拟 · ') + a.name : '未选择账户';
}

export function selectAccount(id: string): void {
  accountStore.selectedId = id;
  localStorage.setItem('aw-account', id);
}

/**
 * 加载账户列表。默认保持已有选择；无有效选择时：
 * 优先 prefer（real/paper），否则取第一个账户。
 */
export async function loadAccounts(prefer: 'real' | 'paper' | null = null): Promise<void> {
  const res = await api.get<{ accounts: AccountOption[] }>('/accounts').catch(() => null);
  if (!res) return;
  accountStore.accounts = res.accounts;
  accountStore.loaded = true;
  const valid = res.accounts.some((a) => a.id === accountStore.selectedId);
  if (!valid) {
    const target =
      (prefer ? res.accounts.find((a) => a.type === prefer) : undefined) ??
      (prefer == null ? res.accounts.find((a) => a.type === 'real') : undefined) ??
      res.accounts[0];
    accountStore.selectedId = target?.id ?? '';
    localStorage.setItem('aw-account', accountStore.selectedId);
  }
}
