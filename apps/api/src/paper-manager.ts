import type { Interval, Market } from '@agentwin/shared';
import { PaperTradingEngine, type PaperEngineOptions } from '@agentwin/engine';
import { builtinRegistry } from '@agentwin/strategy';
import type { AppServices } from './services.ts';

/** 管理当前运行的 paper trading 引擎（单实例） */
export class PaperManager {
  private engine: PaperTradingEngine | null = null;
  private readonly services: AppServices;

  constructor(services: AppServices) {
    this.services = services;
  }

  get running(): boolean {
    return this.engine?.running ?? false;
  }

  async start(opts: PaperEngineOptions): Promise<object> {
    if (this.engine?.running) return { error: 'paper trading already running — stop first' };
    const engine = new PaperTradingEngine(opts, {
      storage: this.services.storage,
      marketData: this.services.marketData,
      strategyFactory: (id) => builtinRegistry.create(id),
      onEvent: (e) => {
        if (e.type === 'error') console.error('[paper]', e.message);
        else if (e.type === 'trade') console.log('[paper] trade', e.trade.side, e.trade.symbol, e.trade.qty, '@', e.trade.price, 'pnl', e.trade.realizedPnl);
      },
    });
    await engine.start();
    this.engine = engine;
    return engine.status();
  }

  async stop(): Promise<object> {
    if (!this.engine) return { running: false };
    await this.engine.stop();
    const s = this.engine.status();
    this.engine = null;
    return s;
  }

  status(): object {
    return this.engine ? this.engine.status() : { running: false };
  }
}
