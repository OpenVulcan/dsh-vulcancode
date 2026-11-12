import path from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import type Koffi from 'koffi'
import { z } from 'zod'

// Carry only identifiers, revisions and embeddings across the native process boundary.
// 原生进程边界仅传输标识、版本和向量。
export interface VectorRequest {
  root: string
  library: string
  model: string
  project: string
  vector: number[]
  entries: { id: string; revision: string; scopeKey: string; embedding: number[] }[]
}

// Validate the owned result fields returned by the VLDB JSON API.
// 校验 VLDB JSON 接口返回的自有结果字段。
export const vectorHits = z.array(z.object({ id: z.uuid(), revision: z.uuid() }))

/** Run one scoped upsert and vector search using the pinned VLDB C ABI.
 *  使用固定版本的 VLDB C ABI 执行一次范围受限的向量写入和搜索。 */
function query(request: VectorRequest): z.infer<typeof vectorHits> {
  const { root, library, model, project, vector, entries } = request
  if (!/^[a-f0-9]{64}$/.test(model) || (project !== '' && !/^dshproject-[a-f0-9]{16}$/.test(project))) {
    throw new Error('Invalid vector index identity.')
  }
  const table = `memory_${model}`
  // Use the release package's N-API entry point and standard FFI methods, without a build lifecycle.
  // 使用发行包的 N-API 入口和标准 FFI 方法，安装时无需运行构建脚本。
  const koffi = createRequire(import.meta.url)(`@koromix/koffi-${process.platform}-${process.arch}`) as typeof Koffi
  const dll = koffi.load(library)
  const runtimeOptions = koffi.struct('RuntimeOptions', {
    default_db_path: 'str', db_root: 'str', read_consistency_interval_ms: 'uint64_t',
    has_read_consistency_interval: 'uint8_t', max_upsert_payload: 'size_t', max_search_limit: 'size_t',
    max_concurrent_requests: 'size_t',
  })
  koffi.struct('ByteBuffer', { data: 'void *', len: 'size_t', cap: 'size_t' })
  const defaultOptions = dll.func('vldb_lancedb_runtime_options_default', runtimeOptions, [])
  const openRuntime = dll.func('vldb_lancedb_runtime_create', 'void *', [runtimeOptions])
  const closeRuntime = dll.func('void vldb_lancedb_runtime_destroy(void *)')
  const openEngine = dll.func('void *vldb_lancedb_runtime_open_default_engine(void *)')
  const closeEngine = dll.func('void vldb_lancedb_engine_destroy(void *)')
  const createTable = dll.func('void *vldb_lancedb_engine_create_table_json(void *, const char *)')
  const upsert = dll.func('void *vldb_lancedb_engine_vector_upsert(void *, const char *, const uint8_t *, size_t)')
  const remove = dll.func('void *vldb_lancedb_engine_delete_json(void *, const char *)')
  const search = dll.func('void *vldb_lancedb_engine_vector_search(void *, const char *, _Out_ ByteBuffer *)')
  const freeString = dll.func('void vldb_lancedb_string_free(void *)')
  const freeBytes = dll.func('void vldb_lancedb_bytes_free(ByteBuffer)')
  const lastError = dll.func('str vldb_lancedb_last_error_message()')

  /** Validate an FFI result pointer and release the Rust-owned string.
   *  校验 FFI 结果指针，并释放 Rust 分配的字符串。 */
  const check = (pointer: bigint | null): void => {
    if (pointer === null) throw new Error(lastError())
    try {
      if (JSON.parse(koffi.decode.string(pointer)).success !== true) throw new Error('VLDB operation failed.')
    } finally { freeString(pointer) }
  }

  // Serialize native writers across dsh processes and publish new table metadata only after creation.
  // 跨 dsh 进程串行化原生库写入，建表成功后才发布元数据。
  const db = new DatabaseSync(path.join(root, 'vector-meta.sqlite3'))
  try {
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS managed_models (id TEXT PRIMARY KEY); BEGIN IMMEDIATE')
    const runtime = openRuntime({ ...defaultOptions(), default_db_path: path.join(root, 'vectors'),
      has_read_consistency_interval: 1, read_consistency_interval_ms: 0 })
    if (runtime === null) throw new Error(lastError())
    try {
      const engine = openEngine(runtime)
      if (engine === null) throw new Error(lastError())
      try {
        const records = new DatabaseSync(path.join(root, 'memory.sqlite3'))
        try {
          records.exec('PRAGMA busy_timeout=5000')
          if (db.prepare('SELECT id FROM managed_models WHERE id=?').get(model) === undefined) {
            // Preview tables have no deletion ledger. Replace only their derived vector cache once.
            // 预览版向量表没有清理登记，仅一次性重建其派生向量缓存。
            check(createTable(engine, JSON.stringify({ table_name: table, overwrite_if_exists: true, columns: [
              { name: 'id', column_type: 'string' }, { name: 'revision', column_type: 'string' },
              { name: 'scopeKey', column_type: 'string' }, { name: 'embedding', column_type: 'vector_float32', vector_dim: vector.length },
            ] })))
            records.prepare('DELETE FROM indexed WHERE model=?').run(model)
            records.prepare('DELETE FROM vector_candidates WHERE model=?').run(model)
            db.prepare('INSERT INTO managed_models VALUES (?)').run(model)
            // Commit table creation before any upsert can succeed and be recorded by the caller.
            // 在允许写入成功并由调用方标记前，先提交建表记录。
            db.exec('COMMIT; BEGIN IMMEDIATE')
          }
          if (entries.length !== 0) {
            // Record each candidate before crossing FFI so an interrupted upsert can still be cleaned up.
            // 在调用 FFI 前登记每个候选项，确保写入中断后仍可清理。
            const register = records.prepare(`
              INSERT OR IGNORE INTO vector_candidates
              SELECT ?,id,revision FROM records WHERE id=? AND revision=?
              RETURNING id
            `)
            const candidate = records.prepare(`
              SELECT 1 FROM vector_candidates AS candidate JOIN records USING (id,revision)
              WHERE candidate.model=? AND candidate.id=? AND candidate.revision=?
            `)
            const rows = entries.filter(entry => register.get(model, entry.id, entry.revision) !== undefined
              || candidate.get(model, entry.id, entry.revision) !== undefined)
            if (rows.length !== 0) {
              const bytes = Buffer.from(JSON.stringify(rows))
              check(upsert(engine, JSON.stringify({ table_name: table, input_format: 'json', key_columns: ['id'] }), bytes, bytes.length))
            }
          }
          // Remove stale revisions before ranking. Delete by id and revision so a newer upsert survives.
          // 排序前删除失效版本。以标识和版本为条件删除，保留更新后的向量。
          const obsolete = records.prepare(`
            SELECT candidate.id,candidate.revision FROM vector_candidates AS candidate
            LEFT JOIN records USING(id,revision)
            WHERE candidate.model=? AND records.id IS NULL LIMIT 128
          `)
          const forget = records.prepare('DELETE FROM vector_candidates WHERE model=? AND id=? AND revision=?')
          for (;;) {
            const stale = vectorHits.parse(obsolete.all(model))
            if (stale.length === 0) break
            const condition = stale.map(({ id, revision }) => `(id = '${id}' AND revision = '${revision}')`).join(' OR ')
            check(remove(engine, JSON.stringify({ table_name: table, condition })))
            for (const { id, revision } of stale) forget.run(model, id, revision)
          }
        } finally { records.close() }
        const out: { data?: bigint; len?: number } = {}
        check(search(engine, JSON.stringify({ table_name: table, vector, vector_column: 'embedding', output_format: 'json',
          limit: 24, filter: `scopeKey IN ('user','space','${project}')` }), out))
        try {
          const hits = vectorHits.parse(JSON.parse(koffi.decode.string(out.data!, Number(out.len))))
          db.exec('COMMIT')
          return hits
        } finally { freeBytes(out) }
      } finally { closeEngine(engine) }
    } finally { closeRuntime(runtime) }
  } finally { db.close() }
}

// Handle one IPC request and exit after flushing the result to the parent.
// 处理一次 IPC 请求，在将结果发送给父进程后退出。
process.once('message', (request: VectorRequest) => {
  try { process.send!({ hits: query(request) }, () => { process.disconnect() }) }
  catch { process.send!({ error: true }, () => { process.disconnect() }) }
})
