import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { MemoryError } from '../markdown/errors.js'
import { DEFAULT_TEXT_POLICY, textPolicySchema, type TextPolicy } from './text-policy.js'
import { compilePiiFile, defaultPii, piiSelector, piiSnapshot, redactText, type PiiSnapshot } from './pii.js'
import { RULE_FILE_LIMIT } from './rule-resources.js'

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
export const consentSchema = z.object({ binding: z.string(), id: z.string(), revision: z.string(), automatic: z.literal(true).optional() })
// Represent the persisted cloud consent.
// 表示持久化的云端授权同意记录。
export type Consent = z.infer<typeof consentSchema>

// Pair consent with a persisted revision shared by every DSH process opening the database.
// 将同意记录与持久化版本配对，供打开该数据库的所有 DSH 进程共享。
interface ConsentState {
  readonly revision: string
  readonly grant: Consent | null
}

// Carry reviewed additions and the exact old revisions that may be retired with them.
// 携带已审核的新增记录及可在同一事务中归档的旧记录版本。
export interface DerivedRecord {
  readonly record: z.infer<typeof recordFields>
  readonly supersedes: readonly RecordEntry[]
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
        CREATE TABLE IF NOT EXISTS distilled_turns (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS retired_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS text_policy (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS text_rules (
          family TEXT NOT NULL, selector TEXT NOT NULL, source TEXT NOT NULL, revision TEXT NOT NULL,
          PRIMARY KEY(family,selector)
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

  /** Return the configured local privacy and noise policy.
   *  返回已配置的本机隐私及噪声策略。 */
  textPolicy(): TextPolicy {
    const row = this.db.prepare('SELECT value FROM text_policy WHERE singleton=1').get()
    return row === undefined ? DEFAULT_TEXT_POLICY : textPolicySchema.parse(JSON.parse(String(row.value)))
  }

  /** Read one local override and its revision for a known rule resource.
   *  读取指定规则资源的本地覆盖及其版本。 */
  ruleOverride(family: 'pii' | 'noise', selector: string) {
    return this.db.prepare('SELECT source,revision FROM text_rules WHERE family=? AND selector=?')
      .get(family, selector) as { source: string; revision: string } | undefined
  }

  /** Return editable effective PII JSON and its compare-and-swap revision.
   *  返回可编辑的生效 PII JSON 及其比较交换版本。 */
  piiFile(selector: string) {
    const name = piiSelector.parse(selector)
    const override = this.ruleOverride('pii', name)
    return { source: override?.source ?? defaultPii(name), revision: override?.revision ?? null }
  }

  /** Resolve both effective PII files in one SQLite read for an immutable operation snapshot.
   *  通过单次 SQLite 读取解析两份生效 PII 文件，生成不可变操作快照。 */
  pii(region = this.textPolicy().region): PiiSnapshot {
    const overrides = this.db.prepare("SELECT selector,source FROM text_rules WHERE family='pii' AND selector IN ('common',?)")
      .all(region) as { selector: string; source: string }[]
    return piiSnapshot(region, overrides.find(row => row.selector === 'common')?.source,
      overrides.find(row => row.selector === region)?.source)
  }

  /** Validate a PII override before saving it, or restore the shipped file with null.
   *  校验后保存 PII 覆盖，或以 null 恢复随包文件。 */
  savePiiFile(selector: string, source: string | null, expected: string | null) {
    const name = piiSelector.parse(selector)
    if (source !== null) {
      if (Buffer.byteLength(source) > RULE_FILE_LIMIT) throw MemoryError.invalid('The PII rule file is too large.')
      try { compilePiiFile(name, source) } catch {
        throw MemoryError.invalid('Invalid PII rules. Check the JSON, language, rule names, patterns and capture references.')
      }
    }
    this.saveRuleOverride('pii', name, source, expected)
    return this.piiFile(name)
  }

  /** Commit a validated override only when the editor still holds its current revision.
   *  仅在编辑器仍持有当前版本时提交已校验的覆盖。 */
  private saveRuleOverride(family: 'pii' | 'noise', selector: string, source: string | null, expected: string | null): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if ((this.ruleOverride(family, selector)?.revision ?? null) !== expected) {
        throw new MemoryError('revision_mismatch', 'The rule file changed. Reload it before saving.')
      }
      if (source === null) this.db.prepare('DELETE FROM text_rules WHERE family=? AND selector=?').run(family, selector)
      else this.db.prepare('INSERT OR REPLACE INTO text_rules VALUES (?,?,?,?)').run(family, selector, source, randomUUID())
      this.db.prepare('UPDATE consent_revision SET revision=? WHERE singleton=1').run(randomUUID())
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Persist the validated policy and invalidate work admitted before the change.
   *  保存已校验的策略，并使变更前准入的任务失效。 */
  saveTextPolicy(policy: TextPolicy): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT OR REPLACE INTO text_policy VALUES (1,?)').run(JSON.stringify(policy))
      this.db.prepare('UPDATE consent_revision SET revision=? WHERE singleton=1').run(randomUUID())
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

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
      const after = this.mutate(project, edit, edit.action === 'remove' ? undefined : this.pii())
      this.db.exec('COMMIT')
      return after
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Apply a validated record change within the caller's transaction and return the current row.
   *  在调用方事务内执行已校验的记录变更，返回当前记录。 */
  private mutate(project: string, edit: z.infer<typeof mutationSchema>, pii?: PiiSnapshot): RecordEntry | null {
    const before = edit.action === 'add' ? undefined : this.get(project, edit.id)
    if (edit.action !== 'add' && before === undefined) throw new MemoryError('not_found', 'Memory record does not exist in this scope.')
    if (before !== undefined && edit.action !== 'add' && before.revision !== edit.revision) {
      throw new MemoryError('revision_mismatch', 'This record changed. Reload it before saving.')
    }
    let after: RecordEntry | null = null
    // Redact before writing either the authoritative row or the full-text index.
    // 在写入权威记录或全文索引前执行脱敏。
    if (edit.action !== 'remove' && pii !== undefined) {
      const title = redactText(edit.title, pii).text.slice(0, 160).trim()
      const body = redactText(edit.body, pii).text.slice(0, 4000).trim()
      if (title === '' || body === '') throw MemoryError.invalid('The title and body must contain text after redaction.')
      edit = { ...edit, title, body }
    }
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
    return after
  }

  /** Check whether the exact source turn already committed its reviewed records.
   *  检查该来源回合是否已提交审核结果。 */
  hasDistilled(turnId: string): boolean {
    return this.db.prepare('SELECT 1 FROM distilled_turns WHERE id=?').get(turnId) !== undefined
  }

  /** Commit one reviewed turn and its index changes atomically, returning false on duplicate delivery.
   *  原子提交一个已审核回合及其索引变更，重复投递时返回 false。 */
  commitDistillation(project: string, turnId: string, approvedRevision: string, changes: readonly DerivedRecord[],
    retire: readonly RecordEntry[]): boolean {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.consent().revision !== approvedRevision) throw MemoryError.invalid('The memory consent changed during turn analysis.')
      const claimed = this.db.prepare('INSERT OR IGNORE INTO distilled_turns VALUES (?)').run(turnId)
      if (claimed.changes === 0) {
        this.db.exec('COMMIT')
        return false
      }
      const retired = new Map<string, RecordEntry>()
      for (const old of [...retire, ...changes.flatMap(change => change.supersedes)]) {
        if (retired.has(old.id)) throw MemoryError.invalid('The review retired the same record more than once.')
        retired.set(old.id, old)
      }
      for (const old of retired.values()) {
        this.mutate(project, { action: 'remove', id: old.id, revision: old.revision })
        this.db.prepare('INSERT INTO retired_records VALUES (?,?)').run(old.id, JSON.stringify(old))
      }
      for (const change of changes) {
        const { record } = change
        const duplicate = this.db.prepare('SELECT 1 FROM records WHERE kind=? AND scope=? AND project=? AND body=?')
          .get(record.kind, record.scope, record.scope === 'project' ? project : '', record.body)
        if (duplicate === undefined) this.mutate(project, mutationSchema.parse({ action: 'add', ...record }))
      }
      this.db.exec('COMMIT')
      return true
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
  pending(project: string | undefined, model: string): RecordEntry[] {
    return this.db.prepare(`
      SELECT records.* FROM records LEFT JOIN indexed
      ON records.id=indexed.id AND indexed.model=? AND records.revision=indexed.revision
      AND EXISTS (SELECT 1 FROM vector_candidates AS candidate
        WHERE candidate.model=indexed.model AND candidate.id=indexed.id AND candidate.revision=indexed.revision)
      WHERE (? IS NULL OR ${SCOPE}) AND records.kind='memory' AND indexed.id IS NULL ORDER BY records.updated,records.id LIMIT 10
    `).all(model, project ?? null, project ?? null) as unknown as RecordEntry[]
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
