// ================= 策略运行时事件流（WebSocket 下游消费） =================
// 连接后端 /api/ws/strategy，消费后台策略运行时发出的实时事件：
//   candle    —— 最新 K 线更新（可用于实时刷新图表）
//   indicator —— 指标快照（EMA/MACD/RSI）+ 策略信号
//   start/stop/error
// 单一连接 + 多订阅者；断线自动重连，重连后补发订阅。

export type StrategyEventType = 'start' | 'stop' | 'candle' | 'indicator' | 'error';

export interface StrategyIndicatorSnapshot {
  fast: number; slow: number; signal: number;
  emaFast: number | null; emaSlow: number | null;
  dif: number | null; dea: number | null; hist: number | null; rsi: number | null;
}

export interface StrategyRuntimeSignal {
  action: string; sizeMode: string; size: number; reason: string;
}

export interface StrategyRuntimeEvent {
  type: StrategyEventType;
  runtimeId: string;
  seq: number;
  at: number;
  symbol: string;
  market: string;
  interval: string;
  strategyId: string;
  candle?: { openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number };
  closed?: boolean;
  indicators?: StrategyIndicatorSnapshot;
  signal?: StrategyRuntimeSignal | null;
  message?: string;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let started = false;
const listeners = new Map<string, Set<(e: StrategyRuntimeEvent) => void>>();
const allListeners = new Set<(e: StrategyRuntimeEvent) => void>();
const desired = new Set<string>(); // 已订阅的 runtimeId（建立连接后补发）
let wantAll = false; // 是否订阅全部运行时

function wsUrl(): string {
  const base = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');
  if (base.startsWith('http')) return base.replace(/^http/, 'ws') + '/ws/strategy';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return proto + '://' + location.host + base + '/ws/strategy';
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    reconnectDelay = 1000;
    for (const id of desired) ws.send(JSON.stringify({ type: 'subscribe', runtimeId: id }));
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { type?: string; event?: StrategyRuntimeEvent };
      if (msg.type !== 'strategy-event' || !msg.event) return;
      const e = msg.event;
      const set = listeners.get(e.runtimeId);
      if (set) for (const cb of set) cb(e);
      for (const cb of allListeners) cb(e);
    } catch {
      /* 忽略非法消息 */
    }
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    try { ws.close(); } catch { /* ignore */ }
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer || !started) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

/** 订阅某个策略运行时的事件，返回取消订阅函数 */
export function subscribeRuntime(runtimeId: string, cb: (e: StrategyRuntimeEvent) => void): () => void {
  const id = runtimeId.trim();
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(cb);
  desired.add(id);
  started = true;
  connect();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'subscribe', runtimeId: id }));
  }
  return () => {
    const set = listeners.get(id);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      listeners.delete(id);
      desired.delete(id);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'unsubscribe', runtimeId: id }));
      }
    }
  };
}

/** 订阅全部运行时的实时事件（调试/全局面板用） */
export function subscribeAll(cb: (e: StrategyRuntimeEvent) => void): () => void {
  allListeners.add(cb);
  wantAll = true;
  started = true;
  connect();
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe' }));
  return () => {
    allListeners.delete(cb);
    if (allListeners.size === 0) {
      wantAll = false;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'unsubscribe' }));
    }
  };
}

/** 是否已订阅全部运行时（诊断用） */
export function isSubscribedToAll(): boolean {
  return wantAll;
}
