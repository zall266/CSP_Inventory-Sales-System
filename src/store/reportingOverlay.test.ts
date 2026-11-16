import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  combineReportingSurfaces,
  isReportingDenied,
  pickReportingNumber,
  pickReportingOverlay,
  reportingSurface,
} from './reportingOverlay.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('local overlay is used only when the backend is unset', () => {
  const local = { totalSales: 42516 }
  const live = { totalSales: 0 }
  assert.deepEqual(pickReportingOverlay({ data: null, configured: false, status: 'idle' }, local, live), local)
  assert.deepEqual(pickReportingOverlay({ data: live, configured: true, status: 'ok' }, local, { totalSales: 0 }), live)
  assert.deepEqual(pickReportingOverlay({ data: null, configured: true, status: 'ok' }, local, { totalSales: 0 }), { totalSales: 0 })
})

test('configured errors and loading never return seed overlay', () => {
  const local = { totalSales: 42516 }
  const empty = { totalSales: 0 }
  assert.deepEqual(pickReportingOverlay({ data: null, configured: true, status: 'loading' }, local, empty), empty)
  assert.deepEqual(pickReportingOverlay({ data: null, configured: true, status: 'error' }, local, empty), empty)
  assert.deepEqual(pickReportingOverlay({ data: local, configured: true, status: 'error' }, local, empty), empty)
  assert.equal(pickReportingNumber({ configured: true, status: 'loading' }, undefined, 42516), 0)
  assert.equal(pickReportingNumber({ configured: true, status: 'error' }, 99, 42516), 0)
  assert.equal(pickReportingNumber({ configured: true, status: 'ok' }, 0, 42516), 0)
})

test('missing view permission is always denied; FORBIDDEN is denied when the backend is configured', () => {
  assert.equal(isReportingDenied({ configured: false, denied: false }, false), true)
  assert.equal(isReportingDenied({ configured: false, denied: false }, true), false)
  assert.equal(isReportingDenied({ configured: true, denied: false }, true), false)
  assert.equal(isReportingDenied({ configured: true, denied: false }, false), true)
  assert.equal(isReportingDenied({ configured: true, denied: true }, true), true)
})

test('reportingSurface distinguishes demo, live zero, loading, error and denied', () => {
  assert.equal(reportingSurface({ configured: false, denied: false, status: 'idle' }, true), 'demo')
  assert.equal(reportingSurface({ configured: true, denied: false, status: 'loading' }, true), 'loading')
  assert.equal(reportingSurface({ configured: true, denied: false, status: 'error' }, true), 'error')
  assert.equal(reportingSurface({ configured: true, denied: false, status: 'ok' }, true), 'live')
  assert.equal(reportingSurface({ configured: true, denied: true, status: 'denied' }, true), 'denied')
  assert.equal(reportingSurface({ configured: true, denied: false, status: 'ok' }, false), 'denied')
  assert.deepEqual(combineReportingSurfaces(['loading', 'live']), 'loading')
  assert.deepEqual(combineReportingSurfaces(['error', 'live']), 'error')
})

test('configured KPI fallback is zero, not seed math', () => {
  assert.equal(pickReportingNumber({ configured: false, status: 'idle' }, undefined, 42516), 42516)
  assert.equal(pickReportingNumber({ configured: true, status: 'ok' }, undefined, 42516), 0)
  assert.equal(pickReportingNumber({ configured: true, status: 'ok' }, 12, 42516), 12)
})

test('dashboard and reports pages gate dashboard.view and reports.view', () => {
  const dashboard = fs.readFileSync(path.join(root, 'src/features/dashboard/DashboardPage.tsx'), 'utf8')
  const reports = fs.readFileSync(path.join(root, 'src/features/reports/ReportsPages.tsx'), 'utf8')
  const manufacturing = fs.readFileSync(path.join(root, 'src/features/manufacturing/ManufacturingReportsPages.tsx'), 'utf8')
  const sidebar = fs.readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
  const pjkm = fs.readFileSync(path.join(root, 'src/features/pjkm/PjkmPages.tsx'), 'utf8')
  assert.equal(dashboard.includes("hasPermission(state, 'dashboard.view')"), true)
  assert.equal(dashboard.includes('reportingSurface'), true)
  assert.equal(dashboard.includes("surface === 'demo'"), true)
  assert.equal(dashboard.includes('useLocal ? chartData'), true)
  assert.equal(reports.includes("hasPermission(state, 'reports.view')"), true)
  assert.equal(reports.includes('overlay?.sales'), true)
  assert.equal(reports.includes('overlay?.purchases'), true)
  assert.equal(manufacturing.includes("hasPermission(state, 'reports.view')"), true)
  assert.equal(manufacturing.includes('query.data?.orders'), true)
  assert.equal(sidebar.includes('dashboard.view'), true)
  assert.equal(sidebar.includes('reports.view'), true)
  assert.equal(pjkm.includes('reportingSurface'), true)
})

test('cashier defaults still omit dashboard.view and reports.view', () => {
  const source = fs.readFileSync(path.join(root, 'src/features/settings/permissions.ts'), 'utf8')
  const match = source.match(/if \(role === 'cashier'\) \{[\s\S]*?return withKeys\(\[([\s\S]*?)\]\)/)
  assert.ok(match)
  assert.equal(match[1].includes('dashboard.view'), false)
  assert.equal(match[1].includes('reports.view'), false)
})
