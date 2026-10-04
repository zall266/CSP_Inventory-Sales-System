// Module 6 warehouse map. Physical placement only.
// InventoryBalances and StockMovements are not written here.
// Sheet1, identity, products, and parties stay untouched.

var STORAGE_LOCATION_HEADERS = ['id', 'name', 'type', 'warehouseId', 'active', 'createdAt', 'updatedAt'];
var STORAGE_SLOT_HEADERS = ['id', 'locationId', 'level', 'face', 'slotNo', 'capacity', 'active'];
var SLOT_OCCUPANCY_HEADERS = [
  'id', 'slotId', 'productId', 'quantityPacks', 'batchRef', 'productionSessionRef',
  'placedBy', 'placedAt', 'updatedAt'
];
var PLACEMENT_LOG_HEADERS = [
  'id', 'action', 'productId', 'quantity', 'fromSlotId', 'toSlotId', 'batchRef',
  'referenceId', 'performedBy', 'performedAt', 'reason'
];
var DISPLAY_STOCK_HEADERS = ['id', 'warehouseId', 'productId', 'qty', 'updatedAt'];
var PRODUCTION_BALANCE_HEADERS = [
  'id', 'productId', 'quantity', 'unit', 'location', 'container', 'warehouseId',
  'productionDate', 'productionReference', 'status'
];
var BALANCE_USAGE_LOG_HEADERS = [
  'id', 'balanceId', 'productId', 'quantity', 'unit', 'productionDate', 'productionReference',
  'container', 'location', 'reason', 'notes', 'performedBy', 'performedAt'
];

