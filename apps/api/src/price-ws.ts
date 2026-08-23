import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { BinanceWs } from '@agentwin/market';
import type { ProxyConfig } from '@agentwin/market';

interface TickerData {
  e?: string; // 事件类型 24hrTicker
  s?: string; // 符号
  c?: string; // 最新价
  P?: string; // 24h 涨跌幅 %
}

export interface PriceTick {
  type: 'ticker';
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  at: number;
}

/**
 * 实时价格 WebSocket 服务（/api/ws/prices）：
 * - 后端维持单一 Binance WS 连接（btcusdt@ticker 等），按客户端订阅引用计数；
 * - 所有浏览器客户端共享同一份推送，收到 ticker 即广播（客户端按需过滤符号）；
 * - 顶栏 BTC 价格等全站实时行情共用此源，替代轮询。
 */
export class PriceWsServer {
  private wss: WebSocketServer | null = null;
  private binance: BinanceWs | null = null;
  private clients = new Set<WebSocket>();
  private refs = new Map<string, number>();
  private unsubs = new Map<string, () => void>();
  private readonly proxyConfig: ProxyConfig;

  constructor(proxyConfig: ProxyConfig) {
    this.proxyConfig = proxyConfig;
  }

  attach(app: FastifyInstance): void {
    this.wss = new WebSocketServer({ noServer: true });
    app.server.on('upgrade', (req, socket, head) => {
      let pathname = '';
      try {
        pathname = new URL(req.url ?? '/', 'http://internal').pathname;
      } catch {
        return;
      }
      if (pathname !== '/api/ws/prices') return;
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConn(ws));
    });
    this.binance = new BinanceWs('SPOT', { proxyConfig: this.proxyConfig });
  }

  close(): void {
    try { this.wss?.close(); } catch { /* ignore */ }
    this.wss = null;
    for (const unsub of this.unsubs.values()) unsub();
    this.unsubs.clear();
    this.refs.clear();
    this.binance?.close();
    this.binance = null;
    this.clients.clear();
  }

  private onConn(ws: WebSocket): void {
    this.clients.add(ws);
    const wanted = new Set<string>();
    this.addRef('BTCUSDT', wanted); // 默认推送 BTCUSDT（顶栏价格）
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ready', symbols: [...wanted] }));
    }
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; symbol?: string };
        const sym = String(msg.symbol ?? '').toUpperCase().trim();
        if (!sym) return;
        if (msg.type === 'subscribe') this.addRef(sym, wanted);
        else if (msg.type === 'unsubscribe') this.release(ws, sym, wanted);
      } catch {
        /* 忽略非法消息 */
      }
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      for (const sym of wanted) this.release(ws, sym, wanted);
    });
    ws.on('error', () => {
      this.clients.delete(ws);
      for (const sym of wanted) this.release(ws, sym, wanted);
    });
  }

  private addRef(symbol: string, wanted: Set<string>): void {
    if (wanted.has(symbol)) return;
    wanted.add(symbol);
    const n = (this.refs.get(symbol) ?? 0) + 1;
    this.refs.set(symbol, n);
    if (n === 1) this.subscribeBinance(symbol);
  }

  private release(ws: WebSocket, symbol: string, wanted: Set<string>): void {
    if (!wanted.delete(symbol)) return;
    const n = (this.refs.get(symbol) ?? 1) - 1;
    if (n <= 0) {
      this.refs.delete(symbol);
      const unsub = this.unsubs.get(symbol);
      if (unsub) { unsub(); this.unsubs.delete(symbol); }
    } else {
      this.refs.set(symbol, n);
    }
  }

  private subscribeBinance(symbol: string): void {
    if (!this.binance) return;
    const unsub = this.binance.subscribe(symbol.toLowerCase() + '@ticker', (data) => {
      const d = data as TickerData;
      const px = parseFloat(String(d.c ?? ''));
      if (!Number.isFinite(px)) return;
      const pct = parseFloat(String(d.P ?? ''));
      const tick: PriceTick = {
        type: 'ticker',
        symbol: String(d.s ?? symbol).toUpperCase(),
        lastPrice: px,
        priceChangePercent: Number.isFinite(pct) ? pct : 0,
        at: Date.now(),
      };
      const msg = JSON.stringify(tick);
      for (const c of this.clients) {
        if (c.readyState === WebSocket.OPEN) {
          try { c.send(msg); } catch { /* ignore */ }
        }
      }
    });
    this.unsubs.set(symbol, unsub);
  }
}
