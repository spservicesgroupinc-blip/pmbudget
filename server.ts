import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { healthPayload, runProcessEstimate, runGenerateWorkOrders } from './serverRoutines.js';

// Env files/keys live in env/ (see env/README.md); root paths kept as legacy fallback.
dotenv.config({ path: ['env/.env.local', 'env/.env', '.env.local', '.env'] });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Local dev mock for the Google Apps Script backend. Mirrors the wire protocol
// in apps-script/Code.gs: { ok, data } / { ok, false, error }. Accounts
// created through the mock live only in memory (dev-only).
// ---------------------------------------------------------------------------
const GAPPS_MOCK_USERS: Record<string, { password: string; name: string; role: string }> = {
  'demo@hayssons.com': { password: 'restore2026', name: 'Demo User', role: 'admin' },
};
const GAPPS_MOCK_TOKEN = 'dev-session-token';

interface MockCustomerProfile {
  customer_id: string;
  client_name: string;
  claim_number: string;
  carrier: string;
  property_address: string;
  total_rcv: number;
  drive_folder_id: string;
  estimate_json_url: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}
const GAPPS_MOCK_CUSTOMERS = new Map<string, MockCustomerProfile>();
// Raw estimate_json payloads keyed by customer id (dev-only mirror of the
// Drive-stored estimate file returned by getCustomerProfile).
const GAPPS_MOCK_CUSTOMER_ESTIMATES = new Map<string, string>();

function gappsMockOk(data: unknown) {
  return { ok: true, data };
}
function gappsMockFail(error: string) {
  return { ok: false, error };
}

