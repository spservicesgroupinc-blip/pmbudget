/**
 * XactSchedule Apps Script Backend
 * Hays + Sons Complete Restoration
 *
 * Deployed as a Web App ("Execute as: Me", "Who has access: Anyone").
 * Account creation and login require no setup keys. Data actions require
 * a session token issued by login(). Exports are written into the script
 * owner's Google account and logged to the "Exports" sheet.
 *
 * After editing this file, create a NEW deployment version for changes to
 * reach the published /exec URL.
 */

/* ===================== Configuration / constants ===================== */

var PROP_SESSION_TTL_HOURS = 'SESSION_TTL_HOURS';
var PROP_DB_SPREADSHEET_ID = 'DB_SPREADSHEET_ID';

var DEFAULT_SESSION_TTL_HOURS = 12;
var DB_SPREADSHEET_NAME = 'XactSchedule Database';
var BRAND_RED = '#DC2626';

var SHEET_USERS = 'Users';
var SHEET_SESSIONS = 'Sessions';
var SHEET_EXPORTS = 'Exports';
var SHEET_CUSTOMERS = 'Customers';

var USERS_HEADERS = ['Email', 'Name', 'Role', 'Salt', 'PasswordHash', 'Active', 'CreatedAt'];
var SESSIONS_HEADERS = ['Token', 'Email', 'Name', 'Role', 'CreatedAt', 'ExpiresAt'];
var EXPORTS_HEADERS = ['CreatedAt', 'UserEmail', 'Type', 'Title', 'Url'];
var CUSTOMERS_HEADERS = ['CustomerId', 'ClientName', 'ClaimNumber', 'Carrier', 'PropertyAddress', 'TotalRcv', 'DriveFolderId', 'EstimateJsonFileId', 'EstimateJsonUrl', 'CreatedAt', 'UpdatedAt', 'CreatedBy'];

var CUSTOMERS_ROOT_FOLDER_NAME = 'XactSchedule Customers';
var PROP_CUSTOMERS_ROOT_ID = 'CUSTOMERS_DRIVE_FOLDER_ID';

var APP_NAME = 'XactSchedule Apps Script Backend';
var DRIVE_FILE_URL_PREFIX = 'https://drive.google.com/file/d/';

/* ============================ HTTP entry points ============================ */

/**
 * GET /exec — browsable health check. Returns the same payload as the
 * 'ping' action without requiring a session.
 */
function doGet() {
  return respond_({ ok: true, data: pingData_() });
}

/**
 * POST /exec — the main web app handler.
 * Body: { action: string, token?: string, ...payload }
 * Always responds HTTP 200 with { ok: true, data } or { ok: false, error }.
 */
function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    if (raw === '') {
      throw new Error('No request body.');
    }
    var body;
    try {
      body = JSON.parse(raw);
    } catch (parseErr) {
      throw new Error('Invalid JSON body.');
    }
    if (typeof body !== 'object' || body === null) {
      throw new Error('Invalid JSON body.');
    }

    return respond_({ ok: true, data: handleAction_(body) });
  } catch (err) {
    return respond_({ ok: false, error: errorMessage_(err) });
  }
}

/* ============================== Action dispatch ============================== */

/**
 * Dispatches on body.action. Each handler returns the "data" portion of the
 * success response.
 */
function handleAction_(body) {
  var action = body.action;
  if (typeof action !== 'string' || action === '') {
    throw new Error('Unknown action.');
  }
  switch (action) {
    case 'ping':
      return pingData_();
    case 'login':
      return login_(body);
    case 'logout':
      return logout_(body);
    case 'session':
      return session_(body);
    case 'addUser':
      return addUser_(body);
    case 'createSheetsBudget':
      return createSheetsBudget_(body);
    case 'createDocsScopeAgreement':
      return createDocsScopeAgreement_(body);
    case 'syncCalendarEvents':
      return syncCalendarEvents_(body);
    case 'uploadWorkOrderPdf':
      return uploadWorkOrderPdf_(body);
    case 'savePackageToDrive':
      return savePackageToDrive_(body);
    case 'saveCustomerProfile':
      return saveCustomerProfile_(body);
    case 'listCustomerProfiles':
      return listCustomerProfiles_(body);
    case 'getCustomerProfile':
      return getCustomerProfile_(body);
    case 'deleteCustomerProfile':
      return deleteCustomerProfile_(body);
    case 'uploadCustomerPdf':
      return uploadCustomerPdf_(body);
    default:
      throw new Error('Unknown action.');
  }
}

