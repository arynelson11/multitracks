import { describe, expect, it } from 'vitest'
import {
  BILLING_CONTINUES,
  LEGACY_BILLING_WARNING,
  LEGACY_COURTESY_WARNING,
  LEGACY_STOPPED_LABEL,
  blockText,
  cancelText,
  changePlanText,
  courtesyLastDay,
  courtesyPlanKeys,
  courtesyText,
  doneText,
  endCourtesyText,
  hasLegacyCharge,
  isFuture,
  isLegacyPaid,
  lastDayOf,
  noCourtesyText,
  onlyHigherText,
  quotaText,
  unblockText,
} from './actionText'

const TRAVESSAO = String.fromCharCode(0x2014)
// O Intl põe espaço fixo (U+00A0) entre R$ e o número.
const norm = (s: string) => s.replace(/\u00a0/g, ' ')

const PRO_MENSAL = { label: 'Pro Mensal', value: 49.9, cycle: 'MONTHLY' }
const STUDIO_MENSAL = { label: 'Studio Mensal', value: 119.9, cycle: 'MONTHLY' }
const PRO_ANUAL = { label: 'Pro Anual', value: 454.8, cycle: 'YEARLY' }

describe('changePlanText', () => {
  it('diz o efeito no Asaas com os preços da tabela e a data da próxima cobrança', () => {
    expect(norm(changePlanText(PRO_MENSAL, STUDIO_MENSAL, '2026-12-16'))).toBe(
      'A assinatura no Asaas passa de Pro Mensal (R$ 49,90 por mês) para Studio Mensal (R$ 119,90 por mês) a partir da próxima cobrança, em 16/12/2026. O acesso muda agora. Não há cobrança nem desconto proporcional.',
    )
  })

  it('anual escreve por ano', () => {
    expect(norm(changePlanText(PRO_MENSAL, PRO_ANUAL, '2026-12-16'))).toContain('para Pro Anual (R$ 454,80 por ano) a partir')
  })

  it('sem data fica só a partir da próxima cobrança', () => {
    expect(norm(changePlanText(PRO_MENSAL, STUDIO_MENSAL, null))).toBe(
      'A assinatura no Asaas passa de Pro Mensal (R$ 49,90 por mês) para Studio Mensal (R$ 119,90 por mês) a partir da próxima cobrança. O acesso muda agora. Não há cobrança nem desconto proporcional.',
    )
  })

  it('plano sem preço conhecido aparece só com o nome', () => {
    expect(norm(changePlanText({ label: 'plano_x', value: null, cycle: null }, STUDIO_MENSAL, null))).toContain('passa de plano_x para Studio Mensal')
  })
})

describe('courtesyText', () => {
  it('com data e sem paga: volta sozinha para o Livre', () => {
    expect(courtesyText('pro_anual', '2026-12-16', null)).toBe(
      'Studio Anual sem cobrança até 16/12/2026 (fim do dia). Nada muda no Asaas. No fim, a conta volta sozinha para o Livre.',
    )
  })

  it('com paga: no fim volta para a paga, que continua sendo cobrada', () => {
    expect(courtesyText('pro_anual', '2026-12-16', 'essencial_mensal')).toBe(
      'Studio Anual sem cobrança até 16/12/2026 (fim do dia). Nada muda no Asaas. No fim, a conta volta para o Pro Mensal, que continua sendo cobrado normalmente.',
    )
  })

  it('sem data: manda usar Encerrar cortesia', () => {
    expect(courtesyText('pro_anual', null, null)).toBe(
      'Studio Anual sem cobrança e sem data para acabar. Nada muda no Asaas. Para encerrar, use Encerrar cortesia.',
    )
  })

})