function createWarehouseRepository(sheetRepository) {
  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function flag(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function ensure(spreadsheet) {
    var locations = sheetRepository.ensureSheet(spreadsheet, 'StorageLocations', STORAGE_LOCATION_HEADERS);
    var slots = sheetRepository.ensureSheet(spreadsheet, 'StorageSlots', STORAGE_SLOT_HEADERS);
    var occupancies = sheetRepository.ensureSheet(spreadsheet, 'SlotOccupancies', SLOT_OCCUPANCY_HEADERS);
    var logs = sheetRepository.ensureSheet(spreadsheet, 'PlacementLogs', PLACEMENT_LOG_HEADERS);
    var display = sheetRepository.ensureSheet(spreadsheet, 'DisplayStocks', DISPLAY_STOCK_HEADERS);
    var balances = sheetRepository.ensureSheet(spreadsheet, 'ProductionBalances', PRODUCTION_BALANCE_HEADERS);
    var usage = sheetRepository.ensureSheet(spreadsheet, 'BalanceUsageLogs', BALANCE_USAGE_LOG_HEADERS);
    forceText(occupancies, SLOT_OCCUPANCY_HEADERS.indexOf('batchRef') + 1);
    forceText(occupancies, SLOT_OCCUPANCY_HEADERS.indexOf('productionSessionRef') + 1);
    forceText(logs, PLACEMENT_LOG_HEADERS.indexOf('batchRef') + 1);
    forceText(logs, PLACEMENT_LOG_HEADERS.indexOf('referenceId') + 1);
    forceText(balances, PRODUCTION_BALANCE_HEADERS.indexOf('productionDate') + 1);
    forceText(balances, PRODUCTION_BALANCE_HEADERS.indexOf('productionReference') + 1);
    forceText(usage, BALANCE_USAGE_LOG_HEADERS.indexOf('productionDate') + 1);
    forceText(usage, BALANCE_USAGE_LOG_HEADERS.indexOf('productionReference') + 1);
    return {
      locations: locations,
      slots: slots,
      occupancies: occupancies,
      logs: logs,
      display: display,
      balances: balances,
      usage: usage
    };
  }

  function sheet(spreadsheet, name) {
    return sheetRepository.getSheet(spreadsheet, name);
  }

  function readLocations(spreadsheet) {
    var current = sheet(spreadsheet, 'StorageLocations');
    if (!current) return [];
    return sheetRepository.readObjects(current).map(function (row) {
      return {
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        type: text(row.type).trim(),
        warehouseId: text(row.warehouseId).trim(),
        active: flag(row.active),
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
    }).filter(function (row) { return row.id; });
  }

  function readSlots(spreadsheet) {
    var current = sheet(spreadsheet, 'StorageSlots');
    if (!current) return [];
    return sheetRepository.readObjects(current).map(function (row) {
      return {
        id: text(row.id).trim(),
        locationId: text(row.locationId).trim(),
        level: num(row.level),
        face: text(row.face).trim() || 'NONE',
        slotNo: num(row.slotNo),
        capacity: num(row.capacity),
        active: flag(row.active)
      };
    }).filter(function (row) { return row.id; });
  }

  function readOccupancies(spreadsheet) {
    var current = sheet(spreadsheet, 'SlotOccupancies');
    if (!current) return [];
    return sheetRepository.readObjects(current).map(function (row) {
      return {
        id: text(row.id).trim(),
        slotId: text(row.slotId).trim(),
        productId: text(row.productId).trim(),
        quantityPacks: num(row.quantityPacks),
        batchRef: text(row.batchRef).trim(),
        productionSessionRef: text(row.productionSessionRef).trim(),
        placedBy: text(row.placedBy).trim(),
        placedAt: text(row.placedAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
    }).filter(function (row) { return row.id && row.slotId; });
  }

  function readLogs(spreadsheet) {
    var current = sheet(spreadsheet, 'PlacementLogs');
    if (!current) return [];
    return sheetRepository.readObjects(current).map(function (row) {
      return {
        id: text(row.id).trim(),
        action: text(row.action).trim(),
        productId: text(row.productId).trim(),
        quantity: num(row.quantity),
        fromSlotId: text(row.fromSlotId).trim(),
        toSlotId: text(row.toSlotId).trim(),
        batchRef: text(row.batchRef).trim(),
        referenceId: text(row.referenceId).trim(),
        performedBy: text(row.performedBy).trim(),
        performedAt: text(row.performedAt).trim(),
        reason: text(row.reason).trim()
      };
    }).filter(function (row) { return row.id; });
  }

  function readDisplay(spreadsheet) {
    var current = sheet(spreadsheet, 'DisplayStocks');
    if (!current) return [];
    return sheetRepository.readObjects(current).map(function (row) {
      return {
        id: text(row.id).trim(),
        warehouseId: text(row.warehouseId).trim(),
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        updatedAt: text(row.updatedAt).trim()
      };
    }).filter(function (row) { return row.id; });
  }

  function readProductionBalances(spreadsheet) {
    var current = sheet(spreadsheet, 'ProductionBalances');
    if (!current) return [];
    return sheetRepository.readObjects(current).map(function (row) {
      var status = text(row.status).trim() === 'consumed' ? 'consumed' : 'available';
      return {
        id: text(row.id).trim(),
        productId: text(row.productId).trim(),
        quantity: num(row.quantity),
        unit: text(row.unit).trim(),
        location: text(row.location).trim(),
        container: text(row.container).trim(),
        warehouseId: text(row.warehouseId).trim(),
        productionDate: text(row.productionDate).trim(),
        productionReference: text(row.productionReference).trim(),
        status: status
      };
    }).filter(function (row) { return row.id; });
  }

  function readBalanceUsage(spreadsheet) {
    var current = sheet(spreadsheet, 'BalanceUsageLogs');
    if (!current) return [];
    return sheetRepository.readObjects(current).map(function (row) {
      return {
        id: text(row.id).trim(),
        balanceId: text(row.balanceId).trim(),
        productId: text(row.productId).trim(),
        quantity: num(row.quantity),
        unit: text(row.unit).trim(),
        productionDate: text(row.productionDate).trim(),
        productionReference: text(row.productionReference).trim(),
        container: text(row.container).trim(),
        location: text(row.location).trim(),
        reason: text(row.reason).trim(),
        notes: text(row.notes).trim(),
        performedBy: text(row.performedBy).trim(),
        performedAt: text(row.performedAt).trim()
      };
    }).filter(function (row) { return row.id; });
  }

  function writeLocations(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'StorageLocations'), rows);
  }

  function writeSlots(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'StorageSlots'), rows);
  }

  function writeOccupancies(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'SlotOccupancies'), rows);
  }

  function writeDisplay(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'DisplayStocks'), rows);
  }

  function writeProductionBalances(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheet(spreadsheet, 'ProductionBalances'), rows);
  }

  function appendLog(spreadsheet, row) {
    ensure(spreadsheet);
    sheetRepository.appendObject(sheet(spreadsheet, 'PlacementLogs'), row);
  }

  function appendUsage(spreadsheet, row) {
    ensure(spreadsheet);
    sheetRepository.appendObject(sheet(spreadsheet, 'BalanceUsageLogs'), row);
  }

  return {
    ensure: ensure,
    readLocations: readLocations,
    readSlots: readSlots,
    readOccupancies: readOccupancies,
    readLogs: readLogs,
    readDisplay: readDisplay,
    readProductionBalances: readProductionBalances,
    readBalanceUsage: readBalanceUsage,
    writeLocations: writeLocations,
    writeSlots: writeSlots,
    writeOccupancies: writeOccupancies,
    writeDisplay: writeDisplay,
    writeProductionBalances: writeProductionBalances,
    appendLog: appendLog,
    appendUsage: appendUsage
  };
}
