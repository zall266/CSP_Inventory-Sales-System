// Phase 1 boundary only. Phase 2 inserts a temporary session provider.
// Phase 13 replaces that provider. Business services take a principal and a
// permission key. They do not read passwords, HR, or Script Properties.

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