/* ============================== Auth actions ============================== */

function pingData_() {
  return {
    status: 'ok',
    app: APP_NAME,
    time: new Date().toISOString(),
  };
}

/**
 * login: { email, password }
 * Verifies the user row and issues a fresh session token.
 */
function login_(body) {
  var email = normalizeEmail_(body.email);
  var password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  var row = findUserRow_(email);
  if (!row) {
    throw new Error('Invalid email or password.');
  }
  if (String(row.active).toUpperCase() !== 'TRUE') {
    throw new Error('Account disabled.');
  }
  if (hashPassword_(password, row.salt) !== row.passwordHash) {
    throw new Error('Invalid email or password.');
  }

  var token = Utilities.getUuid();
  var now = new Date();
  var expiresAt = new Date(now.getTime() + sessionTtlHours_() * 60 * 60 * 1000);
  var sessions = ensureSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
  sessions.appendRow([token, email, row.name, row.role, now.toISOString(), expiresAt.toISOString()]);
  purgeExpiredSessions_(sessions);

  return {
    token: token,
    user: { email: email, name: row.name, role: row.role },
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * logout: { token }
 */
function logout_(body) {
  var token = typeof body.token === 'string' ? body.token : '';
  if (token) {
    var sessions = ensureSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
    deleteSessionToken_(sessions, token);
  }
  return { ok: true };
}

/**
 * session: { token } — validates and returns the current user.
 */
function session_(body) {
  var session = authorize_(body);
  return { user: session.user, expiresAt: session.expiresAt };
}

/**
 * addUser: { email, name, password }
 * Self-service sign-up creates a new staff account. Existing accounts and
 * privileged roles can only be updated through the editor/admin workflow.
 */
function addUser_(body) {
  var email = normalizeEmail_(body.email);
  var name = typeof body.name === 'string' ? body.name.trim() : '';
  var password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  if (!name || name.length > 100) {
    throw new Error('Enter your name (up to 100 characters).');
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('Password must be between 8 and 128 characters.');
  }

  // Serialize duplicate checks and inserts so simultaneous registrations
  // cannot overwrite one another through the editor's upsert helper.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (findUserRow_(email)) {
      throw new Error('An account with this email already exists. Please sign in.');
    }
    upsertUser_(email, name, password, 'staff', true);
    SpreadsheetApp.flush();
    return { user: { email: email, name: name, role: 'staff' } };
  } finally {
    lock.releaseLock();
  }
}

/* ============================== Export actions ============================== */

/**
 * createSheetsBudget: { token, title, headers, rows }
 * Creates a branded budget spreadsheet from the client-prepared table.
 */
function createSheetsBudget_(body) {
  var user = authorize_(body).user;
  var title = requireString_(body.title, 'title');
  var headers = body.headers;
  var rows = body.rows;
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error('headers must be a non-empty array.');
  }
  if (!Array.isArray(rows)) {
    throw new Error('rows must be an array.');
  }

  var ss = SpreadsheetApp.create(title);
  var sheet = ss.getSheets()[0];
  if (sheet.getName() !== 'Budget') {
    sheet.setName('Budget');
  }
  var values = [headers].concat(rows);
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  applySheetFormatting_(sheet, headers.length);

  var id = ss.getId();
  logExport_(user.email, 'sheets', title, ss.getUrl());
  return { id: id, url: ss.getUrl(), title: title };
}

/**
 * createDocsScopeAgreement: { token, title, body }
 * Creates a scope-agreement Google Doc from the client-prepared text.
 */
