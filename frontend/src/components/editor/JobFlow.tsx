import { useState } from 'react'

import type { Layout } from '../../editor/types'

interface Props {
  layout: Layout
  busy: boolean
  onTake: (operator: string) => void
  onCheck: (key: string, done: boolean) => void
  onFinish: () => void
}

const STAGE_TITLE: Record<string, string> = {
  planning: 'Раскладка',
  in_progress: 'В работе',
  finished: 'Завершён',
}

/**
 * Жизнь листа: взял в работу → чеклист → раскрой завершён.
 *
 * Чеклист не формальность: неразмеченные детали в цеху никто не опознает, а
 * несосчитанные всплывут на сборке. Поэтому «Раскрой завершён» доступен
 * только когда отмечены все три пункта.
 */
export default function JobFlow({ layout, busy, onTake, onCheck, onFinish }: Props) {
  const [operator, setOperator] = useState('')
  const { stage, checklist } = layout.job
  const left = checklist.filter((item) => !item.done).length

  if (stage === 'planning') {
    return (
      <div className="sec">
        <div className="lbl" style={{ marginBottom: 9 }}>
          Работа с листом
        </div>
        <div className="row tight">
          <input
            className="grow"
            placeholder="Имя оператора"
            value={operator || layout.job.operator || ''}
            onChange={(event) => setOperator(event.target.value)}
          />
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onTake(operator || layout.job.operator || '')}
          >
            Взял в работу
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Учётных записей нет — оператор просто называет себя. Имя останется в
          журнале листа и попадёт на стикеры.
        </div>
      </div>
    )
  }

  return (
    <div className="sec">
      <div className="sec-head">
        <span className="lbl">Работа с листом</span>
        <span className={`badge ${stage === 'finished' ? 'ok' : 'plain'}`} style={{ marginLeft: 'auto' }}>
          {STAGE_TITLE[stage] ?? stage}
        </span>
      </div>

      <div className="small muted" style={{ marginBottom: 9 }}>
        Оператор: <b style={{ color: 'var(--ink)' }}>{layout.job.operator ?? '—'}</b>
      </div>

      <div className="checklist">
        {checklist.map((item) => (
          <label className={`check-row${item.done ? ' done' : ''}`} key={item.key}>
            <input
              type="checkbox"
              checked={item.done}
              disabled={busy || stage === 'finished'}
              onChange={(event) => onCheck(item.key, event.target.checked)}
            />
            {item.title}
          </label>
        ))}
      </div>

      {stage !== 'finished' && (
        <>
          <button
            type="button"
            className="primary"
            style={{ width: '100%', marginTop: 10 }}
            disabled={busy || left > 0}
            onClick={onFinish}
          >
            Раскрой завершён
          </button>
          {left > 0 && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Осталось отметить: {left}. Пока пункт не закрыт, раскрой не
              завершается.
            </div>
          )}
        </>
      )}
    </div>
  )
}
