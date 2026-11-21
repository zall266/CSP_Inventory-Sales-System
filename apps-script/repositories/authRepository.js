var AUTH_CREDENTIAL_HEADERS = [
  'id', 'userId', 'username', 'passwordHash', 'salt', 'iterations', 'algorithm',
  'wrappedVerifier', 'mustChange', 'passwordUpdatedAt', 'failedCount', 'lockedUntil', 'status',
  'createdAt', 'updatedAt', 'createdBy'
];
var AUTH_CHALLENGE_HEADERS = [
  'id', 'username', 'challengeHash', 'purpose', 'createdAt', 'expiresAt', 'consumedAt'
];
var AUTH_SESSION_HEADERS = [
  'id', 'userId', 'tokenHash', 'createdAt', 'lastSeenAt', 'expiresAt',
  'idleExpiresAt', 'revokedAt', 'revokedReason'
];
var AUTH_EVENT_HEADERS = [
  'id', 'timestamp', 'actorUserId', 'targetUserId', 'eventType', 'result', 'reason', 'requestId'
];

var AUTH_CREDENTIAL_HEADERS_LEGACY = [
  'id', 'userId', 'username', 'passwordHash', 'salt', 'iterations', 'algorithm',
  'mustChange', 'passwordUpdatedAt', 'failedCount', 'lockedUntil', 'status',
  'createdAt', 'updatedAt', 'createdBy'
];

function migrateAuthCredentialHeaders(sheetRepository, spreadsheet) {
  var existing = spreadsheet.getSheetByName('AuthCredentials');
  if (!existing) return;
  var current = sheetRepository.headerMap(existing).filter(Boolean);
  if (current.join('|') === AUTH_CREDENTIAL_HEADERS.join('|')) return;
  if (current.join('|') !== AUTH_CREDENTIAL_HEADERS_LEGACY.join('|')) return;
  var records = sheetRepository.readObjects(existing);
  existing.getRange(1, 1, 1, AUTH_CREDENTIAL_HEADERS.length).setValues([AUTH_CREDENTIAL_HEADERS]);
  sheetRepository.replaceObjects(existing, records);
}

function createAuthRepository(sheetRepository) {
  function ensure(spreadsheet) {
    migrateAuthCredentialHeaders(sheetRepository, spreadsheet);
    sheetRepository.ensureSheet(spreadsheet, 'AuthCredentials', AUTH_CREDENTIAL_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'AuthChallenges', AUTH_CHALLENGE_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'AuthSessions', AUTH_SESSION_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'AuthEvents', AUTH_EVENT_HEADERS);
  }

  function sheet(spreadsheet, name) {
    return sheetRepository.getSheet(spreadsheet, name);
  }

  function asBool(value) {
    return value === true || value === 'TRUE' || value === 'true' || value === 1 || value === '1';
  }

  function asNumber(value) {
    var number = Number(value);
    return isFinite(number) ? number : 0;
  }

  function mapCredential(record) {
    return {
      id: String(record.id || ''),
      userId: String(record.userId || ''),
      username: String(record.username || '').trim().toLowerCase(),
      passwordHash: String(record.passwordHash || ''),
      salt: String(record.salt || ''),
      iterations: asNumber(record.iterations) || AUTH_PBKDF2_ITERATIONS,
      algorithm: String(record.algorithm || 'pbkdf2-hmac-sha256'),
      wrappedVerifier: String(record.wrappedVerifier || ''),
      mustChange: asBool(record.mustChange),
      passwordUpdatedAt: String(record.passwordUpdatedAt || ''),
      failedCount: asNumber(record.failedCount),
      lockedUntil: String(record.lockedUntil || ''),
      status: String(record.status || 'active'),
      createdAt: String(record.createdAt || ''),
      updatedAt: String(record.updatedAt || ''),
      createdBy: String(record.createdBy || '')
    };
  }

  function mapSession(record) {
    return {
      id: String(record.id || ''),
      userId: String(record.userId || ''),
      tokenHash: String(record.tokenHash || ''),
      createdAt: String(record.createdAt || ''),
      lastSeenAt: String(record.lastSeenAt || ''),
      expiresAt: String(record.expiresAt || ''),
      idleExpiresAt: String(record.idleExpiresAt || ''),
      revokedAt: String(record.revokedAt || ''),
      revokedReason: String(record.revokedReason || '')
    };
  }

  function mapEvent(record) {
    return {
      id: String(record.id || ''),
      timestamp: String(record.timestamp || ''),
      actorUserId: String(record.actorUserId || ''),
      targetUserId: String(record.targetUserId || ''),
      eventType: String(record.eventType || ''),
      result: String(record.result || ''),
      reason: String(record.reason || ''),
      requestId: String(record.requestId || '')
    };
  }

  function mapChallenge(record) {
    return {
      id: String(record.id || ''),
      username: String(record.username || '').trim().toLowerCase(),
      challengeHash: String(record.challengeHash || ''),
      purpose: String(record.purpose || ''),
      createdAt: String(record.createdAt || ''),
      expiresAt: String(record.expiresAt || ''),
      consumedAt: String(record.consumedAt || '')
    };
  }

  function readCredentials(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthCredentials')).map(mapCredential);
  }

  function writeCredentials(spreadsheet, records) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'AuthCredentials'), records);
  }

  function readChallenges(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthChallenges')).map(mapChallenge);
  }

  function writeChallenges(spreadsheet, records) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'AuthChallenges'), records);
  }

  function readSessions(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthSessions')).map(mapSession);
  }

  function writeSessions(spreadsheet, records) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'AuthSessions'), records);
  }

  function readEvents(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthEvents')).map(mapEvent);
  }

  function appendEvent(spreadsheet, record) {
    ensure(spreadsheet);
    sheetRepository.appendObject(sheet(spreadsheet, 'AuthEvents'), record);
  }

  return {
    headers: {
      credentials: AUTH_CREDENTIAL_HEADERS,
      challenges: AUTH_CHALLENGE_HEADERS,
      sessions: AUTH_SESSION_HEADERS,
      events: AUTH_EVENT_HEADERS
    },
    ensure: ensure,
    readCredentials: readCredentials,
    writeCredentials: writeCredentials,
    readChallenges: readChallenges,
    writeChallenges: writeChallenges,
    readSessions: readSessions,
    writeSessions: writeSessions,
    readEvents: readEvents,
    appendEvent: appendEvent
  };
}
