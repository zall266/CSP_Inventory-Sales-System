var CSP_ERROR_CODES = {
  INVALID_REQUEST: true,
  UNKNOWN_ACTION: true,
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  VALIDATION_ERROR: true,
  CONFLICT: true,
  DUPLICATE_REQUEST: true,
  INTERNAL_ERROR: true
};

function appError(code, message) {
  var error = new Error(message);
  error.code = CSP_ERROR_CODES[code] ? code : 'INTERNAL_ERROR';
  error.expose = true;
  return error;
}

function toSafeError(error) {
  var code = error && error.expose && CSP_ERROR_CODES[error.code] ? error.code : 'INTERNAL_ERROR';
  var message = code === 'INTERNAL_ERROR'
    ? 'The request could not be completed.'
    : String(error && error.message ? error.message : 'The request could not be completed.');
  return { code: code, message: message };
}
