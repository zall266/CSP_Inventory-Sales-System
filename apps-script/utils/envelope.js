function okEnvelope(data, meta) {
  return {
    ok: true,
    data: data,
    error: null,
    meta: Object.assign({ timestamp: nowIso() }, meta || {})
  };
}

function errorEnvelope(code, message, meta) {
  var safe = toSafeError(appError(code, message));
  return {
    ok: false,
    data: null,
    error: { code: safe.code, message: safe.message },
    meta: Object.assign({ timestamp: nowIso() }, meta || {})
  };
}
