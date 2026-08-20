import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

// 加载 .env：优先仓库根目录（通常放这里），再尝试运行目录（apps/api）。
// pnpm --filter 的工作目录是包目录，之前的 '.env' 相对路径读不到根配置。
const here = fileURLToPath(new URL('.', import.meta.url));
const envCandidates = [
  resolve(here, '../../../.env'), // 仓库根 .env（apps/api/src → 仓库根）
  resolve(process.cwd(), '.env'), // 运行目录 .env（如 apps/api/.env，可覆盖）
];
for (const p of envCandidates) {
  try {
    process.loadEnvFile(p);
  } catch {
    /* 不存在或已加载则跳过 */
  }
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
