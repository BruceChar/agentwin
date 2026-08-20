import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { createServices, closeServices, type AppServices } from './services.ts';
import { PaperManager } from './paper-manager.ts';
import { registerRoutes } from './routes.ts';
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
  registerRoutes(app, services, paper);
  return {
    app,
    services,
    close: async () => {
      await paper.stop();
      await app.close();
    },
  };
}
