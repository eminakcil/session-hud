import { expect, test } from 'claude-code/testing'

import { PALETTES, bar, paceBar, schemeOf, svg } from '../hooks/icons'

test('light theme values pick the light palette, anything else dark', () => {
  expect(schemeOf('light')).toBe('light')
  expect(schemeOf('light-daltonized')).toBe('light')
  expect(schemeOf('dark')).toBe('dark')
  expect(schemeOf('auto')).toBe('dark')
  expect(schemeOf(undefined)).toBe('dark')
})

test('icons and bars draw in the scheme they are given', () => {
  expect(svg('cache', 'icon', undefined, 'light')).toContain(PALETTES.light.icon)
  expect(svg('cache')).toContain(PALETTES.dark.icon)
  expect(bar(0.5, 'success', 400, 6, 'light')).toContain(PALETTES.light.success)
  expect(paceBar(0.5, 0.5, 'warning', 44, 8, undefined, 'light')).toContain(PALETTES.light.time)
})
