// Ported from src/features/pjkm for Apps Script V8.

var PJKM_ROW_BUDGET = 12;
var PJKM_511_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var PJKM_911_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
var PJKM_1011_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
var PJKM_1011_FINISHED = { 'cat-air': true, 'cat-ice': true, 'cat-waffle': true };
var PJKM_1011_IN = {
  production_in: true, receiving: true, opening_balance: true, opening_stock: true,
  sales_return: true, sales_return_good: true
};
var PJKM_1011_FIRST_BODY_MM = 297 - 14 - 18 - 8 - 36 - 6;
var PJKM_1011_NEXT_BODY_MM = 297 - 14 - 18 - 8 - 6 - 6;
var PJKM_1011_LINE_MM = 3.15;
var PJKM_911_PAGE_INNER_MM = 297 - 14 - 18;
var PJKM_911_SHEET_PAD_MM = 8;
var PJKM_911_FIRST_CHROME_MM = 30.7;
var PJKM_911_NEXT_CHROME_MM = 0;
var PJKM_911_TABLE_HEAD_MM = 4.5;
var PJKM_911_PAGE_SAFETY_MM = 4;
var PJKM_911_LINE_MM = 2.3;
var PJKM_911_ROW_PAD_MM = 1.93;
var PJKM_911_FIXED = { tarikh: 14, butiran: 22, total: 16 };

function pjkmSystemDateKey(iso) {
  var parsed = new Date(iso);
  if (isNaN(parsed.getTime())) return String(iso || '').slice(0, 10);
  return reportDateKey(parsed);
}

function pjkmDate(iso) {
  var key = pjkmSystemDateKey(iso);
  var parts = key.split('-');
  return Number(parts[2]) + '-' + PJKM_511_MONTHS[Number(parts[1]) - 1] + '-' + parts[0];
}

function pjkmMonthKey(iso) {
  return pjkmSystemDateKey(iso).slice(0, 7);
}

function pjkmQtyText(qty, unit) {
  var amount = Number.isInteger(qty) ? String(qty) : String(qty);
  var raw = String(unit || '').trim();
  var label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : '';
  return label ? amount + ' ' + label : amount;
}

function pjkmExpiryText(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var parsed = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!parsed) return raw;
  return Number(parsed[3]) + '-' + PJKM_511_MONTHS[Number(parsed[2]) - 1] + '-' + parsed[1];
}

function pjkmBatchCell(batchNo, expiry) {
  var batch = String(batchNo || '').trim();
  var exp = pjkmExpiryText(expiry);
  if (batch && exp) return batch + '\n' + exp;
  return batch || exp;
}

function pjkmRowWeight(row) {
  var longest = Math.max(row.supplier.length, row.product.length, row.notes.length, row.batchCell.length, 1);
  return Math.max(1, Math.ceil(longest / 22));
}

function paginatePjkmRows(rows, rowBudget) {
  var budget = rowBudget || PJKM_ROW_BUDGET;
  var pages = [];
  var current = [];
  var used = 0;
  (rows || []).forEach(function (row) {
    var weight = Math.min(pjkmRowWeight(row), budget);
    if (current.length && used + weight > budget) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += weight;
  });
  if (current.length || !pages.length) pages.push(current);
  var count = Math.max(pages.length, 1);
  return pages.map(function (pageRows, index) {
    return { page: index + 1, pages: count, label: (index + 1) + ' of ' + count, rows: pageRows };
  });
}

