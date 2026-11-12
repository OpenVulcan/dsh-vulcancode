import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { MemoryError } from '../markdown/errors.js'

// Validate record edits at both the UI and tool boundaries.
// 在界面和工具入口统一校验记录变更。
const recordFields = z.object({
  kind: z.enum(['memory', 'profile']),
  scope: z.enum(['user', 'space', 'project']),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
})

// Check revisions before mutating an existing record.
// 变更已有记录前校验版本。
const identity = z.object({ id: z.uuid(), revision: z.uuid() })

// Describe the three supported record mutations.
// 定义支持的三类记录变更。
export const mutationSchema = z.discriminatedUnion('action', [
  recordFields.extend({ action: z.literal('add') }),
  recordFields.pick({ title: true, body: true }).extend(identity.shape).extend({ action: z.literal('edit') }),
  identity.extend({ action: z.literal('remove') }),
])

// Describe a persisted record and its authorized scope.
// 定义持久化记录及其访问范围。
export type RecordEntry = z.infer<typeof recordFields> & z.infer<typeof identity> & { project: string; updated: number }

// Bind consent to a single authorization and the service's advertised revision.
// 将同意记录绑定到单一授权和服务公布的版本。
export const consentSchema = z.object({ binding: z.string(), id: z.string(), revision: z.string() })
// Represent the persisted cloud consent.
// 表示持久化的云端授权同意记录。
export type Consent = z.infer<typeof consentSchema>

// Pair consent with a persisted revision shared by every DSH process opening the database.
// 将同意记录与持久化版本配对，供打开该数据库的所有 DSH 进程共享。
interface ConsentState {
  readonly revision: string
  readonly grant: Consent | null
}

// Scope predicate shared by reads and mutations. An empty project matches only global records.
// 读写共用的范围条件，空项目只能命中全局记录。
const SCOPE = "(scope <> 'project' OR project = ?)"

/** Own the authoritative SQLite records and FTS index for one dsh profile directory.
 *  管理一个 dsh 配置目录下的权威 SQLite 记录和全文索引。 */
export class SqliteStore {
  /** Use the given database and dictionary tokenizer. Open via the lazy factory below.
   *  使用指定数据库和词典分词函数，通过下方工厂延迟打开。 */
  private constructor(private db: DatabaseSync, private tokenize: (text: string) => string[]) {}

  /** Open storage under root and initialize the FTS5 schema, returning a ready store.
   *  在 root 下打开存储并初始化 FTS5 表，返回可用的存储实例。 */
  static async open(root: string): Promise<SqliteStore> {
    const [{ DatabaseSync }, { Jieba }, { dict }] = await Promise.all([
      import('node:sqlite'), import('@node-rs/jieba'), import('@node-rs/jieba/dict.js'),
    ])
    const jieba = Jieba.withDict(dict)
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(path.join(root, 'memory.sqlite3'))
    try {
      db.exec(`
        PRAGMA busy_timeout=5000;
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY, revision TEXT NOT NULL, scope TEXT NOT NULL, project TEXT NOT NULL,
          kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS records_scope ON records(project, kind, updated);
        CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(id UNINDEXED, tokens);
        CREATE TABLE IF NOT EXISTS consent (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS consent_revision (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision TEXT NOT NULL);
        INSERT OR IGNORE INTO consent_revision VALUES (1,'0');
        CREATE TABLE IF NOT EXISTS indexed (
          model TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(model,id)
        );
        CREATE TABLE IF NOT EXISTS vector_candidates (
          model TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(model,id,revision)
        );
      `)
      return new SqliteStore(db, (value) => jieba.cutForSearch(value.normalize('NFKC').toLowerCase(), true)
        .flatMap(token => token.match(/[\p{L}\p{N}]+/gu) ?? []))
    } catch (error) {
      db.close()
      throw error
    }
  }

  /** Release the local database on plugin unload.
   *  插件卸载时关闭本地数据库。 */
  close(): void { this.db.close() }

  /** Return up to limit visible records of kind, ordered by recency.
   *  按最近更新时间返回最多 limit 条可访问的指定类型记录。 */
  list(project: string, kind: RecordEntry['kind'], limit: number, offset = 0): RecordEntry[] {
    return this.db.prepare(`SELECT * FROM records WHERE ${SCOPE} AND kind=? ORDER BY updated DESC,id LIMIT ? OFFSET ?`)
      .all(project, kind, limit, offset) as unknown as RecordEntry[]
  }

  /** Return visible memory records ranked by FTS5 for the tokenized query.
   *  按 FTS5 对分词后的查询排序，返回可访问的记忆记录。 */
  search(project: string, query: string, limit: number): RecordEntry[] {
    const tokens = [...new Set(this.tokenize(query))].slice(0, 32)
    if (tokens.length === 0) return []
    const match = tokens.map(token => `"${token}"`).join(' OR ')
    return this.db.prepare(`
      SELECT records.* FROM records_fts JOIN records ON records.id=records_fts.id
      WHERE records_fts MATCH ? AND ${SCOPE} AND kind='memory' ORDER BY bm25(records_fts),records.updated DESC LIMIT ?
    `).all(match, project, limit) as unknown as RecordEntry[]
  }

