// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

afterEach(cleanup)

describe('infra de testes', () => {
  it('renderiza React no jsdom', () => {
    render(<p>pronto pro domingo</p>)
    expect(screen.getByText('pronto pro domingo')).toBeTruthy()
  })
})
