import type { Market } from '@agentwin/shared';

export const SPOT_WS_BASE = 'wss://stream.binance.com:9443';
export const SPOT_DATA_STREAM_BASE = 'wss://data-stream.binance.vision';
export const FUTURES_WS_BASE = 'wss://fstream.binance.com';

function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

type WsMessageHandler = (raw: Record<string, unknown>) => void;

function streamName(sub: { symbol: string; stream: string }): string {
  return sub.symbol.toLowerCase() + '@' + sub.stream;
}

/**
 * Binance WebSocket 客户端：单连接 + 合并流（combined streams），自动重连、心跳。
 * 消息通过 stream 字段路由到对应 handler。
 */
export class BinanceWs {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<WsMessageHandler>>();
  private connecting = false;
  private closedByUser = false;
  private retryDelay = 1000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private readonly market: Market;
  private readonly opts: {
    onStatus?: (status: 'open' | 'close' | 'error', detail?: string) => void;
    /** 显式指定 WS 端点（覆盖官方域名） */
    baseUrl?: string;
  };

  constructor(market: Market, opts: { onStatus?: (status: 'open' | 'close' | 'error', detail?: string) => void; baseUrl?: string } = {}) {
    this.market = market;
    this.opts = opts;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private wsBaseCandidates(): string[] {
    const list: string[] = [];
    if (this.opts.baseUrl) list.push(this.opts.baseUrl);
    if (process.env.BINANCE_WS_BASE_URL) list.push(process.env.BINANCE_WS_BASE_URL);
    if (this.market === 'SPOT') {
      list.push(SPOT_WS_BASE, SPOT_DATA_STREAM_BASE);
    } else {
      list.push(FUTURES_WS_BASE);
    }
    return dedupe(list);
  }

  private buildUrl(base: string): string {
    const streams = [...this.handlers.keys()];
    return base + '/stream?streams=' + streams.join('/');
  }

  /** 依次尝试候选主机，直到连接成功 */
  connect(): Promise<void> {
    if (this.connected || this.connecting) return Promise.resolve();
    if (this.handlers.size === 0) return Promise.resolve();
    this.closedByUser = false;
    this.connecting = true;
    const candidates = this.wsBaseCandidates();
    return this.tryConnect(candidates, 0);
  }

  private tryConnect(candidates: string[], idx: number): Promise<void> {
    if (idx >= candidates.length) {
      this.connecting = false;
      return Promise.reject(new Error('BinanceWs: all stream hosts unreachable — 检查网络或设置 BINANCE_WS_BASE_URL'));
    }
    const base = candidates[idx]!;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.buildUrl(base));
      this.ws = ws;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        this.opts.onStatus?.('error', reason);
        try { ws.close(); } catch { /* ignore */ }
        this.tryConnect(candidates, idx + 1).then(resolve, reject);
      };
      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        this.connecting = false;
        this.retryDelay = 1000;
        this.opts.onStatus?.('open');
        this.startPing();
        resolve();
      });
      ws.addEventListener('error', () => fail('connect error on ' + base));
      ws.addEventListener('close', () => {
        this.connecting = false;
        this.stopPing();
        this.opts.onStatus?.('close');
        if (!settled) {
          settled = true;
          this.tryConnect(candidates, idx + 1).then(resolve, reject);
          return;
        }
        if (!this.closedByUser && this.handlers.size > 0) this.scheduleReconnect();
      });
      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (msg['stream'] && typeof msg['stream'] === 'string') {
            const set = this.handlers.get(msg['stream']);
            if (set) {
              const data = (msg['data'] ?? {}) as Record<string, unknown>;
              for (const h of set) h(data);
            }
          } else if (msg['e'] && typeof msg['e'] === 'string') {
            const key = String(msg['s'] ?? '').toLowerCase() + '@' + msg['e'];
            const set = this.handlers.get(key) ?? this.handlers.get('*');
            if (set) for (const h of set) h(msg);
          }
        } catch {
          /* 忽略非 JSON 消息（如 PONG） */
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.connecting) return;
    setTimeout(() => {
      if (this.closedByUser || this.handlers.size === 0) return;
      this.connect().catch(() => {
        this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
      });
    }, this.retryDelay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('{"method":"PING"}');
    }, 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** 订阅流，返回退订函数 */
  subscribe(stream: string, handler: WsMessageHandler): () => void {
    if (!this.handlers.has(stream)) this.handlers.set(stream, new Set());
    this.handlers.get(stream)!.add(handler);
    if (this.connected) {
      // 已有连接则重连以应用新流（简化处理）
      this.reconnectSoon();
    } else {
      this.connect().catch(() => { /* 重连逻辑接管 */ });
    }
    return () => {
      const set = this.handlers.get(stream);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.handlers.delete(stream);
      }
    };
  }

  private reconnectSoon(): void {
    if (this.closedByUser) return;
    try { this.ws?.close(); } catch { /* ignore */ }
  }

  close(): void {
    this.closedByUser = true;
    this.stopPing();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.handlers.clear();
  }
}

export function klineStream(symbol: string, interval: string): string {
  return symbol.toLowerCase() + '@kline_' + interval;
}
export function aggTradeStream(symbol: string): string {
  return symbol.toLowerCase() + '@aggTrade';
}
export function bookTickerStream(symbol: string): string {
  return symbol.toLowerCase() + '@bookTicker';
}
export function markPriceStream(symbol: string): string {
  return symbol.toLowerCase() + '@markPrice@1s';
}
