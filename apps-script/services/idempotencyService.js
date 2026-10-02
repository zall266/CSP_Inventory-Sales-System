function createIdempotencyService(sheetRepository) {
  var repository = createIdempotencyRepository(sheetRepository);

  function execute(key, request, handler) {
    if (!key) throw appError('VALIDATION_ERROR', 'Idempotency key is required.');
    return withScriptLock(function () {
      var spreadsheet = sheetRepository.openSpreadsheet();
      var existing = repository.find(spreadsheet, key);
      if (existing) {
        if (String(existing.action) !== String(request.action)) {
          throw appError('DUPLICATE_REQUEST', 'This idempotency key was used for a different action.');
        }
        var stored = JSON.parse(String(existing.response || '{}'));
        stored.meta = Object.assign({}, stored.meta || {}, { idempotentReplay: true });
        return stored;
      }
      var response = handler();
      if (response && response.ok) {
        var stamp = nowIso();
        repository.append(spreadsheet, {
          idempotencyKey: key,
          requestId: request.requestId || '',
          action: request.action,
          status: 'completed',
          response: JSON.stringify(response),
          createdAt: stamp,
          updatedAt: stamp
        });
      }
      return response;
    });
  }

  return { execute: execute };
}
