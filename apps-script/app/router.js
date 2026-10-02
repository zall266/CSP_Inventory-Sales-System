function createRouter(system) {
  function dispatch(request) {
    if (!request || request.v !== 1 || typeof request.action !== 'string' || !request.action) {
      return errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', {});
    }
    var requestId = request.requestId ? String(request.requestId) : '';
    var payload = request.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', { requestId: requestId });
    }
    var principal = authenticate();
    authorize(principal, '');
    if (request.action === 'system.health') return system.health(request);
    if (request.action === 'system.ping') return system.ping(request);
    return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
  }

  return { dispatch: dispatch };
}
