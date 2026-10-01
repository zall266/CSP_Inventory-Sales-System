function createAuditService(sheetRepository) {
  var repository = createAuditRepository(sheetRepository);

  function append(entry) {
    var record = {
      auditId: createId(),
      timestamp: nowIso(),
      userId: entry.userId || '',
      action: entry.action,
      entityType: entry.entityType || '',
      entityId: entry.entityId || '',
      reference: entry.reference || '',
      before: entry.before || '',
      after: entry.after || '',
      requestId: entry.requestId || ''
    };
    repository.append(sheetRepository.openSpreadsheet(), record);
    return { auditId: record.auditId };
  }

  return { append: append };
}
