function createAuthStore(dependencies) {
  var sheets = dependencies.sheetRepository;
  var repo = createAuthRepository(sheets);
  var clock = dependencies.now || function () { return new Date(); };
  var skipLock = Boolean(dependencies && dependencies.skipLock);

  function guarded(fn) {
    if (skipLock) return fn();
    return withScriptLock(fn);
  }

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

  function kdfHighWater(spreadsheet) {
    var events = repo.readEvents(spreadsheet);
    var max = 0;
    var i;
    for (i = 0; i < events.length; i += 1) {
      if (events[i].eventType !== 'kdf_advance') continue;
      var n = authParseCanonicalCounter(events[i].reason, { emptyAllowed: false, zeroAllowed: false });
      if (n > max) max = n;
    }
    return max;
  }

  function existingKeyedOutputs(spreadsheet) {
    return repo.readCredentials(spreadsheet).length + repo.readSessions(spreadsheet).length;
  }

  function keyedOptions(spreadsheet) {
    return {
      minCounter: kdfHighWater(spreadsheet),
      existingOutputs: existingKeyedOutputs(spreadsheet)
    };
  }

  // Persistence is ordered, not atomic across Script Properties and Sheets:
  // 1. AUTH_KDF_COUNTER / AUTH_KDF_INITIALIZED are written inside the KDF.
  // 2. AuthEvents kdf_advance is appended next (this function).
  // 3. Credential or session rows are written last.
  // 4. credential_issued / credential_rotated audit rows are appended after persist.
  // A crash after (1) leaves the property counter ahead of the sheet. Recovery
  // uses max(property, sheet high-water)+1 and skips the used counter; it does
  // not reuse it. A crash after (2) before (3) leaves an unused hole. Missing
  // INITIALIZED after any outputs or sheet high-water still fails closed.
  // Pepper rotation does not reset AUTH_KDF_COUNTER. Changing the pepper makes
  // existing HMAC credential hashes unverifiable; re-issue credentials. Session
  // token hashes are SHA-256 of the token (not peppered); revoke sessions after
  // a pepper rotation. A full wipe of properties AND auth sheets with the same
  // pepper looks like first boot and can repeat counter 1.
  function recordKdfAdvance(spreadsheet) {
    if (!authKeyedKdfActive()) return;
    repo.appendEvent(spreadsheet, {
      id: createId(),
      timestamp: stamp(),
      actorUserId: '',
      targetUserId: '',
      eventType: 'kdf_advance',
      result: 'ok',
      reason: String(authGetLastKeyedCounter()),
      requestId: ''
    });
  }

  function issueCredential(input) {
    return guarded(function () {
      var spreadsheet = open();
      var userId = String(input && input.userId || '').trim();
      var username = String(input && input.username || '').trim().toLowerCase();
      var createdBy = String(input && input.createdBy || '').trim();
      if (!userId || !username) throw appError('VALIDATION_ERROR', 'User is not valid.');
      var secret = authGenerateSecret(keyedOptions(spreadsheet));
      recordKdfAdvance(spreadsheet);
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
      return {
        plaintext: secret.plaintext,
        record: record,
        entropyBits: secret.entropyBits,
        securityBoundBits: secret.securityBoundBits,
        entropyMeasured: secret.entropyMeasured,
        entropyAssumption: secret.entropyAssumption,
        source: secret.source
      };
    });
  }

  function rotateCredential(input) {
    return guarded(function () {
      var spreadsheet = open();
      var userId = String(input && input.userId || '').trim();
      if (!userId) throw appError('VALIDATION_ERROR', 'User is not valid.');
      var records = repo.readCredentials(spreadsheet);
      var current = findCredential(records, userId);
      if (!current) throw appError('NOT_FOUND', 'Credential was not found.');
      var secret = authGenerateSecret(keyedOptions(spreadsheet));
      recordKdfAdvance(spreadsheet);
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
    return guarded(function () {
      authReadPepper();
      var spreadsheet = open();
      var records = repo.readCredentials(spreadsheet);
      var record = findCredentialByUsername(records, username);
      if (!record) return { ok: false, userId: '' };
      if (!authVerifySecret(plaintext, record)) return { ok: false, userId: record.userId };
      return { ok: true, userId: record.userId };
    });
  }

  function issueSession(input) {
    return guarded(function () {
      var spreadsheet = open();
      var userId = String(input && input.userId || '').trim();
      if (!userId) throw appError('VALIDATION_ERROR', 'User is not valid.');
      var token = authRandomToken(keyedOptions(spreadsheet));
      recordKdfAdvance(spreadsheet);
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
    return guarded(function () {
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
    return guarded(function () {
      revokeUserSessionsUnlocked(open(), String(userId || ''), reason);
      return { ok: true };
    });
  }

  // Logout revokes only the presented session. Other sessions for the same
  // user stay valid. Credential replace/rotate still uses revokeUserSessions.
  function revokeCurrentSession(token, reason) {
    var raw = token === undefined || token === null ? '' : String(token);
    if (!raw) return { ok: true, revoked: false };
    return guarded(function () {
      var spreadsheet = open();
      var hash = authHashToken(raw);
      var sessions = repo.readSessions(spreadsheet);
      var now = stamp();
      var revoked = false;
      var next = sessions.map(function (item) {
        if (item.revokedAt) return item;
        if (!authTimingSafeEqual(authHexToBytes(item.tokenHash), authHexToBytes(hash))) return item;
        revoked = true;
        return Object.assign({}, item, {
          revokedAt: now,
          revokedReason: String(reason || 'logout')
        });
      });
      if (revoked) repo.writeSessions(spreadsheet, next);
      return { ok: true, revoked: revoked };
    });
  }

  var AUTH_LOGIN_WINDOW_MS = 15 * 60 * 1000;
  var AUTH_LOGIN_MAX_ATTEMPTS = 5;
  var AUTH_LOGIN_BASE_COOLDOWN_MS = 60 * 1000;
  var AUTH_LOGIN_MAX_COOLDOWN_MS = 15 * 60 * 1000;
  var AUTH_LOGIN_ATTEMPT_MAX_ROWS = 200;
  var AUTH_LOGIN_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

  function emailAttemptHash(email) {
    return authHashToken(String(email || '').trim().toLowerCase());
  }

  function parseMillis(value) {
    var ms = Date.parse(String(value || ''));
    return isFinite(ms) ? ms : 0;
  }

  function pruneLoginAttempts(records, nowMs) {
    var kept = records.filter(function (item) {
      var last = parseMillis(item.lastAttemptAt) || parseMillis(item.updatedAt);
      return last && (nowMs - last) <= AUTH_LOGIN_ATTEMPT_TTL_MS;
    });
    if (kept.length <= AUTH_LOGIN_ATTEMPT_MAX_ROWS) return kept;
    kept.sort(function (a, b) {
      return parseMillis(b.lastAttemptAt) - parseMillis(a.lastAttemptAt);
    });
    return kept.slice(0, AUTH_LOGIN_ATTEMPT_MAX_ROWS);
  }

  function loginCooldownMs(failedCount) {
    var extra = failedCount - AUTH_LOGIN_MAX_ATTEMPTS;
    if (extra < 0) return 0;
    var shift = extra;
    if (shift > 4) shift = 4;
    var wait = AUTH_LOGIN_BASE_COOLDOWN_MS * Math.pow(2, shift);
    if (wait > AUTH_LOGIN_MAX_COOLDOWN_MS) wait = AUTH_LOGIN_MAX_COOLDOWN_MS;
    return wait;
  }

  function findAttempt(records, emailHash) {
    var i;
    for (i = 0; i < records.length; i += 1) {
      if (records[i].emailHash === emailHash) return records[i];
    }
    return null;
  }

  function isLoginThrottled(email) {
    return guarded(function () {
      var spreadsheet = open();
      repo.ensure(spreadsheet);
      var needle = String(email || '').trim().toLowerCase();
      if (!needle) return false;
      var hash = emailAttemptHash(needle);
      var nowMs = clock().getTime();
      var records = pruneLoginAttempts(repo.readLoginAttempts(spreadsheet), nowMs);
      var row = findAttempt(records, hash);
      if (!row) return false;
      var until = parseMillis(row.cooldownUntil);
      return Boolean(until && nowMs < until);
    });
  }

  function recordLoginFailure(email) {
    return guarded(function () {
      var spreadsheet = open();
      repo.ensure(spreadsheet);
      var needle = String(email || '').trim().toLowerCase();
      if (!needle) return { throttled: false };
      var hash = emailAttemptHash(needle);
      var nowMs = clock().getTime();
      var now = stamp();
      var records = pruneLoginAttempts(repo.readLoginAttempts(spreadsheet), nowMs);
      var row = findAttempt(records, hash);
      var until = row ? parseMillis(row.cooldownUntil) : 0;
      if (until && nowMs < until) {
        return { throttled: true, failedCount: Number(row.failedCount || 0) };
      }
      var windowStart = row ? parseMillis(row.windowStartedAt) : 0;
      var count = row ? Number(row.failedCount || 0) : 0;
      if (!windowStart || (nowMs - windowStart) > AUTH_LOGIN_WINDOW_MS) {
        windowStart = nowMs;
        count = 0;
      }
      count += 1;
      var cooldown = loginCooldownMs(count);
      var next = {
        id: row && row.id ? row.id : createId(),
        emailHash: hash,
        failedCount: count,
        windowStartedAt: nowIso(new Date(windowStart)),
        cooldownUntil: cooldown ? nowIso(new Date(nowMs + cooldown)) : '',
        lastAttemptAt: now,
        updatedAt: now
      };
      var written = records.filter(function (item) { return item.emailHash !== hash; });
      written.push(next);
      repo.writeLoginAttempts(spreadsheet, pruneLoginAttempts(written, nowMs));
      return { throttled: Boolean(cooldown), failedCount: count };
    });
  }

  function clearLoginFailures(email) {
    return guarded(function () {
      var spreadsheet = open();
      repo.ensure(spreadsheet);
      var needle = String(email || '').trim().toLowerCase();
      if (!needle) return { ok: true };
      var hash = emailAttemptHash(needle);
      var nowMs = clock().getTime();
      var records = pruneLoginAttempts(repo.readLoginAttempts(spreadsheet), nowMs).filter(function (item) {
        return item.emailHash !== hash;
      });
      repo.writeLoginAttempts(spreadsheet, records);
      return { ok: true };
    });
  }

  function ensureSheets() {
    return guarded(function () {
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
    revokeCurrentSession: revokeCurrentSession,
    revokeUserSessions: revokeUserSessions,
    isLoginThrottled: isLoginThrottled,
    recordLoginFailure: recordLoginFailure,
    clearLoginFailures: clearLoginFailures,
    readEvents: readEvents,
    readCredentials: readCredentials
  };
}
