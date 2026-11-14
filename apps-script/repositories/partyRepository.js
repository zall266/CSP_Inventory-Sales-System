// Module 4 parties. Fields match the locked Customer, Supplier, Agent,
// and CustomerWholesalePrice types. Agent warehouses stay on Warehouses.
// Agent prices stay on Products. Sheet1 and Modules 1–3 sheets are not created here.

var CUSTOMER_HEADERS = ['id', 'name', 'phone', 'email', 'address', 'status'];
var SUPPLIER_HEADERS = ['id', 'name', 'contact', 'phone', 'email', 'status'];
var AGENT_HEADERS = [
  'id', 'name', 'code', 'warehouseId', 'userId', 'bankName', 'accountHolder',
  'bankAccount', 'status', 'createdAt', 'updatedAt'
];
var CUSTOMER_WHOLESALE_PRICE_HEADERS = [
  'id', 'customerId', 'productId', 'price', 'active', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
];

function createPartyRepository(sheetRepository) {
  function ensure(spreadsheet) {
    var customers = sheetRepository.ensureSheet(spreadsheet, 'Customers', CUSTOMER_HEADERS);
    var suppliers = sheetRepository.ensureSheet(spreadsheet, 'Suppliers', SUPPLIER_HEADERS);
    var agents = sheetRepository.ensureSheet(spreadsheet, 'Agents', AGENT_HEADERS);
    var prices = sheetRepository.ensureSheet(spreadsheet, 'CustomerWholesalePrices', CUSTOMER_WHOLESALE_PRICE_HEADERS);
    forceText(customers, CUSTOMER_HEADERS.indexOf('phone') + 1);
    forceText(suppliers, SUPPLIER_HEADERS.indexOf('phone') + 1);
    forceText(agents, AGENT_HEADERS.indexOf('code') + 1);
    forceText(agents, AGENT_HEADERS.indexOf('bankAccount') + 1);
    return { customers: customers, suppliers: suppliers, agents: agents, prices: prices };
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

  function status(value) {
    return text(value).trim() === 'inactive' ? 'inactive' : 'active';
  }

  function readCustomers(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Customers');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        phone: text(row.phone).trim(),
        email: text(row.email).trim(),
        address: text(row.address).trim(),
        status: status(row.status)
      };
    }).filter(function (row) { return row.id; });
  }

  function readSuppliers(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Suppliers');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        contact: text(row.contact).trim(),
        phone: text(row.phone).trim(),
        email: text(row.email).trim(),
        status: status(row.status)
      };
    }).filter(function (row) { return row.id; });
  }

  function readAgents(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Agents');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var agent = {
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        code: text(row.code).trim(),
        warehouseId: text(row.warehouseId).trim(),
        bankName: text(row.bankName).trim(),
        accountHolder: text(row.accountHolder).trim(),
        bankAccount: text(row.bankAccount).trim(),
        status: status(row.status),
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
      var userId = text(row.userId).trim();
      if (userId) agent.userId = userId;
      return agent;
    }).filter(function (row) { return row.id; });
  }

  function readWholesalePrices(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'CustomerWholesalePrices');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        customerId: text(row.customerId).trim(),
        productId: text(row.productId).trim(),
        price: num(row.price),
        active: text(row.active).trim() === '' ? true : flag(row.active),
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim(),
        createdBy: text(row.createdBy).trim(),
        updatedBy: text(row.updatedBy).trim()
      };
    }).filter(function (row) { return row.id; });
  }

  function writeCustomers(spreadsheet, customers) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Customers'), customers);
  }

  function writeSuppliers(spreadsheet, suppliers) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Suppliers'), suppliers);
  }

  function writeAgents(spreadsheet, agents) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Agents'), agents);
  }

  function writeWholesalePrices(spreadsheet, prices) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'CustomerWholesalePrices'), prices);
  }

  return {
    ensure: ensure,
    readCustomers: readCustomers,
    readSuppliers: readSuppliers,
    readAgents: readAgents,
    readWholesalePrices: readWholesalePrices,
    writeCustomers: writeCustomers,
    writeSuppliers: writeSuppliers,
    writeAgents: writeAgents,
    writeWholesalePrices: writeWholesalePrices
  };
}