// Ruling ADM-FINAL-onda: a mesma fórmula do servidor (courtesyRefusal).
describe('courtesyPlanKeys', () => {
  const ALL = ['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']

  it('sem paga ativa: todos os planos', () => {
    expect(courtesyPlanKeys(ALL, [])).toEqual(ALL)
  })

  it('com paga ativa: só os de nível maior que o pago', () => {
    expect(courtesyPlanKeys(ALL, ['essencial_mensal'])).toEqual(['pro_mensal', 'pro_anual'])
    // O mesmo nível (mensal e anual do Pro) não entra.
    expect(courtesyPlanKeys(ALL, ['essencial_anual'])).toEqual(['pro_mensal', 'pro_anual'])
    // Quem paga Studio não tem plano maior.
    expect(courtesyPlanKeys(ALL, ['pro_mensal'])).toEqual([])
    expect(courtesyPlanKeys(ALL, ['pro_anual'])).toEqual([])
  })

  it('com duas pagas ativas vale a de nível mais alto', () => {
    expect(courtesyPlanKeys(ALL, ['essencial_mensal', 'pro_anual'])).toEqual([])
  })

  it('as frases dizem o plano pago e por que só o maior', () => {
    expect(onlyHigherText('essencial_mensal')).toBe(
      'Só planos maiores que o Pro Mensal pago: cortesia de plano igual ou menor não muda nada agora e, se a assinatura for cancelada, pode tirar o plano pago antes da hora.',
    )
    expect(noCourtesyText('pro_anual')).toBe(
      'Dar cortesia não aparece: esta conta já paga o Studio Anual, e a cortesia só pode ser de plano maior que o pago.',
    )
  })
})

describe('courtesyLastDay', () => {
  it('é hoje mais N dias em Brasília', () => {
    // 22:00 de 16/11 em Brasília já é 17/11 em UTC: o último dia de 30 dias é 16/12.
    expect(courtesyLastDay(30, new Date('2026-11-17T01:00:00Z'))).toBe('2026-12-16')
    expect(courtesyLastDay(7, new Date('2026-11-30T12:00:00Z'))).toBe('2026-12-07')
  })
})

describe('endCourtesyText', () => {
  it('sem paga: volta para o Livre', () => {
    expect(endCourtesyText('pro_anual', { kind: 'free' })).toBe('A cortesia de Studio Anual acaba agora. Nada muda no Asaas. A conta volta para o Livre.')
  })

  it('com paga: volta para a paga', () => {
    expect(endCourtesyText('pro_anual', { kind: 'paid', planKey: 'essencial_mensal' })).toBe(
      'A cortesia de Studio Anual acaba agora. Nada muda no Asaas. A conta volta para o Pro Mensal pago.',
    )
  })

  it('com paga cancelada ainda no período: volta para ela até o último dia', () => {
    expect(endCourtesyText('pro_anual', { kind: 'paid_until', planKey: 'essencial_mensal', lastDay: '2026-12-16' })).toBe(
      'A cortesia de Studio Anual acaba agora. Nada muda no Asaas. A conta volta para o Pro Mensal pago até 16/12/2026 e depois para o Livre.',
    )
  })

  it('com outra cortesia ativa: fica com ela', () => {
    expect(endCourtesyText('pro_anual', { kind: 'courtesy', planKey: 'essencial_mensal' })).toBe(
      'A cortesia de Studio Anual acaba agora. Nada muda no Asaas. A conta fica com a outra cortesia, de Pro Mensal.',
    )
  })
})

describe('cancelText', () => {
  it('no fim do período: para a renovação e mantém o plano até o último dia', () => {
    expect(cancelText('period_end', 'essencial_mensal', '2026-12-16')).toBe(
      'A renovação para agora no Asaas e nada mais é cobrado. A conta continua no Pro Mensal até 16/12/2026 e depois volta para o Livre. Nenhum estorno é feito.',
    )
  })

  it('no fim do período sem período pago pela frente: volta para o Livre agora', () => {
    expect(cancelText('period_end', 'essencial_mensal', null)).toBe(
      'A renovação para agora no Asaas e nada mais é cobrado. Não há período pago pela frente, então a conta volta para o Livre agora. Nenhum estorno é feito.',
    )
  })

  it('agora: remove no Asaas, sem estorno, e manda estornar no painel', () => {
    expect(cancelText('now', 'essencial_mensal', '2026-12-16')).toBe(
      'A assinatura é removida no Asaas agora e a conta volta para o Livre na hora. Nenhum estorno é feito; se precisar devolver dinheiro, estorne no painel do Asaas.',
    )
  })
})

