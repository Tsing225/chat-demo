/** Android 应用版本号（唯一的网页侧来源）：关于页展示与更新比较共用。package.json 的 0.1.1 是上游基线，不是应用版本。 */
export const APP_VERSION = '1.0.3'

export const GITHUB_REPO = 'Tsing225/chat-demo'
export const REPO_URL = `https://github.com/${GITHUB_REPO}`
export const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
export const PRICES_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/prices.json`
export const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'

/**
 * 解析版本号：接受可选的 v 前缀（如 v1.0.1），缺失的分段按 0 处理（1.0 与 1.0.0 等价）。
 * 任何分段不是纯数字、或分段数不在 1-3 之间时返回 null（非语义化标签直接忽略，永不抛错）。
 */
export const parseVersion = (tag: string): [number, number, number] | null => {
  const cleaned = tag.trim().replace(/^[vV]/, '')
  if (!cleaned) {
    return null
  }
  const parts = cleaned.split('.')
  if (parts.length < 1 || parts.length > 3) {
    return null
  }
  const numbers: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null
    }
    const value = Number(part)
    if (!Number.isSafeInteger(value)) {
      return null
    }
    numbers.push(value)
  }
  while (numbers.length < 3) {
    numbers.push(0)
  }
  return [numbers[0], numbers[1], numbers[2]]
}

/** 版本比较：a 大于 b 返回正数，相等返回 0，小于返回负数。 */
export const compareVersions = (
  a: [number, number, number],
  b: [number, number, number]
): number => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  return 0
}

/** 远程标签是否比当前版本更新；无法解析的标签一律视为不更新。 */
export const isNewerVersion = (remoteTag: string, current: string): boolean => {
  const remote = parseVersion(remoteTag)
  const local = parseVersion(current)
  if (!remote || !local) {
    return false
  }
  return compareVersions(remote, local) > 0
}
