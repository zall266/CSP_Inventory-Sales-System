// Module 3 products. Fields match the locked Product type.
// SalesComponents is the child tab for product.salesComponents.
// InventoryBalances stores the zero on-hand rows created with a product.
// Sheet1, identity sheets, Warehouses, and Categories are not created here.

var PRODUCT_HEADERS = [
  'id', 'name', 'sku', 'barcode', 'categoryId', 'unit', 'purchaseUnit',
  'purchaseConversionQty', 'purchaseCost', 'costPrice', 'costSource',
  'sellingPrice', 'wholesalePrice', 'agentPrice', 'sellable', 'reorderLevel',
  'trackBatch', 'trackExpiry', 'status', 'accent', 'imageFileId'
];
var PRODUCT_HEADERS_WITHOUT_IMAGE = PRODUCT_HEADERS.slice(0, -1);
var SALES_COMPONENT_HEADERS = ['id', 'productId', 'componentProductId', 'qty'];
var INVENTORY_BALANCE_HEADERS = ['productId', 'warehouseId', 'qty'];

function createProductRepository(sheetRepository) {
  function headerRow(sheet) {
    var width = sheet.getLastColumn();
    if (width < 1) return [];
    return sheet.getRange(1, 1, 1, width).getValues()[0].map(function (header) {
      return String(header || '').trim();
    }).filter(Boolean);
  }

  function ensureProductSheet(spreadsheet) {
    var existing = sheetRepository.getSheet(spreadsheet, 'Products');
    if (!existing) {
      return sheetRepository.ensureSheet(spreadsheet, 'Products', PRODUCT_HEADERS);
    }
    var current = headerRow(existing);
    if (!current.length) {
      existing.getRange(1, 1, 1, PRODUCT_HEADERS.length).setValues([PRODUCT_HEADERS]);
      return existing;
    }
    if (current.join('|') === PRODUCT_HEADERS.join('|')) return existing;
    if (current.join('|') === PRODUCT_HEADERS_WITHOUT_IMAGE.join('|')) {
      existing.getRange(1, 1, 1, PRODUCT_HEADERS.length).setValues([PRODUCT_HEADERS]);
      return existing;
    }
    throw appError('CONFLICT', 'Foundation sheet headers do not match.');
  }

  function ensure(spreadsheet) {
    var products = ensureProductSheet(spreadsheet);
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
      var imageFileId = text(row.imageFileId).trim();
      if (imageFileId) product.imageFileId = imageFileId;
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
        accent: product.accent,
        imageFileId: text(product.imageFileId).trim()
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

  // Image mutations write only the Products imageFileId cell. They must not
  // rewrite SalesComponents, InventoryBalances, or unrelated product fields.
  function writeProductImageFileId(spreadsheet, productId, imageFileId) {
    var sheet = ensureProductSheet(spreadsheet);
    var headers = headerRow(sheet);
    var idCol = headers.indexOf('id') + 1;
    var imageCol = headers.indexOf('imageFileId') + 1;
    if (idCol < 1 || imageCol < 1) {
      throw appError('CONFLICT', 'Foundation sheet headers do not match.');
    }
    var last = sheet.getLastRow();
    if (last < 2) throw appError('NOT_FOUND', 'Product was not found.');
    var ids = sheet.getRange(2, idCol, last - 1, 1).getValues();
    var id = text(productId).trim();
    var value = text(imageFileId).trim();
    for (var i = 0; i < ids.length; i += 1) {
      if (text(ids[i][0]).trim() === id) {
        sheet.getRange(i + 2, imageCol, 1, 1).setValues([[value]]);
        return;
      }
    }
    throw appError('NOT_FOUND', 'Product was not found.');
  }

  return {
    ensure: ensure,
    readProducts: readProducts,
    readComponents: readComponents,
    readBalances: readBalances,
    writeProducts: writeProducts,
    writeComponents: writeComponents,
    writeBalances: writeBalances,
    writeProductImageFileId: writeProductImageFileId
  };
}
