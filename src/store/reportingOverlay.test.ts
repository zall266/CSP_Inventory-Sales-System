import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isReportingDenied, pickReportingNumber, pickReportingOverlay } from './reportingOverlay.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('local overlay is used only when the backend is unset', () => {
  const local = { totalSales: 42516 }
  const live = { totalSales: 0 }
  assert.deepEqual(pickReportingOverlay({ data: null, configured: false }, local, live), local)
  assert.deepEqual(pickReportingOverlay({ data: live, configured: true }, local, { totalSales: 0 }), live)
  assert.deepEqual(pickReportingOverlay({ data: null, configured: true }, local, { totalSales: 0 }), { totalSales: 0 })
})

test('missing view permission is always denied; FORBIDDEN is denied when the backend is configured', () => {
  assert.equal(isReportingDenied({ configured: false, denied: false }, false), true)
  assert.equal(isReportingDenied({ configured: false, denied: false }, true), false)
  assert.equal(isReportingDenied({ configured: true, denied: false }, true), false)
  assert.equal(isReportingDenied({ configured: true, denied: false }, false), true)
  assert.equal(isReportingDenied({ configured: true, denied: true }, true), true)
})

test('configured KPI fallback is zero, not seed math', () => {
  assert.equal(pickReportingNumber({ configured: false }, undefined, 42516), 42516)
  assert.equal(pickReportingNumber({ configured: true }, undefined, 42516), 0)
  assert.equal(pickReportingNumber({ configured: true }, 12, 42516), 12)
})

test('dashboard and reports pages gate dashboard.view and reports.view', () => {
  const dashboard = fs.readFileSync(path.join(root, 'src/features/dashboard/DashboardPage.tsx'), 'utf8')
  const reports = fs.readFileSync(path.join(root, 'src/features/reports/ReportsPages.tsx'), 'utf8')
  const manufacturing = fs.readFileSync(path.join(root, 'src/features/manufacturing/ManufacturingReportsPages.tsx'), 'utf8')
  const sidebar = fs.readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
  const pjkm = fs.readFileSync(path.join(root, 'src/features/pjkm/PjkmPages.tsx'), 'utf8')
  assert.equal(dashboard.includes("hasPermission(state, 'dashboard.view')"), true)
  assert.equal(dashboard.includes('isReportingDenied'), true)
  assert.equal(reports.includes("hasPermission(state, 'reports.view')"), true)
  assert.equal(manufacturing.includes("hasPermission(state, 'reports.view')"), true)
  assert.equal(sidebar.includes("dashboard.view"), true)
  assert.equal(sidebar.includes("reports.view"), true)
  assert.equal(pjkm.includes('isReportingDenied'), true)
})

test('cashier defaults still omit dashboard.view and reports.view', () => {
  const source = fs.readFileSync(path.join(root, 'src/features/settings/permissions.ts'), 'utf8')
  const match = source.match(/if \(role === 'cashier'\) \{[\s\S]*?return withKeys\(\[([\s\S]*?)\]\)/)
  assert.ok(match)
  assert.equal(match[1].includes('dashboard.view'), false)
  assert.equal(match[1].includes('reports.view'), false)
})
