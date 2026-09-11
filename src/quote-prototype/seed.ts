import { PROTOTYPE_TODAY } from '@/utils/format'
import { quotationTotals } from './calc'
import type { QuoteCustomer, QuoteLine, QuoteProduct, QuoteSettings, Quotation } from './types'

const iso = (month: number, day: number, hour = 10, minute = 0) =>
  new Date(Date.UTC(2026, month - 1, day, hour - 8, minute)).toISOString()

export const defaultSettings = (): QuoteSettings => ({
  companyName: 'COOL SLURPPY MARKETING',
  registrationNo: 'AS0423373-A',
  address: 'JC3249, Kilang Teres, Melaka HalalHub Serkam Fasa 2, Merlimau, Melaka, 77300, Malaysia',
  phone: '01156849903',
  email: 'hello@coolslurppypowder.com',
  website: 'www.coolslurppypowder.com',
  logoDataUrl: '',
  quotationPrefix: '2026',
  nextNumber: 212,
  validityDays: 7,
  paymentMethod: 'Payment by Online Transfer should be made payable to COOL SLURPPY MARKETING.',
  bankName: 'Maybank',
  accountHolder: 'COOL SLURPPY MARKETING',
  accountNumber: '551043567137',
  duitNowQrDataUrl: '',
  defaultNotes: 'Quotations are valid for seven (7) days from the date of issue.\nGoods sold are not returnable.',
  defaultTerms: 'Quotations are valid for seven (7) days from the date of issue.\nGoods sold are not returnable.',
})

export const seedCustomers = (): QuoteCustomer[] => [
  { id: 'c-gbk', name: 'GBK', company: 'GBK', address: '12A, Jalan Kerongsang 1, Bandar Puteri, 41200 Klang, Selangor, Malaysia', phone: '0182709193', email: 'order@gbk.my' },
  { id: 'c-kaki', name: 'Kaki Kopi Muar', company: 'KAKI KOPI MUAR', address: 'NO.1 Kedai PTD 11242 Jalan Tungku Bendahara, Kampung Dato Bentara Luar, Muar, Johor, 84000, Malaysia', phone: '019-7766952', email: 'kakikopi@gmail.com' },
  { id: 'c-abc', name: 'Aina Abdullah', company: 'ABC Cafe', address: '18, Jalan Bukit Bintang, 55100 Kuala Lumpur', phone: '03-2166 4410', email: 'orders@abccafe.my' },
  { id: 'c-fajar', name: 'Fajar Cafe', company: 'Fajar Cafe', address: '32, Jalan Ampang, 50450 Kuala Lumpur', phone: '03-4142 8801', email: 'fajarcafe@gmail.com' },
  { id: 'c-maju', name: 'Purchasing Desk', company: 'Maju Enterprise', address: '88, Jalan Imbi, 55100 Kuala Lumpur', phone: '012-388 2210', email: 'purchasing@maju.my' },
  { id: 'c-xyz', name: 'Encik Rahman', company: 'Kedai Kopi XYZ', address: '7, Jalan Melaka Raya, 75000 Melaka', phone: '017-662 1194', email: 'xyzkopi@gmail.com' },
  { id: 'c-seri', name: 'Restoran Seri Melaka', company: 'Restoran Seri Melaka', address: '21, Jalan Hang Tuah, 75300 Melaka', phone: '06-281 4402', email: 'serimelaka@gmail.com' },
  { id: 'c-wong', name: 'Uncle Wong', company: 'Uncle Wong Dessert', address: '5, Jalan Kuchai Lama, 58200 Kuala Lumpur', phone: '016-334 7781', email: 'unclewong@gmail.com' },
  { id: 'c-halo', name: 'Halo Boba', company: 'Halo Boba Sdn Bhd', address: '12, Jalan SS2/72, 47300 Petaling Jaya, Selangor', phone: '011-2345 8890', email: 'hello@haloboba.my' },
  { id: 'c-dapur', name: 'Dapur Raya', company: 'Dapur Raya Enterprise', address: '9, Jalan Merdeka, 75000 Melaka', phone: '012-909 3311', email: 'dapurraya@gmail.com' },
]

