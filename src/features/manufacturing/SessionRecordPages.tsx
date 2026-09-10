import { Link } from 'react-router-dom'
import { Button, PageHeader } from '@/components/ui'

export function MaterialConsumptionPage() {
  return (
    <div>
      <PageHeader
        title="Material Consumption"
        subtitle="Consumption is posted automatically when a daily session is completed. Use the picking list while production is running."
        actions={<Link to="/manufacturing/picking"><Button>Open picking list</Button></Link>}
      />
    </div>
  )
}

export function FinishedGoodsPage() {
  return (
    <div>
      <PageHeader
        title="Finished Goods"
        subtitle="Packed products are received automatically when you complete Today's Production. Production balance is stored separately as processed bulk."
        actions={<Link to="/manufacturing/today"><Button>Today's production</Button></Link>}
      />
    </div>
  )
}
