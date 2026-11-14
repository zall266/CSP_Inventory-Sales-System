// Date-preset filters and KPI math from src/store/hooks.ts and the report pages.

function reportRound2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function reportDateKey(date) {
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date instanceof Date ? date : new Date(date));
  function pick(type) {
    var found = '';
    parts.forEach(function (part) {
      if (part.type === type) found = part.value;
    });
    return found;
  }
  return pick('year') + '-' + pick('month') + '-' + pick('day');
}

function reportStartOfDay(date) {
  var key = reportDateKey(date);
  return new Date(key + 'T00:00:00+08:00');
}

function reportAddDays(date, days) {
  var next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function reportDateRange(payload) {
  var todayRaw = payload && payload.today ? String(payload.today).trim() : '';
  var today = /^\d{4}-\d{2}-\d{2}$/.test(todayRaw) ? new Date(todayRaw + 'T12:00:00+08:00') : new Date();
  var end = reportStartOfDay(today);
  end.setHours(23, 59, 59, 999);
  var preset = payload && payload.preset ? String(payload.preset).trim() : '30d';
  if (preset === '7d') return { from: reportAddDays(reportStartOfDay(today), -6), to: end };
  if (preset === '90d') return { from: reportAddDays(reportStartOfDay(today), -89), to: end };
  if (preset === 'custom') {
    var customFrom = payload && payload.customFrom ? String(payload.customFrom).trim() : '';
    var customTo = payload && payload.customTo ? String(payload.customTo).trim() : '';
    return {
      from: new Date((customFrom || reportDateKey(today)) + 'T00:00:00+08:00'),
      to: new Date((customTo || reportDateKey(today)) + 'T23:59:59+08:00')
    };
  }
  return { from: reportAddDays(reportStartOfDay(today), -29), to: end };
}

function reportInRange(iso, from, to) {
  var t = new Date(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function isCompanyWarehouse(warehouses, warehouseId) {
  var found = false;
  (warehouses || []).forEach(function (row) {
    if (row.id === warehouseId && row.kind === 'company') found = true;
  });
  return found;
}

function reportWarehouseMatch(warehouses, warehouseId, filter) {
  if (!filter || filter === 'all') return isCompanyWarehouse(warehouses, warehouseId);
  return warehouseId === filter;
}

function filteredSalesRows(sales, warehouses, range, warehouseFilter) {
  return (sales || []).filter(function (sale) {
    if (sale.status === 'voided') return false;
    if (!reportInRange(sale.date, range.from, range.to)) return false;
    return reportWarehouseMatch(warehouses, sale.warehouseId, warehouseFilter);
  });
}

function filteredPurchaseRows(purchases, warehouses, range, warehouseFilter) {
  return (purchases || []).filter(function (purchase) {
    if (!reportInRange(purchase.date, range.from, range.to)) return false;
    return reportWarehouseMatch(warehouses, purchase.warehouseId, warehouseFilter);
  });
}

function filteredExpenseRows(expenses, range) {
  return (expenses || []).filter(function (expense) {
    return reportInRange(expense.date, range.from, range.to);
  });
}

function filteredOrderRows(orders, warehouses, range, warehouseFilter) {
  return (orders || []).filter(function (order) {
    if (!reportInRange(order.date, range.from, range.to)) return false;
    return reportWarehouseMatch(warehouses, order.warehouseId, warehouseFilter);
  });
}

function productCost(products, productId) {
  var cost = 0;
  (products || []).forEach(function (product) {
    if (product.id === productId) cost = Number(product.costPrice) || 0;
  });
  return cost;
}

function saleCogsTotal(products, sale) {
  var sum = 0;
  (sale.items || []).forEach(function (item) {
    sum += productCost(products, item.productId) * Number(item.qty);
  });
  return reportRound2(sum);
}

function inventoryValueTotal(products, warehouses, inventory, warehouseFilter) {
  var sum = 0;
  (inventory || []).forEach(function (row) {
    if (!reportWarehouseMatch(warehouses, row.warehouseId, warehouseFilter)) return;
    sum += (Number(row.qty) || 0) * productCost(products, row.productId);
  });
  return reportRound2(sum);
}

function outstandingReceivablesTotal(sales) {
  var sum = 0;
  (sales || []).forEach(function (sale) {
    if (sale.status === 'voided') return;
    sum += Number(sale.balance) || 0;
  });
  return reportRound2(sum);
}

function outstandingPayablesTotal(purchases) {
  var sum = 0;
  (purchases || []).forEach(function (purchase) {
    sum += Number(purchase.balance) || 0;
  });
  return reportRound2(sum);
}
