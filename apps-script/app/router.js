function createRouter(backend) {
  var system = backend && typeof backend.health === 'function' ? backend : backend.system;
  var auth = backend && backend.auth ? backend.auth : null;
  var identity = backend && backend.identity ? backend.identity : null;
  var masters = backend && backend.masters ? backend.masters : null;
  var products = backend && backend.products ? backend.products : null;
  var parties = backend && backend.parties ? backend.parties : null;
  var inventory = backend && backend.inventory ? backend.inventory : null;
  var warehouse = backend && backend.warehouse ? backend.warehouse : null;
  var boms = backend && backend.boms ? backend.boms : null;
  var openingBalances = backend && backend.openingBalances ? backend.openingBalances : null;
  var purchases = backend && backend.purchases ? backend.purchases : null;
  var receivings = backend && backend.receivings ? backend.receivings : null;
  var manufacturing = backend && backend.manufacturing ? backend.manufacturing : null;
  var sales = backend && backend.sales ? backend.sales : null;
  var salesReturns = backend && backend.salesReturns ? backend.salesReturns : null;
  var salesImport = backend && backend.salesImport ? backend.salesImport : null;
  var dispatchMod = backend && backend.dispatch ? backend.dispatch : null;
  var ops = backend && backend.ops ? backend.ops : null;
  var reporting = backend && backend.reporting ? backend.reporting : null;

  function dispatch(request) {
    if (!request || request.v !== 1 || typeof request.action !== 'string' || !request.action) {
      return errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', {});
    }
    var requestId = request.requestId ? String(request.requestId) : '';
    var payload = request.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', { requestId: requestId });
    }
    // AUTH-1: a presented sessionToken is validated fail-closed. Missing token
    // still yields an unauthenticated principal (AUTH-2 will require a session
    // on every business action). Login skips token validation so a stale token
    // cannot block a new login. Authenticated requests overwrite actorUserId.
    var principal = authenticate();
    if (!isUnauthenticatedAuthAction(request.action)) {
      principal = auth && typeof auth.resolvePrincipal === 'function'
        ? auth.resolvePrincipal(request)
        : authenticate();
    }
    authorize(principal, '');
    if (principal && principal.authenticated) {
      payload.actorUserId = principal.userId;
    }
    if (request.action === 'system.health') return system.health(request);
    if (request.action === 'system.ping') return system.ping(request);
    if (auth && auth.canHandle(request.action)) return auth.dispatch(request, principal);
    if (identity && identity.canHandle(request.action)) return identity.dispatch(request);
    if (masters && masters.canHandle(request.action)) return masters.dispatch(request);
    if (products && products.canHandle(request.action)) return products.dispatch(request);
    if (parties && parties.canHandle(request.action)) return parties.dispatch(request);
    if (inventory && inventory.canHandle(request.action)) return inventory.dispatch(request);
    if (warehouse && warehouse.canHandle(request.action)) return warehouse.dispatch(request);
    if (boms && boms.canHandle(request.action)) return boms.dispatch(request);
    if (openingBalances && openingBalances.canHandle(request.action)) return openingBalances.dispatch(request);
    if (purchases && purchases.canHandle(request.action)) return purchases.dispatch(request);
    if (receivings && receivings.canHandle(request.action)) return receivings.dispatch(request);
    if (manufacturing && manufacturing.canHandle(request.action)) return manufacturing.dispatch(request);
    if (sales && sales.canHandle(request.action)) return sales.dispatch(request);
    if (salesReturns && salesReturns.canHandle(request.action)) return salesReturns.dispatch(request);
    if (salesImport && salesImport.canHandle(request.action)) return salesImport.dispatch(request);
    if (dispatchMod && dispatchMod.canHandle(request.action)) return dispatchMod.dispatch(request);
    if (ops && ops.canHandle(request.action)) return ops.dispatch(request);
    if (reporting && reporting.canHandle(request.action)) return reporting.dispatch(request);
    return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
  }

  return { dispatch: dispatch };
}
