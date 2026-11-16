// Supabase falso, em memória, só pros testes do backend (nenhuma chamada de rede).
// Cobre o pedaço do query builder que o api/ usa: select/eq/in/neq/order/limit,
// maybeSingle/single, insert, upsert, update, delete e rpc. A pasta começa com
// sublinhado, então a Vercel não transforma estes arquivos em função.

export type Row = Record<string, unknown>
export type DbError = { message: string; code?: string }
export type DbResult = { data: unknown; error: DbError | null }
export type RpcHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>

type Filter = { col: string; op: 'eq' | 'in' | 'neq'; value: unknown }

export type FakeDbOptions = {
  tables?: Record<string, Row[]>
  primaryKeys?: Record<string, string>
  rpc?: Record<string, RpcHandler>
}

export type FakeDb = {
  tables: Record<string, Row[]>
  rpcCalls: { name: string; args: Record<string, unknown> }[]
  writes: { table: string; op: 'insert' | 'upsert' | 'update' | 'delete'; payload: unknown }[]
  failTable: (table: string, error: DbError) => void
  setRpc: (name: string, handler: RpcHandler) => RpcHandler | undefined
  from: (table: string) => QueryBuilder
  rpc: (name: string, args?: Record<string, unknown>) => Promise<DbResult>
}

const DEFAULT_PKS: Record<string, string> = {
  profiles: 'id',
  pending_checkouts: 'id',
  payments: 'id',
  billing_subscriptions: 'id',
  billing_payments: 'asaas_payment_id',
  asaas_webhook_events: 'id',
}

class QueryBuilder implements PromiseLike<DbResult> {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private payload: unknown = null
  private onConflict: string | null = null
  private ignoreDuplicates = false
  private singleMode: 'maybe' | 'one' | null = null
  private orderBy: { col: string; ascending: boolean } | null = null
  private limitN: number | null = null
  private returning = false

  constructor(private readonly db: FakeDbImpl, private readonly table: string) {}

  select(cols?: string): this {
    void cols // as colunas não importam no falso: devolve a linha inteira
    if (this.op !== 'select') this.returning = true
    return this
  }
  insert(payload: Row | Row[]): this { this.op = 'insert'; this.payload = payload; return this }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = 'upsert'; this.payload = payload
    this.onConflict = opts?.onConflict ?? null
    this.ignoreDuplicates = !!opts?.ignoreDuplicates
    return this
  }
  update(payload: Row): this { this.op = 'update'; this.payload = payload; return this }
  delete(): this { this.op = 'delete'; return this }
  eq(col: string, value: unknown): this { this.filters.push({ col, op: 'eq', value }); return this }
  neq(col: string, value: unknown): this { this.filters.push({ col, op: 'neq', value }); return this }
  in(col: string, value: unknown[]): this { this.filters.push({ col, op: 'in', value }); return this }
  order(col: string, opts?: { ascending?: boolean }): this { this.orderBy = { col, ascending: opts?.ascending ?? true }; return this }
  limit(n: number): this { this.limitN = n; return this }
  maybeSingle(): this { this.singleMode = 'maybe'; return this }
  single(): this { this.singleMode = 'one'; return this }

  then<A = DbResult, B = never>(onOk?: ((v: DbResult) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(onOk, onErr)
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      if (f.op === 'eq') return row[f.col] === f.value
      if (f.op === 'neq') return row[f.col] !== f.value
      return Array.isArray(f.value) && f.value.includes(row[f.col])
    })
  }

  private run(): DbResult {
    const failure = this.db.failures.get(this.table)
    if (failure) return { data: null, error: failure }
    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = [])
    const pk = this.db.primaryKeys[this.table] ?? 'id'

    if (this.op === 'select') {
      let out = rows.filter((r) => this.matches(r)).map((r) => ({ ...r }))
      if (this.orderBy) {
        const { col, ascending } = this.orderBy
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (ascending ? 1 : -1))
      }
      if (this.limitN != null) out = out.slice(0, this.limitN)
      if (this.singleMode) {
        if (out.length === 0) return this.singleMode === 'one' ? { data: null, error: { message: 'no rows', code: 'PGRST116' } } : { data: null, error: null }
        return { data: out[0], error: null }
      }
      return { data: out, error: null }
    }

    const list = Array.isArray(this.payload) ? (this.payload as Row[]) : [this.payload as Row]

    if (this.op === 'insert') {
      for (const item of list) {
        if (rows.some((r) => r[pk] === item[pk])) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
      }
      for (const item of list) rows.push({ ...item })
      this.db.writes.push({ table: this.table, op: 'insert', payload: this.payload })
      return { data: this.returning ? list : null, error: null }
    }

    if (this.op === 'upsert') {
      const key = this.onConflict ?? pk
      const inserted: Row[] = []
      for (const item of list) {
        const existing = rows.find((r) => r[key] === item[key])
        if (existing) {
          if (!this.ignoreDuplicates) Object.assign(existing, item)
        } else {
          rows.push({ ...item })
          inserted.push(item)
        }
      }
      this.db.writes.push({ table: this.table, op: 'upsert', payload: this.payload })
      return { data: this.returning ? (this.ignoreDuplicates ? inserted : list) : null, error: null }
    }

    if (this.op === 'update') {
      const hit = rows.filter((r) => this.matches(r))
      for (const r of hit) Object.assign(r, this.payload as Row)
      this.db.writes.push({ table: this.table, op: 'update', payload: this.payload })
      return { data: this.returning ? hit : null, error: null }
    }

    const keep = rows.filter((r) => !this.matches(r))
    this.db.tables[this.table] = keep
    this.db.writes.push({ table: this.table, op: 'delete', payload: this.filters })
    return { data: null, error: null }
  }
}

class FakeDbImpl implements FakeDb {
  tables: Record<string, Row[]>
  primaryKeys: Record<string, string>
  rpcHandlers: Record<string, RpcHandler>
  rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  writes: { table: string; op: 'insert' | 'upsert' | 'update' | 'delete'; payload: unknown }[] = []
  failures = new Map<string, DbError>()

  constructor(opts: FakeDbOptions) {
    this.tables = structuredClone(opts.tables ?? {})
    this.primaryKeys = { ...DEFAULT_PKS, ...(opts.primaryKeys ?? {}) }
    this.rpcHandlers = opts.rpc ?? {}
  }

  failTable(table: string, error: DbError): void { this.failures.set(table, error) }

  // Troca o RPC falso e devolve o anterior (pra simular falha e depois voltar).
  setRpc(name: string, handler: RpcHandler): RpcHandler | undefined {
    const previous = this.rpcHandlers[name]
    this.rpcHandlers[name] = handler
    return previous
  }

  from(table: string): QueryBuilder { return new QueryBuilder(this, table) }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult> {
    this.rpcCalls.push({ name, args })
    const handler = this.rpcHandlers[name]
    if (!handler) return { data: null, error: { message: `function ${name} not found in fake`, code: 'PGRST202' } }
    try {
      return { data: await handler(args), error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
}

export function createFakeDb(opts: FakeDbOptions = {}): FakeDb {
  return new FakeDbImpl(opts)
}

// Resposta HTTP falsa no formato que os handlers da Vercel usam.
export type FakeRes = {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  status: (code: number) => FakeRes
  json: (body: unknown) => FakeRes
  end: () => FakeRes
  setHeader: (k: string, v: string) => void
}

export function createRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { res.statusCode = code; return res },
    json(body) { res.body = body; return res },
    end() { return res },
    setHeader(k, v) { res.headers[k] = v },
  }
  return res
}