function buildPjkm511(input) {
  var rows = [];
  var ordered = (input.receivings || []).slice().sort(function (a, b) {
    return a.date.localeCompare(b.date) || a.receivingNo.localeCompare(b.receivingNo);
  });
  ordered.forEach(function (receiving) {
    if (receiving.status !== 'completed') return;
    if (pjkmMonthKey(receiving.date) !== input.month) return;
    if (!isCompanyWarehouse(input.warehouses, receiving.warehouseId)) return;
    var supplier = null;
    if (receiving.supplierId) {
      (input.suppliers || []).forEach(function (item) {
        if (item.id === receiving.supplierId) supplier = item;
      });
    }
    (receiving.items || []).forEach(function (line) {
      var product = null;
      (input.products || []).forEach(function (item) {
        if (item.id === line.productId) product = item;
      });
      var warnings = [];
      if (!supplier) warnings.push('supplier');
      if (!String(line.batchNo || '').trim() && !String(line.expiry || '').trim()) warnings.push('batch');
      if (!line.condition) warnings.push('condition');
      rows.push({
        receivingId: receiving.id,
        receivingNo: receiving.receivingNo,
        date: pjkmDate(receiving.date),
        supplier: supplier ? supplier.name : '',
        product: product ? product.name : '',
        batchCell: pjkmBatchCell(line.batchNo, line.expiry),
        qtyText: pjkmQtyText(line.qty, line.unit),
        condition: line.condition || '',
        notes: String(line.notes || '').trim(),
        preparedBy: receiving.receivedByName,
        verifiedBy: '',
        warnings: warnings
      });
    });
  });
  var attention = rows.filter(function (row) { return row.warnings.length > 0; });
  return { rows: rows, pages: paginatePjkmRows(rows, input.rowBudget), attention: attention };
}

function pjkm911Period(month) {
  var parts = String(month || '').split('-');
  return { bulan: PJKM_911_MONTHS[Number(parts[1]) - 1] || '', tahun: parts[0] || '' };
}

function pjkm911Widths(columnCount) {
  var count = Math.max(columnCount, 1);
  var courier = (186 - PJKM_911_FIXED.tarikh - PJKM_911_FIXED.butiran - PJKM_911_FIXED.total) / count;
  return { tarikh: PJKM_911_FIXED.tarikh, butiran: PJKM_911_FIXED.butiran, courier: courier, total: PJKM_911_FIXED.total, table: 186 };
}

function pjkm911WrappedLines(value, chars) {
  if (!value) return 1;
  return Math.max(1, Math.ceil(String(value).length / Math.max(chars, 1)));
}

function pjkm911BlockMm(block, columns) {
  var widths = pjkm911Widths(columns.length);
  var chars = Math.max(1, Math.floor((widths.courier - 1.2) / 1.9));
  var vehicleLines = 2;
  var plateLines = 2;
  columns.forEach(function (column) {
    var cell = block.cells[column];
    if (!cell) return;
    vehicleLines = Math.max(vehicleLines, pjkm911WrappedLines(cell.vehicleType, chars));
    plateLines = Math.max(plateLines, pjkm911WrappedLines(cell.plateNumber, chars));
  });
  var lines = [2, vehicleLines, plateLines, 2, 1];
  var sum = 0;
  lines.forEach(function (count) {
    sum += count * PJKM_911_LINE_MM + PJKM_911_ROW_PAD_MM;
  });
  return sum;
}

function paginatePjkm911(blocks, columns, period) {
  var firstMm = PJKM_911_PAGE_INNER_MM - PJKM_911_SHEET_PAD_MM - PJKM_911_FIRST_CHROME_MM - PJKM_911_TABLE_HEAD_MM - PJKM_911_PAGE_SAFETY_MM;
  var nextMm = PJKM_911_PAGE_INNER_MM - PJKM_911_SHEET_PAD_MM - PJKM_911_NEXT_CHROME_MM - PJKM_911_TABLE_HEAD_MM - PJKM_911_PAGE_SAFETY_MM;
  var pages = [];
  var current = [];
  var used = 0;
  var budget = firstMm;
  (blocks || []).forEach(function (block) {
    var height = pjkm911BlockMm(block, columns);
    if (current.length && used + height > budget) {
      pages.push(current);
      current = [];
      used = 0;
      budget = nextMm;
    }
    current.push(block);
    used += height;
    if (height > budget) {
      pages.push(current);
      current = [];
      used = 0;
      budget = nextMm;
    }
  });
  if (current.length || !pages.length) pages.push(current);
  var count = Math.max(pages.length, 1);
  return pages.map(function (pageBlocks, index) {
    return {
      page: index + 1, pages: count, label: (index + 1) + ' of ' + count,
      blocks: pageBlocks, columns: columns, bulan: period.bulan, tahun: period.tahun
    };
  });
}

