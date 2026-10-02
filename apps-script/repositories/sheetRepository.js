// Apps Script Sheet.getRange(row, column, numRows, numColumns).

function createSheetRepository(options) {
  var settings = options || {};

  function openSpreadsheet() {
    if (settings.openSpreadsheet) return settings.openSpreadsheet();
    return SpreadsheetApp.openById(getConfig().spreadsheetId);
  }

  function headerMap(sheet) {
    var width = sheet.getLastColumn();
    if (width < 1) return [];
    return sheet.getRange(1, 1, 1, width).getValues()[0].map(function (header) {
      return String(header || '').trim();
    });
  }

  function getSheet(spreadsheet, name) {
    return spreadsheet.getSheetByName(name);
  }

  function ensureSheet(spreadsheet, name, headers) {
    if (name === 'Sheet1') {
      throw appError('VALIDATION_ERROR', 'Sheet1 is reserved and is left unchanged.');
    }
    var existing = spreadsheet.getSheetByName(name);
    if (!existing) {
      existing = spreadsheet.insertSheet(name);
      existing.getRange(1, 1, 1, headers.length).setValues([headers]);
      return existing;
    }
    var current = headerMap(existing).filter(Boolean);
    if (!current.length) {
      existing.getRange(1, 1, 1, headers.length).setValues([headers]);
      return existing;
    }
    if (current.join('|') !== headers.join('|')) {
      throw appError('CONFLICT', 'Foundation sheet headers do not match.');
    }
    return existing;
  }

  function appendObject(sheet, record) {
    var headers = headerMap(sheet).filter(Boolean);
    if (!headers.length) throw appError('VALIDATION_ERROR', 'Sheet headers are missing.');
    sheet.appendRow(headers.map(function (header) {
      var value = record[header];
      return value === undefined || value === null ? '' : value;
    }));
  }

  function readObjects(sheet) {
    var headers = headerMap(sheet);
    var width = headers.filter(Boolean).length;
    var lastRow = sheet.getLastRow();
    if (width < 1 || lastRow < 2) return [];
    return sheet.getRange(2, 1, lastRow - 1, width).getValues().filter(function (row) {
      return row.some(function (cell) { return String(cell || '').trim() !== ''; });
    }).map(function (row) {
      var record = {};
      headers.forEach(function (header, index) {
        if (header) record[header] = row[index];
      });
      return record;
    });
  }

  return {
    openSpreadsheet: openSpreadsheet,
    headerMap: headerMap,
    getSheet: getSheet,
    ensureSheet: ensureSheet,
    appendObject: appendObject,
    readObjects: readObjects
  };
}
