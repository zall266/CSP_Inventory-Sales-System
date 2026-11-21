// Module 18: dashboard, reports, PJKM, and BMR reads. No inventory posts.

var REPORTING_ACTIONS = {
  'dashboard.get': true,
  'reports.sales': true,
  'reports.purchases': true,
  'reports.inventory': true,
  'reports.profit': true,
  'reports.manufacturing': true,
  'pjkm.511': true,
  'pjkm.911': true,
  'pjkm.1011': true,
  'bmr.list': true,
  'bmr.get': true
};

function createReportingService(deps) {
  var sheets = deps.sheetRepository;
  var salesRepo = createSalesRepository(sheets);
  var purchaseRepo = createPurchaseRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var masters = createMasterRepository(sheets);
  var parties = createPartyRepository(sheets);
  var receivingRepo = createReceivingRepository(sheets);
  var dispatchRepo = createDispatchRepository(sheets);
  var manufacturingRepo = createManufacturingRepository(sheets);
  var opsRepo = createOpsRepository(sheets);
  var bomRepo = createBomRepository(sheets);

  function canHandle(action) {
    return Boolean(REPORTING_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function sheetRows(spreadsheet, name) {
    var sheet = sheets.getSheet(spreadsheet, name);
    if (!sheet) return [];
    return sheets.readObjects(sheet);
  }

  function flagCell(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function loadActor(spreadsheet, actorUserId, message) {
    var id = text(actorUserId).trim();
    if (!id) throw appError('FORBIDDEN', message);
    var match = null;
    sheetRows(spreadsheet, 'Users').forEach(function (row) {
      if (text(row.id).trim() === id) match = row;
    });
    if (!match || text(match.status).trim() !== 'active') throw appError('FORBIDDEN', message);
    return {
      id: text(match.id).trim(),
      name: text(match.name).trim() || text(match.id).trim(),
      roleId: text(match.roleId).trim(),
      role: text(match.role).trim(),
      status: 'active'
    };
  }

  function actorMay(spreadsheet, actor, key) {
    var roles = sheetRows(spreadsheet, 'Roles').map(function (row) {
      return {
        id: text(row.id).trim(),
        protected: flagCell(row.protected),
        legacyRole: text(row.legacyRole).trim()
      };
    });
    var matrix = {};
    sheetRows(spreadsheet, 'RolePermissions').forEach(function (row) {
      var roleId = text(row.roleId).trim();
      var permissionKey = text(row.permissionKey).trim();
      if (!roleId || !permissionKey) return;
      if (!matrix[roleId]) matrix[roleId] = {};
      matrix[roleId][permissionKey] = flagCell(row.allowed);
    });
    return hasPermission({ roles: roles, settings: { roleMatrix: matrix } }, key, actor);
  }

  function requirePermission(spreadsheet, actorUserId, key, message) {
    var actor = loadActor(spreadsheet, actorUserId, message);
    if (!actorMay(spreadsheet, actor, key)) throw appError('FORBIDDEN', message);
    return actor;
  }

  function sources(spreadsheet) {
    return {
      warehouses: masters.readWarehouses(spreadsheet),
      categories: masters.readCategories(spreadsheet),
      products: products.readProducts(spreadsheet),
      inventory: products.readBalances(spreadsheet),
      movements: inventoryRepo.readMovements(spreadsheet),
      sales: salesRepo.readSales(spreadsheet),
      purchases: purchaseRepo.readPurchases(spreadsheet),
      expenses: opsRepo.readExpenses(spreadsheet),
      customers: parties.readCustomers(spreadsheet),
      suppliers: parties.readSuppliers(spreadsheet),
      receivings: sheets.getSheet(spreadsheet, 'Receivings') ? receivingRepo.readReceivings(spreadsheet) : [],
      dispatches: dispatchRepo.readDispatches(spreadsheet),
      orders: manufacturingRepo.readOrders(spreadsheet),
      sessions: manufacturingRepo.readSessions(spreadsheet),
      boms: bomRepo.readBoms(spreadsheet),
      manufacturers: opsRepo.readManufacturers(spreadsheet),
      halalCertificates: opsRepo.readCertificates(spreadsheet),
      halalCompliances: opsRepo.readCompliances(spreadsheet)
    };
  }

  function nameOf(rows, id) {
    var found = '';
    (rows || []).forEach(function (row) {
      if (row.id === id) found = row.name;
    });
    return found;
  }

  function findProduct(list, productId) {
    var found = null;
    (list || []).forEach(function (item) {
      if (item.id === productId) found = item;
    });
    return found;
  }

  function dashboardPayload(src, payload) {
    var range = reportDateRange(payload);
    var warehouse = text(payload.warehouseId).trim() || 'all';
    var sales = filteredSalesRows(src.sales, src.warehouses, range, warehouse);
    var purchases = filteredPurchaseRows(src.purchases, src.warehouses, range, warehouse);
    var revenue = reportRound2(sales.reduce(function (sum, sale) { return sum + Number(sale.total); }, 0));
    var cogs = reportRound2(sales.reduce(function (sum, sale) { return sum + saleCogsTotal(src.products, sale); }, 0));
    var stockRows = (src.inventory || []).filter(function (row) {
      return reportWarehouseMatch(src.warehouses, row.warehouseId, warehouse);
    });
    var low = 0;
    var out = 0;
    stockRows.forEach(function (row) {
      var product = findProduct(src.products, row.productId);
      if (row.qty <= 0) out += 1;
      else if (product && row.qty <= product.reorderLevel) low += 1;
    });
    return {
      totalSales: revenue,
      cogs: cogs,
      grossProfit: reportRound2(revenue - cogs),
      totalPurchases: reportRound2(purchases.reduce(function (sum, row) { return sum + Number(row.total); }, 0)),
      inventoryValue: inventoryValueTotal(src.products, src.warehouses, src.inventory, warehouse),
      receivables: outstandingReceivablesTotal(src.sales),
      payables: outstandingPayablesTotal(src.purchases),
      lowStockCount: low,
      outOfStockCount: out,
      salesCount: sales.length,
      purchaseCount: purchases.length
    };
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    return locked(function (spreadsheet) {
      if (action === 'dashboard.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'dashboard.view', 'You cannot view the dashboard.');
        return okEnvelope(dashboardPayload(sources(spreadsheet), payload));
      }
      if (action === 'reports.sales' || action === 'reports.purchases' || action === 'reports.inventory' || action === 'reports.profit' || action === 'reports.manufacturing') {
        requirePermission(spreadsheet, payload.actorUserId, 'reports.view', 'You cannot view reports.');
        var src = sources(spreadsheet);
        var range = reportDateRange(payload);
        var warehouse = text(payload.warehouseId).trim() || 'all';
        if (action === 'reports.sales') {
          var sales = filteredSalesRows(src.sales, src.warehouses, range, warehouse);
          var revenue = reportRound2(sales.reduce(function (sum, sale) { return sum + Number(sale.total); }, 0));
          return okEnvelope({
            sales: sales.map(function (sale) {
              return {
                id: sale.id, invoiceNo: sale.invoiceNo, date: sale.date, customerId: sale.customerId,
                customerName: nameOf(src.customers, sale.customerId), total: sale.total, warehouseId: sale.warehouseId
              };
            }),
            invoices: sales.length,
            revenue: revenue,
            averageTicket: sales.length ? reportRound2(revenue / sales.length) : 0
          });
        }
        if (action === 'reports.purchases') {
          var purchases = filteredPurchaseRows(src.purchases, src.warehouses, range, warehouse);
          return okEnvelope({
            purchases: purchases.map(function (row) {
              return {
                id: row.id, purchaseNo: row.purchaseNo, date: row.date, supplierId: row.supplierId,
                supplierName: nameOf(src.suppliers, row.supplierId), total: row.total, balance: row.balance, warehouseId: row.warehouseId
              };
            }),
            documents: purchases.length,
            spend: reportRound2(purchases.reduce(function (sum, row) { return sum + Number(row.total); }, 0)),
            unpaid: reportRound2(purchases.reduce(function (sum, row) { return sum + Number(row.balance); }, 0))
          });
        }
        if (action === 'reports.inventory') {
          var rows = (src.inventory || []).filter(function (row) {
            return reportWarehouseMatch(src.warehouses, row.warehouseId, warehouse);
          }).map(function (row) {
            var product = findProduct(src.products, row.productId);
            if (!product) return null;
            return {
              productId: row.productId,
              productName: product.name,
              categoryId: product.categoryId,
              categoryName: nameOf(src.categories, product.categoryId),
              warehouseId: row.warehouseId,
              warehouseName: nameOf(src.warehouses, row.warehouseId),
              qty: row.qty,
              unit: product.unit,
              value: reportRound2(row.qty * (product.costPrice || 0))
            };
          }).filter(Boolean);
          return okEnvelope({
            rows: rows,
            inventoryValue: inventoryValueTotal(src.products, src.warehouses, src.inventory, warehouse)
          });
        }
        if (action === 'reports.profit') {
          var profitSales = filteredSalesRows(src.sales, src.warehouses, range, warehouse);
          var expenses = filteredExpenseRows(src.expenses, range);
          var profitRevenue = reportRound2(profitSales.reduce(function (sum, sale) { return sum + Number(sale.total); }, 0));
          var profitCogs = reportRound2(profitSales.reduce(function (sum, sale) { return sum + saleCogsTotal(src.products, sale); }, 0));
          var gross = reportRound2(profitRevenue - profitCogs);
          var expenseTotal = reportRound2(expenses.reduce(function (sum, row) { return sum + Number(row.amount); }, 0));
          var net = reportRound2(gross - expenseTotal);
          return okEnvelope({
            revenue: profitRevenue,
            cogs: profitCogs,
            grossProfit: gross,
            grossMargin: profitRevenue ? (gross / profitRevenue) * 100 : 0,
            expenses: expenseTotal,
            netProfit: net
          });
        }
        var orders = filteredOrderRows(src.orders, src.warehouses, range, warehouse);
        return okEnvelope({
          orders: orders.map(function (order) {
            return {
              id: order.id, orderNo: order.orderNo, date: order.date, productId: order.productId,
              productName: nameOf(src.products, order.productId), warehouseId: order.warehouseId,
              plannedQty: order.plannedQty, actualQty: order.actualQty, status: order.status,
              costEstimate: order.costEstimate, consumptions: order.consumptions, wastage: order.wastage
            };
          }),
          orderCount: orders.length,
          plannedQty: orders.reduce(function (sum, order) { return sum + Number(order.plannedQty); }, 0),
          actualQty: orders.reduce(function (sum, order) { return sum + Number(order.actualQty); }, 0)
        });
      }
      if (action === 'pjkm.511' || action === 'pjkm.911' || action === 'pjkm.1011') {
        requirePermission(spreadsheet, payload.actorUserId, 'receiving.view', 'You do not have permission to view receiving.');
        var month = text(payload.month).trim();
        if (!/^\d{4}-\d{2}$/.test(month)) throw appError('VALIDATION_ERROR', 'Month is required.');
        var all = sources(spreadsheet);
        if (action === 'pjkm.511') return okEnvelope(buildPjkm511({
          month: month, receivings: all.receivings, suppliers: all.suppliers, products: all.products, warehouses: all.warehouses
        }));
        if (action === 'pjkm.911') return okEnvelope(buildPjkm911({ month: month, dispatches: all.dispatches }));
        return okEnvelope(buildPjkm1011({
          month: month, movements: all.movements, sales: all.sales, products: all.products,
          warehouses: all.warehouses, sessions: all.sessions
        }));
      }
      if (action === 'bmr.list' || action === 'bmr.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.history.view', 'You do not have permission to view completed production.');
        var bmrSrc = sources(spreadsheet);
        var today = text(payload.today).trim() || reportDateKey(new Date());
        if (action === 'bmr.list') {
          var listed = listBmrRecords(bmrSrc.sessions, bmrSrc.products, bmrSrc.warehouses);
          return okEnvelope({
            records: filterBmrRecords(listed, {
              query: payload.query, range: payload.range, from: payload.from, to: payload.to,
              warehouseId: payload.warehouseId, today: today
            })
          });
        }
        var session = null;
        bmrSrc.sessions.forEach(function (row) {
          if (row.id === text(payload.id || payload.sessionId).trim()) session = row;
        });
        var document = buildBmr(session, {
          products: bmrSrc.products, boms: bmrSrc.boms, categories: bmrSrc.categories,
          manufacturers: bmrSrc.manufacturers, halalCertificates: bmrSrc.halalCertificates,
          halalCompliances: bmrSrc.halalCompliances
        }, today);
        if (!document) throw appError('NOT_FOUND', 'Print BMR is available only for a completed and posted production session.');
        return okEnvelope({ bmr: document });
      }
      throw appError('UNKNOWN_ACTION', 'The action is not available.');
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
