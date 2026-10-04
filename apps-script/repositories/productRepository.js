// Module 3 products. Fields match the locked Product type.
// SalesComponents is the child tab for product.salesComponents.
// InventoryBalances stores the zero on-hand rows created with a product.
// Sheet1, identity sheets, Warehouses, and Categories are not created here.

var PRODUCT_HEADERS = [
  'id', 'name', 'sku', 'barcode', 'categoryId', 'unit', 'purchaseUnit',
  'purchaseConversionQty', 'purchaseCost', 'costPrice', 'costSource',
  'sellingPrice', 'wholesalePrice', 'agentPrice', 'sellable', 'reorderLevel',
  'trackBatch', 'trackExpiry', 'status', 'accent'
];
var SALES_COMPONENT_HEADERS = ['id', 'productId', 'componentProductId', 'qty'];
var INVENTORY_BALANCE_HEADERS = ['productId', 'warehouseId', 'qty'];

function createProductRepository(sheetRepository) {
  function ensure(spreadsheet) {
    var products = sheetRepository.ensureSheet(spreadsheet, 'Products', PRODUCT_HEADERS);
    var components = sheetRepository.ensureSheet(spreadsheet, 'SalesComponents', SALES_COMPONENT_HEADERS);
    var balances = sheetRepository.ensureSheet(spreadsheet, 'InventoryBalances', INVENTORY_BALANCE_HEADERS);
    forceText(products, PRODUCT_HEADERS.indexOf('sku') + 1);
    forceText(products, PRODUCT_HEADERS.indexOf('barcode') + 1);
    return { products: products, components: components, balances: balances };
  }

  function forceText(sheet, column) {
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

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

  function readProducts(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Products');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var agentPrice = text(row.agentPrice).trim();
      var product = {
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        sku: text(row.sku).trim(),
        barcode: text(row.barcode).trim(),
        categoryId: text(row.categoryId).trim(),
        unit: text(row.unit).trim(),
        purchaseUnit: text(row.purchaseUnit).trim(),
        purchaseConversionQty: num(row.purchaseConversionQty),
        purchaseCost: num(row.purchaseCost),
        costPrice: num(row.costPrice),
        costSource: text(row.costSource).trim() === 'bom' ? 'bom' : 'manual',
        sellingPrice: num(row.sellingPrice),
        wholesalePrice: num(row.wholesalePrice),
        sellable: text(row.sellable).trim() === '' ? true : flag(row.sellable),
        reorderLevel: num(row.reorderLevel),
        trackBatch: flag(row.trackBatch),
        trackExpiry: flag(row.trackExpiry),
        status: text(row.status).trim() === 'inactive' ? 'inactive' : 'active',
        accent: text(row.accent).trim() || '#4F46E5'
      };
      if (agentPrice !== '') product.agentPrice = num(row.agentPrice);
      return product;
    });
  }

  function readComponents(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesComponents');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        productId: text(row.productId).trim(),
        componentProductId: text(row.componentProductId).trim(),
        qty: num(row.qty)
      };
    });
  }

  function readBalances(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'InventoryBalances');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        productId: text(row.productId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        qty: num(row.qty)
      };
    });
  }

  function writeProducts(spreadsheet, products) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Products'), products.map(function (product) {
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        categoryId: product.categoryId,
        unit: product.unit,
        purchaseUnit: product.purchaseUnit,
        purchaseConversionQty: product.purchaseConversionQty,
        purchaseCost: product.purchaseCost,
        costPrice: product.costPrice,
        costSource: product.costSource,
        sellingPrice: product.sellingPrice,
        wholesalePrice: product.wholesalePrice,
        agentPrice: product.agentPrice === undefined || product.agentPrice === null ? '' : product.agentPrice,
        sellable: product.sellable !== false,
        reorderLevel: product.reorderLevel,
        trackBatch: Boolean(product.trackBatch),
        trackExpiry: Boolean(product.trackExpiry),
        status: product.status,
        accent: product.accent
      };
    }));
  }

  function writeComponents(spreadsheet, components) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesComponents'), components);
  }

  function writeBalances(spreadsheet, balances) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'InventoryBalances'), balances);
  }

  return {
    ensure: ensure,
    readProducts: readProducts,
    readComponents: readComponents,
    readBalances: readBalances,
    writeProducts: writeProducts,
    writeComponents: writeComponents,
    writeBalances: writeBalances
  };
}
