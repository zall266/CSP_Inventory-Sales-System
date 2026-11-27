var AUTH_CREDENTIAL_HEADERS = [
  'id',
  'userId',
  'username',
  'algorithm',
  'secretHash',
  'status',
  'createdAt',
  'updatedAt',
  'createdBy',
  'rotatedAt'
];

var AUTH_SESSION_HEADERS = [
  'id',
  'userId',
  'tokenHash',
  'createdAt',
  'lastSeenAt',
  'expiresAt',
  'idleExpiresAt',
  'revokedAt',
  'revokedReason'
];

var AUTH_EVENT_HEADERS = [
  'id',
  'timestamp',
  'actorUserId',
  'targetUserId',
  'eventType',
  'result',
  'reason',
  'requestId'
];

var AUTH_LOGIN_ATTEMPT_HEADERS = [
  'id',
  'emailHash',
  'failedCount',
  'windowStartedAt',
  'cooldownUntil',
  'lastAttemptAt',
  'updatedAt'
];

function createAuthRepository(sheetRepository) {
  function ensure(spreadsheet) {
    sheetRepository.ensureSheet(spreadsheet, 'AuthCredentials', AUTH_CREDENTIAL_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'AuthSessions', AUTH_SESSION_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'AuthEvents', AUTH_EVENT_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'AuthLoginAttempts', AUTH_LOGIN_ATTEMPT_HEADERS);
  }

  function sheet(spreadsheet, name) {
    return sheetRepository.getSheet(spreadsheet, name);
  }

  function mapCredential(record) {
    return {
      id: String(record.id || ''),
      userId: String(record.userId || ''),
      username: String(record.username || '').trim().toLowerCase(),
      algorithm: String(record.algorithm || ''),
      secretHash: String(record.secretHash || ''),
      status: String(record.status || 'active'),
      createdAt: String(record.createdAt || ''),
      updatedAt: String(record.updatedAt || ''),
      createdBy: String(record.createdBy || ''),
      rotatedAt: String(record.rotatedAt || '')
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

  function assertNoSecret(record) {
    var keys = Object.keys(record || {});
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i].toLowerCase();
      if (key === 'password' || key === 'plaintext' || key === 'secret' || key === 'token' || key === 'pepper') {
        throw appError('INTERNAL_ERROR', 'The request could not be completed.');
      }
    }
  }

  function redactEventReason(reason) {
    var text = String(reason || '');
    if (!text) return '';
    if (/pepper|password|plaintext|secret|token/i.test(text)) return 'redacted';
    if (/[0-9a-fA-F]{32,}/.test(text)) return 'redacted';
    return text;
  }

  function readCredentials(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthCredentials')).map(mapCredential);
  }

  function writeCredentials(spreadsheet, records) {
    ensure(spreadsheet);
    records.forEach(assertNoSecret);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'AuthCredentials'), records);
  }

  function readSessions(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthSessions')).map(mapSession);
  }

  function writeSessions(spreadsheet, records) {
    ensure(spreadsheet);
    records.forEach(assertNoSecret);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'AuthSessions'), records);
  }

  function appendEvent(spreadsheet, record) {
    ensure(spreadsheet);
    assertNoSecret(record);
    var mapped = mapEvent(record);
    mapped.reason = redactEventReason(mapped.reason);
    sheetRepository.appendObject(sheet(spreadsheet, 'AuthEvents'), mapped);
  }

  function readEvents(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthEvents')).map(mapEvent);
  }

  function mapLoginAttempt(record) {
    return {
      id: String(record.id || ''),
      emailHash: String(record.emailHash || ''),
      failedCount: Number(record.failedCount || 0),
      windowStartedAt: String(record.windowStartedAt || ''),
      cooldownUntil: String(record.cooldownUntil || ''),
      lastAttemptAt: String(record.lastAttemptAt || ''),
      updatedAt: String(record.updatedAt || '')
    };
  }

  function readLoginAttempts(spreadsheet) {
    ensure(spreadsheet);
    return sheetRepository.readObjects(sheet(spreadsheet, 'AuthLoginAttempts')).map(mapLoginAttempt);
  }

  function writeLoginAttempts(spreadsheet, records) {
    ensure(spreadsheet);
    records.forEach(assertNoSecret);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'AuthLoginAttempts'), records);
  }

  return {
    headers: {
      credentials: AUTH_CREDENTIAL_HEADERS,
      sessions: AUTH_SESSION_HEADERS,
      events: AUTH_EVENT_HEADERS,
      loginAttempts: AUTH_LOGIN_ATTEMPT_HEADERS
    },
    ensure: ensure,
    readCredentials: readCredentials,
    writeCredentials: writeCredentials,
    readSessions: readSessions,
    writeSessions: writeSessions,
    appendEvent: appendEvent,
    readEvents: readEvents,
    readLoginAttempts: readLoginAttempts,
    writeLoginAttempts: writeLoginAttempts
  };
}
