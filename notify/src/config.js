// Runtime configuration: environment variables with sane defaults.
// Everything that can change at runtime (YCLIENTS credentials, channel settings, rules)
// lives in the SQLite settings table and is seeded from env on first start.
import path from 'node:path';
import fs from 'node:fs';

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || './data');
  fs.mkdirSync(dataDir, { recursive: true });
  const adminToken = env.ADMIN_TOKEN || '';
  return {
    port: Number(env.PORT || 8090),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: env.DB_FILE || path.join(dataDir, 'notify.sqlite'),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    adminToken,
    apiToken: env.API_TOKEN || adminToken,
    // scheduler
    tickSec: Number(env.TICK_SEC || 20),
    syncIntervalSec: Number(env.SYNC_INTERVAL_SEC || 300),
    horizonDays: Number(env.HORIZON_DAYS || 14),
    // seeds for the settings table
    seed: {
      yclients: {
        partnerToken: env.YCLIENTS_PARTNER_TOKEN || '',
        login: env.YCLIENTS_LOGIN || '',
        password: env.YCLIENTS_PASSWORD || '',
        userToken: env.YCLIENTS_USER_TOKEN || '',
        companyId: env.YCLIENTS_COMPANY_ID ? Number(env.YCLIENTS_COMPANY_ID) : 0,
        baseUrl: env.YCLIENTS_BASE_URL || 'https://api.yclients.ru',
      },
      channels: {
        telegram: { enabled: Boolean(env.TELEGRAM_BOT_TOKEN), botToken: env.TELEGRAM_BOT_TOKEN || '' },
        whatsapp: {
          enabled: Boolean(env.WHATSAPP_ACCESS_TOKEN),
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
          accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
          verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
        },
        sms: {
          enabled: Boolean(env.SMS_PROVIDER),
          provider: env.SMS_PROVIDER || 'smsc',
          login: env.SMS_LOGIN || '',
          password: env.SMS_PASSWORD || '',
          sender: env.SMS_SENDER || '',
          url: env.SMS_URL || '',
        },
        log: { enabled: true },
      },
    },
  };
}
