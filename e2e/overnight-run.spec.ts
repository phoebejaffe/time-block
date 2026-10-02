import { expect, test } from '@playwright/test'
import { formatCalendarDay } from '../src/lib/tasks'

test.describe('overnight run started just after midnight', () => {
  test('keeps the in-progress occurrence on the day it started', async ({
    page,
  }) => {
    const now = new Date()
    now.setHours(0, 15, 0, 0)
    await page.clock.install({ time: now })
    await page.goto('/?e2e=overnight-run')

    await page.getByRole('button', { name: 'Start overnight run' }).click()
    const modal = page.getByRole('dialog', { name: /Running/ })
    await expect(modal).toBeVisible()

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)

    // The stack began yesterday evening: the run calendar opens on that day,
    // not a fresh copy one day forward.
    await expect(modal.locator('.calendar-title')).toHaveText(
      formatCalendarDay(yesterday),
    )

    // The plan was already pushed under yesterday's day key, so the commit CTA
    // must offer to update those events — not add a duplicate set on today.
    await expect(modal.locator('.task-new-commit')).toHaveText(
      /Update calendar/,
    )

    // ‹ › navigation spans the occupied days: blocked before the start day,
    // free to step forward into today.
    const prev = modal.getByRole('button', { name: 'Previous' })
    const next = modal.getByRole('button', { name: 'Next' })
    await expect(prev).toBeDisabled()
    await next.click()
    await expect(modal.locator('.calendar-title')).toHaveText(
      formatCalendarDay(now),
    )
    await expect(next).toBeDisabled()
    await prev.click()
    await expect(modal.locator('.calendar-title')).toHaveText(
      formatCalendarDay(yesterday),
    )
  })
})