describe('lastDayOf', () => {
  it('o fim guardado é o começo do dia seguinte: o último dia é o anterior', () => {
    expect(lastDayOf('2026-12-17T03:00:00+00:00')).toBe('2026-12-16')
    expect(lastDayOf('2026-12-17T00:00:00-03:00')).toBe('2026-12-16')
    expect(lastDayOf(null)).toBeNull()
    expect(lastDayOf('qualquer coisa')).toBeNull()
  })
})

describe('isFuture', () => {
  it('só o instante que ainda não chegou', () => {
    const now = new Date('2026-11-17T12:00:00Z')
    expect(isFuture('2026-11-17T12:00:01Z', now)).toBe(true)
    expect(isFuture('2026-11-17T12:00:00Z', now)).toBe(false)
    expect(isFuture('2026-11-17T08:59:59-03:00', now)).toBe(false)
    expect(isFuture(null, now)).toBe(false)
    expect(isFuture('sem data', now)).toBe(false)
  })
})

describe('isLegacyPaid', () => {
  const NOW = new Date('2026-11-17T12:00:00Z')
  const asaas = { kind: 'asaas', status: 'canceled', accessUntil: '2026-10-01T03:00:00Z' }
  const courtesy = (accessUntil: string | null, status = 'active') => ({ kind: 'courtesy', status, accessUntil })

  it('plano pago valendo, sem linha no Asaas e sem cortesia ativa: assinante antigo (a regra da lista)', () => {
    expect(isLegacyPaid({ plan: 'essencial_mensal', planExpiresAt: null }, [], NOW)).toBe(true)
    expect(isLegacyPaid({ plan: 'pro_anual', planExpiresAt: '2026-12-01T03:00:00Z' }, [], NOW)).toBe(true)
    // Cortesia que já acabou ou foi encerrada não conta.
    expect(isLegacyPaid({ plan: 'pro_mensal', planExpiresAt: null }, [courtesy('2026-11-01T03:00:00Z'), courtesy(null, 'canceled')], NOW)).toBe(true)
  })

  it('não é antigo: Livre, plano vencido, qualquer linha no Asaas ou cortesia ativa', () => {
    expect(isLegacyPaid({ plan: 'free', planExpiresAt: null }, [], NOW)).toBe(false)
    expect(isLegacyPaid({ plan: 'gratuito', planExpiresAt: null }, [], NOW)).toBe(false)
    expect(isLegacyPaid({ plan: 'essencial_mensal', planExpiresAt: '2026-11-17T12:00:00Z' }, [], NOW)).toBe(false)
    expect(isLegacyPaid({ plan: 'essencial_mensal', planExpiresAt: null }, [asaas], NOW)).toBe(false)
    expect(isLegacyPaid({ plan: 'pro_anual', planExpiresAt: null }, [courtesy(null)], NOW)).toBe(false)
    expect(isLegacyPaid({ plan: 'pro_anual', planExpiresAt: null }, [courtesy('2026-12-01T03:00:00Z')], NOW)).toBe(false)
  })
})

