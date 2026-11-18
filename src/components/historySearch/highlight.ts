/** 跳转后的短暂闪烁高亮持续时间（毫秒），样式见 highlight.css。 */
export const FLASH_DURATION_MS = 3000

const FLASH_CLASS = 'history-search-flash'
const CURRENT_CLASS = 'history-search-current'

/** 消息锚点由 MessageList 在每条消息外层渲染：data-message-id。 */
export const findMessageElement = (messageId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)

const scrollToElement = (element: HTMLElement) => {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** 清除文档内全部搜索高亮（闪烁与当前命中）。 */
export const clearMessageHighlights = () => {
  for (const element of document.querySelectorAll(`.${FLASH_CLASS}, .${CURRENT_CLASS}`)) {
    element.classList.remove(FLASH_CLASS, CURRENT_CLASS)
  }
}

/** 滚动到指定消息并闪烁高亮几秒；找不到元素时返回 false。 */
export const scrollToMessageWithFlash = (messageId: string): boolean => {
  const element = findMessageElement(messageId)
  if (!element) {
    return false
  }
  clearMessageHighlights()
  scrollToElement(element)
  element.classList.add(FLASH_CLASS)
  window.setTimeout(() => element.classList.remove(FLASH_CLASS), FLASH_DURATION_MS)
  return true
}

/** 滚动到指定消息并标记为当前命中（持续高亮，直到下一次导航或清除）。 */
export const scrollToMessageAsCurrent = (messageId: string): boolean => {
  const element = findMessageElement(messageId)
  if (!element) {
    return false
  }
  clearMessageHighlights()
  scrollToElement(element)
  element.classList.add(CURRENT_CLASS)
  return true
}

/** 只补上当前命中标记，不滚动（同一条消息反复命中时用，避免打断阅读位置）。 */
export const markCurrentMessage = (messageId: string): void => {
  findMessageElement(messageId)?.classList.add(CURRENT_CLASS)
}
