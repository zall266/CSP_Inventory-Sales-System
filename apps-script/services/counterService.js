function createCounterService(sheetRepository) {
  var repository = createCounterRepository(sheetRepository);

  function allocate(counterKey, prefix) {
    if (!counterKey) throw appError('VALIDATION_ERROR', 'Counter key is required.');
    return withScriptLock(function () {
      return repository.allocate(sheetRepository.openSpreadsheet(), counterKey, prefix || '');
    });
  }

  return { allocate: allocate };
}
