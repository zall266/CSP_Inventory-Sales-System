function createSystemService(dependencies) {
  var sheets = dependencies.sheetRepository;
  var drive = dependencies.driveStorage;
  var loadConfig = dependencies.config || getConfig;

  function health(request) {
    var config = loadConfig();
    var spreadsheet = sheets.openSpreadsheet();
    spreadsheet.getName();
    var foundation = {
      AuditLogs: Boolean(sheets.getSheet(spreadsheet, 'AuditLogs')),
      Idempotency: Boolean(sheets.getSheet(spreadsheet, 'Idempotency')),
      Counters: Boolean(sheets.getSheet(spreadsheet, 'Counters'))
    };
    var root = drive.getRoot();
    if (root.getId() !== config.driveRootId) {
      throw appError('INTERNAL_ERROR', 'Drive root did not match configuration.');
    }
    root.getName();
    return okEnvelope({
      service: 'CSP Inventory Backend',
      environment: config.environment,
      status: 'healthy',
      timezone: config.timezone,
      spreadsheetAccessible: true,
      driveAccessible: true,
      foundationReady: foundation.AuditLogs && foundation.Idempotency && foundation.Counters
    }, { requestId: request.requestId || '' });
  }

  function ping(request) {
    var config = loadConfig();
    return okEnvelope({
      pong: true,
      serverTimestamp: nowIso(),
      environment: config.environment
    }, { requestId: request.requestId || '' });
  }

  return { health: health, ping: ping };
}
