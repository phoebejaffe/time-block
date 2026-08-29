import { expect, test } from '@playwright/test'

async function pointer(
  page: import('@playwright/test').Page,
  type: 'down' | 'move' | 'up',
  point: { x: number; y: number },
) {
  await page.evaluate(({ type, x, y }) => {
    const event = new PointerEvent(`pointer${type}`, {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      buttons: type === 'up' ? 0 : 1,
    })
    if (type === 'down') {
      document.elementFromPoint(x, y)?.dispatchEvent(event)
    } else {
      document.dispatchEvent(event)
    }
  }, { type, ...point })
}

async function dragTaskBeforeThird(page: import('@playwright/test').Page) {
  const panel = page.locator('.e2e-harness-panel')
  const first = page.locator('[data-task-id]').first().locator('.task-card-main')
  const third = page.locator('[data-task-id]').nth(2)
  const firstBox = await first.boundingBox()
  const thirdBox = await third.boundingBox()
  expect(firstBox).not.toBeNull()
  expect(thirdBox).not.toBeNull()
  const start = { x: firstBox!.x + 12, y: firstBox!.y + 12 }
  const target = { x: thirdBox!.x + 12, y: thirdBox!.y + 2 }
  await panel.evaluate((element) => {
    element.scrollTop = 0
  })
  await pointer(page, 'down', start)
  await page.waitForTimeout(170)
  await pointer(page, 'move', target)
  await pointer(page, 'up', target)
  await expect(page.locator('[data-task-id]').nth(1).locator('.task-title-text')).toHaveText('Task 1')
}

test.describe('mobile task dragging and scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('reorders a task by touch drag in planning mode', async ({ page }) => {
    await dragTaskBeforeThird(page)
  })

  test('reorders a task by touch drag in execution mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Execution mode' }).click()
    await dragTaskBeforeThird(page)
  })

  test('scrolls when swiping from a task title before the hold delay', async ({ page }) => {
    const panel = page.locator('.e2e-harness-panel')
    const title = page.locator('[data-task-id]').first().locator('.task-card-main')
    const box = await title.boundingBox()
    expect(box).not.toBeNull()
    await panel.evaluate((element) => {
      element.scrollTop = 200
    })
    const before = await panel.evaluate((element) => element.scrollTop)
    const point = { x: box!.x + 12, y: box!.y + 12 }
    await pointer(page, 'down', point)
    await page.waitForTimeout(40)
    await pointer(page, 'move', { x: point.x, y: point.y + 80 })
    await pointer(page, 'up', { x: point.x, y: point.y + 80 })
    const after = await panel.evaluate((element) => element.scrollTop)
    expect(after).toBeLessThan(before)
    await expect(page.locator('[data-task-id]').first().locator('.task-title-text')).toHaveText('Task 1')
  })

  test('keeps the empty part of a task row scrollable', async ({ page }) => {
    const row = page.locator('[data-task-id]').first()
    await expect(row).toHaveCSS('touch-action', 'pan-y')
    await expect(row.locator('.task-card-main')).toHaveCSS('touch-action', 'none')
  })

  test('reorders a library block by touch drag', async ({ page }) => {
    await page.getByRole('button', { name: 'Open block library' }).click()
    const first = page.locator('[data-block-id]').first().locator('.task-card-main')
    const third = page.locator('[data-block-id]').nth(2)
    const firstBox = await first.boundingBox()
    const thirdBox = await third.boundingBox()
    expect(firstBox).not.toBeNull()
    expect(thirdBox).not.toBeNull()
    const start = { x: firstBox!.x + 12, y: firstBox!.y + 12 }
    const target = { x: thirdBox!.x + 12, y: thirdBox!.y + 2 }
    await pointer(page, 'down', start)
    await page.waitForTimeout(170)
    await pointer(page, 'move', target)
    await pointer(page, 'up', target)
    await expect(page.locator('[data-block-id]').nth(1).locator('.task-title-text')).toHaveText('Library 1')
  })
})
