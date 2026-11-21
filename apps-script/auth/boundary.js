// Authentication boundary. Session validation lives in authService.
// Business services still receive actorUserId only after the router overwrites
// it from the validated session. They do not read passwords or tokens.

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
    enforced: Boolean(principal && principal.authenticated)
  };
}