function createDocsScopeAgreement_(body) {
  var user = authorize_(body).user;
  var title = requireString_(body.title, 'title');
  var bodyText = requireString_(body.body, 'body');

  var doc = DocumentApp.create(title);
  var lines = String(bodyText).split('\n');
  for (var i = 0; i < lines.length; i++) {
    var paragraph = doc.appendParagraph(lines[i]);
    if (i === 0) {
      paragraph.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    }
  }

  var id = doc.getId();
  var url = 'https://docs.google.com/document/d/' + id + '/edit';
  logExport_(user.email, 'docs', title, url);
  return { id: id, url: url, title: title };
}

/**
 * syncCalendarEvents: { token, events: [{ summary, description, startDate, endDate }] }
 * Creates all-day events (end date exclusive → +1 day server-side).
 */
function syncCalendarEvents_(body) {
  var user = authorize_(body).user;
  var events = body.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events must be a non-empty array.');
  }

  var calendar = CalendarApp.getDefaultCalendar();
  var created = 0;
  for (var i = 0; i < events.length; i++) {
    try {
      var ev = events[i];
      var summary = requireString_(ev.summary, 'event summary');
      var start = parseDate_(ev.startDate);
      var end = parseDate_(ev.endDate);
      end.setDate(end.getDate() + 1); // all-day events use an exclusive end
      var calendarEvent = calendar.createAllDayEvent(summary, start, end);
      if (ev.description) {
        calendarEvent.setDescription(String(ev.description));
      }
      created += 1;
    } catch (eventErr) {
      console.warn('Failed to create calendar event: ' + errorMessage_(eventErr));
    }
  }

  logExport_(user.email, 'calendar', String(events.length) + ' trade milestones', 'https://calendar.google.com/calendar/r');
  return {
    count: created,
    calendarName: calendar.getName(),
    calendarUrl: 'https://calendar.google.com/calendar/r',
  };
}

/**
 * uploadWorkOrderPdf: { token, filename, pdfBase64 }
 * Writes a base64 PDF to Drive.
 */
function uploadWorkOrderPdf_(body) {
  var user = authorize_(body).user;
  var filename = requireString_(body.filename, 'filename');
  var pdfBase64 = requireString_(body.pdfBase64, 'pdfBase64');

  var bytes = Utilities.base64Decode(pdfBase64, Utilities.Charset.UTF_8);
  var blob = Utilities.newBlob(bytes, 'application/pdf', filename);
  var file = DriveApp.createFile(blob);

  var url = DRIVE_FILE_URL_PREFIX + file.getId() + '/view';
  logExport_(user.email, 'drive', filename, url);
  return { id: file.getId(), url: url, filename: filename };
}

/**
 * savePackageToDrive: { token, filename, json }
 * Writes the JSON estimate package to Drive.
 */
function savePackageToDrive_(body) {
  var user = authorize_(body).user;
  var filename = requireString_(body.filename, 'filename');
  var json = typeof body.json === 'string' ? body.json : '';

  var file = DriveApp.createFile(filename, json, 'application/json');

  var url = DRIVE_FILE_URL_PREFIX + file.getId() + '/view';
  logExport_(user.email, 'drive', filename, url);
  return { id: file.getId(), url: url, filename: filename };
}

/* ======================== Customer profile actions ======================== */

/**
 * saveCustomerProfile: { token, profile: { client_name, claim_number,
 * carrier?, property_address?, total_rcv? }, estimate_json? }
 * Creates or updates a customer profile row and keeps the estimate JSON in
 * the customer's Drive folder (estimate_profile.json).
 */
