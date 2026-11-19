import { mergeHandlers } from './http.js'
import { handlers as review } from './review.js'
import { handlers as auditList } from './auditList.js'
import { handlers as finance } from './finance.js'
import { handlers as overview } from './overview.js'
import { handlers as subscriberActions } from './subscriberActions.js'
import { handlers as aiCosts } from './aiCosts.js'
import { handlers as subscribers } from './subscribers.js'
import { handlers as funnel } from './funnel.js'

// Todas as ações de /api/admin-stats?action=. Cada módulo tem uma tarefa dona;
// nome repetido entre módulos derruba o carregamento (mergeHandlers).
export const ADMIN_HANDLERS = mergeHandlers(review, auditList, finance, overview, subscriberActions, aiCosts, subscribers, funnel)
