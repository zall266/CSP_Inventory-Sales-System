function createRouter(backend) {
  var system = backend && typeof backend.health === 'function' ? backend : backend.system;
  var identity = backend && backend.identity ? backend.identity : null;
  var masters = backend && backend.masters ? backend.masters : null;
  var products = backend && backend.products ? backend.products : null;

  function dispatch(request) {
    if (!request || request.v !== 1 || typeof request.action !== 'string' || !request.action) {
      return errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', {});
    }
    var requestId = request.requestId ? String(request.requestId) : '';
    var payload = request.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', { requestId: requestId });
    }
    // Phase 1 boundary stays in place. authenticate() is still not a session.
    var principal = authenticate();
    authorize(principal, '');
    if (request.action === 'system.health') return system.health(request);
    if (request.action === 'system.ping') return system.ping(request);
    if (identity && identity.canHandle(request.action)) return identity.dispatch(request);
    if (masters && masters.canHandle(request.action)) return masters.dispatch(request);
    if (products && products.canHandle(request.action)) return products.dispatch(request);
    return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
  }

  return { dispatch: dispatch };
}
