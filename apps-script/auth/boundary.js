// AUTH-1 session boundary. Business services still take a principal and a
// permission key. They do not read passwords, HR, or Script Properties.
// authorize().enforced stays false until AUTH-2 protects every business action.
// A presented session token is always validated (fail closed). Missing token
// still yields an unauthenticated principal so the prototype SPA keeps working
// until AUTH-2. When a principal is authenticated, the router overwrites
// payload.actorUserId from the session and ignores the client value.

function readEnvelopeSessionToken(request) {
  if (!request) return '';
  if (request.sessionToken === undefined || request.sessionToken === null) return '';
  return String(request.sessionToken);
}

function authenticate() {
  return {
    userId: '',
    sessionId: '',
    authenticated: false
  };
}

function authorize(principal, permissionKey) {
  return {
    principal: principal || authenticate(),
    permissionKey: permissionKey || '',
    enforced: false
  };
}

var AUTH_UNAUTHENTICATED_ACTIONS = {
  'system.health': true,
  'system.ping': true,
  'auth.login': true
};

function isUnauthenticatedAuthAction(action) {
  return Boolean(AUTH_UNAUTHENTICATED_ACTIONS[action]);
}