function pjkm911Agreed(values) {
  if (!values.length) return '';
  var first = values[0];
  var ok = values.every(function (value) { return value === first; });
  return ok ? first : '';
}

function pjkm911CellsFor(dispatches) {
  var cells = {};
  var lines = [];
  dispatches.forEach(function (row) {
    (row.lines || []).forEach(function (line) { lines.push(line); });
  });
  DISPATCH_COURIER_ORDER.forEach(function (key) {
    var owners = dispatches.filter(function (row) {
      return dispatchCourierKeys(row).indexOf(key) !== -1;
    });
    if (!owners.length) return;
    var parcelQty = 0;
    lines.forEach(function (line) {
      if (line.courierKey === key) parcelQty += Number(line.parcelQty) || 0;
    });
    cells[key] = {
      parcelQty: parcelQty,
      vehicleType: pjkm911Agreed(owners.map(function (row) { return row.vehicleType; })),
      plateNumber: pjkm911Agreed(owners.map(function (row) { return row.plateNumber; }))
    };
  });
  return { cells: cells, totalAwb: dispatchAwbTotals(lines).totalAwb };
}

function buildPjkm911(input) {
  var prefix = input.month + '-';
  var confirmed = (input.dispatches || []).filter(function (row) {
    return row.status === 'confirmed' && String(row.dispatchDate).indexOf(prefix) === 0;
  });
  var period = pjkm911Period(input.month);
  var byDate = {};
  confirmed.forEach(function (row) {
    if (!byDate[row.dispatchDate]) byDate[row.dispatchDate] = [];
    byDate[row.dispatchDate].push(row);
  });
  var dates = Object.keys(byDate).sort();
  var blocks = dates.map(function (dateKey) {
    var built = pjkm911CellsFor(byDate[dateKey]);
    return {
      id: dateKey,
      day: Number(dateKey.slice(8, 10)),
      dateKey: dateKey,
      cells: built.cells,
      totalAwb: built.totalAwb,
      dispatchIds: byDate[dateKey].map(function (row) { return row.id; })
    };
  });
  var columns = DISPATCH_COURIER_ORDER.filter(function (key) {
    return blocks.some(function (block) { return Boolean(block.cells[key]); });
  });
  return {
    month: input.month,
    bulan: period.bulan,
    tahun: period.tahun,
    columns: columns,
    blocks: blocks,
    pages: paginatePjkm911(blocks, columns, period),
    unknown: columns.indexOf('UNKNOWN') !== -1
  };
}

function pjkm1011Seller(reference) {
  var match = /^(SHOPEE|TIKTOK):([^:]+):/.exec(String(reference || '').trim());
  if (!match) return '';
  var platform = match[1] === 'SHOPEE' ? 'Shopee' : 'TikTok';
  var account = match[2].trim();
  return account ? platform + ' / ' + account : platform;
}

function pjkm1011FinishedIds(products, sessions, movements) {
  var output = {};
  (sessions || []).forEach(function (session) {
    if (!session.posted || session.status !== 'completed') return;
    (session.items || []).forEach(function (item) {
      if (item.actualQty > 0) output[item.productId] = true;
    });
  });
  (movements || []).forEach(function (movement) {
    if (movement.type === 'production_in' && movement.stockIn > 0) output[movement.productId] = true;
  });
  var ids = {};
  (products || []).forEach(function (product) {
    if (product.categoryId === 'cat-pack') return;
    var unit = String(product.unit || '').trim().toLowerCase();
    if (PJKM_1011_FINISHED[product.categoryId] || output[product.id] || unit === 'packs') ids[product.id] = true;
  });
  return ids;
}