export const seedProducts = (): QuoteProduct[] => [
  { id: 'p-waffle', name: 'Tepung Waffle', code: '147822', description: 'Waffle Premix', unit: 'PCS', sellingPrice: 7.49, taxRate: 0, status: 'active' },
  { id: 'p-vanilla', name: 'AB Blue Ice Vanilla', code: '147539', description: 'Air Balang Blue Ice Vanilla', unit: 'PCS', sellingPrice: 17.99, taxRate: 0, status: 'active' },
  { id: 'p-straw', name: 'AB Strawbbery / Yogurt', code: '147549', description: 'Air Balang Strawberry / Yogurt', unit: 'PCS', sellingPrice: 17.99, taxRate: 0, status: 'active' },
  { id: 'p-matcha', name: 'AB Matcha', code: '147540', description: 'Air Balang Matcha', unit: 'PCS', sellingPrice: 17.99, taxRate: 0, status: 'active' },
  { id: 'p-choc', name: 'Chocolate Powder', code: 'CP001', description: 'Chocolate drink powder', unit: 'KG', sellingPrice: 35, taxRate: 0, status: 'active' },
  { id: 'p-mt', name: 'Matcha Powder', code: 'MT001', description: 'Culinary matcha powder', unit: 'KG', sellingPrice: 55, taxRate: 0, status: 'active' },
  { id: 'p-wfkg', name: 'Waffle Premix (Bulk)', code: 'WF001', description: 'Waffle premix in KG', unit: 'KG', sellingPrice: 32, taxRate: 0, status: 'active' },
  { id: 'p-cup', name: 'Plastic Cup', code: 'PC001', description: '16oz plastic cup', unit: 'PCS', sellingPrice: 0.4, taxRate: 0, status: 'active' },
  { id: 'p-ice', name: 'Ice Blended Powder', code: 'IB001', description: 'Ice blended base', unit: 'KG', sellingPrice: 28, taxRate: 0, status: 'active' },
  { id: 'p-air', name: 'Air Balang Premix', code: 'AB001', description: 'Air Balang premix', unit: 'KG', sellingPrice: 24, taxRate: 0, status: 'active' },
  { id: 'p-bd', name: 'Bandung Syrup', code: 'BD001', description: 'Bandung flavoured syrup', unit: 'BTL', sellingPrice: 14, taxRate: 0, status: 'active' },
  { id: 'p-pandan', name: 'Pandan Waffle Premix', code: 'PW001', description: 'Pandan waffle premix', unit: 'KG', sellingPrice: 34, taxRate: 0, status: 'active' },
]

function line(product: QuoteProduct, qty: number, price = product.sellingPrice, discount = 0): QuoteLine {
  const subtotal = Math.round((qty * price - discount) * 100) / 100
  return {
    id: `l-${product.id}-${qty}`,
    productId: product.id,
    name: product.name,
    code: product.code,
    description: product.description,
    qty,
    unit: product.unit,
    unitPrice: price,
    discount,
    subtotal,
  }
}

function quote(
  id: string,
  quotationNo: string,
  date: string,
  customerId: string,
  items: QuoteLine[],
  extras: Partial<Quotation> & { status: Quotation['status'] },
): Quotation {
  const totals = quotationTotals(items, extras.shipping ?? 0, extras.discount ?? 0, extras.tax ?? 0)
  const valid = extras.validUntil ?? new Date(new Date(date).getTime() + 7 * 86400000).toISOString()
  return {
    id,
    quotationNo,
    date,
    validUntil: valid,
    reference: extras.reference ?? '',
    salesperson: extras.salesperson ?? 'Admin',
    customerId,
    items,
    ...totals,
    paymentMethod: extras.paymentMethod ?? defaultSettings().paymentMethod,
    notes: extras.notes ?? defaultSettings().defaultNotes,
    terms: extras.terms ?? defaultSettings().defaultTerms,
    status: extras.status,
  }
}

