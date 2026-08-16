import { describe, expect, it } from 'vitest'
import {
  isMenuColorPickerActive,
  subscribeMenuOutsideClose,
} from './menuDismiss'

describe('isMenuColorPickerActive', () => {
  it('is false when focus is not a color input', () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    expect(isMenuColorPickerActive(() => true)).toBe(false)
    button.remove()
  })

  it('is true when a color input inside the menu is focused', () => {
    const input = document.createElement('input')
    input.type = 'color'
    document.body.append(input)
    input.focus()
    expect(isMenuColorPickerActive((node) => node === input)).toBe(true)
    input.remove()
  })

  it('is false when a color input outside the menu is focused', () => {
    const input = document.createElement('input')
    input.type = 'color'
    document.body.append(input)
    input.focus()
    expect(isMenuColorPickerActive(() => false)).toBe(false)
    input.remove()
  })
})

describe('subscribeMenuOutsideClose', () => {
  it('does not activate the control used to dismiss the menu', () => {
    const button = document.createElement('button')
    let clicks = 0
    let closed = 0
    button.addEventListener('click', () => {
      clicks += 1
    })
    document.body.append(button)

    const unsubscribe = subscribeMenuOutsideClose(() => false, () => {
      closed += 1
    })
    button.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    unsubscribe()
    button.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )

    expect(closed).toBe(1)
    expect(clicks).toBe(0)
    button.remove()
  })
})