  /** Look up a record by id within the active project and the global scopes.
   *  在当前项目和全局范围内按 id 查找记录。 */
  get(project: string, id: string): RecordEntry | undefined {
    return this.db.prepare(`SELECT * FROM records WHERE id=? AND ${SCOPE}`).get(id, project) as RecordEntry | undefined
  }

  /** Apply one checked mutation and update its FTS entry in the same transaction.
   *  执行一次校验过的变更，在同一事务内更新全文索引。 */
  write(project: string, input: unknown): RecordEntry | null {
    const parsed = mutationSchema.safeParse(input)
    if (!parsed.success) throw MemoryError.invalid('Invalid SQLite memory operation.')
    const edit = parsed.data
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const before = edit.action === 'add' ? undefined : this.get(project, edit.id)
      if (edit.action !== 'add' && before === undefined) throw new MemoryError('not_found', 'Memory record does not exist in this scope.')
      if (before !== undefined && edit.action !== 'add' && before.revision !== edit.revision) {
        throw new MemoryError('revision_mismatch', 'This record changed. Reload it before saving.')
      }
      let after: RecordEntry | null = null
      if (edit.action === 'add') {
        if (edit.scope === 'project' && project === '') throw MemoryError.invalid('Select a project for project-scoped records.')
        after = { kind: edit.kind, scope: edit.scope, title: edit.title, body: edit.body,
          id: randomUUID(), revision: randomUUID(), project: edit.scope === 'project' ? project : '', updated: Date.now() }
        this.db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?)')
          .run(after.id, after.revision, after.scope, after.project, after.kind, after.title, after.body, after.updated)
      } else {
        this.db.prepare('DELETE FROM records_fts WHERE id=?').run(edit.id)
        if (edit.action === 'remove') {
          this.db.prepare('DELETE FROM records WHERE id=?').run(edit.id)
          // Keep vector candidates so the native process can remove obsolete rows after a restart.
          // 保留向量候选登记，供原生进程重启后清理失效行。
          this.db.prepare('DELETE FROM indexed WHERE id=?').run(edit.id)
        } else if (before !== undefined) {
          after = { ...before, title: edit.title, body: edit.body, revision: randomUUID(), updated: Date.now() }
          this.db.prepare('UPDATE records SET title=?,body=?,revision=?,updated=? WHERE id=?')
            .run(after.title, after.body, after.revision, after.updated, after.id)
        }
      }
      if (after?.kind === 'memory') {
        this.db.prepare('INSERT INTO records_fts VALUES (?,?)')
          .run(after.id, this.tokenize(`${after.title}\n${after.body}`).join(' '))
      }
      this.db.exec('COMMIT')
      return after
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Read the active grant and revision in one SQLite snapshot.
   *  在同一 SQLite 快照中读取当前授权和版本。 */
  consent(): ConsentState {
    const row = this.db.prepare(`
      SELECT revision,(SELECT value FROM consent WHERE singleton=1) AS value
      FROM consent_revision WHERE singleton=1
    `).get()
    if (row === undefined || typeof row.revision !== 'string') throw new Error('Missing SQLite consent revision.')
    return { revision: row.revision, grant: row.value === null ? null : consentSchema.parse(JSON.parse(String(row.value))) }
  }

  /** Reserve the newest consent decision before external I/O. Revocation removes the grant atomically.
   *  在外部 I/O 前登记最新同意决定，撤销时原子删除授权。 */
  beginConsentChange(revoke: boolean): string {
    const revision = randomUUID()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE consent_revision SET revision=? WHERE singleton=1').run(revision)
      if (revoke) this.db.exec('DELETE FROM consent')
      this.db.exec('COMMIT')
      return revision
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Commit the checked offer only if no later decision has superseded it.
   *  仅当校验过的方案未被后续决定取代时提交。 */
  confirmConsent(revision: string, consent: Consent): boolean {
    const result = this.db.prepare(`
      INSERT OR REPLACE INTO consent
      SELECT 1,? FROM consent_revision WHERE singleton=1 AND revision=?
    `).run(JSON.stringify(consent), revision)
    return Number(result.changes) === 1
  }

  /** Return one eligible batch of memory records whose current revision still needs a vector.
   *  返回一批仍需为当前版本生成向量的可访问记忆记录。 */
  pending(project: string, model: string): RecordEntry[] {
    return this.db.prepare(`
      SELECT records.* FROM records LEFT JOIN indexed
      ON records.id=indexed.id AND indexed.model=? AND records.revision=indexed.revision
      AND EXISTS (SELECT 1 FROM vector_candidates AS candidate
        WHERE candidate.model=indexed.model AND candidate.id=indexed.id AND candidate.revision=indexed.revision)
      WHERE ${SCOPE} AND records.kind='memory' AND indexed.id IS NULL ORDER BY records.updated,records.id LIMIT 10
    `).all(model, project) as unknown as RecordEntry[]
  }

  /** Record successful indexing only while each indexed revision is still current.
   *  仅当向量对应的记录版本仍然有效时标记索引成功。 */
  acknowledge(model: string, records: RecordEntry[]): void {
    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO indexed
      SELECT ?,id,revision FROM records WHERE id=? AND revision=?
    `)
    for (const entry of records) statement.run(model, entry.id, entry.revision)
  }
}
