var AUTH_ACTIONS = {
  'auth.status': true,
  'auth.login': true,
  'auth.logout': true,
  'auth.me': true,
  'auth.changePassword': true,
  'auth.resetPassword': true,
  'auth.bootstrapOwner': true,
  'auth.events': true,
  'auth.accounts': true
};

var AUTH_PUBLIC_ACTIONS = {
  'system.health': true,
  'system.ping': true,
  'auth.status': true,
  'auth.login': true,
  'auth.bootstrapOwner': true,
  'identity.bootstrap': true
};

var AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
var AUTH_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
var AUTH_LOCK_THRESHOLD = 5;
var AUTH_LOCK_MS = 15 * 60 * 1000;
var AUTH_GENERIC_LOGIN = 'Username or password is incorrect.';
var AUTH_DISABLED = 'This account is disabled.';
var AUTH_EXPIRED = 'Your session has expired. Please sign in again.';
var AUTH_REQUIRED = 'Sign in is required.';

function isPublicAuthAction(action) {
  return Boolean(AUTH_PUBLIC_ACTIONS[String(action || '')]);
}

function createAuthService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createAuthRepository(sheets);
  var identityRepository = createIdentityRepository(sheets, deps.driveStorage);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(AUTH_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function identitySnapshot(spreadsheet) {
    return identityRepository.load(spreadsheet);
  }

  function findUser(snapshot, id) {
    for (var i = 0; i < snapshot.users.length; i += 1) {
      if (snapshot.users[i].id === id) return snapshot.users[i];
    }
    return null;
  }

  function findUserByUsername(snapshot, username) {
    var needle = text(username).trim().toLowerCase();
    if (!needle) return null;
    for (var i = 0; i < snapshot.users.length; i += 1) {
      if (String(snapshot.users[i].email || '').trim().toLowerCase() === needle) return snapshot.users[i];
    }
    return null;
  }

  function findOwner(snapshot) {
    for (var i = 0; i < snapshot.users.length; i += 1) {
      var user = snapshot.users[i];
      if (user.status === 'active' && isOwnerUser(snapshot, user)) return user;
    }
    return null;
  }

  function findCredential(records, username) {
    var needle = text(username).trim().toLowerCase();
    for (var i = 0; i < records.length; i += 1) {
      if (records[i].username === needle) return records[i];
    }
    return null;
  }

  function findCredentialByUserId(records, userId) {
    for (var i = 0; i < records.length; i += 1) {
      if (records[i].userId === userId) return records[i];
    }
    return null;
  }

  function recordEvent(spreadsheet, entry) {
    try {
      repository.appendEvent(spreadsheet, {
        id: createId(),
        timestamp: nowIso(),
        actorUserId: text(entry.actorUserId),
        targetUserId: text(entry.targetUserId),
        eventType: text(entry.eventType),
        result: text(entry.result),
        reason: text(entry.reason).slice(0, 180),
        requestId: text(entry.requestId)
      });
    } catch (error) {
      console.log(JSON.stringify({ status: 'error', errorCode: 'AUTH_EVENT_WRITE_FAILED' }));
    }
    try {
      sheets.ensureSheet(spreadsheet, 'AuditLogs', AUDIT_HEADERS);
      audit.append({
        userId: text(entry.actorUserId),
        action: 'auth.' + text(entry.eventType),
        entityType: 'user',
        entityId: text(entry.targetUserId || entry.actorUserId),
        reference: text(entry.result),
        before: '',
        after: text(entry.reason).slice(0, 180),
        requestId: text(entry.requestId)
      });
    } catch (error) {
      console.log(JSON.stringify({ status: 'error', errorCode: 'AUTH_AUDIT_WRITE_FAILED' }));
    }
  }

  function publicUser(snapshot, user, credential) {
    var role = roleById(snapshot, user.roleId);
    return {
      id: user.id,
      name: user.name,
      username: user.email,
      email: user.email,
      roleId: user.roleId,
      role: user.role,
      roleName: role ? role.name : user.role,
      departmentId: user.departmentId,
      status: user.status,
      lastLogin: user.lastLogin,
      mustChange: Boolean(credential && credential.mustChange),
      isOwner: isOwnerUser(snapshot, user)
    };
  }

  function sessionEnvelope(snapshot, user, credential, token, session) {
    return {
      sessionToken: token,
      expiresAt: session.expiresAt,
      idleExpiresAt: session.idleExpiresAt,
      user: publicUser(snapshot, user, credential)
    };
  }

  function persistCredentials(spreadsheet, records, next) {
    var written = records.filter(function (item) { return item.id !== next.id; });
    written.push(next);
    repository.writeCredentials(spreadsheet, written);
  }

  function setPassword(record, password, actorId, mustChange) {
    authValidatePasswordPolicy(password, record.username);
    var hashed = authHashPassword(password);
    record.passwordHash = hashed.hash;
    record.salt = hashed.salt;
    record.iterations = hashed.iterations;
    record.algorithm = hashed.algorithm;
    record.mustChange = Boolean(mustChange);
    record.passwordUpdatedAt = nowIso();
    record.failedCount = 0;
    record.lockedUntil = '';
    record.status = 'active';
    record.updatedAt = nowIso();
    if (!record.createdAt) record.createdAt = record.updatedAt;
    if (!record.createdBy) record.createdBy = actorId || '';
    return record;
  }

  function createCredential(user, password, actorId, mustChange) {
    return setPassword({
      id: createId(),
      userId: user.id,
      username: String(user.email || '').trim().toLowerCase()
    }, password, actorId, mustChange);
  }

  function revokeSessions(spreadsheet, userId, reason, exceptId) {
    var now = nowIso();
    var sessions = repository.readSessions(spreadsheet).map(function (session) {
      if (session.userId !== userId) return session;
      if (exceptId && session.id === exceptId) return session;
      if (session.revokedAt) return session;
      return {
        id: session.id,
        userId: session.userId,
        tokenHash: session.tokenHash,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        idleExpiresAt: session.idleExpiresAt,
        revokedAt: now,
        revokedReason: reason || 'revoked'
      };
    });
    repository.writeSessions(spreadsheet, sessions);
  }

  function createSessionRecord(spreadsheet, user, now) {
    var token = authRandomToken();
    var created = now.toISOString();
    var session = {
      id: createId(),
      userId: user.id,
      tokenHash: authHashToken(token),
      createdAt: created,
      lastSeenAt: created,
      expiresAt: new Date(now.getTime() + AUTH_SESSION_TTL_MS).toISOString(),
      idleExpiresAt: new Date(now.getTime() + AUTH_IDLE_TTL_MS).toISOString(),
      revokedAt: '',
      revokedReason: ''
    };
    repository.writeSessions(spreadsheet, repository.readSessions(spreadsheet).concat([session]));
    return { token: token, session: session };
  }

  function touchLastLogin(spreadsheet, snapshot, userId, stamp) {
    var users = snapshot.users.map(function (item) {
      if (item.id !== userId) return item;
      return {
        id: item.id,
        name: item.name,
        email: item.email,
        roleId: item.roleId,
        role: item.role,
        departmentId: item.departmentId,
        status: item.status,
        lastLogin: stamp,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };
    });
    identityRepository.writeUsers(spreadsheet, users);
  }

  function isLocked(credential, now) {
    if (!credential || !credential.lockedUntil) return false;
    var until = Date.parse(credential.lockedUntil);
    return isFinite(until) && until > now.getTime();
  }

  function failLogin(spreadsheet, credentials, credential, username, reason, requestId) {
    if (credential) {
      credential.failedCount = Number(credential.failedCount || 0) + 1;
      credential.updatedAt = nowIso();
      if (credential.failedCount >= AUTH_LOCK_THRESHOLD) {
        credential.lockedUntil = new Date(Date.now() + AUTH_LOCK_MS).toISOString();
        credential.failedCount = 0;
      }
      persistCredentials(spreadsheet, credentials, credential);
    }
    recordEvent(spreadsheet, {
      actorUserId: '',
      targetUserId: credential ? credential.userId : '',
      eventType: 'login_failed',
      result: 'denied',
      reason: reason,
      requestId: requestId
    });
    if (credential && isLocked(credential, new Date())) {
      throw appError('FORBIDDEN', AUTH_GENERIC_LOGIN);
    }
    throw appError('UNAUTHORIZED', AUTH_GENERIC_LOGIN);
  }

  function login(spreadsheet, payload, requestId) {
    var username = text(payload.username).trim().toLowerCase();
    var password = payload.password;
    if (!username || typeof password !== 'string' || !password) {
      throw appError('VALIDATION_ERROR', 'Username and password are required.');
    }
    var snapshot = identitySnapshot(spreadsheet);
    var credentials = repository.readCredentials(spreadsheet);
    var credential = findCredential(credentials, username);
    var now = new Date();
    if (credential && isLocked(credential, now)) {
      recordEvent(spreadsheet, {
        actorUserId: '',
        targetUserId: credential.userId,
        eventType: 'login_failed',
        result: 'denied',
        reason: 'locked',
        requestId: requestId
      });
      throw appError('FORBIDDEN', AUTH_GENERIC_LOGIN);
    }
    var user = credential ? findUser(snapshot, credential.userId) : findUserByUsername(snapshot, username);
    if (!credential || !authVerifyPassword(password, credential)) {
      return failLogin(spreadsheet, credentials, credential, username, 'invalid_credentials', requestId);
    }
    if (!user || user.status !== 'active') {
      recordEvent(spreadsheet, {
        actorUserId: user ? user.id : credential.userId,
        targetUserId: credential.userId,
        eventType: 'login_failed',
        result: 'denied',
        reason: 'disabled',
        requestId: requestId
      });
      throw appError('FORBIDDEN', AUTH_DISABLED);
    }
    credential.failedCount = 0;
    credential.lockedUntil = '';
    credential.updatedAt = nowIso();
    persistCredentials(spreadsheet, credentials, credential);
    var minted = createSessionRecord(spreadsheet, user, now);
    touchLastLogin(spreadsheet, snapshot, user.id, minted.session.createdAt);
    snapshot = identitySnapshot(spreadsheet);
    user = findUser(snapshot, user.id);
    recordEvent(spreadsheet, {
      actorUserId: user.id,
      targetUserId: user.id,
      eventType: 'login',
      result: 'ok',
      reason: '',
      requestId: requestId
    });
    return sessionEnvelope(snapshot, user, credential, minted.token, minted.session);
  }

  function status(spreadsheet) {
    var snapshot = identitySnapshot(spreadsheet);
    var credentials = repository.readCredentials(spreadsheet);
    var owner = snapshot.empty ? null : findOwner(snapshot);
    return {
      identityReady: !snapshot.empty,
      needsOwnerBootstrap: Boolean(owner && credentials.length === 0),
      sessionHours: AUTH_SESSION_TTL_MS / (60 * 60 * 1000),
      idleMinutes: AUTH_IDLE_TTL_MS / (60 * 1000),
      algorithm: 'pbkdf2-hmac-sha256',
      iterations: AUTH_PBKDF2_ITERATIONS
    };
  }

  function bootstrapOwner(spreadsheet, payload, requestId) {
    var snapshot = identitySnapshot(spreadsheet);
    if (snapshot.empty) throw appError('CONFLICT', 'Identity is not initialized.');
    var credentials = repository.readCredentials(spreadsheet);
    if (credentials.length) throw appError('FORBIDDEN', 'Owner bootstrap is not available.');
    var username = text(payload.username).trim().toLowerCase();
    var password = payload.password;
    if (!username || typeof password !== 'string') throw appError('VALIDATION_ERROR', 'Username and password are required.');
    var user = findUserByUsername(snapshot, username);
    if (!user || !isOwnerUser(snapshot, user) || user.status !== 'active') {
      throw appError('FORBIDDEN', 'Owner bootstrap is not available.');
    }
    authValidatePasswordPolicy(password, username);
    var credential = createCredential(user, password, user.id, false);
    repository.writeCredentials(spreadsheet, [credential]);
    var minted = createSessionRecord(spreadsheet, user, new Date());
    touchLastLogin(spreadsheet, snapshot, user.id, minted.session.createdAt);
    snapshot = identitySnapshot(spreadsheet);
    user = findUser(snapshot, user.id);
    recordEvent(spreadsheet, {
      actorUserId: user.id,
      targetUserId: user.id,
      eventType: 'owner_bootstrap',
      result: 'ok',
      reason: '',
      requestId: requestId
    });
    return sessionEnvelope(snapshot, user, credential, minted.token, minted.session);
  }

  function parseSession(spreadsheet, token) {
    var value = text(token).trim();
    if (!value) throw appError('UNAUTHORIZED', AUTH_REQUIRED);
    var tokenHash = authHashToken(value);
    var sessions = repository.readSessions(spreadsheet);
    var now = Date.now();
    var found = null;
    for (var i = 0; i < sessions.length; i += 1) {
      if (sessions[i].tokenHash === tokenHash) {
        found = sessions[i];
        break;
      }
    }
    if (!found) throw appError('UNAUTHORIZED', AUTH_REQUIRED);
    if (found.revokedAt) {
      recordEvent(spreadsheet, {
        actorUserId: found.userId,
        targetUserId: found.userId,
        eventType: 'session_revoked_access',
        result: 'denied',
        reason: found.revokedReason || 'revoked',
        requestId: ''
      });
      throw appError('UNAUTHORIZED', AUTH_EXPIRED);
    }
    if (Date.parse(found.expiresAt) <= now || Date.parse(found.idleExpiresAt) <= now) {
      found.revokedAt = nowIso();
      found.revokedReason = Date.parse(found.expiresAt) <= now ? 'expired' : 'idle';
      repository.writeSessions(spreadsheet, sessions);
      recordEvent(spreadsheet, {
        actorUserId: found.userId,
        targetUserId: found.userId,
        eventType: 'session_expired',
        result: 'denied',
        reason: found.revokedReason,
        requestId: ''
      });
      throw appError('UNAUTHORIZED', AUTH_EXPIRED);
    }
    var user = readUserRow(spreadsheet, found.userId);
    if (!user || user.status !== 'active') {
      found.revokedAt = nowIso();
      found.revokedReason = 'disabled';
      repository.writeSessions(spreadsheet, sessions);
      throw appError('FORBIDDEN', AUTH_DISABLED);
    }
    var lastSeen = Date.parse(found.lastSeenAt);
    if (!isFinite(lastSeen) || now - lastSeen > 60000) {
      found.lastSeenAt = nowIso();
      found.idleExpiresAt = new Date(now + AUTH_IDLE_TTL_MS).toISOString();
      repository.writeSessions(spreadsheet, sessions);
    }
    var credential = findCredentialByUserId(repository.readCredentials(spreadsheet), user.id);
    return {
      session: found,
      user: user,
      credential: credential,
      snapshot: null
    };
  }

  function readUserRow(spreadsheet, userId) {
    var usersSheet = sheets.getSheet(spreadsheet, 'Users');
    if (!usersSheet) return null;
    var records;
    try {
      records = sheets.readObjects(usersSheet);
    } catch (error) {
      return null;
    }
    for (var i = 0; i < records.length; i += 1) {
      if (text(records[i].id) === userId) {
        return {
          id: text(records[i].id),
          name: text(records[i].name),
          email: text(records[i].email),
          roleId: text(records[i].roleId),
          role: text(records[i].role),
          departmentId: text(records[i].departmentId),
          status: text(records[i].status) === 'inactive' ? 'inactive' : 'active',
          lastLogin: text(records[i].lastLogin)
        };
      }
    }
    return null;
  }

  function withIdentitySnapshot(spreadsheet, resolved) {
    if (!resolved.snapshot) resolved.snapshot = identitySnapshot(spreadsheet);
    return resolved;
  }

  function logout(spreadsheet, payload, requestId, resolved) {
    var sessions = repository.readSessions(spreadsheet).map(function (session) {
      if (session.id !== resolved.session.id) return session;
      return {
        id: session.id,
        userId: session.userId,
        tokenHash: session.tokenHash,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        idleExpiresAt: session.idleExpiresAt,
        revokedAt: nowIso(),
        revokedReason: 'logout'
      };
    });
    repository.writeSessions(spreadsheet, sessions);
    recordEvent(spreadsheet, {
      actorUserId: resolved.user.id,
      targetUserId: resolved.user.id,
      eventType: 'logout',
      result: 'ok',
      reason: '',
      requestId: requestId
    });
    return { loggedOut: true };
  }

  function me(spreadsheet, resolved) {
    return {
      user: publicUser(resolved.snapshot, resolved.user, resolved.credential),
      expiresAt: resolved.session.expiresAt,
      idleExpiresAt: resolved.session.idleExpiresAt
    };
  }

  function changePassword(spreadsheet, payload, requestId, resolved) {
    var currentPassword = payload.currentPassword;
    var nextPassword = payload.newPassword;
    if (typeof currentPassword !== 'string' || typeof nextPassword !== 'string') {
      throw appError('VALIDATION_ERROR', 'Current and new passwords are required.');
    }
    var credentials = repository.readCredentials(spreadsheet);
    var credential = findCredentialByUserId(credentials, resolved.user.id);
    if (!credential || !authVerifyPassword(currentPassword, credential)) {
      recordEvent(spreadsheet, {
        actorUserId: resolved.user.id,
        targetUserId: resolved.user.id,
        eventType: 'password_change',
        result: 'denied',
        reason: 'invalid_current',
        requestId: requestId
      });
      throw appError('FORBIDDEN', 'Current password is incorrect.');
    }
    if (currentPassword === nextPassword) {
      throw appError('VALIDATION_ERROR', 'New password must be different.');
    }
    setPassword(credential, nextPassword, resolved.user.id, false);
    persistCredentials(spreadsheet, credentials, credential);
    revokeSessions(spreadsheet, resolved.user.id, 'password_change', resolved.session.id);
    recordEvent(spreadsheet, {
      actorUserId: resolved.user.id,
      targetUserId: resolved.user.id,
      eventType: 'password_change',
      result: 'ok',
      reason: '',
      requestId: requestId
    });
    return { changed: true, mustChange: false };
  }

  function resetPassword(spreadsheet, payload, requestId, resolved) {
    if (!isOwnerUser(resolved.snapshot, resolved.user)) {
      recordEvent(spreadsheet, {
        actorUserId: resolved.user.id,
        targetUserId: text(payload.userId),
        eventType: 'password_reset',
        result: 'denied',
        reason: 'not_owner',
        requestId: requestId
      });
      throw appError('FORBIDDEN', 'Only Owner can reset passwords.');
    }
    var target = findUser(resolved.snapshot, text(payload.userId));
    if (!target) throw appError('NOT_FOUND', 'User was not found.');
    var nextPassword = payload.newPassword;
    if (typeof nextPassword !== 'string') throw appError('VALIDATION_ERROR', 'A new password is required.');
    var credentials = repository.readCredentials(spreadsheet);
    var credential = findCredentialByUserId(credentials, target.id);
    if (!credential) credential = createCredential(target, nextPassword, resolved.user.id, true);
    else setPassword(credential, nextPassword, resolved.user.id, true);
    persistCredentials(spreadsheet, credentials, credential);
    revokeSessions(spreadsheet, target.id, 'password_reset');
    recordEvent(spreadsheet, {
      actorUserId: resolved.user.id,
      targetUserId: target.id,
      eventType: 'password_reset',
      result: 'ok',
      reason: 'must_change',
      requestId: requestId
    });
    return { reset: true, userId: target.id, mustChange: true };
  }

  function events(spreadsheet, payload, resolved) {
    if (!isOwnerUser(resolved.snapshot, resolved.user)) {
      throw appError('FORBIDDEN', 'Only Owner can view security events.');
    }
    var rows = repository.readEvents(spreadsheet).slice().reverse();
    var limit = Math.min(200, Math.max(1, Number(payload.limit) || 50));
    return { events: rows.slice(0, limit) };
  }

  function accounts(spreadsheet, resolved) {
    if (!isOwnerUser(resolved.snapshot, resolved.user)) {
      throw appError('FORBIDDEN', 'Only Owner can view staff security status.');
    }
    var summaries = {};
    repository.readCredentials(spreadsheet).forEach(function (credential) {
      summaries[credential.userId] = {
        userId: credential.userId,
        username: credential.username,
        hasPassword: Boolean(credential.passwordHash),
        mustChange: Boolean(credential.mustChange),
        passwordUpdatedAt: credential.passwordUpdatedAt,
        lockedUntil: credential.lockedUntil
      };
    });
    return { accounts: summaries };
  }

  function syncCredentialUsername(spreadsheet, userId, username) {
    var credentials = repository.readCredentials(spreadsheet);
    var credential = findCredentialByUserId(credentials, userId);
    if (!credential) return;
    credential.username = text(username).trim().toLowerCase();
    credential.updatedAt = nowIso();
    persistCredentials(spreadsheet, credentials, credential);
  }

  function requirePasswordReady(resolved, action) {
    if (action === 'auth.changePassword' || action === 'auth.logout' || action === 'auth.me') return;
    if (resolved.credential && resolved.credential.mustChange) {
      throw appError('FORBIDDEN', 'Password change is required.');
    }
  }

  function authenticateRequest(request) {
    var action = request && request.action ? String(request.action) : '';
    if (isPublicAuthAction(action)) {
      return { authenticated: false, userId: '', sessionId: '', public: true };
    }
    var payload = request && request.payload ? request.payload : {};
    var spreadsheet = sheets.openSpreadsheet();
    var resolved = parseSession(spreadsheet, payload.sessionToken);
    requirePasswordReady(resolved, action);
    payload.actorUserId = resolved.user.id;
    if (Object.prototype.hasOwnProperty.call(payload, 'actorRole')) delete payload.actorRole;
    return {
      authenticated: true,
      userId: resolved.user.id,
      sessionId: resolved.session.id,
      mustChange: Boolean(resolved.credential && resolved.credential.mustChange),
      user: resolved.user
    };
  }

  function issueTestSession(spreadsheet, userId) {
    var usersSheet = sheets.getSheet(spreadsheet, 'Users');
    if (!usersSheet) return '';
    var records;
    try {
      records = sheets.readObjects(usersSheet);
    } catch (error) {
      return '';
    }
    var wanted = text(userId).trim();
    var user = null;
    for (var i = 0; i < records.length; i += 1) {
      var id = text(records[i].id).trim();
      if (!id) continue;
      if (wanted && id === wanted) {
        user = { id: id };
        break;
      }
      if (!wanted && !user) user = { id: id };
      if (!wanted && text(records[i].role) === 'owner') {
        user = { id: id };
        break;
      }
    }
    if (!user) return '';
    return createSessionRecord(spreadsheet, user, new Date()).token;
  }

  function revokeUserSessions(spreadsheet, userId, reason) {
    revokeSessions(spreadsheet, userId, reason || 'revoked');
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload;
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'auth.status') return okEnvelope(status(spreadsheet));
      if (action === 'auth.login') return okEnvelope(login(spreadsheet, payload, requestId));
      if (action === 'auth.bootstrapOwner') return okEnvelope(bootstrapOwner(spreadsheet, payload, requestId));
      var resolved = parseSession(spreadsheet, payload.sessionToken);
      if (action === 'auth.logout') return okEnvelope(logout(spreadsheet, payload, requestId, resolved));
      if (action === 'auth.me') return okEnvelope(me(spreadsheet, withIdentitySnapshot(spreadsheet, resolved)));
      if (action === 'auth.changePassword') return okEnvelope(changePassword(spreadsheet, payload, requestId, resolved));
      if (action === 'auth.resetPassword') return okEnvelope(resetPassword(spreadsheet, payload, requestId, withIdentitySnapshot(spreadsheet, resolved)));
      if (action === 'auth.events') return okEnvelope(events(spreadsheet, payload, withIdentitySnapshot(spreadsheet, resolved)));
      if (action === 'auth.accounts') return okEnvelope(accounts(spreadsheet, withIdentitySnapshot(spreadsheet, resolved)));
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return {
    canHandle: canHandle,
    dispatch: dispatch,
    authenticateRequest: authenticateRequest,
    issueTestSession: issueTestSession,
    revokeUserSessions: revokeUserSessions,
    syncCredentialUsername: syncCredentialUsername
  };
}

function resolveAuthService(backend) {
  if (backend && backend.auth) return backend.auth;
  if (backend && backend.sheets) {
    return createAuthService({
      sheetRepository: backend.sheets,
      driveStorage: backend.driveStorage || backend.drive
    });
  }
  return createAuthService({ sheetRepository: createSheetRepository() });
}

function issueHarnessSession(request, backend) {
  if (!request || !request.payload || request.payload.sessionToken !== undefined) return '';
  if (isPublicAuthAction(request.action)) return '';
  try {
    var auth = resolveAuthService(backend);
    var sheets = backend && backend.sheets ? backend.sheets : createSheetRepository();
    return auth.issueTestSession(sheets.openSpreadsheet(), textOrEmpty(request.payload.actorUserId));
  } catch (error) {
    return '';
  }
}

function textOrEmpty(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}
