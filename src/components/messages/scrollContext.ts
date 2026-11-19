import { createContext, useContext } from 'react'

/** 渲染更新后请求滚到底部；用户上滑离开底部时由列表忽略 */
export const ScrollToBottomContext = createContext<() => void>(() => {})

export const useScrollToBottom = () => useContext(ScrollToBottomContext)

/** 消息列表是否在底部（距底部 <40px，与 MessageList 的 STICKY_THRESHOLD 一致）：输入框据此自动折叠 / 展开。无列表的首页默认在底部。 */
export const InputCollapseContext = createContext<{ isAtBottom: boolean }>({ isAtBottom: true })
