function logRequest(entry) {
  console.log(JSON.stringify({
    requestId: entry.requestId || '',
    action: entry.action || '',
    timestamp: nowIso(),
    status: entry.status || '',
    errorCode: entry.errorCode || '',
    durationMs: entry.durationMs
  }));
}
