// Shared receiving ↔ purchase link guards. Used by ReceivingService and PurchaseService.
// Product overlap: at least one canonical productId on both documents.
// Warehouse: both headers always have warehouseId; a mismatch is rejected.
// Quantities and line counts may differ (partial delivery).

function receivingPurchaseProductIds(items) {
  var ids = {};
  (items || []).forEach(function (item) {
    var id = item && item.productId !== undefined && item.productId !== null ? String(item.productId).trim() : '';
    if (id) ids[id] = true;
  });
  return ids;
}

function requireCompatibleReceivingPurchase(receiving, purchase) {
  var receivingWh = receiving && receiving.warehouseId ? String(receiving.warehouseId).trim() : '';
  var purchaseWh = purchase && purchase.warehouseId ? String(purchase.warehouseId).trim() : '';
  if (receivingWh && purchaseWh && receivingWh !== purchaseWh) {
    throw appError('VALIDATION_ERROR', 'Receiving and purchase must use the same warehouse.');
  }
  var receivingIds = receivingPurchaseProductIds(receiving && receiving.items);
  var overlap = false;
  (purchase && purchase.items ? purchase.items : []).forEach(function (item) {
    var id = item && item.productId !== undefined && item.productId !== null ? String(item.productId).trim() : '';
    if (id && receivingIds[id]) overlap = true;
  });
  if (!overlap) {
    throw appError('PRODUCT_MISMATCH', 'Receiving and purchase must share at least one product.');
  }
}