function saveCustomerProfile_(body) {
  var user = authorize_(body).user;
  var profile = body.profile;
  if (typeof profile !== 'object' || profile === null) {
    throw new Error('profile is required.');
  }
  var clientName = requireString_(profile.client_name, 'client name');
  var claimNumber = requireString_(profile.claim_number, 'claim number');
  var carrier = typeof profile.carrier === 'string' ? profile.carrier : '';
  var propertyAddress = typeof profile.property_address === 'string' ? profile.property_address : '';
  var totalRcv = typeof profile.total_rcv === 'number' ? profile.total_rcv : 0;
  var estimateJson = typeof body.estimate_json === 'string' ? body.estimate_json : '';

  var customerId = customerId_(clientName, claimNumber);
  var customers = ensureSheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var nowIso = new Date().toISOString();
  var rowIndex = findCustomerRowIndex_(customers, customerId);

  if (rowIndex !== -1) {
    // Update the existing row, preserving CreatedAt and CreatedBy.
    var row = customers.getRange(rowIndex + 1, 1, 1, CUSTOMERS_HEADERS.length).getValues()[0];
    row[1] = clientName;
    row[2] = claimNumber;
    row[3] = carrier;
    row[4] = propertyAddress;
    row[5] = totalRcv;
    if (!String(row[6])) {
      row[6] = getOrCreateCustomerFolder_(clientName, claimNumber).getId();
    }
    var jsonFile = upsertEstimateJsonFile_(String(row[6]), estimateJson);
    row[7] = jsonFile.id;
    row[8] = jsonFile.url;
    row[10] = nowIso; // UpdatedAt
    customers.getRange(rowIndex + 1, 1, 1, CUSTOMERS_HEADERS.length).setValues([row]);
    return customerSummary_(row);
  }

  var folder = getOrCreateCustomerFolder_(clientName, claimNumber);
  var jsonResult = upsertEstimateJsonFile_(folder.getId(), estimateJson);
  customers.appendRow([
    customerId,
    clientName,
    claimNumber,
    carrier,
    propertyAddress,
    totalRcv,
    folder.getId(),
    jsonResult.id,
    jsonResult.url,
    nowIso,
    nowIso,
    user.email,
  ]);
  return {
    customer_id: customerId,
    client_name: clientName,
    claim_number: claimNumber,
    carrier: carrier,
    property_address: propertyAddress,
    total_rcv: totalRcv,
    drive_folder_id: folder.getId(),
    estimate_json_url: jsonResult.url,
    created_at: nowIso,
    updated_at: nowIso,
    created_by: user.email,
  };
}

/**
 * listCustomerProfiles: { token }
 * Returns all customer profiles, sorted by updated_at descending.
 */
function listCustomerProfiles_(body) {
  var user = authorize_(body).user;
  var customers = ensureSheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var lastRow = Math.max(customers.getLastRow(), 1);
  var values = customers.getRange(1, 1, lastRow, CUSTOMERS_HEADERS.length).getValues();
  var profiles = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === '') {
      continue;
    }
    profiles.push(customerSummary_(values[i]));
  }
  profiles.sort(function (a, b) {
    if (a.updated_at < b.updated_at) return 1;
    if (a.updated_at > b.updated_at) return -1;
    return 0;
  });
  return { profiles: profiles };
}

/**
 * getCustomerProfile: { token, customer_id }
 * Returns the profile summary plus the estimate JSON stored in Drive.
 */
function getCustomerProfile_(body) {
  var user = authorize_(body).user;
  var customerId = requireString_(body.customer_id, 'customer id');

  var customers = ensureSheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var rowIndex = findCustomerRowIndex_(customers, customerId);
  if (rowIndex === -1) {
    throw new Error('Customer profile not found.');
  }
  var row = customers.getRange(rowIndex + 1, 1, 1, CUSTOMERS_HEADERS.length).getValues()[0];
  var estimateJson = '';
  var jsonFileId = String(row[7]);
  if (jsonFileId) {
    estimateJson = DriveApp.getFileById(jsonFileId).getBlob().getDataAsString();
  }
  return { profile: customerSummary_(row), estimate_json: estimateJson };
}

/**
 * deleteCustomerProfile: { token, customer_id }
 * Removes the profile row (Drive files are left in place).
 */
function deleteCustomerProfile_(body) {
  var user = authorize_(body).user;
  var customerId = requireString_(body.customer_id, 'customer id');
  var customers = ensureSheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var rowIndex = findCustomerRowIndex_(customers, customerId);
  if (rowIndex !== -1) {
    customers.deleteRow(rowIndex + 1);
  }
  return { ok: true, deleted: true };
}

