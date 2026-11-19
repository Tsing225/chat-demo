import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ReasoningEffort } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 字体大小档位；默认标准 */
export type FontSizeLevel = 'small' | 'standard' | 'large' | 'xlarge'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、字体大小 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** GitHub file-download accelerator: empty (unset) = built-in default, 'direct' = no proxy, https:// URL = custom prefix. See resolveGithubProxy in githubProxy.ts. */
  githubProxyPrefix: string
  /** 推理强度（output_config.effort），默认 high（与服务端默认一致）。 */
  reasoningEffort: ReasoningEffort
  /** 字体大小档位，默认标准；跟随系统开启时忽略。 */
  fontSize: FontSizeLevel
  /** 跟随系统字体大小；开启时读取 Android 系统字号，手动档位不生效。 */
  followSystemFontSize: boolean
  /** 翻看对话时自动折叠输入框；默认开启，未保存过时也开启。 */
  autoCollapseInput: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  githubProxyPrefix: 'chat-demo:github-proxy-prefix',
  reasoningEffort: 'chat-demo:reasoning-effort',
  fontSize: 'chat-demo:font-size',
  followSystemFontSize: 'chat-demo:follow-system-font-size',
  autoCollapseInput: 'chat-demo:auto-collapse-input',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过或保存的值不在三档之内时用 high（服务端默认强度）。 */
// 旧档位 Middle（存为 medium）已删除：不在三档之内，按上面规则自动落到 High。
const initialReasoningEffort = (): ReasoningEffort => {
  const saved = read(KEYS.reasoningEffort)
  return saved === 'low' || saved === 'high' || saved === 'max' ? saved : 'high'
}

/** 未保存过或保存的值不在四档之内时用标准。 */
const initialFontSize = (): FontSizeLevel => {
  const saved = read(KEYS.fontSize)
  return saved === 'small' || saved === 'standard' || saved === 'large' || saved === 'xlarge'
    ? saved
    : 'standard'
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  githubProxyPrefix: read(KEYS.githubProxyPrefix) ?? '',
  reasoningEffort: initialReasoningEffort(),
  fontSize: initialFontSize(),
  followSystemFontSize: read(KEYS.followSystemFontSize) === 'true',
  // 默认开启：从未保存过（null）或保存为 'true' 时都开启，只有显式 'false' 关闭。
  autoCollapseInput: read(KEYS.autoCollapseInput) !== 'false',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setGithubProxyPrefix = (githubProxyPrefix: string) => {
  write(KEYS.githubProxyPrefix, githubProxyPrefix)
  useSettings.setState({ githubProxyPrefix })
}

export const setReasoningEffort = (reasoningEffort: ReasoningEffort) => {
  write(KEYS.reasoningEffort, reasoningEffort)
  useSettings.setState({ reasoningEffort })
}

export const setFontSize = (fontSize: FontSizeLevel) => {
  write(KEYS.fontSize, fontSize)
  useSettings.setState({ fontSize })
}

export const setFollowSystemFontSize = (followSystemFontSize: boolean) => {
  write(KEYS.followSystemFontSize, String(followSystemFontSize))
  useSettings.setState({ followSystemFontSize })
}

export const setAutoCollapseInput = (autoCollapseInput: boolean) => {
  write(KEYS.autoCollapseInput, String(autoCollapseInput))
  useSettings.setState({ autoCollapseInput })
}
