function createAuthStore(dependencies) {
  var sheets = dependencies.sheetRepository;
  var repo = createAuthRepository(sheets);
  var clock = dependencies.now || function () { return new Date(); };

  function stamp() {
    return nowIso(clock());
  }

  function isoPlus(ms) {
    return nowIso(new Date(clock().getTime() + ms));
  }

  function open() {
    return sheets.openSpreadsheet();
  }

  function findCredential(records, userId) {
    for (var i = 0; i < records.length; i += 1) {
      if (records[i].userId === userId && records[i].status === 'active') return records[i];
    }
    return null;
  }

  function findCredentialByUsername(records, username) {
    var needle = String(username || '').trim().toLowerCase();
    for (var i = 0; i < records.length; i += 1) {
      if (records[i].username === needle && records[i].status === 'active') return records[i];
    }
    return null;
  }

  function issueCredential(input) {
    return withScriptLock(function () {
      var spreadsheet = open();
      var userId = String(input && input.userId || '').trim();
      var username = String(input && input.username || '').trim().toLowerCase();
      var createdBy = String(input && input.createdBy || '').trim();
      if (!userId || !username) throw appError('VALIDATION_ERROR', 'User is not valid.');
      var secret = authGenerateSecret();
      if (secret.minEntropyBits < AUTH_MIN_ENTROPY_BITS || secret.entropyBits < AUTH_MIN_ENTROPY_BITS) {
        throw appError('INTERNAL_ERROR', 'The request could not be completed.');
      }
      var hashed = authHashSecret(secret.plaintext);
      var affectedUsers = {};
      affectedUsers[userId] = true;
      var records = repo.readCredentials(spreadsheet).map(function (item) {
        if (item.userId === userId || item.username === username) {
          affectedUsers[item.userId] = true;
          return Object.assign({}, item, { status: 'revoked', updatedAt: stamp() });
        }
        return item;
      });
      var record = {
        id: createId(),
        userId: userId,
        username: username,
        algorithm: hashed.algorithm,
        secretHash: hashed.secretHash,
        status: 'active',
        createdAt: stamp(),
        updatedAt: stamp(),
        createdBy: createdBy,
        rotatedAt: ''
      };
      records.push(record);
      repo.writeCredentials(spreadsheet, records);
      var revokedIds = Object.keys(affectedUsers);
      var r;
      for (r = 0; r < revokedIds.length; r += 1) {
        revokeUserSessionsUnlocked(spreadsheet, revokedIds[r], 'credential_replaced');
      }
      repo.appendEvent(spreadsheet, {
        id: createId(),
        timestamp: stamp(),
        actorUserId: createdBy,
        targetUserId: userId,
        eventType: 'credential_issued',
        result: 'ok',
        reason: '',
        requestId: String(input && input.requestId || '')
      });
      return { plaintext: secret.plaintext, record: record, entropyBits: secret.entropyBits };
    });
  }

  function rotateCredential(input) {
    return withScriptLock(function () {
      var spreadsheet = open();
      var userId = String(input && input.userId || '').trim();
      if (!userId) throw appError('VALIDATION_ERROR', 'User is not valid.');
      var records = repo.readCredentials(spreadsheet);
      var current = findCredential(records, userId);
      if (!current) throw appError('NOT_FOUND', 'Credential was not found.');
      var secret = authGenerateSecret();
      var hashed = authHashSecret(secret.plaintext);
      var now = stamp();
      var next = records.map(function (item) {
        if (item.id !== current.id) return item;
        return Object.assign({}, item, {
          algorithm: hashed.algorithm,
          secretHash: hashed.secretHash,
          status: 'active',
          updatedAt: now,
          rotatedAt: now,
          createdBy: String(input && input.createdBy || item.createdBy)
        });
      });
      repo.writeCredentials(spreadsheet, next);
      revokeUserSessionsUnlocked(spreadsheet, userId, 'credential_rotated');
      repo.appendEvent(spreadsheet, {
        id: createId(),
        timestamp: now,
        actorUserId: String(input && input.createdBy || ''),
        targetUserId: userId,
        eventType: 'credential_rotated',
        result: 'ok',
        reason: 'previous_invalidated',
        requestId: String(input && input.requestId || '')
      });
      return { plaintext: secret.plaintext, entropyBits: secret.entropyBits };
    });
  }

  function verifyCredential(username, plaintext) {
    var spreadsheet = open();
    var records = repo.readCredentials(spreadsheet);
    var record = findCredentialByUsername(records, username);
    if (!record) return { ok: false, userId: '' };
    if (!authVerifySecret(plaintext, record)) return { ok: false, userId: record.userId };
    return { ok: true, userId: record.userId };
  }

  function issueSession(input) {
    return withScriptLock(function () {
      var spreadsheet = open();
      var userId = String(input && input.userId || '').trim();
      if (!userId) throw appError('VALIDATION_ERROR', 'User is not valid.');
      var token = authRandomToken();
      var now = stamp();
      var record = {
        id: createId(),
        userId: userId,
        tokenHash: authHashToken(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: isoPlus(AUTH_SESSION_ABSOLUTE_MS),
        idleExpiresAt: isoPlus(AUTH_SESSION_IDLE_MS),
        revokedAt: '',
        revokedReason: ''
      };
      var sessions = repo.readSessions(spreadsheet);
      sessions.push(record);
      repo.writeSessions(spreadsheet, sessions);
      return { token: token, record: record };
    });
  }

  function sessionExpired(item, now) {
    var absolute = Date.parse(item.expiresAt);
    var idle = Date.parse(item.idleExpiresAt);
    if (!isFinite(absolute) || !isFinite(idle)) return true;
    if (now >= absolute) return true;
    if (now >= idle) return true;
    return false;
  }

  function validateSession(token) {
    return withScriptLock(function () {
      var spreadsheet = open();
      var hash = authHashToken(String(token || ''));
      var sessions = repo.readSessions(spreadsheet);
      var now = clock().getTime();
      var found = null;
      var i;
      for (i = 0; i < sessions.length; i += 1) {
        var item = sessions[i];
        if (item.revokedAt) continue;
        if (!authTimingSafeEqual(authHexToBytes(item.tokenHash), authHexToBytes(hash))) continue;
        if (sessionExpired(item, now)) return null;
        var nextIdleMs = now + AUTH_SESSION_IDLE_MS;
        var absoluteMs = Date.parse(item.expiresAt);
        if (nextIdleMs > absoluteMs) nextIdleMs = absoluteMs;
        var updated = Object.assign({}, item, {
          lastSeenAt: stamp(),
          idleExpiresAt: nowIso(new Date(nextIdleMs))
        });
        sessions[i] = updated;
        found = updated;
        break;
      }
      if (found) repo.writeSessions(spreadsheet, sessions);
      return found;
    });
  }

  function revokeUserSessionsUnlocked(spreadsheet, userId, reason) {
    var now = stamp();
    var sessions = repo.readSessions(spreadsheet).map(function (item) {
      if (item.userId !== userId || item.revokedAt) return item;
      return Object.assign({}, item, { revokedAt: now, revokedReason: String(reason || 'revoked') });
    });
    repo.writeSessions(spreadsheet, sessions);
  }

  function revokeUserSessions(userId, reason) {
    return withScriptLock(function () {
      revokeUserSessionsUnlocked(open(), String(userId || ''), reason);
      return { ok: true };
    });
  }

  function ensureSheets() {
    return withScriptLock(function () {
      repo.ensure(open());
      return { ok: true };
    });
  }

  function readEvents() {
    return repo.readEvents(open());
  }

  function readCredentials() {
    return repo.readCredentials(open());
  }

  return {
    ensureSheets: ensureSheets,
    issueCredential: issueCredential,
    rotateCredential: rotateCredential,
    verifyCredential: verifyCredential,
    issueSession: issueSession,
    validateSession: validateSession,
    revokeUserSessions: revokeUserSessions,
    readEvents: readEvents,
    readCredentials: readCredentials
  };
}