/**
 * uploadCustomerPdf: { token, customer_id, filename, pdfBase64 }
 * Writes a base64 PDF into the customer's Drive folder.
 */
function uploadCustomerPdf_(body) {
  var user = authorize_(body).user;
  var customerId = requireString_(body.customer_id, 'customer id');
  var filename = requireString_(body.filename, 'filename');
  var pdfBase64 = requireString_(body.pdfBase64, 'pdfBase64');

  var customers = ensureSheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var rowIndex = findCustomerRowIndex_(customers, customerId);
  if (rowIndex === -1) {
    throw new Error('Customer profile not found.');
  }
  var row = customers.getRange(rowIndex + 1, 1, 1, CUSTOMERS_HEADERS.length).getValues()[0];

  var bytes = Utilities.base64Decode(pdfBase64, Utilities.Charset.UTF_8);
  var blob = Utilities.newBlob(bytes, 'application/pdf', filename);

  var folderId = String(row[6]);
  if (!folderId) {
    folderId = getOrCreateCustomerFolder_(String(row[1]), String(row[2])).getId();
    row[6] = folderId;
  }
  var file = DriveApp.getFolderById(folderId).createFile(blob);

  var url = DRIVE_FILE_URL_PREFIX + file.getId() + '/view';
  row[10] = new Date().toISOString(); // UpdatedAt
  customers.getRange(rowIndex + 1, 1, 1, CUSTOMERS_HEADERS.length).setValues([row]);

  return { id: file.getId(), url: url, filename: filename, customer_id: customerId };
}

/* ====================== Customer profile helpers ====================== */

/**
 * Deterministic customer id derived from client name + claim number.
 */
function customerId_(clientName, claimNumber) {
  var input = String(clientName).toLowerCase().trim() + '|' + String(claimNumber).trim();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return 'C-' + bytesToHex_(digest).slice(0, 12);
}

/** Returns the 0-based row index (header row included) of the profile, or -1. */
function findCustomerRowIndex_(customers, customerId) {
  var lastRow = Math.max(customers.getLastRow(), 1);
  var values = customers.getRange(1, 1, lastRow, CUSTOMERS_HEADERS.length).getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === customerId) {
      return i;
    }
  }
  return -1;
}

/** Maps a Customers sheet row to the profile summary object. */
function customerSummary_(row) {
  var total = Number(row[5]);
  return {
    customer_id: String(row[0]),
    client_name: String(row[1]),
    claim_number: String(row[2]),
    carrier: String(row[3]),
    property_address: String(row[4]),
    total_rcv: isNaN(total) ? 0 : total,
    drive_folder_id: String(row[6]),
    estimate_json_url: String(row[8]),
    created_at: String(row[9]),
    updated_at: String(row[10]),
    created_by: String(row[11]),
  };
}

/** Returns (or creates) the 'XactSchedule Customers' root Drive folder. */
function getOrCreateCustomersRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty(PROP_CUSTOMERS_ROOT_ID);
  if (existingId) {
    try {
      return DriveApp.getFolderById(existingId);
    } catch (e) {
      // Fall through and create a new root folder.
    }
  }
  var folder = DriveApp.createFolder(CUSTOMERS_ROOT_FOLDER_NAME);
  props.setProperty(PROP_CUSTOMERS_ROOT_ID, folder.getId());
  return folder;
}

