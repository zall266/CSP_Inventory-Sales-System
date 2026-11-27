// Module 16 dispatch tables. Lines are normalized; API snapshots nest them on the dispatch.

var VEHICLE_HEADERS = ['id', 'code', 'vehicleType', 'plateNumber', 'active', 'createdAt', 'updatedAt'];
var DISPATCH_HEADERS = [
  'id', 'dispatchDate', 'vehicleId', 'vehicleCode', 'vehicleType', 'plateNumber', 'condition',
  'status', 'createdBy', 'createdAt', 'confirmedBy', 'confirmedAt', 'voidedBy', 'voidedAt',
  'inspectionGroupId'
];
var DISPATCH_LINE_HEADERS = ['dispatchId', 'shipmentId', 'trackingNumber', 'courierKey', 'parcelQty'];
var INSPECTION_GROUP_HEADERS = [
  'id', 'groupNo', 'dispatchDate', 'status', 'dispatchIdsJson', 'createdAt', 'createdBy',
  'confirmedAt', 'confirmedBy'
];

function createDispatchRepository(sheetRepository) {
  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function flag(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function optional(value) {
    var next = text(value).trim();
    return next || undefined;
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function parseJson(value, fallback) {
    var raw = text(value).trim();
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function jsonCell(value) {
    if (value === undefined || value === null || value === '') return '';
    return JSON.stringify(value);
  }

  function ensure(spreadsheet) {
    var vehicles = sheetRepository.ensureSheet(spreadsheet, 'Vehicles', VEHICLE_HEADERS);
    var dispatches = sheetRepository.ensureSheet(spreadsheet, 'Dispatches', DISPATCH_HEADERS);
    var lines = sheetRepository.ensureSheet(spreadsheet, 'DispatchLines', DISPATCH_LINE_HEADERS);
    var groups = sheetRepository.ensureSheet(spreadsheet, 'InspectionGroups', INSPECTION_GROUP_HEADERS);
    forceText(vehicles, VEHICLE_HEADERS.indexOf('id') + 1);
    forceText(vehicles, VEHICLE_HEADERS.indexOf('code') + 1);
    forceText(dispatches, DISPATCH_HEADERS.indexOf('id') + 1);
    forceText(lines, DISPATCH_LINE_HEADERS.indexOf('shipmentId') + 1);
    forceText(groups, INSPECTION_GROUP_HEADERS.indexOf('groupNo') + 1);
    return {
      vehicles: vehicles,
      dispatches: dispatches,
      lines: lines,
      groups: groups
    };
  }

  function readVehicles(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Vehicles');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        code: text(row.code).trim(),
        vehicleType: text(row.vehicleType).trim(),
        plateNumber: text(row.plateNumber).trim(),
        active: row.active === '' ? true : flag(row.active),
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
    }).filter(Boolean);
  }

  function writeVehicles(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Vehicles'), (rows || []).map(function (row) {
      return {
        id: row.id,
        code: row.code,
        vehicleType: row.vehicleType,
        plateNumber: row.plateNumber,
        active: row.active !== false,
        createdAt: row.createdAt || '',
        updatedAt: row.updatedAt || ''
      };
    }));
  }

  function readDispatchHeaders(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Dispatches');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var item = {
        id: id,
        dispatchDate: text(row.dispatchDate).trim(),
        vehicleId: text(row.vehicleId).trim(),
        vehicleCode: text(row.vehicleCode).trim(),
        vehicleType: text(row.vehicleType).trim(),
        plateNumber: text(row.plateNumber).trim(),
        condition: text(row.condition).trim() === 'BAIK' ? 'BAIK' : '',
        status: text(row.status).trim() || 'draft',
        createdBy: text(row.createdBy).trim(),
        createdAt: text(row.createdAt).trim(),
        lines: []
      };
      var confirmedBy = optional(row.confirmedBy);
      var confirmedAt = optional(row.confirmedAt);
      var voidedBy = optional(row.voidedBy);
      var voidedAt = optional(row.voidedAt);
      var inspectionGroupId = optional(row.inspectionGroupId);
      if (confirmedBy) item.confirmedBy = confirmedBy;
      if (confirmedAt) item.confirmedAt = confirmedAt;
      if (voidedBy) item.voidedBy = voidedBy;
      if (voidedAt) item.voidedAt = voidedAt;
      if (inspectionGroupId) item.inspectionGroupId = inspectionGroupId;
      return item;
    }).filter(Boolean);
  }

  function readDispatchLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'DispatchLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var dispatchId = text(row.dispatchId).trim();
      var shipmentId = text(row.shipmentId).trim();
      if (!dispatchId || !shipmentId) return null;
      return {
        dispatchId: dispatchId,
        shipmentId: shipmentId,
        trackingNumber: text(row.trackingNumber).trim(),
        courierKey: text(row.courierKey).trim(),
        parcelQty: num(row.parcelQty)
      };
    }).filter(Boolean);
  }

  function readDispatches(spreadsheet) {
    var headers = readDispatchHeaders(spreadsheet);
    var grouped = {};
    readDispatchLines(spreadsheet).forEach(function (line) {
      if (!grouped[line.dispatchId]) grouped[line.dispatchId] = [];
      grouped[line.dispatchId].push({
        shipmentId: line.shipmentId,
        trackingNumber: line.trackingNumber,
        courierKey: line.courierKey,
        parcelQty: line.parcelQty
      });
    });
    headers.forEach(function (row) {
      row.lines = grouped[row.id] || [];
    });
    return headers;
  }

  function writeDispatches(spreadsheet, rows) {
    ensure(spreadsheet);
    var headers = [];
    var lines = [];
    (rows || []).forEach(function (row) {
      headers.push({
        id: row.id,
        dispatchDate: row.dispatchDate,
        vehicleId: row.vehicleId || '',
        vehicleCode: row.vehicleCode || '',
        vehicleType: row.vehicleType || '',
        plateNumber: row.plateNumber || '',
        condition: row.condition === 'BAIK' ? 'BAIK' : '',
        status: row.status || 'draft',
        createdBy: row.createdBy || '',
        createdAt: row.createdAt || '',
        confirmedBy: row.confirmedBy || '',
        confirmedAt: row.confirmedAt || '',
        voidedBy: row.voidedBy || '',
        voidedAt: row.voidedAt || '',
        inspectionGroupId: row.inspectionGroupId || ''
      });
      (row.lines || []).forEach(function (line) {
        lines.push({
          dispatchId: row.id,
          shipmentId: line.shipmentId,
          trackingNumber: line.trackingNumber || '',
          courierKey: line.courierKey,
          parcelQty: line.parcelQty
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Dispatches'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'DispatchLines'), lines);
  }

  function readGroups(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'InspectionGroups');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var ids = parseJson(row.dispatchIdsJson, []) || [];
      if (!Array.isArray(ids)) ids = [];
      return {
        id: id,
        groupNo: text(row.groupNo).trim(),
        dispatchDate: text(row.dispatchDate).trim(),
        status: text(row.status).trim() || 'confirmed',
        dispatchIds: ids.map(function (value) { return text(value).trim(); }).filter(Boolean),
        createdAt: text(row.createdAt).trim(),
        createdBy: text(row.createdBy).trim(),
        confirmedAt: text(row.confirmedAt).trim(),
        confirmedBy: text(row.confirmedBy).trim()
      };
    }).filter(Boolean);
  }

  function writeGroups(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'InspectionGroups'), (rows || []).map(function (row) {
      return {
        id: row.id,
        groupNo: row.groupNo,
        dispatchDate: row.dispatchDate,
        status: row.status,
        dispatchIdsJson: jsonCell(row.dispatchIds || []),
        createdAt: row.createdAt || '',
        createdBy: row.createdBy || '',
        confirmedAt: row.confirmedAt || '',
        confirmedBy: row.confirmedBy || ''
      };
    }));
  }

  return {
    ensure: ensure,
    readVehicles: readVehicles,
    writeVehicles: writeVehicles,
    readDispatches: readDispatches,
    writeDispatches: writeDispatches,
    readGroups: readGroups,
    writeGroups: writeGroups
  };
}
