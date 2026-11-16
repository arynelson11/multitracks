import { describe, expect, it } from 'vitest'
import { ensureEmailOnlyNotifications } from '../_lib/asaas.js'
import { createFakeAsaas } from './billingHarness.js'

// Avisos do próprio Asaas ao cliente: só por e-mail (SMS, ligação e WhatsApp
// têm tarifa por envio). Vencimento e atraso ficam ligados por e-mail.
// Formato e padrões: docs.asaas.com, "Notificações padrões".

const defaults = [
  { id: 'n1', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: true, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false },
  { id: 'n2', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 0, enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: true, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false },
  { id: 'n3', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 10, enabled: false, emailEnabledForCustomer: false, smsEnabledForCustomer: false, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false },
  { id: 'n4', event: 'PAYMENT_OVERDUE', scheduleOffset: 0, enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: true, phoneCallEnabledForCustomer: true, whatsappEnabledForCustomer: false },
  { id: 'n5', event: 'PAYMENT_RECEIVED', scheduleOffset: 0, enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: false, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false },
]

describe('ensureEmailOnlyNotifications', () => {
  it('desliga SMS e ligação de todas e mantém vencimento e atraso ligados por e-mail', async () => {
    const asaas = createFakeAsaas({ get: () => ({ data: defaults }) })
    const changed = await ensureEmailOnlyNotifications(asaas, 'cus_1')
    expect(asaas.get).toHaveBeenCalledWith('/customers/cus_1/notifications')
    expect(changed).toBe(4)
    const [path, body] = asaas.put.mock.calls[0] as [string, { customer: string; notifications: Record<string, unknown>[] }]
    expect(path).toBe('/notifications/batch')
    expect(body.customer).toBe('cus_1')
    const byId = Object.fromEntries(body.notifications.map((n) => [n.id, n]))
    for (const n of body.notifications) {
      expect(n).toMatchObject({ smsEnabledForCustomer: false, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false })
    }
    expect(byId.n2).toMatchObject({ enabled: true, emailEnabledForCustomer: true })
    expect(byId.n3).toMatchObject({ enabled: true, emailEnabledForCustomer: true })
    expect(byId.n4).toMatchObject({ enabled: true, emailEnabledForCustomer: true })
    // aviso que não é de vencimento: só tira o SMS, não liga nem desliga o e-mail
    expect(byId.n1).not.toHaveProperty('enabled')
    expect(byId.n5).toBeUndefined()
  })

  it('já está só por e-mail: não altera nada', async () => {
    const emailOnly = defaults.map((n) => ({ ...n, enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: false, phoneCallEnabledForCustomer: false }))
    const asaas = createFakeAsaas({ get: () => ({ data: emailOnly }) })
    expect(await ensureEmailOnlyNotifications(asaas, 'cus_1')).toBe(0)
    expect(asaas.put).not.toHaveBeenCalled()
  })
})
