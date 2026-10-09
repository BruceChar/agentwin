import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { createServices, closeServices, type AppServices } from './services.ts';
import { PaperManager } from './paper-manager.ts';
import { StrategyRuntimeManager } from './strategy-runtime-manager.ts';
import { registerRoutes } from './routes.ts';
import { PriceWsServer } from './price-ws.ts';
import { StrategyWsServer } from './strategy-ws.ts';
import type { AppConfig } from './config.ts';

export interface AppHandle {
  app: ReturnType<typeof Fastify>;
  services: AppServices;
  close: () => Promise<void>;
}

/** 组装 Fastify 应用（可注入 inject 测试） */
export async function buildApp(config: AppConfig): Promise<AppHandle> {
  const services = await createServices(config);
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(sensible);
  app.addHook('onClose', async () => {
    await closeServices(services);
  });
  const paper = new PaperManager(services);
  const runtime = new StrategyRuntimeManager(services);
  registerRoutes(app, services, paper, runtime);
  // 实时价格 WebSocket（全站共享，顶栏价格等），随代理配置变化自动重连
  const priceWs = new PriceWsServer(services.proxySettings.config);
  priceWs.attach(app);
  // 策略指标事件 WebSocket（/api/ws/strategy）：后台运行时的实时事件广播给下游
  const strategyWs = new StrategyWsServer(runtime);
  strategyWs.attach(app);
  return {
    app,
    services,
    close: async () => {
      await paper.stop();
      await runtime.closeAll();
      strategyWs.close();
      priceWs.close();
      await app.close();
    },
  };
}
