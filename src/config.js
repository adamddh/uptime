import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

export default {
  CHECK_INTERVAL_MS: 5_000,
  PROBE_TIMEOUT_MS: 3_000,
  OUTAGE_THRESHOLD: 2,
  RECOVERY_THRESHOLD: 2,
  CONSENSUS_THRESHOLD: 2,

  TARGETS: [
    { id: 'google-dns-tcp',  host: '8.8.8.8',                                 method: 'tcp',  port: 53  },
    { id: 'cf-dns-tcp',      host: '1.1.1.1',                                  method: 'tcp',  port: 53  },
    { id: 'google-http',     url:  'https://www.google.com/generate_204',       method: 'http'            },
    { id: 'dns-resolve',     host: 'dns.google',                               method: 'dns'             },
  ],

  HTTP_PORT: 5173,
  WS_PORT:   5174,

  DB_PATH:  join(root, 'data', 'uptime.db'),

  ROLLUP_INTERVAL_MS: 300_000,

  SLEEP_GAP_THRESHOLD_MS: 20_000,
};
