import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual backend against in-memory Google service adapters.
// No Google accounts, sheets, or deployments are changed by these checks.
const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

class Sheet {
  rows = [];
  getLastRow() { return this.rows.length; }
  getRange(row, column, height, width) {
    const range = {
      getValues: () => Array.from({ length: height }, (_, r) =>
        Array.from({ length: width }, (_, c) => this.rows[row - 1 + r]?.[column - 1 + c] ?? '')),
      setValues: (values) => {
        assert.equal(values.length, height);
        values.forEach((cells, r) => {
          assert.equal(cells.length, width);
          this.rows[row - 1 + r] ??= [];
          cells.forEach((cell, c) => { this.rows[row - 1 + r][column - 1 + c] = cell; });
        });
        return range;
      },
      setFontWeight: () => range,
      setBackground: () => range,
      setFontColor: () => range,
    };
    return range;
  }
  setFrozenRows() {}
  appendRow(row) { this.rows.push(Array.from(row)); }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
}

function backend(initialProperties = {}) {
  const sheets = new Map();
  const properties = new Map(Object.entries(initialProperties));
  const stats = { held: false, waits: 0, releases: 0, flushes: 0 };
  const spreadsheet = {
    getId: () => 'test-database',
    getSheetByName: (name) => sheets.get(name) ?? null,
    insertSheet: (name) => { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; },
  };
  const context = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value),
    }) },
    SpreadsheetApp: {
      openById: () => spreadsheet,
      create: () => spreadsheet,
      flush: () => { stats.flushes++; },
    },
    LockService: { getScriptLock: () => ({
      waitLock: () => { assert.equal(stats.held, false); stats.held = true; stats.waits++; },
      releaseLock: () => { assert.equal(stats.held, true); stats.held = false; stats.releases++; },
    }) },
    Utilities: {
      getUuid: randomUUID,
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_, input) => Array.from(createHash('sha256').update(input).digest()),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ getContent: () => text, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(source, context, { filename: 'apps-script/Code.gs' });
  const rawPost = (text) => JSON.parse(context.doPost({ postData: { contents: text } }).getContent());
  return { post: (body) => rawPost(JSON.stringify(body)), rawPost, sheets, properties, stats };
}

const app = backend(); // Deliberately no APP_KEY or ADMIN_SETUP_KEY.
assert.equal(app.post({ action: 'ping' }).ok, true);
assert.equal(app.rawPost('{bad-json').ok, false);
assert.equal(app.post({ action: 'not-an-action' }).ok, false);

const credentials = { email: '  PM@Example.com  ', name: 'Project Manager', password: 'test-password-123' };
const first = app.post({ action: 'addUser', ...credentials, role: 'admin' });
assert.equal(first.ok, true, 'Sign-up should work with no script properties or setup key');
assert.deepEqual(first.data.user, { email: 'pm@example.com', name: 'Project Manager', role: 'staff' });
const storedUser = [...app.sheets.get('Users').rows[1]];
assert.notEqual(storedUser[4], credentials.password, 'Passwords must be stored as salted hashes');

const second = app.post({ action: 'addUser', ...credentials, email: 'second@example.com', role: 'admin', adminKey: 'ignored' });
assert.equal(second.ok, true, 'Subsequent sign-ups must also work without a setup key');
assert.equal(second.data.user.role, 'staff', 'Public sign-up cannot choose an administrator role');

const duplicate = app.post({ action: 'addUser', ...credentials, email: 'PM@example.com', password: 'replacement-password', role: 'admin' });
assert.equal(duplicate.ok, false);
assert.match(duplicate.error, /already exists/);
assert.deepEqual(app.sheets.get('Users').rows[1], storedUser, 'Duplicate sign-up must not reset an existing account');
assert.equal(app.stats.held, false, 'Duplicate rejection must release the registration lock');
assert.equal(app.stats.waits, app.stats.releases);
assert.equal(app.stats.flushes, 2, 'Registrations must be committed before releasing the lock');

for (const invalid of [
  { email: 'not-an-email' }, { name: '' }, { password: 'short' }, { password: 'x'.repeat(129) },
]) {
  assert.equal(app.post({ action: 'addUser', ...credentials, email: 'invalid@example.com', ...invalid }).ok, false);
}
assert.equal(app.sheets.get('Users').rows.length, 3, 'Invalid requests must not create accounts');

assert.equal(app.post({ action: 'login', email: 'pm@example.com', password: 'replacement-password' }).ok, false);
const signedIn = app.post({ action: 'login', email: 'PM@example.com', password: credentials.password });
assert.equal(signedIn.ok, true, 'A registered user must be able to sign in without an app key');
assert.ok(signedIn.data.token);
assert.equal(app.post({ action: 'session', token: signedIn.data.token }).ok, true);

for (const action of [
  'createSheetsBudget', 'createDocsScopeAgreement', 'syncCalendarEvents', 'uploadWorkOrderPdf',
  'savePackageToDrive', 'saveCustomerProfile', 'listCustomerProfiles', 'getCustomerProfile',
  'deleteCustomerProfile', 'uploadCustomerPdf',
]) {
  const denied = app.post({ action });
  assert.equal(denied.ok, false, `${action} must require an account session`);
  assert.match(denied.error, /Session expired or invalid/);
}
assert.equal(app.post({ action: 'session', token: 'invalid-token' }).ok, false);
assert.equal(app.post({ action: 'logout', token: signedIn.data.token }).ok, true);
assert.equal(app.post({ action: 'session', token: signedIn.data.token }).ok, false, 'Sign-out must invalidate the token');

const renewed = app.post({ action: 'login', email: 'pm@example.com', password: credentials.password });
app.sheets.get('Sessions').rows.find((row) => row[0] === renewed.data.token)[5] = '2000-01-01T00:00:00.000Z';
assert.equal(app.post({ action: 'session', token: renewed.data.token }).ok, false, 'Expired tokens must be rejected');

app.sheets.get('Users').rows[1][5] = 'FALSE';
assert.equal(app.post({ action: 'login', email: 'pm@example.com', password: credentials.password }).ok, false);
assert.equal(app.post({ action: 'addUser', ...credentials }).ok, false, 'Sign-up cannot reactivate a disabled account');

const legacy = backend({ APP_KEY: 'legacy-key', ADMIN_SETUP_KEY: 'legacy-setup-key' });
assert.equal(legacy.post({ action: 'addUser', ...credentials }).ok, true, 'Legacy key properties must not block sign-up');
assert.equal(legacy.post({ action: 'login', email: 'pm@example.com', password: credentials.password }).ok, true);

console.log('Apps Script auth passed: key-free sign-up/login, staff roles, duplicate protection, validation, and session access checks.');
