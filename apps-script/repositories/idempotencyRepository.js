var IDEMPOTENCY_HEADERS = [
  'idempotencyKey',
  'requestId',
  'action',
  'status',
  'response',
  'createdAt',
  'updatedAt'
];

function createIdempotencyRepository(sheetRepository) {
  function requireSheet(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Idempotency');
    if (!sheet) throw appError('NOT_FOUND', 'Idempotency sheet is not initialized.');
    return sheet;
  }

  function find(spreadsheet, key) {
    var rows = sheetRepository.readObjects(requireSheet(spreadsheet));
    for (var index = 0; index < rows.length; index += 1) {
      if (String(rows[index].idempotencyKey) === String(key)) return rows[index];
    }
    return null;
  }

  function append(spreadsheet, record) {
    sheetRepository.appendObject(requireSheet(spreadsheet), record);
  }

  return { headers: IDEMPOTENCY_HEADERS, find: find, append: append };
}
