import type { Market } from '@agentwin/shared';

export const SPOT_WS_BASE = 'wss://stream.binance.com:9443';
export const FUTURES_WS_BASE = 'wss://fstream.binance.com';

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
  private readonly opts: { onStatus?: (status: 'open' | 'close' | 'error', detail?: string) => void };

  constructor(market: Market, opts: { onStatus?: (status: 'open' | 'close' | 'error', detail?: string) => void } = {}) {
    this.market = market;
    this.opts = opts;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private wsBase(): string {
    return this.market === 'SPOT' ? SPOT_WS_BASE : FUTURES_WS_BASE;
  }

  private buildUrl(): string {
    const streams = [...this.handlers.keys()];
    return this.wsBase() + '/stream?streams=' + streams.join('/');
  }

  connect(): Promise<void> {
    if (this.connected || this.connecting) return Promise.resolve();
    if (this.handlers.size === 0) return Promise.resolve();
    this.closedByUser = false;
    this.connecting = true;
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.buildUrl());
      this.ws = ws;
      const onOpen = () => {
        this.connecting = false;
        this.retryDelay = 1000;
        this.opts.onStatus?.('open');
        this.startPing();
        resolve();
      };
      const onError = (e: Event) => {
        this.connecting = false;
        this.opts.onStatus?.('error', String((e as ErrorEvent).message ?? ''));
        if (!this.closedByUser) reject(new Error('BinanceWs connect error: ' + String((e as ErrorEvent).message ?? '')));
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', () => {
        this.connecting = false;
        this.stopPing();
        this.opts.onStatus?.('close');
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
            // 单流模式兜底：按事件类型分发
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
