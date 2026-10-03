// @vitest-environment jsdom
/**
 * The body: the current stage, the transition history in log order, and the
 * empty state before the first record.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from './helpers.ts'
import { StageBody } from '../src/client/StageBody.tsx'
import type { StageView } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

function bodyOf(view: StageView) {
  const useStage = <T,>(selector: (state: StageView) => T): T => selector(view)
  return render(createElement(StageBody, { useStage, t } as never))
}

describe('StageBody', () => {
  it('renders the empty state before the first record', () => {
    const { container } = bodyOf({ current: undefined, records: [] })
    expect(container.querySelector('[data-stage-empty]')?.textContent).toBe(zh.empty)
    expect(container.querySelector('[data-stage-current]')).toBeNull()
  })

  it('renders the current stage and the history in log order', () => {
    const { container } = bodyOf({
      current: 'design',
      records: [
        { stage: 'route', seq: 1, time: 0, switched: false },
        { stage: 'design', seq: 2, time: 0, switched: true },
      ],
    })
    expect(container.querySelector('[data-stage-current]')?.textContent).toBe('design')
    const items = [...container.querySelectorAll('[data-stage-history] li')].map(item => item.textContent)
    expect(items).toEqual([`${zh.entered} route`, `${zh.switched} design`])
  })
})