/** Sanitizes a Drive folder name: '/' → '-', collapsed whitespace, trimmed. */
function sanitizeDriveFolderName_(name) {
  return String(name).replace(/\//g, '-').replace(/\s+/g, ' ').trim();
}

/** Returns (or creates) the customer's folder under the root folder. */
function getOrCreateCustomerFolder_(clientName, claimNumber) {
  var root = getOrCreateCustomersRootFolder_();
  var folderName = sanitizeDriveFolderName_(clientName + ' - Claim ' + claimNumber);
  var matches = root.getFoldersByName(folderName);
  if (matches.hasNext()) {
    return matches.next();
  }
  return root.createFolder(folderName);
}

/** Creates or updates estimate_profile.json in the folder; returns id + url. */
function upsertEstimateJsonFile_(folderId, estimateJson) {
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByName('estimate_profile.json');
  var file;
  if (files.hasNext()) {
    file = files.next();
    file.setContent(estimateJson);
  } else {
    file = folder.createFile('estimate_profile.json', estimateJson, 'application/json');
  }
  return { id: file.getId(), url: DRIVE_FILE_URL_PREFIX + file.getId() + '/view' };
}

/* ============================ Auth helpers ============================ */

/**
 * Validates body.token against the Sessions sheet. Returns { user, expiresAt }.
 */
function authorize_(body) {
  var token = typeof body.token === 'string' ? body.token : '';
  if (!token) {
    throw new Error('Session expired or invalid.');
  }
  var sessions = ensureSheet_(SHEET_SESSIONS, SESSIONS_HEADERS);
  purgeExpiredSessions_(sessions);
  var found = findSessionRow_(sessions, token);
  if (!found) {
    throw new Error('Session expired or invalid.');
  }
  return {
    user: { email: found.email, name: found.name, role: found.role },
    expiresAt: found.expiresAt,
  };
}

function findSessionRow_(sessions, token) {
  var lastRow = Math.max(sessions.getLastRow(), 1);
  var values = sessions.getRange(1, 1, lastRow, SESSIONS_HEADERS.length).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === token) {
      return {
        email: String(values[i][1]),
        name: String(values[i][2]),
        role: String(values[i][3]),
        expiresAt: String(values[i][5]),
      };
    }
  }
  return null;
}

function deleteSessionToken_(sessions, token) {
  var lastRow = Math.max(sessions.getLastRow(), 1);
  var values = sessions.getRange(1, 1, lastRow, SESSIONS_HEADERS.length).getValues();
  for (var i = lastRow - 1; i >= 0; i--) {
    if (String(values[i][0]) === token) {
      sessions.deleteRow(i + 1);
      return;
    }
  }
}

function purgeExpiredSessions_(sessions) {
  var lastRow = Math.max(sessions.getLastRow(), 1);
  var values = sessions.getRange(1, 1, lastRow, SESSIONS_HEADERS.length).getValues();
  var now = new Date().getTime();
  var rowsToDelete = [];
  for (var i = 0; i < values.length; i++) {
    var token = String(values[i][0]);
    if (!token) continue;
    var expiresRaw = String(values[i][5]);
    if (expiresRaw && new Date(expiresRaw).getTime() < now) {
      rowsToDelete.push(i + 1);
    }
  }
  // Delete bottom-up so row indexes stay valid.
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sessions.deleteRow(rowsToDelete[j]);
  }
}

function sessionTtlHours_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_SESSION_TTL_HOURS);
  var parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed <= 0 ? DEFAULT_SESSION_TTL_HOURS : parsed;
}

/* ============================ Users sheet helpers ============================ */

function normalizeEmail_(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function findUserRow_(email) {
  var users = ensureSheet_(SHEET_USERS, USERS_HEADERS);
  var lastRow = Math.max(users.getLastRow(), 1);
  var values = users.getRange(1, 1, lastRow, USERS_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase() === email) {
      return {
        email: String(values[i][0]),
        name: String(values[i][1]),
        role: String(values[i][2]),
        salt: String(values[i][3]),
        passwordHash: String(values[i][4]),
        active: String(values[i][5]),
      };
    }
  }
  return null;
}

/**
 * Inserts or updates a user row (called by addUser_ and createAdminUser).
 */
function upsertUser_(email, name, password, role, active) {
  var users = ensureSheet_(SHEET_USERS, USERS_HEADERS);
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var hash = hashPassword_(password, salt);
  var now = new Date().toISOString();
  var lastRow = Math.max(users.getLastRow(), 1);
  var values = users.getRange(1, 1, lastRow, USERS_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase() === email) {
      users.getRange(i + 1, 1, 1, USERS_HEADERS.length).setValues([[email, name, role, salt, hash, active ? 'TRUE' : 'FALSE', now]]);
      return;
    }
  }
  users.appendRow([email, name, role, salt, hash, active ? 'TRUE' : 'FALSE', now]);
}

