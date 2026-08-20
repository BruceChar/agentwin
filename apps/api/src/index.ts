import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

// 加载 .env（Node 内置）
try {
  process.loadEnvFile('.env');
} catch {
  /* 无 .env 时使用环境变量/默认值 */
}

const config = loadConfig();
const handle = await buildApp(config);
try {
  await handle.app.listen({ host: config.host, port: config.port });
  console.log('AgentWin API listening on http://' + config.host + ':' + config.port);
  console.log('storage=' + config.dbEngine, 'llm=' + config.llmProvider + '/' + config.llmModel);
} catch (err) {
  handle.app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await handle.close();
    process.exit(0);
  });
}
