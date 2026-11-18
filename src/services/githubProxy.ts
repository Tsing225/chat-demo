import { useSettings } from './settings.js'

/**
 * 规范化代理前缀：去首尾空白与末尾斜杠。空字符串表示不使用代理（合法）；
 * 非 https 开头的地址返回 null（调用方据此报错，永不拼出不安全的地址）。
 */
export const normalizeGithubProxy = (value: string): string | null => {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed === '') {
    return ''
  }
  if (!trimmed.startsWith('https://') || trimmed === 'https://') {
    return null
  }
  return trimmed
}

/**
 * 仅对 GitHub 文件地址加代理前缀（APK 下载、prices.json），形式为 `<proxy>/<original-url>`。
 * 每次调用时读取最新设置，改设置后下一次下载即生效，无需重启。
 * api.github.com 的更新检查与 api.deepseek.com 永不走代理（调用方不经过本函数）。
 */
export const withGithubProxy = (url: string): string => {
  const prefix = normalizeGithubProxy(useSettings.getState().githubProxyPrefix)
  if (!prefix) {
    return url
  }
  return `${prefix}/${url}`
}
