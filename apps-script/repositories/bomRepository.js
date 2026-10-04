// Module 7 BOM / recipes. A BOM belongs to one product.
// BomItems are the component lines. Identity is the row id, not the sheet position.

var BOM_HEADERS = ['id', 'name', 'productId', 'outputQty', 'outputUnit', 'bulkYieldGrams', 'status', 'notes'];
var BOM_ITEM_HEADERS = ['id', 'bomId', 'productId', 'qty', 'unit', 'wastagePct', 'notes', 'consumptionMethod'];

function createBomRepository(sheetRepository) {
  function ensure(spreadsheet) {
    var boms = sheetRepository.ensureSheet(spreadsheet, 'Boms', BOM_HEADERS);
    var items = sheetRepository.ensureSheet(spreadsheet, 'BomItems', BOM_ITEM_HEADERS);
    forceText(boms, BOM_HEADERS.indexOf('id') + 1);
    forceText(boms, BOM_HEADERS.indexOf('productId') + 1);
    forceText(items, BOM_ITEM_HEADERS.indexOf('id') + 1);
    forceText(items, BOM_ITEM_HEADERS.indexOf('bomId') + 1);
    forceText(items, BOM_ITEM_HEADERS.indexOf('productId') + 1);
    return { boms: boms, items: items };
  }

  function forceText(sheet, column) {
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readItems(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'BomItems');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var notes = text(row.notes);
      var item = {
        id: text(row.id).trim(),
        bomId: text(row.bomId).trim(),
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        unit: text(row.unit).trim(),
        wastagePct: num(row.wastagePct),
        notes: notes,
        consumptionMethod: text(row.consumptionMethod).trim() === 'MANUAL' ? 'MANUAL' : 'AUTO'
      };
      return item;
    });
  }

  function readBoms(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Boms');
    if (!sheet) return [];
    var items = readItems(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      var grams = text(row.bulkYieldGrams).trim();
      var bom = {
        id: id,
        name: text(row.name).trim(),
        productId: text(row.productId).trim(),
        outputQty: num(row.outputQty),
        outputUnit: text(row.outputUnit).trim(),
        status: text(row.status).trim() === 'inactive' ? 'inactive' : 'active',
        notes: text(row.notes),
        items: items.filter(function (item) { return item.bomId === id; }).map(function (item) {
          return {
            id: item.id,
            productId: item.productId,
            qty: item.qty,
            unit: item.unit,
            wastagePct: item.wastagePct,
            notes: item.notes,
            consumptionMethod: item.consumptionMethod
          };
        })
      };
      if (grams !== '') bom.bulkYieldGrams = num(row.bulkYieldGrams);
      return bom;
    });
  }

  function writeBoms(spreadsheet, boms) {
    ensure(spreadsheet);
    var headers = [];
    var items = [];
    (boms || []).forEach(function (bom) {
      headers.push({
        id: bom.id,
        name: bom.name,
        productId: bom.productId,
        outputQty: bom.outputQty,
        outputUnit: bom.outputUnit,
        bulkYieldGrams: bom.bulkYieldGrams === undefined || bom.bulkYieldGrams === null ? '' : bom.bulkYieldGrams,
        status: bom.status,
        notes: bom.notes || ''
      });
      (bom.items || []).forEach(function (item) {
        items.push({
          id: item.id,
          bomId: bom.id,
          productId: item.productId,
          qty: item.qty,
          unit: item.unit,
          wastagePct: item.wastagePct,
          notes: item.notes || '',
          consumptionMethod: item.consumptionMethod === 'MANUAL' ? 'MANUAL' : 'AUTO'
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Boms'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'BomItems'), items);
  }

  return {
    ensure: ensure,
    readBoms: readBoms,
    writeBoms: writeBoms
  };
}
