import { create } from 'zustand'
import { PRICES_URL } from '../version.js'
import type { ChatModel, MessageUsage } from './api/types.js'
import { getVisibleMessages } from './chat/branches.js'
import type { AssistantMessage, Session } from './chat/types.js'
import { withGithubProxy } from './githubProxy.js'

/** 某档价格的高峰 / 空闲价，单位：元 / 百万 tokens。 */
export type PeakRates = { peak: number; offPeak: number }

export type ModelPrices = {
  inputCacheMiss: PeakRates
  inputCacheHit: PeakRates
  inputCacheCreation: PeakRates
  output: PeakRates
}

export type PriceTable = {
  schemaVersion: number
  effectiveDate: string
  contextWindow: number
  /** 每次联网搜索 / 抓取的价格，单位：元。 */
  webSearchPerRequest: number
  models: Record<ChatModel, ModelPrices>
}

/**
 * 内置价格（元 / 百万 tokens，2026-11-18 核对自官方价格页）。
 * 缓存写入（cache_creation_input_tokens）没有单独公布的价格：官方价格页只列
 * 缓存命中 / 缓存未命中 / 输出三档，且缓存为自动机制、无单独写入费用；因此写
 * 入 token 按缓存未命中价计（首次计算的输入本就按全价计，之后命中才享低价）。
 * 在线 prices.json 与内置表结构相同，改价只需更新仓库根目录的 prices.json。
 */
export const BUNDLED_PRICES: PriceTable = {
  schemaVersion: 1,
  effectiveDate: '2026-11-18',
  contextWindow: 1_000_000,
  webSearchPerRequest: 0.005,
  models: {
    'deepseek-flash': {
      inputCacheMiss: { offPeak: 1, peak: 2 },
      inputCacheHit: { offPeak: 0.02, peak: 0.04 },
      inputCacheCreation: { offPeak: 1, peak: 2 },
      output: { offPeak: 4, peak: 8 },
    },
    'deepseek-v4-pro': {
      inputCacheMiss: { offPeak: 4.5, peak: 9 },
      inputCacheHit: { offPeak: 0.15, peak: 0.3 },
      inputCacheCreation: { offPeak: 4.5, peak: 9 },
      output: { offPeak: 13.5, peak: 27 },
    },
  },
}

/** 北京时间的星期（1-5 为周一至周五）与小时；取不到时返回 null。 */
const beijingParts = (at: Date): { weekday: number; hour: number } | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(at)
    const weekdayText = parts.find((part) => part.type === 'weekday')?.value
    const hourText = parts.find((part) => part.type === 'hour')?.value
    const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
    const weekday = weekdayText ? weekdays[weekdayText] : undefined
    const hour = hourText ? Number(hourText) : NaN
    if (weekday === undefined || !Number.isInteger(hour)) {
      return null
    }
    return { weekday, hour }
  } catch {
    return null
  }
}

/**
 * 是否处于高峰时段：北京时间周一至周五 9:00-12:00、14:00-18:00。
 * 中国法定节假日无法从时钟推导，节假日的高峰估算可能偏高，费用文案均以“约”标注。
 */
export const isPeakTime = (at: Date): boolean => {
  const parts = beijingParts(at)
  if (!parts) {
    return false
  }
  if (parts.weekday < 1 || parts.weekday > 5) {
    return false
  }
  return (parts.hour >= 9 && parts.hour < 12) || (parts.hour >= 14 && parts.hour < 18)
}

export const isPeakNow = (): boolean => isPeakTime(new Date())

const rate = (rates: PeakRates, peak: boolean): number => (peak ? rates.peak : rates.offPeak)

/**
 * 按一次请求的用量计费（单位：元）。output_tokens 已包含思考 token，思考按输出价计，
 * 因此推理强度不改变计费公式，只改变实际产生的 token 数。
 * 联网搜索按 usage.server_tool_use.web_search_requests 计数，每次 0.005 元。
 */
export const computeCost = (
  usage: MessageUsage,
  model: ChatModel | null,
  table: PriceTable,
  at: Date
): number => {
  const prices = table.models[model ?? 'deepseek-flash']
  const peak = isPeakTime(at)
  const tokens =
    (usage.input_tokens * rate(prices.inputCacheMiss, peak) +
      usage.cache_creation_input_tokens * rate(prices.inputCacheCreation, peak) +
      usage.cache_read_input_tokens * rate(prices.inputCacheHit, peak) +
      usage.output_tokens * rate(prices.output, peak)) /
    1_000_000
  const searches = (usage.server_tool_use?.web_search_requests ?? 0) * table.webSearchPerRequest
  return tokens + searches
}

/**
 * 单条回复的费用：已持久化的 cost 优先；1.0.1 之前没有 cost 的消息按当前价格、
 * 以消息创建时间判断高峰 / 空闲现场估算；没有用量的消息计 0。
 */
export const getMessageCost = (message: AssistantMessage, table: PriceTable): number => {
  if (typeof message.cost === 'number') {
    return message.cost
  }
  if (!message.usage) {
    return 0
  }
  return computeCost(message.usage, message.model, table, new Date(message.createdAt))
}

