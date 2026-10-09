import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import type { StrategyRuntimeManager } from './strategy-runtime-manager.ts';

/**
 * 策略指标事件推送 WebSocket（/api/ws/strategy）：
 * - 后端共享单连接：每个客户端通过 {type:'subscribe', runtimeId} 订阅某个运行时（缺省订阅全部 '*'）；
 * - 运行时每次产生事件（K 线更新 / 指标快照 / 策略信号 / 启停 / 错误）即广播给订阅的客户端；
 * - 消息格式：{ type: 'ready' | 'strategy-event', ... }，其中 strategy-event 携带完整运行时事件。
 */
export class StrategyWsServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, Set<string>>();
  private unsubscribe: (() => void) | null = null;
  private readonly manager: StrategyRuntimeManager;

  constructor(manager: StrategyRuntimeManager) {
    this.manager = manager;
  }

  attach(app: FastifyInstance): void {
    this.wss = new WebSocketServer({ noServer: true });
    app.server.on('upgrade', (req, socket, head) => {
      let pathname = '';
      try { pathname = new URL(req.url ?? '/', 'http://internal').pathname; } catch { return; }
      if (pathname !== '/api/ws/strategy') return;
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConn(ws));
    });
    this.unsubscribe = this.manager.subscribe((e) => this.broadcast(e));
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const ws of this.clients.keys()) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
    try { this.wss?.close(); } catch { /* ignore */ }
    this.wss = null;
  }

  private onConn(ws: WebSocket): void {
    this.clients.set(ws, new Set(['*'])); // 默认订阅全部运行时
    this.send(ws, { type: 'ready', runtimes: this.manager.list().map((r) => r.id) });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; runtimeId?: string };
        const filters = this.clients.get(ws);
        if (!filters) return;
        const id = String(msg.runtimeId ?? '').trim();
        if (msg.type === 'subscribe') {
          if (id) filters.add(id); else filters.add('*');
        } else if (msg.type === 'unsubscribe') {
          if (id) filters.delete(id); else filters.clear();
        } else if (msg.type === 'ping') {
          this.send(ws, { type: 'pong', at: Date.now() });
        }
      } catch { /* 忽略非法消息 */ }
    });
    const drop = () => this.clients.delete(ws);
    ws.on('close', drop);
    ws.on('error', drop);
  }

  private broadcast(event: unknown): void {
    const runtimeId = (event as { runtimeId?: string }).runtimeId ?? '';
    const msg = JSON.stringify({ type: 'strategy-event', event });
    for (const [ws, filters] of this.clients) {
      if (!filters.has('*') && !filters.has(runtimeId)) continue;
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch { /* ignore */ }
      }
    }
  }

  private send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
    }
  }
}
