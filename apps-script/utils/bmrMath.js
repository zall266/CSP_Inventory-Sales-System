// Ported from src/features/manufacturing/bmrModel.ts for Apps Script V8.

var BMR_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var BMR_PROCESS_STEPS = ['Weighing of ingredients', 'Mixing', 'Filling / Packaging', 'Grinding', 'Cleaning'];
var BMR_PROCESS_RULES = {
  weighingUpTo5: 30, weighingUpTo10: 45, weighingAbove10: 60,
  mixing: 60, fillingPacks: 45, fillingMinutes: 30, grinding: 45, cleaning: 60
};
var BMR_PROCESS_NOTE = 'Process times are system-calculated estimates; verify actual time before signing.';
var BMR_PROCESS_UNAVAILABLE_NOTE = 'Process times were not calculated. A start time, material closing, and released packs are required.';
var BMR_MULTIPLE_HALAL_REMARK = 'Multiple Halal records — confirm manually';
var BMR_UNIT_ALIASES = {
  kg: 'KG', g: 'G', gram: 'G', grams: 'G', pcs: 'PCS', pack: 'PACK', packs: 'PACK'
};
var HALAL_EXPIRING_DAYS = 90;

function bmrNormalizeUnit(unit) {
  var raw = String(unit || '').trim();
  if (!raw) return '';
  return BMR_UNIT_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
}

function bmrFormatQty(value) {
  if (Number.isInteger(value)) return Number(value).toLocaleString('en-MY');
  return Number(value).toLocaleString('en-MY', { maximumFractionDigits: 2 });
}

function addCalendarYears(dateKey, years) {
  if (!isHalalDateKey(dateKey)) return '';
  var parts = dateKey.split('-').map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
}

function addCalendarDays(dateKey, days) {
  if (!isHalalDateKey(dateKey)) return '';
  var parts = dateKey.split('-').map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
}

function bmrExpiryDate(productionDate) {
  return addCalendarYears(productionDate, 1);
}

function bmrBatchNo(productionDate) {
  var expiry = bmrExpiryDate(productionDate);
  if (!isHalalDateKey(productionDate) || !expiry) return '';
  return productionDate.slice(8, 10) + productionDate.slice(5, 7) + expiry.slice(0, 4);
}

function bmrDateLabel(dateKey) {
  if (!isHalalDateKey(dateKey)) return '';
  var parts = dateKey.split('-').map(Number);
  return parts[2] + '-' + BMR_MONTHS[parts[1] - 1] + '-' + parts[0];
}

function canPrintBmr(session) {
  return Boolean(session && session.status === 'completed' && session.posted);
}

function bmrGramsPerPack(bom) {
  if (bom && bom.bulkYieldGrams && bom.outputQty > 0) return bom.bulkYieldGrams / bom.outputQty;
  return 0;
}

function weightToGrams(qty, unit) {
  if (!isFinite(Number(qty))) return null;
  var code = bmrNormalizeUnit(unit);
  if (code === 'G') return reportRound2(qty);
  if (code === 'KG') return reportRound2(qty * 1000);
  return null;
}

function deriveHalalStatus(certificate, today) {
  if (!certificate || !isHalalDateKey(certificate.expiryDate)) return 'not_registered';
  if (certificate.expiryDate < today) return 'expired';
  if (certificate.verificationStatus !== 'verified') return 'pending';
  if (certificate.expiryDate <= addCalendarDays(today, HALAL_EXPIRING_DAYS)) return 'expiring';
  return 'active';
}

function halalStatusLabel(status) {
  if (status === 'not_registered') return 'Not Registered';
  if (status === 'pending') return 'Pending Verification';
  if (status === 'active') return 'Active';
  if (status === 'expiring') return 'Expiring Soon';
  return 'Expired';
}

function listBmrRecords(sessions, products, warehouses) {
  var rows = [];
  (sessions || []).forEach(function (session) {
    if (!canPrintBmr(session)) return;
    var names = (session.items || []).map(function (item) {
      var found = 'Unknown product';
      (products || []).forEach(function (product) {
        if (product.id === item.productId) found = product.name;
      });
      return found;
    });
    var warehouseName = '';
    (warehouses || []).forEach(function (warehouse) {
      if (warehouse.id === session.warehouseId) warehouseName = warehouse.name;
    });
    rows.push({
      sessionId: session.id,
      productionDate: session.productionDate,
      dateLabel: bmrDateLabel(session.productionDate),
      batchNo: bmrBatchNo(session.productionDate),
      productName: names.join(', '),
      warehouseId: session.warehouseId,
      warehouseName: warehouseName,
      reference: session.reference,
      status: 'Completed',
      completedAt: session.completedAt || '',
      printPath: '/manufacturing/bmr/' + session.id,
      viewPath: '/manufacturing/history/' + session.id
    });
  });
  rows.sort(function (a, b) {
    return b.productionDate.localeCompare(a.productionDate) || b.completedAt.localeCompare(a.completedAt) || b.sessionId.localeCompare(a.sessionId);
  });
  return rows;
}