describe('hasLegacyCharge', () => {
  const NOW = new Date('2026-11-17T12:00:00Z')
  const old = { id: 'chk_old', planKey: 'essencial_mensal' }
  const row = (over: Partial<{ id: string; kind: string; status: string; accessUntil: string | null }> = {}) => ({
    id: 'cortesia:1', kind: 'courtesy', status: 'active', accessUntil: null, ...over,
  })

  it('a regra do servidor: sem paga ativa, plano pago valendo e pagamento antigo que não virou linha', () => {
    expect(hasLegacyCharge({ plan: 'essencial_mensal', planExpiresAt: null }, [], [old], NOW)).toBe(true)
    // Com cortesia ativa também (o perfil fica no plano da cortesia): é o caso do Encerrar cortesia.
    expect(hasLegacyCharge({ plan: 'pro_anual', planExpiresAt: null }, [row()], [old], NOW)).toBe(true)
    // Paga da Fase 3 cancelada não adota o checkout antigo.
    expect(hasLegacyCharge({ plan: 'pro_mensal', planExpiresAt: '2026-12-01T03:00:00Z' }, [row({ id: 'chk_new', kind: 'asaas', status: 'canceled', accessUntil: '2026-12-01T03:00:00Z' })], [old], NOW)).toBe(true)
  })

  it('não tem: paga ativa, pagamento já adotado, plano Livre ou vencido, sem pagamento antigo de plano pago', () => {
    expect(hasLegacyCharge({ plan: 'essencial_mensal', planExpiresAt: null }, [row({ id: 'chk_new', kind: 'asaas' })], [old], NOW)).toBe(false)
    expect(hasLegacyCharge({ plan: 'essencial_mensal', planExpiresAt: null }, [row({ id: 'chk_old', kind: 'asaas', status: 'canceled' })], [old], NOW)).toBe(false)
    expect(hasLegacyCharge({ plan: 'free', planExpiresAt: null }, [], [old], NOW)).toBe(false)
    expect(hasLegacyCharge({ plan: 'essencial_mensal', planExpiresAt: '2026-11-17T12:00:00Z' }, [], [old], NOW)).toBe(false)
    expect(hasLegacyCharge({ plan: 'essencial_mensal', planExpiresAt: null }, [], [], NOW)).toBe(false)
    expect(hasLegacyCharge({ plan: 'essencial_mensal', planExpiresAt: null }, [], [{ id: 'x', planKey: 'free' }], NOW)).toBe(false)
  })
})

describe('blockText e unblockText', () => {
  it('bloquear diz o que a pessoa perde', () => {
    expect(blockText(false)).toBe('A pessoa perde o acesso ao app agora: separar, biblioteca em nuvem, enviar arquivos e assinar.')
  })

  it('com paga ativa avisa que a cobrança continua', () => {
    expect(BILLING_CONTINUES).toBe('A cobrança no Asaas continua. Para parar de cobrar, cancele a assinatura também.')
    expect(blockText(true)).toBe(
      'A pessoa perde o acesso ao app agora: separar, biblioteca em nuvem, enviar arquivos e assinar. A cobrança no Asaas continua. Para parar de cobrar, cancele a assinatura também.',
    )
  })

  it('assinante antigo: o aviso da cobrança antiga', () => {
    expect(LEGACY_BILLING_WARNING).toBe(
      'Esta conta pode ter uma cobrança antiga no Asaas que o app não controla. Bloquear não para essa cobrança; confira no painel do Asaas.',
    )
    expect(LEGACY_BILLING_WARNING).not.toContain(TRAVESSAO)
  })

  it('assinante antigo na cortesia: o aviso e a caixa', () => {
    expect(LEGACY_COURTESY_WARNING).toBe(
      'Esta conta tem uma cobrança antiga no Asaas que o app não controla. A cortesia muda o plano no app, mas não para essa cobrança.',
    )
    expect(LEGACY_STOPPED_LABEL).toBe('Já parei a cobrança antiga no painel do Asaas')
  })

  it('desbloquear', () => {
    expect(unblockText()).toBe('O acesso volta agora. Nada muda no Asaas.')
  })
})