function pjkm1011PushEvent(events, event) {
  if (event.qtyIn <= 0 && event.qtyOut <= 0) return;
  events.push(event);
}

function pjkm1011BuildEvents(input) {
  var events = [];
  var voidDates = {};
  (input.movements || []).forEach(function (movement) {
    if (String(movement.reference).slice(-5) !== '-VOID') return;
    var invoice = String(movement.reference).slice(0, -5);
    if (!voidDates[invoice]) voidDates[invoice] = pjkmSystemDateKey(movement.date);
  });
  (input.movements || []).forEach(function (movement) {
    if (!input.finished[movement.productId]) return;
    if (String(movement.notes || '').indexOf('Sales component') === 0) return;
    var dateKey = pjkmSystemDateKey(movement.date);
    if (movement.type === 'sale' && movement.stockOut > 0) {
      pjkm1011PushEvent(events, {
        dateKey: dateKey, productId: movement.productId, warehouseId: movement.warehouseId,
        qtyIn: 0, qtyOut: movement.stockOut, seller: '', tarikhBuat: '', reference: movement.reference
      });
      return;
    }
    if (movement.type === 'sales_return' && movement.notes === 'Voided sale') {
      var invoice = String(movement.reference).slice(-5) === '-VOID' ? String(movement.reference).slice(0, -5) : '';
      var sale = null;
      (input.sales || []).forEach(function (item) { if (item.invoiceNo === invoice) sale = item; });
      var restoredComponent = false;
      ((sale && sale.items) || []).forEach(function (line) {
        ((line.salesComponentsSnapshot) || []).forEach(function (row) {
          if (row.productId === movement.productId) restoredComponent = true;
        });
      });
      if (restoredComponent) return;
    }
    if (!PJKM_1011_IN[movement.type] || !(movement.stockIn > 0)) return;
    var produced = '';
    if (movement.type === 'production_in') {
      (input.sessions || []).forEach(function (session) {
        if (session.reference === movement.reference && session.posted && session.status === 'completed' && session.productionDate) {
          produced = pjkmSystemDateKey(session.productionDate);
        }
      });
    }
    pjkm1011PushEvent(events, {
      dateKey: dateKey, productId: movement.productId, warehouseId: movement.warehouseId,
      qtyIn: movement.stockIn, qtyOut: 0, seller: '',
      tarikhBuat: produced || (movement.type === 'production_in' || movement.type === 'receiving' ? dateKey : ''),
      reference: movement.reference
    });
  });
  (input.sales || []).forEach(function (sale) {
    (sale.items || []).forEach(function (line) {
      if (!(line.salesComponentsSnapshot && line.salesComponentsSnapshot.length)) return;
      if (!input.finished[line.productId]) return;
      pjkm1011PushEvent(events, {
        dateKey: pjkmSystemDateKey(sale.date), productId: line.productId, warehouseId: sale.warehouseId,
        qtyIn: 0, qtyOut: line.qty, seller: pjkm1011Seller(sale.reference), tarikhBuat: '', reference: sale.invoiceNo
      });
      if (sale.status !== 'voided') return;
      var restored = reportRound2(line.qty - (line.returnedQty || 0));
      var voidDate = voidDates[sale.invoiceNo];
      if (!(restored > 0) || !voidDate) return;
      pjkm1011PushEvent(events, {
        dateKey: voidDate, productId: line.productId, warehouseId: sale.warehouseId,
        qtyIn: restored, qtyOut: 0, seller: '', tarikhBuat: '', reference: sale.invoiceNo + '-VOID'
      });
    });
  });
  var sellerByInvoice = {};
  (input.sales || []).forEach(function (sale) {
    var seller = pjkm1011Seller(sale.reference);
    if (seller) sellerByInvoice[sale.invoiceNo] = seller;
  });
  events.forEach(function (event) {
    if (event.qtyOut > 0 && !event.seller) event.seller = sellerByInvoice[event.reference] || '';
  });
  return events;
}

