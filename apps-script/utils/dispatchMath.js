// Ported from src/features/dispatch/dispatchModel.ts for Apps Script V8.

var DISPATCH_COURIER_ORDER = [
  'JNT',
  'JNT CARGO',
  'SPX',
  'FLASH',
  'GDEX',
  'INSTANT',
  'POS',
  'NINJAVAN',
  'UNKNOWN'
];

var DISPATCH_COURIER_SET = {
  JNT: true,
  'JNT CARGO': true,
  SPX: true,
  FLASH: true,
  GDEX: true,
  INSTANT: true,
  POS: true,
  NINJAVAN: true,
  UNKNOWN: true
};

function parseDispatchParcelQty(value) {
  var qty = Number(value);
  if (!Number.isInteger(qty) || qty < 1) return null;
  return qty;
}

function isDispatchDate(value) {
  var text = value === undefined || value === null ? '' : String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  var parts = text.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function confirmedShipmentOwner(dispatches, shipmentId, exceptDispatchId) {
  var found = null;
  (dispatches || []).forEach(function (row) {
    if (found) return;
    if (row.status !== 'confirmed' || row.id === exceptDispatchId) return;
    var lines = row.lines || [];
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].shipmentId === shipmentId) {
        found = row;
        return;
      }
    }
  });
  return found;
}

function validateDispatchLines(input) {
  var seenShipment = {};
  var seenTracking = {};
  var lines = input.lines || [];
  var shipments = input.shipments || [];
  var dispatches = input.dispatches || [];
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    var shipmentId = String(line.shipmentId || '').trim();
    if (seenShipment[shipmentId]) return 'Each shipment can be added once.';
    seenShipment[shipmentId] = true;
    var shipment = null;
    shipments.forEach(function (item) {
      if (item.id === shipmentId) shipment = item;
    });
    if (!shipment) return 'A selected shipment was not found.';
    if (!DISPATCH_COURIER_SET[line.courierKey]) return 'Choose a courier column or leave the shipment as UNKNOWN.';
    if (parseDispatchParcelQty(line.parcelQty) == null) return 'Parcel quantity must be a whole number of at least 1.';
    if (confirmedShipmentOwner(dispatches, shipmentId, input.dispatchId)) {
      return 'That shipment is already on a confirmed dispatch.';
    }
    var tracking = String(shipment.trackingNumber || '').trim();
    if (tracking) {
      if (seenTracking[tracking]) return 'That tracking number is already on this dispatch.';
      seenTracking[tracking] = true;
    }
  }
  return '';
}

function snapshotDispatchLines(lines, shipments) {
  return (lines || []).map(function (line) {
    var shipment = null;
    (shipments || []).forEach(function (item) {
      if (item.id === line.shipmentId) shipment = item;
    });
    return {
      shipmentId: line.shipmentId,
      trackingNumber: shipment ? shipment.trackingNumber || '' : '',
      courierKey: line.courierKey,
      parcelQty: line.parcelQty
    };
  });
}

function dispatchCourierKeys(dispatch) {
  var present = {};
  ((dispatch && dispatch.lines) || []).forEach(function (line) {
    present[line.courierKey] = true;
  });
  return DISPATCH_COURIER_ORDER.filter(function (key) {
    return present[key];
  });
}

function inspectionCourierConflict(dispatches) {
  var seen = {};
  var conflict = '';
  (dispatches || []).forEach(function (row) {
    dispatchCourierKeys(row).forEach(function (key) {
      if (conflict) return;
      if (seen[key]) conflict = key;
      seen[key] = true;
    });
  });
  return conflict;
}

function validateInspectionGroup(dispatches, dispatchIds) {
  if (!dispatchIds || dispatchIds.length < 1) return 'Select at least one confirmed dispatch.';
  var unique = {};
  dispatchIds.forEach(function (id) {
    unique[id] = true;
  });
  if (Object.keys(unique).length !== dispatchIds.length) return 'Select each dispatch once.';
  var rows = [];
  var missing = false;
  dispatchIds.forEach(function (id) {
    var found = null;
    (dispatches || []).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found) missing = true;
    else rows.push(found);
  });
  if (missing) return 'A selected dispatch was not found.';
  var draft = false;
  var voided = false;
  var notConfirmed = false;
  var grouped = false;
  rows.forEach(function (row) {
    if (row.status === 'draft') draft = true;
    if (row.status === 'void') voided = true;
    if (row.status !== 'confirmed') notConfirmed = true;
    if (row.inspectionGroupId) grouped = true;
  });
  if (draft) return 'A draft dispatch cannot join an inspection group.';
  if (voided) return 'A voided dispatch cannot join an inspection group.';
  if (notConfirmed) return 'Only a confirmed dispatch can join an inspection group.';
  if (grouped) return 'That dispatch is already in an inspection group.';
  var date = rows[0].dispatchDate;
  var mixedDate = false;
  rows.forEach(function (row) {
    if (row.dispatchDate !== date) mixedDate = true;
  });
  if (mixedDate) return 'Inspection Group must contain Dispatch records from the same date.';
  var conflict = inspectionCourierConflict(rows);
  if (conflict) return 'Courier ' + conflict + ' already exists in this inspection group. Use another Inspection Group.';
  return '';
}
