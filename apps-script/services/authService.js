// AUTH-1: login / logout / session over the existing Auth V1 credential store.
// Public HTTP actions: auth.login, auth.logout, auth.session.
// issueCredential, rotateCredential, readCredentials, and hashes stay internal.
// The raw session token is returned only in auth.login data.token. It is never
// written to Sheets, AuthEvents, logs, or idempotency rows.

var AUTH_ACTIONS = {
  'auth.login': true,
  'auth.logout': true,
  'auth.session': true
};

var AUTH_GENERIC_LOGIN_MESSAGE = 'Email or password is incorrect.';
var AUTH_GENERIC_SESSION_MESSAGE = 'The session is not valid.';

function createAuthService(deps) {
  var sheets = deps.sheetRepository;
  var authStore = deps.authStore;
  var identityRepo = createIdentityRepository(sheets, deps.driveStorage);

  function canHandle(action) {
    return Boolean(AUTH_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function open() {
    return sheets.openSpreadsheet();
  }

  function publicUser(user) {
    return {
      id: text(user.id || user.userId),
      name: text(user.name),
      email: text(user.email).trim().toLowerCase(),
      roleId: text(user.roleId)
    };
  }

  function findUserById(snapshot, userId) {
    var id = text(userId).trim();
    var i;
    for (i = 0; i < snapshot.users.length; i += 1) {
      if (snapshot.users[i].id === id) return snapshot.users[i];
    }
    return null;
  }

  function findUserByEmail(snapshot, email) {
    var needle = text(email).trim().toLowerCase();
    var i;
    for (i = 0; i < snapshot.users.length; i += 1) {
      if (text(snapshot.users[i].email).trim().toLowerCase() === needle) return snapshot.users[i];
    }
    return null;
  }

  function loginFailed(spreadsheet, requestId, targetUserId) {
    authStore.ensureSheets();
    identityRepo.ensure(spreadsheet);
    var repo = createAuthRepository(sheets);
    repo.appendEvent(spreadsheet, {
      id: createId(),
      timestamp: nowIso(),
      actorUserId: '',
      targetUserId: text(targetUserId),
      eventType: 'login_failed',
      result: 'error',
      reason: 'rejected',
      requestId: text(requestId)
    });
    throw appError('UNAUTHORIZED', AUTH_GENERIC_LOGIN_MESSAGE);
  }

  function recordEvent(spreadsheet, eventType, actorUserId, targetUserId, requestId) {
    var repo = createAuthRepository(sheets);
    repo.appendEvent(spreadsheet, {
      id: createId(),
      timestamp: nowIso(),
      actorUserId: text(actorUserId),
      targetUserId: text(targetUserId),
      eventType: eventType,
      result: 'ok',
      reason: '',
      requestId: text(requestId)
    });
  }

  function resolvePrincipal(request) {
    var token = readEnvelopeSessionToken(request);
    if (!token) {
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    if (!authStore || typeof authStore.validateSession !== 'function') {
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    var session;
    try {
      session = authStore.validateSession(token);
    } catch (error) {
      if (error && error.expose && error.code === 'CONFLICT') throw error;
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    if (!session || !session.userId) {
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    var snapshot = identityRepo.load(open());
    var user = findUserById(snapshot, session.userId);
    if (!user || text(user.status).trim() !== 'active') {
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    return {
      userId: user.id,
      sessionId: text(session.id),
      authenticated: true,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      user: user,
      snapshot: snapshot
    };
  }

  function login(request) {
    return withScriptLock(function () {
      var payload = request && request.payload ? request.payload : {};
      var requestId = request && request.requestId ? String(request.requestId) : '';
      var email = text(payload.email || payload.username).trim().toLowerCase();
      var password = payload.password === undefined || payload.password === null ? '' : String(payload.password);
      var spreadsheet = open();
      authStore.ensureSheets();
      var snapshot = identityRepo.load(spreadsheet);
      if (!email || !password) {
        if (email) authStore.recordLoginFailure(email);
        loginFailed(spreadsheet, requestId, '');
      }
      if (authStore.isLoginThrottled(email)) {
        loginFailed(spreadsheet, requestId, '');
      }
      var user = findUserByEmail(snapshot, email);
      if (!user || text(user.status).trim() !== 'active') {
        authStore.recordLoginFailure(email);
        loginFailed(spreadsheet, requestId, user ? user.id : '');
      }
      var verified;
      try {
        verified = authStore.verifyCredential(email, password);
      } catch (error) {
        if (error && error.expose && (error.code === 'CONFLICT' || error.code === 'INTERNAL_ERROR')) throw error;
        authStore.recordLoginFailure(email);
        loginFailed(spreadsheet, requestId, user.id);
      }
      if (!verified || !verified.ok || verified.userId !== user.id) {
        authStore.recordLoginFailure(email);
        loginFailed(spreadsheet, requestId, user.id);
      }
      authStore.clearLoginFailures(email);
      var issued = authStore.issueSession({ userId: user.id });
      recordEvent(spreadsheet, 'login_ok', user.id, user.id, requestId);
      return okEnvelope({
        token: issued.token,
        sessionId: issued.record.id,
        expiresAt: issued.record.expiresAt,
        idleExpiresAt: issued.record.idleExpiresAt,
        user: publicUser(user)
      }, { requestId: requestId });
    });
  }

  function logout(request, principal) {
    var requestId = request && request.requestId ? String(request.requestId) : '';
    var token = readEnvelopeSessionToken(request);
    if (!token || !principal || !principal.authenticated) {
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    var result = authStore.revokeCurrentSession(token, 'logout');
    if (!result || !result.revoked) {
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    recordEvent(open(), 'logout_ok', principal.userId, principal.userId, requestId);
    return okEnvelope({ revoked: true }, { requestId: requestId });
  }

  function session(request, principal) {
    var requestId = request && request.requestId ? String(request.requestId) : '';
    if (!principal || !principal.authenticated) {
      throw appError('UNAUTHORIZED', AUTH_GENERIC_SESSION_MESSAGE);
    }
    return okEnvelope({
      sessionId: principal.sessionId,
      user: publicUser(principal)
    }, { requestId: requestId });
  }

  function dispatch(request, principal) {
    var action = request.action;
    if (action === 'auth.login') return login(request);
    if (action === 'auth.logout') return logout(request, principal);
    if (action === 'auth.session') return session(request, principal);
    return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', {
      requestId: request.requestId ? String(request.requestId) : ''
    });
  }

  return {
    canHandle: canHandle,
    dispatch: dispatch,
    resolvePrincipal: resolvePrincipal
  };
}
