// ================= 全局共享实时价格源（WebSocket） =================
// 单一连接 + 多订阅者：顶栏价格、各页面行情共用后端 /api/ws/prices 的推送，
// 替代各自轮询；断线自动重连（指数退避）。

export interface PriceTick {
  type: 'ticker';
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  at: number;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let started = false;
const listeners = new Map<string, Set<(t: PriceTick) => void>>();
const latest = new Map<string, PriceTick>();
const desired = new Set<string>(); // 已订阅的符号（连接建立后补发订阅）

function wsUrl(): string {
  const base = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');
  if (base.startsWith('http')) return base.replace(/^http/, 'ws') + '/ws/prices';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return proto + '://' + location.host + base + '/ws/prices';
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
    for (const s of desired) ws.send(JSON.stringify({ type: 'subscribe', symbol: s }));
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { type?: string; symbol?: string; lastPrice?: number; priceChangePercent?: number; at?: number };
      if (msg.type === 'ticker' && msg.symbol && typeof msg.lastPrice === 'number') {
        const t: PriceTick = { type: 'ticker', symbol: String(msg.symbol).toUpperCase(), lastPrice: msg.lastPrice, priceChangePercent: msg.priceChangePercent ?? 0, at: msg.at ?? Date.now() };
        latest.set(t.symbol, t);
        const set = listeners.get(t.symbol);
        if (set) for (const cb of set) cb(t);
      }
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

/** 订阅某品种实时价格，返回取消订阅函数 */
export function subscribePrice(symbol: string, cb: (t: PriceTick) => void): () => void {
  const sym = symbol.toUpperCase();
  if (!listeners.has(sym)) listeners.set(sym, new Set());
  listeners.get(sym)!.add(cb);
  desired.add(sym);
  started = true;
  connect();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
  }
  return () => {
    const set = listeners.get(sym);
    if (set) {
      set.delete(cb);
      if (set.size === 0) {
        listeners.delete(sym);
        desired.delete(sym);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'unsubscribe', symbol: sym }));
        }
      }
    }
  };
}

/** 最近一次价格快照（未收到过推送时为 null） */
export function latestPrice(symbol: string): PriceTick | null {
  return latest.get(symbol.toUpperCase()) ?? null;
}
