import { useSettings } from './settings.js'

/**
 * Built-in default GitHub file accelerator, used when the user has not set
 * their own prefix and has not explicitly chosen a direct connection.
 * Byte-verified 2026-11-18 against the real v1.0.2 APK asset (exact size +
 * SHA256) and prices.json; reachability from mainland China without a VPN
 * still needs an on-device check, which is why downloads fall back to the
 * direct URL once (see githubFileUrls).
 */
export const DEFAULT_GITHUB_PROXY = 'https://gh-proxy.com'

/**
 * Stored-value sentinel meaning "direct connection, no proxy". It is not a
 * URL, so it can never be confused with a custom prefix, and it is distinct
 * from an unset/empty value (which means "use the built-in default").
 */
export const DIRECT_GITHUB_PROXY = 'direct'

export type GithubProxyMode = 'default' | 'custom' | 'direct'

export type ResolvedGithubProxy = {
  mode: GithubProxyMode
  /** Effective prefix; empty when mode is 'direct'. */
  prefix: string
}

/**
 * Normalizes a proxy prefix typed by the user: trims whitespace and trailing
 * slashes. An empty string is valid (the settings UI maps it to "direct");
 * anything not starting with https:// returns null (the caller shows an
 * inline error and never builds an insecure address).
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
 * Resolves a stored setting value to the effective proxy (tri-state):
 * - unset / empty -> built-in default. This also migrates old installs: an
 *   empty value previously meant "direct", and those users now get the
 *   accelerator, which is the point of the change.
 * - the 'direct' sentinel -> no proxy.
 * - a valid https:// URL -> that custom prefix (a stored copy of the default
 *   URL resolves as 'default', since it behaves identically).
 * - anything else (non-string, http://, garbage) -> built-in default, so a
 *   corrupt stored value can never break downloads or silently go direct.
 */
export const resolveGithubProxy = (stored: unknown): ResolvedGithubProxy => {
  if (typeof stored !== 'string') {
    return { mode: 'default', prefix: DEFAULT_GITHUB_PROXY }
  }
  const trimmed = stored.trim().replace(/\/+$/, '')
  if (trimmed === '') {
    return { mode: 'default', prefix: DEFAULT_GITHUB_PROXY }
  }
  if (trimmed === DIRECT_GITHUB_PROXY) {
    return { mode: 'direct', prefix: '' }
  }
  if (trimmed === DEFAULT_GITHUB_PROXY) {
    return { mode: 'default', prefix: DEFAULT_GITHUB_PROXY }
  }
  if (!trimmed.startsWith('https://') || trimmed === 'https://') {
    return { mode: 'default', prefix: DEFAULT_GITHUB_PROXY }
  }
  return { mode: 'custom', prefix: trimmed }
}

/**
 * Effective proxy from the current settings; re-read on every call so a
 * settings change applies to the next download without a restart.
 */
export const getEffectiveGithubProxy = (): ResolvedGithubProxy =>
  resolveGithubProxy(useSettings.getState().githubProxyPrefix)

/**
 * Prefixes a GitHub file URL (APK download, prices.json) as
 * `<proxy>/<original-url>`. Only file downloads go through this function;
 * api.github.com update checks and api.deepseek.com never do.
 */
export const withGithubProxy = (url: string): string => {
  const { prefix } = getEffectiveGithubProxy()
  if (!prefix) {
    return url
  }
  return `${prefix}/${url}`
}

/**
 * Download attempt order for a GitHub file URL: the proxied URL first, then
 * the direct URL exactly once as a fallback. Direct mode yields a single
 * attempt (no pointless retry of the same URL). Callers try the URLs in
 * order and keep SHA256 verification on every attempt.
 */
export const githubFileUrls = (url: string): string[] => {
  const proxied = withGithubProxy(url)
  return proxied === url ? [url] : [proxied, url]
}
