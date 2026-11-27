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
    var action = request.action;
    var spec = getActionAuthorization(action);
    var principal = authenticate();
    if (spec && spec.access === 'public') {
      authorize(principal, '');
      if (action === 'system.health') return system.health(request);
      if (action === 'system.ping') return system.ping(request);
      if (auth && auth.canHandle(action)) return auth.dispatch(request, principal);
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    }

    if (!auth || typeof auth.resolvePrincipal !== 'function') {
      throw appError('UNAUTHORIZED', 'The session is not valid.');
    }
    principal = auth.resolvePrincipal(request);
    if (!principal || !principal.authenticated) {
      throw appError('UNAUTHORIZED', 'The session is not valid.');
    }
    payload.actorUserId = principal.userId;
    if (!spec) {
      if (serviceCanHandle(action)) {
        throw appError('FORBIDDEN', 'You do not have permission.');
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    }
    if (!principalMay(principal.snapshot, principal.user, spec)) {
      throw appError('FORBIDDEN', 'You do not have permission.');
    }
    authorize(principal, spec.permissions && spec.permissions[0] ? spec.permissions[0] : '');
    if (auth && auth.canHandle(action)) return auth.dispatch(request, principal);
    if (identity && identity.canHandle(action)) return identity.dispatch(request);
    if (masters && masters.canHandle(action)) return masters.dispatch(request);
    if (products && products.canHandle(action)) return products.dispatch(request);
    if (parties && parties.canHandle(action)) return parties.dispatch(request);
    if (inventory && inventory.canHandle(action)) return inventory.dispatch(request);
    if (warehouse && warehouse.canHandle(action)) return warehouse.dispatch(request);
    if (boms && boms.canHandle(action)) return boms.dispatch(request);
    if (openingBalances && openingBalances.canHandle(action)) return openingBalances.dispatch(request);
    if (purchases && purchases.canHandle(action)) return purchases.dispatch(request);
    if (receivings && receivings.canHandle(action)) return receivings.dispatch(request);
    if (manufacturing && manufacturing.canHandle(action)) return manufacturing.dispatch(request);
    if (sales && sales.canHandle(action)) return sales.dispatch(request);
    if (salesReturns && salesReturns.canHandle(action)) return salesReturns.dispatch(request);
    if (salesImport && salesImport.canHandle(action)) return salesImport.dispatch(request);
    if (dispatchMod && dispatchMod.canHandle(action)) return dispatchMod.dispatch(request);
    if (ops && ops.canHandle(action)) return ops.dispatch(request);
    if (reporting && reporting.canHandle(action)) return reporting.dispatch(request);
    return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
  }

  function serviceCanHandle(action) {
    if (auth && auth.canHandle(action)) return true;
    if (identity && identity.canHandle(action)) return true;
    if (masters && masters.canHandle(action)) return true;
    if (products && products.canHandle(action)) return true;
    if (parties && parties.canHandle(action)) return true;
    if (inventory && inventory.canHandle(action)) return true;
    if (warehouse && warehouse.canHandle(action)) return true;
    if (boms && boms.canHandle(action)) return true;
    if (openingBalances && openingBalances.canHandle(action)) return true;
    if (purchases && purchases.canHandle(action)) return true;
    if (receivings && receivings.canHandle(action)) return true;
    if (manufacturing && manufacturing.canHandle(action)) return true;
    if (sales && sales.canHandle(action)) return true;
    if (salesReturns && salesReturns.canHandle(action)) return true;
    if (salesImport && salesImport.canHandle(action)) return true;
    if (dispatchMod && dispatchMod.canHandle(action)) return true;
    if (ops && ops.canHandle(action)) return true;
    if (reporting && reporting.canHandle(action)) return true;
    return false;
  }

  return { dispatch: dispatch };
}
