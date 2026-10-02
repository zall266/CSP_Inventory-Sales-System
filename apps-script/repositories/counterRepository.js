var COUNTER_HEADERS = ['counterKey', 'prefix', 'nextValue', 'updatedAt'];

function createCounterRepository(sheetRepository) {
  function requireSheet(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Counters');
    if (!sheet) throw appError('NOT_FOUND', 'Counters sheet is not initialized.');
    return sheet;
  }

  function allocate(spreadsheet, counterKey, prefix) {
    var sheet = requireSheet(spreadsheet);
    var headers = sheetRepository.headerMap(sheet).filter(Boolean);
    var keyIndex = headers.indexOf('counterKey');
    var valueIndex = headers.indexOf('nextValue');
    var prefixIndex = headers.indexOf('prefix');
    var updatedIndex = headers.indexOf('updatedAt');
    if (keyIndex < 0 || valueIndex < 0) throw appError('CONFLICT', 'Counter headers do not match.');
    var lastRow = sheet.getLastRow();
    var width = headers.length;
    if (lastRow >= 2) {
      var rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();
      for (var index = 0; index < rows.length; index += 1) {
        if (String(rows[index][keyIndex]) !== String(counterKey)) continue;
        var issued = Number(rows[index][valueIndex]);
        if (!Number.isFinite(issued) || issued < 1) throw appError('CONFLICT', 'Counter value is invalid.');
        rows[index][valueIndex] = issued + 1;
        if (prefixIndex >= 0) rows[index][prefixIndex] = prefix || rows[index][prefixIndex] || '';
        if (updatedIndex >= 0) rows[index][updatedIndex] = nowIso();
        sheet.getRange(index + 2, 1, 1, width).setValues([rows[index]]);
        return { counterKey: counterKey, prefix: prefix || '', value: issued };
      }
    }
    sheetRepository.appendObject(sheet, {
      counterKey: counterKey,
      prefix: prefix || '',
      nextValue: 2,
      updatedAt: nowIso()
    });
    return { counterKey: counterKey, prefix: prefix || '', value: 1 };
  }

  return { headers: COUNTER_HEADERS, allocate: allocate };
}
