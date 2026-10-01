function defaultBackend() {
  var sheets = createSheetRepository();
  var drive = createDriveStorage();
  return {
    sheets: sheets,
    drive: drive,
    system: createSystemService({ sheetRepository: sheets, driveStorage: drive }),
    idempotency: createIdempotencyService(sheets),
    foundation: createFoundationService(sheets)
  };
}

function jsonOutput(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(request, backend) {
  var started = Date.now();
  var resolved = backend || defaultBackend();
  var action = request && request.action ? String(request.action) : '';
  var requestId = request && request.requestId ? String(request.requestId) : '';
  try {
    var router = createRouter(resolved.system);
    var key = request && request.idempotencyKey ? String(request.idempotencyKey).trim() : '';
    var response = key
      ? resolved.idempotency.execute(key, request, function () { return router.dispatch(request); })
      : router.dispatch(request);
    logRequest({
      requestId: requestId,
      action: action,
      status: response && response.ok ? 'ok' : 'error',
      errorCode: response && response.error ? response.error.code : '',
      durationMs: Date.now() - started
    });
    return response;
  } catch (error) {
    var safe = toSafeError(error);
    logRequest({
      requestId: requestId,
      action: action,
      status: 'error',
      errorCode: safe.code,
      durationMs: Date.now() - started
    });
    return errorEnvelope(safe.code, safe.message, { requestId: requestId });
  }
}

function doGet() {
  try {
    return jsonOutput(handleRequest({
      v: 1,
      requestId: createId(),
      action: 'system.health',
      payload: {}
    }));
  } catch (error) {
    var safe = toSafeError(error);
    return jsonOutput(errorEnvelope(safe.code, safe.message, {}));
  }
}

function doPost(event) {
  if (!event || !event.postData || !event.postData.contents) {
    return jsonOutput(errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', {}));
  }
  try {
    return jsonOutput(handleRequest(JSON.parse(event.postData.contents)));
  } catch (error) {
    return jsonOutput(errorEnvelope('INVALID_REQUEST', 'Request envelope is invalid.', {}));
  }
}

function initializeFoundation() {
  return createFoundationService(createSheetRepository()).initialize();
}
