var CSP_CONFIG_KEYS = ['ENVIRONMENT', 'SPREADSHEET_ID', 'DRIVE_ROOT_ID', 'TIMEZONE'];

function getConfig() {
  var properties = PropertiesService.getScriptProperties();
  var values = {};
  var missing = [];
  CSP_CONFIG_KEYS.forEach(function (key) {
    var value = properties.getProperty(key);
    if (!value) missing.push(key);
    else values[key] = String(value);
  });
  if (missing.length) {
    console.log(JSON.stringify({ status: 'error', errorCode: 'INTERNAL_ERROR', missing: missing }));
    throw appError('INTERNAL_ERROR', 'Backend configuration is incomplete.');
  }
  if (values.ENVIRONMENT !== 'DEV') {
    throw appError('FORBIDDEN', 'This foundation build serves DEV only.');
  }
  if (values.TIMEZONE !== 'Asia/Kuala_Lumpur') {
    throw appError('VALIDATION_ERROR', 'Backend timezone is invalid.');
  }
  return {
    environment: values.ENVIRONMENT,
    spreadsheetId: values.SPREADSHEET_ID,
    driveRootId: values.DRIVE_ROOT_ID,
    timezone: values.TIMEZONE
  };
}
