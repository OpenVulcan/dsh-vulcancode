/** The plugin's interface text; dsh picks the dictionary that matches its interface language. */

export const NAMESPACE = 'openvulcan-account'

export const zh = {
  'nav': 'OpenVulcan 账号',
  'summary': 'VulcanCode 套件：OpenVulcan 账号、自动审批（Vulcan Decision）、交互式回答与 Vulcan 界面风格。账号登录一次，各插件共用。',
  'openSettings': '账号设置',
  'openGuard': '自动审批设置',

  'page.title': 'OpenVulcan 账号',
  'page.lead': '云端判定等 VulcanCode 功能使用这个账号。登录凭据保存在 dsh 的凭据存储中，退出登录会同时注销本设备。',
  'loading': '读取中…',
  'unavailable': '无法读取账号状态：dsh 没有向本页面提供插件接口。',

  'account.title': '账号',
  'account.lead': '选择账号所在站点并登录。',
  'account.site.global': '国际站',
  'account.site.cn': '中国站',
  'account.signIn': '登录',
  'account.signedIn': '已登录',
  'account.expires': '凭据有效期至 {expires}',
  'account.reauth': '凭据轮换中断，需要重新登录。',
  'account.waiting': '已打开授权页，批准后自动完成登录。',
  'account.openAgain': '重新打开授权页',
  'account.cancel': '取消登录',
  'account.signOut': '退出登录',
  'account.failed': '登录失败：{error}',
}

export type Key = keyof typeof zh
export type Translate = (key: Key) => string

export const en: Record<Key, string> = {
  'nav': 'OpenVulcan account',
  'summary': 'The VulcanCode suite: OpenVulcan account, auto approval (Vulcan Decision), interactive answers and the Vulcan look. Sign in once; every part uses the account.',
  'openSettings': 'Account settings',
  'openGuard': 'Auto approval settings',

  'page.title': 'OpenVulcan account',
  'page.lead': 'Cloud judging and other VulcanCode features use this account. The credential is kept in dsh\'s credential store; signing out also revokes this device.',
  'loading': 'Loading…',
  'unavailable': 'Cannot read the account: dsh offers this page no plugin routes.',

  'account.title': 'Account',
  'account.lead': 'Choose the site of your account and sign in.',
  'account.site.global': 'Global',
  'account.site.cn': 'China',
  'account.signIn': 'Sign in',
  'account.signedIn': 'Signed in',
  'account.expires': 'Credential valid until {expires}',
  'account.reauth': 'A credential rotation was interrupted; sign in again.',
  'account.waiting': 'The approval page is open; sign-in completes once you approve.',
  'account.openAgain': 'Open the approval page again',
  'account.cancel': 'Cancel sign-in',
  'account.signOut': 'Sign out',
  'account.failed': 'Sign-in failed: {error}',
}

/** Replace `{name}` placeholders. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
}
