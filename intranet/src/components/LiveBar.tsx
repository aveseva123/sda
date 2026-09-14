// Плавающая строка с итогами для телефона: видна, пока двигаешь ползунки в разделе финмодели
import type { ModelResult } from '../model/finance'
import { usdRangeShort } from '../lib/format'

export function LiveBar({ model, visible }: { model: ModelResult; visible: boolean }) {
  if (!visible) return null
  const inv = model.base.investment
  const C = model.constants
  return (
    <div className="print-hide lg:hidden fixed inset-x-0 bottom-0 z-30 px-3 pb-3" aria-live="polite">
      <div className="glass px-4 py-2.5 flex items-center justify-between gap-3 text-xs" style={{ background: 'rgba(12,12,14,0.92)' }}>
        <div>
          <span className="block text-muted">Инвестиция</span>
          <span className="text-base font-semibold text-amber tabular-nums">{usdRangeShort(inv.total.min, inv.total.max)}</span>
        </div>
        <div>
          <span className="block text-muted">Ноль</span>
          <span className="text-base font-semibold tabular-nums">{inv.zeroMonth ? `мес ${inv.zeroMonth}` : `нет за ${C.horizonMonths}`}</span>
        </div>
        <div>
          <span className="block text-muted">Окупаемость</span>
          <span className="text-base font-semibold tabular-nums">{model.base.payback ? `${model.base.payback} мес` : `нет за ${C.paybackSearchMonths}`}</span>
        </div>
      </div>
    </div>
  )
}
