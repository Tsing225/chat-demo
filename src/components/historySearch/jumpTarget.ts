import { create } from 'zustand'

/**
 * 跨组件的搜索跳转目标：全局搜索点选结果后，先切会话，会话页挂载后再滚动到消息。
 * nonce 让重复跳转到同一条消息也能触发效果。
 */
export type JumpTarget = {
  sessionId: string
  messageId: string
  nonce: number
}

type JumpState = {
  target: JumpTarget | null
}

export const useJumpTarget = create<JumpState>(() => ({ target: null }))

export const requestJumpToMessage = (sessionId: string, messageId: string) =>
  useJumpTarget.setState({ target: { sessionId, messageId, nonce: Date.now() } })

export const clearJumpToMessage = () => useJumpTarget.setState({ target: null })