/** 对话总费用：只汇总当前可见分支（getVisibleMessages），不含切走的分支版本。 */
export const getSessionCost = (session: Session, table: PriceTable): number => {
  let total = 0
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'assistant') {
      total += getMessageCost(message, table)
    }
  }
  return total
}

/**
 * 上下文剩余百分比：上下文窗口减去最近一条带用量的可见回复的全部 token
 *（输入 + 缓存写入 + 缓存读取 + 输出），下限 0；新对话 / 无用量时为 100。
 */
export const getContextRemainingPercent = (
  session: Session | undefined,
  table: PriceTable
): number => {
  if (!session) {
    return 100
  }
  const visible = getVisibleMessages(session)
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i]
    if (message.role === 'assistant' && message.usage) {
      const used =
        message.usage.input_tokens +
        message.usage.cache_creation_input_tokens +
        message.usage.cache_read_input_tokens +
        message.usage.output_tokens
      const remaining = ((table.contextWindow - used) / table.contextWindow) * 100
      return Math.min(100, Math.max(0, Math.round(remaining)))
    }
  }
  return 100
}

/** 回复落定（settle）时把费用写进消息；没有用量时原样返回。 */
export const withSettledCost = (
  reply: AssistantMessage,
  table: PriceTable,
  at: Date
): AssistantMessage => {
  if (!reply.usage) {
    return reply
  }
  const cost = computeCost(reply.usage, reply.model, table, at)
  return reply.cost === cost ? reply : { ...reply, cost }
}

/** 费用展示：小于 0.01 元保留 4 位小数（否则永远显示 0.00），其余保留 2 位。 */
export const formatCostYuan = (cost: number): string => {
  if (!Number.isFinite(cost) || cost <= 0) {
    return '0.00'
  }
  return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)
}

type PricesState = { table: PriceTable; source: 'bundled' | 'online' }

export const usePrices = create<PricesState>(() => ({ table: BUNDLED_PRICES, source: 'bundled' }))

export const getEffectivePrices = (): PriceTable => usePrices.getState().table

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

const readPeakRates = (value: unknown): PeakRates | null => {
  const obj = asRecord(value)
  if (!obj) {
    return null
  }
  const peak = obj['peak']
  const offPeak = obj['offPeak']
  if (
    typeof peak !== 'number' ||
    typeof offPeak !== 'number' ||
    !Number.isFinite(peak) ||
    !Number.isFinite(offPeak) ||
    peak < 0 ||
    offPeak < 0
  ) {
    return null
  }
  return { peak, offPeak }
}

const readModelPrices = (value: unknown): ModelPrices | null => {
  const obj = asRecord(value)
  if (!obj) {
    return null
  }
  const inputCacheMiss = readPeakRates(obj['inputCacheMiss'])
  const inputCacheHit = readPeakRates(obj['inputCacheHit'])
  const inputCacheCreation = readPeakRates(obj['inputCacheCreation'])
  const output = readPeakRates(obj['output'])
  if (!inputCacheMiss || !inputCacheHit || !inputCacheCreation || !output) {
    return null
  }
  return { inputCacheMiss, inputCacheHit, inputCacheCreation, output }
}

/** 校验在线价格表结构；任何字段缺失或非法都返回 null（调用方保留内置价格）。 */
export const parsePriceTable = (value: unknown): PriceTable | null => {
  const obj = asRecord(value)
  if (!obj || obj['schemaVersion'] !== 1) {
    return null
  }
  const effectiveDate = obj['effectiveDate']
  const contextWindow = obj['contextWindow']
  const webSearchPerRequest = obj['webSearchPerRequest']
  if (typeof effectiveDate !== 'string' || !effectiveDate) {
    return null
  }
  if (
    typeof contextWindow !== 'number' ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return null
  }
  if (
    typeof webSearchPerRequest !== 'number' ||
    !Number.isFinite(webSearchPerRequest) ||
    webSearchPerRequest < 0
  ) {
    return null
  }
  const models = asRecord(obj['models'])
  if (!models) {
    return null
  }
  const flash = readModelPrices(models['deepseek-flash'])
  const pro = readModelPrices(models['deepseek-v4-pro'])
  if (!flash || !pro) {
    return null
  }
  return {
    schemaVersion: 1,
    effectiveDate,
    contextWindow,
    webSearchPerRequest,
    models: { 'deepseek-flash': flash, 'deepseek-v4-pro': pro },
  }
}

let loading: Promise<void> | null = null

/**
 * 拉取仓库里的 prices.json（走 GitHub 代理设置）；离线、超时或结构非法时静默
 * 保留内置价格。应用在 prices.json 推送之前也能正常工作（走内置价格）。
 */
export const loadPrices = (): Promise<void> => {
  if (loading) {
    return loading
  }
  loading = (async () => {
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 10_000)
      try {
        const response = await fetch(withGithubProxy(PRICES_URL), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          return
        }
        const table = parsePriceTable(await response.json())
        if (table) {
          usePrices.setState({ table, source: 'online' })
        }
      } finally {
        window.clearTimeout(timer)
      }
    } catch {
      // 静默失败：内置价格继续生效。
    }
  })().finally(() => {
    loading = null
  })
  return loading
}