function filterBmrRecords(rows, input) {
  var today = input && isHalalDateKey(input.today) ? input.today : '';
  var range = (input && input.range) || 'all';
  var needle = String(input && input.query ? input.query : '').trim().toLowerCase();
  var weekFrom = '';
  var weekTo = '';
  if (today) {
    var parts = today.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    var weekday = date.getUTCDay();
    var mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    var start = new Date(date);
    start.setUTCDate(date.getUTCDate() + mondayOffset);
    var end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    function keyOf(value) {
      return value.getUTCFullYear() + '-' + String(value.getUTCMonth() + 1).padStart(2, '0') + '-' + String(value.getUTCDate()).padStart(2, '0');
    }
    weekFrom = keyOf(start);
    weekTo = keyOf(end);
  }
  var month = today.slice(0, 7);
  return (rows || []).filter(function (row) {
    if (input && input.warehouseId && input.warehouseId !== 'all' && row.warehouseId !== input.warehouseId) return false;
    if (range === 'today' && row.productionDate !== today) return false;
    if (range === 'week' && (row.productionDate < weekFrom || row.productionDate > weekTo)) return false;
    if (range === 'month' && row.productionDate.indexOf(month) !== 0) return false;
    if (range === 'custom') {
      if (input.from && row.productionDate < input.from) return false;
      if (input.to && row.productionDate > input.to) return false;
    }
    if (!needle) return true;
    return [row.batchNo, row.productName, row.reference].some(function (value) {
      return String(value).toLowerCase().indexOf(needle) !== -1;
    });
  });
}

function isPackagingMaterial(product, categories) {
  if (!product) return false;
  if (bmrNormalizeUnit(product.unit) === 'PCS') return true;
  var category = null;
  (categories || []).forEach(function (item) {
    if (item.id === product.categoryId) category = item;
  });
  return product.categoryId === 'cat-pack' || (category && String(category.name).trim().toLowerCase() === 'packaging');
}

function productOf(products, productId) {
  var found = null;
  (products || []).forEach(function (item) {
    if (item.id === productId) found = item;
  });
  return found;
}

function halalForProduct(productId, source, today) {
  var rows = (source.halalCompliances || []).filter(function (item) { return item.productId === productId; });
  if (!rows.length) return { manufacturer: '', expiry: '', status: 'Not Registered', remarks: '' };
  if (rows.length > 1) return { manufacturer: '', expiry: '', status: '', remarks: BMR_MULTIPLE_HALAL_REMARK };
  var compliance = rows[0];
  var manufacturer = null;
  (source.manufacturers || []).forEach(function (item) {
    if (item.id === compliance.manufacturerId) manufacturer = item;
  });
  var certificate = null;
  (source.halalCertificates || []).forEach(function (item) {
    if (item.id === compliance.certificateId) certificate = item;
  });
  return {
    manufacturer: manufacturer ? manufacturer.name : '',
    expiry: certificate && isHalalDateKey(certificate.expiryDate) ? bmrDateLabel(certificate.expiryDate) : '',
    status: halalStatusLabel(deriveHalalStatus(certificate, today)),
    remarks: ''
  };
}

function materialRows(session, source, today) {
  var lines = (session.materialClosing && session.materialClosing.lines) || [];
  var rows = [];
  lines.forEach(function (line) {
    var product = productOf(source.products, line.productId);
    if (isPackagingMaterial(product, source.categories)) return;
    var grams = weightToGrams(line.actualUsedQty, product && product.unit);
    var halal = halalForProduct(line.productId, source, today);
    rows.push({
      material: product ? product.name : 'Unknown material',
      manufacturer: halal.manufacturer,
      warehouseStockG: '',
      quantityUsedG: grams == null ? '' : bmrFormatQty(grams),
      expiryDate: halal.expiry,
      halalStatus: halal.status,
      remarks: halal.remarks
    });
  });
  return rows;
}

