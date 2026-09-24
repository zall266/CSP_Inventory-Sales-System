import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { useStore } from '@/store/hooks'
import {
  BMR_COMPANY,
  BMR_DOCUMENT,
  BMR_EFFECTIVE_DATE,
  BMR_TITLE,
  buildBmr,
  type BmrApprovalRow,
  type BmrDeviationRow,
  type BmrDocument,
  type BmrMaterialRow,
  type BmrPackagingRow,
  type BmrPage,
  type BmrProcessRow,
} from '@/features/manufacturing/bmrModel'
import './bmr.css'

export function BmrPrintPage() {
  const { sessionId } = useParams()
  const state = useStore()
  const session = state.productionSessions.find((item) => item.id === sessionId)
  const record = buildBmr(session, {
    products: state.products,
    boms: state.boms,
    categories: state.categories,
    manufacturers: state.manufacturers,
    halalCertificates: state.halalCertificates,
    halalCompliances: state.halalCompliances,
  })
  const filename = record ? `BMR_${record.batchNo}_${record.productionDate}.pdf` : 'BMR.pdf'

  return (
    <div className="bmr-root min-h-screen bg-slate-200">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Batch Manufacturing Record</div>
          <div className="text-xs text-slate-500">{record ? `${record.productName} · ${record.batchNo}` : 'Not available'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.history.back()}>Back</Button>
          <Button onClick={() => { document.title = filename; window.print() }} disabled={!record}>Print / Save as PDF</Button>
        </div>
      </div>
      {!record ? (
        <div className="mx-auto mt-8 max-w-lg rounded-lg border border-slate-300 bg-white px-4 py-6 text-sm text-slate-700">
          Print BMR is available only for a completed and posted production session.
        </div>
      ) : (
        <div className="py-6 print:py-0">
          {record.pages.map((page, index) => (
            <BmrSheet key={index} record={record} page={page} />
          ))}
        </div>
      )}
    </div>
  )
}

function BmrSheet({ record, page }: { record: BmrDocument; page: BmrPage }) {
  return (
    <section className="bmr-sheet">
      {page.showDocumentHeader ? <DocumentHeader record={record} /> : <div className="bmr-continued">{BMR_TITLE} — continued</div>}
      {page.materials.length > 0 && <MaterialTable rows={page.materials} />}
      {page.showProcess && <ProcessTable rows={record.process} />}
      {page.showPackaging && <PackagingTable rows={record.packaging} />}
      {page.showDeviations && <DeviationTable rows={record.deviations} />}
      {page.showApproval && <ApprovalTable rows={record.approval} />}
    </section>
  )
}

function DocumentHeader({ record }: { record: BmrDocument }) {
  return (
    <>
      <div className="bmr-company">{BMR_COMPANY}</div>
      <div className="bmr-doc">{BMR_DOCUMENT}</div>
      <div className="bmr-effective">Effective Date: {BMR_EFFECTIVE_DATE}</div>
      <div className="bmr-title">{BMR_TITLE}</div>
      <table className="bmr-meta">
        <tbody>
          <tr><th>Product Name</th><td>{record.productName}</td></tr>
          <tr><th>Batch No.</th><td>{record.batchNo}</td></tr>
          <tr><th>Production Date</th><td>{record.productionDateLabel}</td></tr>
          <tr><th>Expiry Date</th><td>{record.expiryDateLabel}</td></tr>
          <tr><th>Approved By</th><td>{record.approvedBy}</td></tr>
        </tbody>
      </table>
    </>
  )
}

function MaterialTable({ rows }: { rows: BmrMaterialRow[] }) {
  return (
    <>
      <div className="bmr-section">1. Raw Material Details</div>
      <table className="bmr-grid">
        <thead>
          <tr>
            <th>Material</th>
            <th>Manufacturer</th>
            <th>Warehouse stock (g)</th>
            <th>Quantity Used (g)</th>
            <th>Expiry Date</th>
            <th>Halal Status</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.material}-${index}`}>
              <td>{row.material}</td>
              <td>{row.manufacturer}</td>
              <td>{row.warehouseStockG}</td>
              <td>{row.quantityUsedG}</td>
              <td>{row.expiryDate}</td>
              <td>{row.halalStatus}</td>
              <td>{row.remarks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function ProcessTable({ rows }: { rows: BmrProcessRow[] }) {
  return (
    <>
      <div className="bmr-section">Process</div>
      <table className="bmr-grid">
        <thead>
          <tr>
            <th>Step</th>
            <th>Process Description</th>
            <th>Time Start</th>
            <th>Time End</th>
            <th>Operator Name</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.step}>
              <td>{row.step}</td>
              <td>{row.description}</td>
              <td>{row.timeStart}</td>
              <td>{row.timeEnd}</td>
              <td>{row.operatorName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function PackagingTable({ rows }: { rows: BmrPackagingRow[] }) {
  return (
    <>
      <div className="bmr-section">3. Packaging Details</div>
      <table className="bmr-grid">
        <thead>
          <tr>
            <th>Flavour</th>
            <th>Size / Weight (g)</th>
            <th>Quantity Produced (g)</th>
            <th>Quantity Released (Pack)</th>
            <th>Quantity Rejected</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.flavour}-${index}`}>
              <td>{row.flavour}</td>
              <td>{row.sizeWeightG}</td>
              <td>{row.quantityProducedG}</td>
              <td>{row.quantityReleasedPack}</td>
              <td>{row.quantityRejected}</td>
              <td>{row.remarks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function DeviationTable({ rows }: { rows: BmrDeviationRow[] }) {
  return (
    <>
      <div className="bmr-section">4. Deviations / Non-Conformance</div>
      <table className="bmr-grid">
        <thead>
          <tr>
            <th>Issue</th>
            <th>Description</th>
            <th>Corrective Action</th>
            <th>Responsible Person</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="bmr-sign">
              <td>{row.issue}</td>
              <td>{row.description}</td>
              <td>{row.correctiveAction}</td>
              <td>{row.responsiblePerson}</td>
              <td>{row.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function ApprovalTable({ rows }: { rows: BmrApprovalRow[] }) {
  return (
    <>
      <div className="bmr-section">5. Final Approval</div>
      <table className="bmr-grid">
        <thead>
          <tr>
            <th>Department</th>
            <th>Name</th>
            <th>Signature</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.department} className="bmr-sign">
              <td>{row.department}</td>
              <td>{row.name}</td>
              <td>{row.signature}</td>
              <td>{row.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
