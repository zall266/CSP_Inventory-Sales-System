// Module 2 masters. Fields match the locked Warehouse and Category types.
// Warehouses: id, name, code, kind. Categories: id, name.
// Sheet1 and the Module 1 sheets are not created here.

var WAREHOUSE_HEADERS = ['id', 'name', 'code', 'kind'];
var CATEGORY_HEADERS = ['id', 'name'];

function createMasterRepository(sheetRepository) {
  function ensure(spreadsheet) {
    sheetRepository.ensureSheet(spreadsheet, 'Warehouses', WAREHOUSE_HEADERS);
    sheetRepository.ensureSheet(spreadsheet, 'Categories', CATEGORY_HEADERS);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function readWarehouses(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Warehouses');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        code: text(row.code).trim(),
        kind: text(row.kind).trim()
      };
    });
  }

  function readCategories(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Categories');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        name: text(row.name).trim()
      };
    });
  }

  function writeWarehouses(spreadsheet, warehouses) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Warehouses'), warehouses);
  }

  function writeCategories(spreadsheet, categories) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Categories'), categories);
  }

  return {
    ensure: ensure,
    readWarehouses: readWarehouses,
    readCategories: readCategories,
    writeWarehouses: writeWarehouses,
    writeCategories: writeCategories
  };
}