function packagingRows(session, source) {
  return (session.items || []).map(function (item) {
    var product = productOf(source.products, item.productId);
    var bom = null;
    (source.boms || []).forEach(function (row) {
      if (row.id === item.bomId) bom = row;
    });
    var grams = bom ? bmrGramsPerPack(bom) : 0;
    var released = item.actualQty;
    var produced = grams > 0 ? reportRound2(released * grams) : null;
    var balance = item.productionBalanceQty > 0 ? 'Production balance ' + bmrFormatQty(item.productionBalanceQty) + ' g' : '';
    return {
      flavour: product ? product.name : 'Unknown product',
      sizeWeightG: grams > 0 ? bmrFormatQty(reportRound2(grams)) : '',
      quantityProducedG: produced == null ? '' : bmrFormatQty(produced),
      quantityReleasedPack: bmrFormatQty(released),
      quantityRejected: '',
      remarks: balance
    };
  });
}

function blankProcessRows() {
  return BMR_PROCESS_STEPS.map(function (description, index) {
    return { step: index + 1, description: description, timeStart: '', timeEnd: '', operatorName: '' };
  });
}

function weighingMinutes(materialLines) {
  if (materialLines <= 0) return null;
  if (materialLines <= 5) return BMR_PROCESS_RULES.weighingUpTo5;
  if (materialLines <= 10) return BMR_PROCESS_RULES.weighingUpTo10;
  return BMR_PROCESS_RULES.weighingAbove10;
}

function fillingMinutes(totalPacks) {
  if (!isFinite(totalPacks) || totalPacks <= 0) return null;
  return Math.ceil(totalPacks / BMR_PROCESS_RULES.fillingPacks) * BMR_PROCESS_RULES.fillingMinutes;
}

function formatProcessClock(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur'
  }).format(date);
}

function countableMaterialLines(session, source) {
  return ((session.materialClosing && session.materialClosing.lines) || []).filter(function (line) {
    return !isPackagingMaterial(productOf(source.products, line.productId), source.categories);
  }).length;
}

function buildProcessSchedule(input) {
  var start = new Date(input.startedAt);
  var weighing = weighingMinutes(input.materialLines);
  var filling = fillingMinutes(input.totalPacks);
  if (!input.startedAt || isNaN(start.getTime()) || weighing == null || filling == null) {
    return { rows: blankProcessRows(), note: BMR_PROCESS_UNAVAILABLE_NOTE };
  }
  var durations = [weighing, BMR_PROCESS_RULES.mixing, filling, BMR_PROCESS_RULES.grinding, BMR_PROCESS_RULES.cleaning];
  var cursor = start.getTime();
  var rows = BMR_PROCESS_STEPS.map(function (description, index) {
    var timeStart = formatProcessClock(new Date(cursor));
    cursor += durations[index] * 60000;
    return { step: index + 1, description: description, timeStart: timeStart, timeEnd: formatProcessClock(new Date(cursor)), operatorName: '' };
  });
  return { rows: rows, note: BMR_PROCESS_NOTE };
}

function buildBmr(session, source, today) {
  if (!canPrintBmr(session)) return null;
  var expiryDate = bmrExpiryDate(session.productionDate);
  var names = (session.items || []).map(function (item) {
    var product = productOf(source.products, item.productId);
    return product ? product.name : 'Unknown product';
  });
  var schedule = buildProcessSchedule({
    startedAt: session.startedAt,
    materialLines: countableMaterialLines(session, source),
    totalPacks: (session.items || []).reduce(function (sum, item) { return sum + Math.max(0, item.actualQty || 0); }, 0)
  });
  return {
    sessionId: session.id,
    productName: names.join(', '),
    batchNo: bmrBatchNo(session.productionDate),
    productionDate: session.productionDate,
    productionDateLabel: bmrDateLabel(session.productionDate),
    expiryDate: expiryDate,
    expiryDateLabel: bmrDateLabel(expiryDate),
    approvedBy: '',
    materials: materialRows(session, source, today),
    process: schedule.rows,
    packaging: packagingRows(session, source),
    deviations: [{ issue: '', description: '', correctiveAction: '', responsiblePerson: '', date: '' }],
    approval: [
      { department: 'Production', name: session.completedBy || '', signature: '', date: bmrDateLabel(session.productionDate) },
      { department: 'QC / QA', name: '', signature: '', date: '' },
      { department: 'Halal Compliance', name: '', signature: '', date: '' }
    ],
    processNote: schedule.note
  };
}
