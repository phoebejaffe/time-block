import { expect, test } from '@playwright/test'
import { formatCalendarDay } from '../src/lib/tasks'

/**
 * Toggling Starts ↔ Ends on a midnight-crossing plan moves the calendar view
 * to the new anchor's day while keeping the resolved stack (and its pushed
 * events) on the same calendar days.
 */
test.describe('overnight plan anchor toggle', () => {
  test('view follows the anchor day and pushed events stay tracked', async ({
    page,
  }) => {
    await page.goto('/?e2e=toggle-day')

    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const title = page.locator('.calendar-title')
    const commit = page.locator('.task-new-commit')
    const toEnds = page.getByRole('button', { name: /tap to anchor from end/ })
    const toStarts = page.getByRole('button', {
      name: /tap to anchor from start/,
    })

    // Starts at 22:00 today — the stack ends 00:30 tomorrow.
    await expect(title).toHaveText(formatCalendarDay(today))
    await expect(commit).toHaveText(/Update calendar/)

    // Ends: the anchor lands on tomorrow, so the view follows — the stack
    // (22:00 → 00:30) and its pushed events stay on the same days.
    await toEnds.click()
    await expect(title).toHaveText(formatCalendarDay(tomorrow))
    await expect(commit).toHaveText(/Update calendar/)

    // Starts again: the anchor lands back on today, and the view follows back.
    await toStarts.click()
    await expect(title).toHaveText(formatCalendarDay(today))
    await expect(commit).toHaveText(/Update calendar/)
  })
})
