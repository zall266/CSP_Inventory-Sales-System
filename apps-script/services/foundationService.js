function createFoundationService(sheetRepository) {
  var audit = createAuditService(sheetRepository);

  function initialize() {
    var config = getConfig();
    if (config.environment !== 'DEV') throw appError('FORBIDDEN', 'Foundation setup is limited to DEV.');
    var spreadsheet = sheetRepository.openSpreadsheet();
    var plan = [
      { name: 'AuditLogs', headers: AUDIT_HEADERS },
      { name: 'Idempotency', headers: IDEMPOTENCY_HEADERS },
      { name: 'Counters', headers: COUNTER_HEADERS }
    ];
    plan.forEach(function (item) {
      sheetRepository.ensureSheet(spreadsheet, item.name, item.headers);
    });
    audit.append({
      userId: '',
      action: 'system.foundation.initialize',
      entityType: 'system',
      entityId: 'foundation',
      reference: '',
      before: '',
      after: 'AuditLogs,Idempotency,Counters',
      requestId: ''
    });
    return okEnvelope({
      initialized: plan.map(function (item) { return item.name; }),
      sheet1Preserved: Boolean(sheetRepository.getSheet(spreadsheet, 'Sheet1'))
    });
  }

  return { initialize: initialize };
}