function hashPassword_(password, salt) {
  var input = salt + ':' + password;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var byte = bytes[i] & 0xff;
    hex += (byte < 16 ? '0' : '') + byte.toString(16);
  }
  return hex;
}

/* ============================ Exports audit log ============================ */

function logExport_(userEmail, type, title, url) {
  try {
    var exports = ensureSheet_(SHEET_EXPORTS, EXPORTS_HEADERS);
    exports.appendRow([new Date().toISOString(), userEmail, type, title, url]);
  } catch (err) {
    console.warn('Failed to write Exports log: ' + errorMessage_(err));
  }
}

/* ============================ Database bootstrap ============================ */

/**
 * Editor-runnable: creates (or links) the database spreadsheet and makes sure
 * all sheets and header rows exist. Run once during deployment, or any time
 * to repair the sheet structure.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty(PROP_DB_SPREADSHEET_ID);
  var ss;
  if (existingId) {
    try {
      ss = SpreadsheetApp.openById(existingId);
    } catch (openErr) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(DB_SPREADSHEET_NAME);
    props.setProperty(PROP_DB_SPREADSHEET_ID, ss.getId());
  }
  ensureSheetIn_(ss, SHEET_USERS, USERS_HEADERS);
  ensureSheetIn_(ss, SHEET_SESSIONS, SESSIONS_HEADERS);
  ensureSheetIn_(ss, SHEET_EXPORTS, EXPORTS_HEADERS);
  ensureSheetIn_(ss, SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  try {
    getOrCreateCustomersRootFolder_();
  } catch (err) {
    console.warn('Failed to create Customers Drive folder: ' + errorMessage_(err));
  }
  console.log('Setup complete. Database spreadsheet id: ' + ss.getId());
  return ss.getId();
}

/**
 * Editor-only: creates an administrator or updates an existing account.
 * Example: createAdminUser('you@hayssons.com', 'Your Name', 'a-strong-password')
 */
function createAdminUser(email, name, password, role) {
  var normalized = normalizeEmail_(email);
  if (!normalized || !password) {
    throw new Error('Email and password are required.');
  }
  upsertUser_(
    normalized,
    typeof name === 'string' && name.trim() ? name.trim() : normalized,
    password,
    typeof role === 'string' && role.trim() ? role.trim() : 'admin',
    true
  );
  console.log('User ready: ' + normalized);
}

function ensureSheet_(name, headers) {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty(PROP_DB_SPREADSHEET_ID);
  var ss = null;
  if (existingId) {
    try {
      ss = SpreadsheetApp.openById(existingId);
    } catch (openErr) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(DB_SPREADSHEET_NAME);
    props.setProperty(PROP_DB_SPREADSHEET_ID, ss.getId());
  }
  return ensureSheetIn_(ss, name, headers);
}

function ensureSheetIn_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var current = headerRange.getValues()[0];
  var needsHeaders = false;
  for (var i = 0; i < headers.length; i++) {
    if (String(current[i]) !== headers[i]) {
      needsHeaders = true;
      break;
    }
  }
  if (needsHeaders) {
    headerRange.setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground(BRAND_RED).setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ============================ Branded sheet formatting ============================ */

function applySheetFormatting_(sheet, columnCount) {
  // Brand the header row (red fill, white bold text), freeze it, and size columns.
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground(BRAND_RED)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  for (var c = 1; c <= columnCount; c++) {
    sheet.autoResizeColumn(c);
  }
}

/* ============================ Small utilities ============================ */

function parseDate_(raw) {
  var value = requireString_(raw, 'date');
  // 'YYYY-MM-DD' → local Date
  var parts = value.split('-');
  if (parts.length !== 3) {
    throw new Error('Invalid date: ' + value);
  }
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function requireString_(raw, label) {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  throw new Error(label + ' is required.');
}

function errorMessage_(err) {
  return err && err.message ? String(err.message) : String(err);
}

function respond_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