describe('quotaText', () => {
  it('zerar', () => {
    expect(quotaText('reset', 4, 5, 0, null, '2026-11-30')).toBe('O contador deste mês volta de 4 para 0 (limite 5). Nada muda no Asaas.')
  })

  it('somar', () => {
    expect(quotaText('add', 4, 5, 0, 10, '2026-11-30')).toBe(
      'Mais 10 separações só neste mês: o limite vai de 5 para 15 até 30/11/2026. Nada muda no Asaas.',
    )
  })

  it('o extra que já existe conta no limite, e 1 fica no singular', () => {
    expect(quotaText('add', 4, 5, 10, 1, '2026-11-30')).toBe(
      'Mais 1 separação só neste mês: o limite vai de 15 para 16 até 30/11/2026. Nada muda no Asaas.',
    )
    expect(quotaText('reset', 4, 5, 10, null, '2026-11-30')).toBe('O contador deste mês volta de 4 para 0 (limite 15). Nada muda no Asaas.')
  })
})

describe('doneText', () => {
  it('sucesso comum é Feito.', () => {
    expect(doneText('block', { result: 'blocked' })).toBe('Feito.')
    expect(doneText('change-plan', { result: 'changed', planKey: 'pro_mensal' })).toBe('Feito.')
    expect(doneText('cancel-subscription', { result: 'canceled', accessUntil: null, pendingStop: false })).toBe('Feito.')
    expect(doneText('adjust-quota', null)).toBe('Feito.')
  })

  it('o que já estava feito diz que nada mudou', () => {
    expect(doneText('change-plan', { result: 'unchanged', planKey: 'pro_mensal' })).toBe('Feito. A conta já estava neste plano; nada mudou.')
    expect(doneText('cancel-subscription', { result: 'already_canceled', accessUntil: null, pendingStop: false })).toBe(
      'Feito. A assinatura já estava cancelada; nada mudou.',
    )
    expect(doneText('end-courtesy', { result: 'already_canceled' })).toBe('Feito. A cortesia já estava encerrada; nada mudou.')
  })

  it('parar a cobrança pendente avisa que o app tenta de novo sozinho', () => {
    expect(doneText('cancel-subscription', { result: 'canceled', accessUntil: '2026-12-17T03:00:00Z', pendingStop: true })).toBe(
      'Feito. Parar a cobrança no Asaas ficou pendente e o app tenta de novo sozinho; acompanhe em Pendências.',
    )
  })
})

describe('sem travessão', () => {
  it('nenhuma frase tem o caractere', () => {
    const all = [
      changePlanText(PRO_MENSAL, STUDIO_MENSAL, '2026-12-16'),
      changePlanText(PRO_MENSAL, PRO_ANUAL, null),
      courtesyText('pro_anual', '2026-12-16', null),
      courtesyText('pro_anual', '2026-12-16', 'essencial_mensal'),
      courtesyText('pro_anual', null, null),
      onlyHigherText('essencial_mensal'),
      noCourtesyText('pro_mensal'),
      endCourtesyText('pro_anual', { kind: 'free' }),
      endCourtesyText('pro_anual', { kind: 'paid', planKey: 'essencial_mensal' }),
      endCourtesyText('pro_anual', { kind: 'paid_until', planKey: 'essencial_mensal', lastDay: '2026-12-16' }),
      endCourtesyText('pro_anual', { kind: 'courtesy', planKey: 'essencial_mensal' }),
      cancelText('period_end', 'essencial_mensal', '2026-12-16'),
      cancelText('period_end', 'essencial_mensal', null),
      cancelText('now', 'essencial_mensal', null),
      blockText(true),
      unblockText(),
      quotaText('reset', 4, 5, 0, null, '2026-11-30'),
      quotaText('add', 4, 5, 0, 10, '2026-11-30'),
      doneText('cancel-subscription', { result: 'canceled', pendingStop: true }),
      doneText('change-plan', { result: 'unchanged' }),
    ]
    for (const text of all) expect(text).not.toContain(TRAVESSAO)
  })
})