export function createSeedState() {
  const products = seedProducts()
  const byId = Object.fromEntries(products.map((item) => [item.id, item])) as Record<string, QuoteProduct>
  const notes = defaultSettings().defaultNotes
  const quotations: Quotation[] = [
    quote('q-0211', '2026/0211', iso(7, 15, 11, 51), 'c-gbk', [line(byId['p-waffle'], 250, 7.49)], {
      shipping: 325,
      discount: 122.5,
      status: 'sent',
      salesperson: 'Admin',
      reference: 'GBK-JUL',
      notes,
    }),
    quote('q-0201', '2026/0201', iso(6, 5, 10, 3), 'c-kaki', [line(byId['p-vanilla'], 20), line(byId['p-straw'], 20)], { status: 'accepted', shipping: 0, discount: 0 }),
    quote('q-0204', '2026/0204', iso(6, 18, 14, 20), 'c-abc', [line(byId['p-matcha'], 30), line(byId['p-cup'], 500)], { status: 'accepted', shipping: 80, discount: 40 }),
    quote('q-0208', '2026/0208', iso(7, 2, 9, 10), 'c-fajar', [line(byId['p-choc'], 40)], { status: 'expired', shipping: 120, discount: 0 }),
    quote('q-0212', '2026/0212', iso(8, 4, 16, 40), 'c-xyz', [line(byId['p-waffle'], 80)], { status: 'rejected', shipping: 90, discount: 20 }),
    quote('q-0215', '2026/0215', iso(8, 21, 11, 5), 'c-seri', [line(byId['p-pandan'], 25), line(byId['p-bd'], 12)], { status: 'sent', shipping: 110, discount: 35 }),
    quote('q-0218', '2026/0218', iso(9, 1, 10, 0), 'c-maju', [line(byId['p-waffle'], 400), line(byId['p-cup'], 2000)], { status: 'accepted', shipping: 380, discount: 200 }),
    quote('q-0219', '2026/0219', iso(9, 2, 13, 15), 'c-halo', [line(byId['p-matcha'], 80), line(byId['p-vanilla'], 60)], { status: 'accepted', shipping: 220, discount: 150 }),
    quote('q-0220', '2026/0220', iso(9, 3, 9, 40), 'c-wong', [line(byId['p-wfkg'], 50), line(byId['p-choc'], 20)], { status: 'accepted', shipping: 160, discount: 80 }),
    quote('q-0221', '2026/0221', iso(9, 4, 15, 10), 'c-dapur', [line(byId['p-air'], 35), line(byId['p-ice'], 20)], { status: 'accepted', shipping: 140, discount: 50 }),
    quote('q-0222', '2026/0222', iso(9, 5, 11, 25), 'c-abc', [line(byId['p-straw'], 100), line(byId['p-matcha'], 100)], { status: 'accepted', shipping: 250, discount: 180 }),
    quote('q-0223', '2026/0223', iso(9, 8, 10, 12), 'c-fajar', [line(byId['p-waffle'], 180)], { status: 'accepted', shipping: 200, discount: 90 }),
    quote('q-0224', '2026/0224', iso(9, 9, 14, 50), 'c-maju', [line(byId['p-mt'], 18), line(byId['p-choc'], 24)], { status: 'draft', shipping: 95, discount: 0 }),
    quote('q-0225', '2026/0225', iso(9, 10, 9, 20), 'c-halo', [line(byId['p-vanilla'], 40), line(byId['p-straw'], 40), line(byId['p-matcha'], 20)], { status: 'draft', shipping: 175, discount: 60 }),
  ]

  void PROTOTYPE_TODAY
  return {
    settings: defaultSettings(),
    customers: seedCustomers(),
    products,
    quotations,
  }
}
