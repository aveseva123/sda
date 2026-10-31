// Entry point: node server.mjs  (see .env.example for configuration)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './src/config.js';
import { openDb } from './src/db.js';
import { App } from './src/app.js';
import { createServer } from './src/api.js';

// minimal .env loader (no dependency)
const envFile = path.resolve(process.env.ENV_FILE || '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const config = loadConfig();
if (!config.adminToken) { console.error('ADMIN_TOKEN не задан: укажите его в окружении или .env'); process.exit(1); }
const db = openDb(config.dbFile);
const app = new App(config, db);
const server = createServer(app);
server.listen(config.port, config.host, () => {
  console.log(`notify: http://${config.host}:${config.port}/  (db: ${config.dbFile})`);
  console.log(`YCLIENTS: ${app.yclientsReady ? 'готов' : 'не настроен — откройте панель'}; каналы: ${Object.keys(app.channels).join(', ') || 'нет'}`);
  app.start();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.stop(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); });
