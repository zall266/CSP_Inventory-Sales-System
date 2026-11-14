// Module 5 ledger lines. InventoryBalances stays the balance projection
// owned by the product repository. StockMovements is append-only.

var STOCK_MOVEMENT_HEADERS = [
  'id', 'date', 'reference', 'productId', 'warehouseId', 'type',
  'stockIn', 'stockOut', 'balance', 'user', 'notes'
];

function createInventoryRepository(sheetRepository) {
  function ensure(spreadsheet) {
    return sheetRepository.ensureSheet(spreadsheet, 'StockMovements', STOCK_MOVEMENT_HEADERS);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readMovements(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'StockMovements');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var notes = text(row.notes).trim();
      var movement = {
        id: text(row.id).trim(),
        date: text(row.date).trim(),
        reference: text(row.reference).trim(),
        productId: text(row.productId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        type: text(row.type).trim(),
        stockIn: num(row.stockIn),
        stockOut: num(row.stockOut),
        balance: num(row.balance),
        user: text(row.user).trim()
      };
      if (notes) movement.notes = notes;
      return movement;
    }).filter(function (row) { return row.id; });
  }

  function appendMovement(spreadsheet, movement) {
    var sheet = ensure(spreadsheet);
    sheetRepository.appendObject(sheet, {
      id: movement.id,
      date: movement.date,
      reference: movement.reference,
      productId: movement.productId,
      warehouseId: movement.warehouseId,
      type: movement.type,
      stockIn: movement.stockIn,
      stockOut: movement.stockOut,
      balance: movement.balance,
      user: movement.user,
      notes: movement.notes || ''
    });
  }

  return {
    headers: STOCK_MOVEMENT_HEADERS,
    ensure: ensure,
    readMovements: readMovements,
    appendMovement: appendMovement
  };
}