function pjkm1011QtyText(value) {
  if (value == null) return '';
  return Number.isInteger(value) ? String(value) : String(reportRound2(value));
}

function pjkm1011WrappedLines(value, chars) {
  if (!value) return 1;
  var sum = 0;
  String(value).split('\n').forEach(function (part) {
    sum += Math.max(1, Math.ceil(part.length / Math.max(chars, 1)));
  });
  return sum;
}

function pjkm1011RowLines(row) {
  return Math.max(
    1,
    pjkm1011WrappedLines(String(row.bil), 4),
    pjkm1011WrappedLines(row.product, 24),
    pjkm1011WrappedLines(row.tarikhBuat, 12),
    pjkm1011WrappedLines(row.tarikhLuput, 12),
    pjkm1011WrappedLines(pjkm1011QtyText(row.qtyIn), 8),
    pjkm1011WrappedLines(row.tempatSimpan, 18),
    pjkm1011WrappedLines(row.seller, 24),
    pjkm1011WrappedLines(row.tarikhEdar, 12),
    pjkm1011WrappedLines(pjkm1011QtyText(row.qtyOut), 8),
    pjkm1011WrappedLines(row.batchNo, 8),
    pjkm1011WrappedLines(pjkm1011QtyText(row.baki), 8)
  );
}

function paginatePjkm1011(rows) {
  var firstMm = PJKM_1011_FIRST_BODY_MM;
  var nextMm = PJKM_1011_NEXT_BODY_MM;
  var pages = [];
  var current = [];
  var used = 0;
  var budget = firstMm;
  (rows || []).forEach(function (row) {
    var height = pjkm1011RowLines(row) * PJKM_1011_LINE_MM;
    if (current.length && used + height > budget) {
      pages.push(current);
      current = [];
      used = 0;
      budget = nextMm;
    }
    current.push(row);
    used += height;
  });
  if (current.length || !pages.length) pages.push(current);
  var count = Math.max(pages.length, 1);
  return pages.map(function (pageRows, index) {
    return { page: index + 1, pages: count, label: (index + 1) + ' of ' + count, rows: pageRows };
  });
}

function pjkm1011MonthLabel(month) {
  var parts = String(month || '').split('-');
  var index = Number(parts[1]) - 1;
  if (!parts[0] || index < 0 || index > 11) return month;
  return 'BULAN : ' + PJKM_1011_MONTHS[index] + ' TAHUN : ' + parts[0];
}

function pjkm1011DisplayDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return '';
  return pjkmDate(dateKey + 'T12:00:00+08:00');
}

