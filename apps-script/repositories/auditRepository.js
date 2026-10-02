var AUDIT_HEADERS = [
  'auditId',
  'timestamp',
  'userId',
  'action',
  'entityType',
  'entityId',
  'reference',
  'before',
  'after',
  'requestId'
];

function createAuditRepository(sheetRepository) {
  function requireSheet(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'AuditLogs');
    if (!sheet) throw appError('NOT_FOUND', 'AuditLogs sheet is not initialized.');
    return sheet;
  }

  function append(spreadsheet, record) {
    sheetRepository.appendObject(requireSheet(spreadsheet), record);
  }

  return { headers: AUDIT_HEADERS, append: append };
}
