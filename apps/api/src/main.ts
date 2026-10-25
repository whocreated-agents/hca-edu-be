import { loadConfig } from './config';
import { createApp } from './bootstrap';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.API_PORT, '0.0.0.0');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