function buildPjkm1011(input) {
  var finished = pjkm1011FinishedIds(input.products, input.sessions, input.movements);
  var events = pjkm1011BuildEvents({
    movements: input.movements, sales: input.sales, sessions: input.sessions, finished: finished
  });
  var productName = {};
  (input.products || []).forEach(function (product) { productName[product.id] = product.name; });
  var warehouseName = {};
  (input.warehouses || []).forEach(function (warehouse) { warehouseName[warehouse.id] = warehouse.name; });
  var groups = {};
  events.forEach(function (event) {
    var key = event.productId + '|' + event.warehouseId + '|' + event.dateKey;
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
  });
  var timelines = {};
  function ensure(productId, warehouseId) {
    var key = productId + '|' + warehouseId;
    if (!timelines[key]) timelines[key] = [];
    return timelines[key];
  }
  Object.keys(groups).forEach(function (key) {
    var parts = key.split('|');
    var list = groups[key];
    var draft = {
      productId: parts[0],
      warehouseId: parts[1],
      dateKey: parts[2],
      qtyIn: reportRound2(list.reduce(function (sum, event) { return sum + event.qtyIn; }, 0)),
      qtyOut: reportRound2(list.reduce(function (sum, event) { return sum + event.qtyOut; }, 0)),
      sellers: {},
      buat: {},
      missingSeller: list.some(function (event) { return event.qtyOut > 0 && !event.seller; }),
      opening: false
    };
    list.forEach(function (event) {
      if (event.seller) draft.sellers[event.seller] = true;
      if (event.tarikhBuat) draft.buat[event.tarikhBuat] = true;
    });
    if (parts[2] < input.month + '-01') {
      var timeline = ensure(parts[0], parts[1]);
      var prior = null;
      timeline.forEach(function (row) { if (row.opening) prior = row; });
      if (prior) {
        prior.qtyIn = reportRound2(prior.qtyIn + draft.qtyIn);
        prior.qtyOut = reportRound2(prior.qtyOut + draft.qtyOut);
      } else {
        draft.opening = true;
        draft.sellers = {};
        draft.buat = {};
        draft.missingSeller = false;
        timeline.push(draft);
      }
      return;
    }
    if (parts[2].slice(0, 7) !== input.month) return;
    ensure(parts[0], parts[1]).push(draft);
  });
  var rows = [];
  Object.keys(timelines).sort(function (a, b) {
    var aParts = a.split('|');
    var bParts = b.split('|');
    var byName = String(productName[aParts[0]] || '').localeCompare(String(productName[bParts[0]] || ''));
    if (byName !== 0) return byName;
    return String(warehouseName[aParts[1]] || '').localeCompare(String(warehouseName[bParts[1]] || ''));
  }).forEach(function (key) {
    var timeline = timelines[key];
    if (!timeline.some(function (row) { return !row.opening; })) return;
    timeline.sort(function (a, b) {
      return Number(b.opening) - Number(a.opening) || a.dateKey.localeCompare(b.dateKey);
    });
    var balance = 0;
    var monthRows = [];
    timeline.forEach(function (draft) {
      balance = reportRound2(balance + draft.qtyIn - draft.qtyOut);
      var warehouse = warehouseName[draft.warehouseId] || '';
      if (draft.opening) {
        if (balance === 0) return;
        monthRows.push({
          key: 'open-' + draft.productId + '-' + draft.warehouseId,
          bil: 0, productId: draft.productId, product: productName[draft.productId] || '',
          warehouseId: draft.warehouseId, dateKey: '', tarikhBuat: '', tarikhLuput: '',
          qtyIn: null, qtyOut: null, tempatSimpan: warehouse, seller: '', tarikhEdar: '',
          batchNo: '', baki: balance, warnings: warehouse ? [] : ['warehouse']
        });
        return;
      }
      var sellers = Object.keys(draft.sellers);
      var warnings = [];
      if (!warehouse) warnings.push('warehouse');
      if (draft.missingSeller) warnings.push('seller');
      var buat = Object.keys(draft.buat).sort();
      monthRows.push({
        key: draft.productId + '-' + draft.warehouseId + '-' + draft.dateKey,
        bil: 0, productId: draft.productId, product: productName[draft.productId] || '',
        warehouseId: draft.warehouseId, dateKey: draft.dateKey,
        tarikhBuat: buat.length ? pjkm1011DisplayDate(buat[0]) : '',
        tarikhLuput: '', qtyIn: draft.qtyIn, qtyOut: draft.qtyOut, tempatSimpan: warehouse,
        seller: sellers.join(', '), tarikhEdar: draft.qtyOut > 0 ? pjkm1011DisplayDate(draft.dateKey) : '',
        batchNo: '', baki: balance, warnings: warnings
      });
    });
    monthRows.forEach(function (row) { rows.push(row); });
  });
  rows.forEach(function (row, index) { row.bil = index + 1; });
  return {
    rows: rows,
    pages: paginatePjkm1011(rows),
    attention: rows.filter(function (row) { return row.warnings.length > 0; }),
    monthLabel: pjkm1011MonthLabel(input.month)
  };
}
