// AUTH-2 session and authorization boundary. Business services take a principal
// and a permission key. They do not read passwords, HR, or Script Properties.
// The router enforces ACTION_AUTHORIZATION before dispatch. Missing tokens on
// non-public actions fail closed. When a principal is authenticated, the router
// overwrites payload.actorUserId from the session.

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
    enforced: true
  };
}

function isUnauthenticatedAuthAction(action) {
  return isPublicAction(action);
}
