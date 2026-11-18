import { useEffect } from 'react'
import { scrollToMessageWithFlash } from './highlight.js'
import { clearJumpToMessage, useJumpTarget } from './jumpTarget.js'

/** 最多重试次数与间隔：会话刚切过来时消息列表可能尚未挂载。 */
const MAX_ATTEMPTS = 20
const RETRY_INTERVAL_MS = 100

/**
 * 消费全局搜索的跳转目标：目标属于当前会话时，等消息元素出现后滚动并闪烁高亮，
 * 成功或超时后都清除目标，避免重复跳转。
 */
export const useJumpToMessage = (sessionId: string) => {
  const target = useJumpTarget((state) => state.target)

  useEffect(() => {
    if (!target) {
      return
    }
    if (target.sessionId !== sessionId) {
      // 切到了别的会话，丢弃过期的跳转目标，避免之后回到该会话时误触发。
      clearJumpToMessage()
      return
    }
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = () => {
      attempts += 1
      if (scrollToMessageWithFlash(target.messageId) || attempts >= MAX_ATTEMPTS) {
        clearJumpToMessage()
        return
      }
      timer = setTimeout(attempt, RETRY_INTERVAL_MS)
    }
    // 首帧之后再找元素，等待本次渲染提交。
    timer = setTimeout(attempt, 0)
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [target, sessionId])
}