function mockCustomerId(clientName: string, claimNumber: string): string {
  const input = `${clientName.trim().toLowerCase()}|${claimNumber.trim()}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash * 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return 'C-' + hash.toString(16).padStart(8, '0') + '0000';
}

function handleGappsMock(body: Record<string, unknown>): unknown {
  const action = typeof body.action === 'string' ? body.action : '';
  const token = typeof body.token === 'string' ? body.token : '';
  const requiresSession = !['ping', 'login', 'logout', 'session', 'addUser'].includes(action);
  if (requiresSession && token !== GAPPS_MOCK_TOKEN) {
    return gappsMockFail('Session expired or invalid.');
  }

  switch (action) {
    case 'ping':
      return gappsMockOk({
        status: 'ok',
        app: 'XactSchedule Local Mock',
        time: new Date().toISOString(),
      });
    case 'login': {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const mockUser = GAPPS_MOCK_USERS[email];
      if (mockUser && mockUser.password === password) {
        return gappsMockOk({
          token: GAPPS_MOCK_TOKEN,
          user: { email, name: mockUser.name, role: mockUser.role },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
      }
      return gappsMockFail(
        'Invalid email or password. (Local demo login: demo@hayssons.com / restore2026)'
      );
    }
    case 'addUser': {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return gappsMockFail('Enter a valid email address.');
      }
      if (!name || name.length > 100) {
        return gappsMockFail('Enter your name (up to 100 characters).');
      }
      if (password.length < 8 || password.length > 128) {
        return gappsMockFail('Password must be between 8 and 128 characters.');
      }
      if (Object.prototype.hasOwnProperty.call(GAPPS_MOCK_USERS, email)) {
        return gappsMockFail('An account with this email already exists. Please sign in.');
      }
      GAPPS_MOCK_USERS[email] = { password, name, role: 'staff' };
      return gappsMockOk({ user: { email, name, role: 'staff' } });
    }
    case 'logout':
      return gappsMockOk({ ok: true });
    case 'session':
      return token === GAPPS_MOCK_TOKEN
        ? gappsMockOk({
            user: { email: 'demo@hayssons.com', name: 'Demo User', role: 'admin' },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          })
        : gappsMockFail('Session expired or invalid.');
    case 'createSheetsBudget':
      return gappsMockOk({
        id: 'dev-sheets',
        url: 'https://docs.google.com/spreadsheets/d/dev-sheets/edit',
        title: String(body.title || 'Budget'),
      });
    case 'createDocsScopeAgreement':
      return gappsMockOk({
        id: 'dev-docs',
        url: 'https://docs.google.com/document/d/dev-docs/edit',
        title: String(body.title || 'Scope Agreement'),
      });
    case 'syncCalendarEvents':
      return gappsMockOk({
        count: Array.isArray(body.events) ? body.events.length : 0,
        calendarName: 'Local Mock Calendar',
        calendarUrl: 'https://calendar.google.com/calendar/r',
      });
    case 'savePackageToDrive':
      return gappsMockOk({
        id: 'dev-drive-json',
        url: 'https://drive.google.com/file/d/dev-drive-json/view',
        filename: String(body.filename || 'package.json'),
      });
    case 'uploadWorkOrderPdf':
      return gappsMockOk({
        id: 'dev-drive-pdf',
        url: 'https://drive.google.com/file/d/dev-drive-pdf/view',
        filename: String(body.filename || 'workorder.pdf'),
      });
    case 'saveCustomerProfile': {
      const profile = (body.profile ?? {}) as Record<string, unknown>;
      const clientName = String(profile.client_name ?? '').trim();
      const claimNumber = String(profile.claim_number ?? '').trim();
      if (!clientName || !claimNumber) {
        return gappsMockFail('Client name and claim number are required.');
      }
      const customerId = mockCustomerId(clientName, claimNumber);
      const now = new Date().toISOString();
      const existing = GAPPS_MOCK_CUSTOMERS.get(customerId);
      const updated: MockCustomerProfile = existing
        ? {
            ...existing,
            client_name: clientName,
            claim_number: claimNumber,
            carrier: String(profile.carrier || ''),
            property_address: String(profile.property_address || ''),
            total_rcv: Number(profile.total_rcv) || 0,
            updated_at: now,
          }
        : {
            customer_id: customerId,
            client_name: clientName,
            claim_number: claimNumber,
            carrier: String(profile.carrier || ''),
            property_address: String(profile.property_address || ''),
            total_rcv: Number(profile.total_rcv) || 0,
            drive_folder_id: 'dev-customer-folder-' + customerId,
            estimate_json_url:
              'https://drive.google.com/file/d/dev-profile-' + customerId + '/view',
            created_at: now,
            updated_at: now,
            created_by: 'demo@hayssons.com',
          };
      GAPPS_MOCK_CUSTOMERS.set(customerId, updated);
      GAPPS_MOCK_CUSTOMER_ESTIMATES.set(
        customerId,
        typeof body.estimate_json === 'string' ? body.estimate_json : ''
      );
      return gappsMockOk(updated);
    }
    case 'listCustomerProfiles': {
      const profiles = [...GAPPS_MOCK_CUSTOMERS.values()].sort((a, b) =>
        a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0
      );
      return gappsMockOk({ profiles });
    }
    case 'getCustomerProfile': {
      const customerId = String(body.customer_id ?? '').trim();
      if (!customerId) {
        return gappsMockFail('Customer ID is required.');
      }
      const profile = GAPPS_MOCK_CUSTOMERS.get(customerId);
      if (!profile) {
        return gappsMockFail('Customer profile not found.');
      }
      return gappsMockOk({
        profile,
        estimate_json: GAPPS_MOCK_CUSTOMER_ESTIMATES.get(customerId) ?? '',
      });
    }
    case 'deleteCustomerProfile': {
      const customerId = String(body.customer_id ?? '').trim();
      if (!customerId) {
        return gappsMockFail('Customer ID is required.');
      }
      if (!GAPPS_MOCK_CUSTOMERS.delete(customerId)) {
        return gappsMockFail('Customer profile not found.');
      }
      GAPPS_MOCK_CUSTOMER_ESTIMATES.delete(customerId);
      return gappsMockOk({ ok: true, deleted: true });
    }
    case 'uploadCustomerPdf': {
      const customerId = String(body.customer_id ?? '').trim();
      if (!customerId) {
        return gappsMockFail('Customer ID is required.');
      }
      const profile = GAPPS_MOCK_CUSTOMERS.get(customerId);
      if (!profile) {
        return gappsMockFail('Customer profile not found.');
      }
      profile.updated_at = new Date().toISOString();
      return gappsMockOk({
        id: 'dev-drive-pdf-' + customerId,
        url: 'https://drive.google.com/file/d/dev-drive-pdf-' + customerId + '/view',
        filename: String(body.filename || 'document.pdf'),
        customer_id: customerId,
      });
    }
    default:
      return gappsMockFail('Unknown action (mock).');
  }
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '60mb' }));
  app.use(express.urlencoded({ extended: true, limit: '60mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json(healthPayload());
  });

  // Process Xactimate Estimate
  app.post('/api/process-estimate', async (req, res) => {
    const result = await runProcessEstimate(req.body || {});
    res.status(result.status).json(result.body);
  });

  // Generate subcontractor field work orders (contract amounts linked to budget lines)
  app.post('/api/generate-work-orders', async (req, res) => {
    const result = await runGenerateWorkOrders(req.body || {});
    res.status(result.status).json(result.body);
  });

  // -------------------------------------------------------------------------
  // Local dev mock for the Google Apps Script backend (server.ts is dev-only;
  // Vercel uses api/*). Lets the login gate and the export flow be exercised
  // before the real Apps Script project is deployed (see
  // instructions/apps-script-deployment.md and env/gapps-config.json).
  // The client posts text/plain (simple request — the real web app does not
  // answer CORS preflights), so parse the raw body here.
  // Demo login: demo@hayssons.com / restore2026
  // -------------------------------------------------------------------------
  app.post('/api/gapps-mock', express.text({ type: '*/*', limit: '60mb' }), (req, res) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(req.body || '{}'));
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
      // ignore — handleGappsMock falls back to its defaults
    }
    res.json(handleGappsMock(body));
  });

  // Client side or static serving
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Operational Workspace server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
