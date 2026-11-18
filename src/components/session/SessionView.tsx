import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { IconSearchOutline16 } from '../base/icons.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { ConversationSearch } from '../historySearch/ConversationSearch.js'
import { useJumpToMessage } from '../historySearch/useJumpToMessage.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const [searchOpen, setSearchOpen] = useState(false)
  // 全局搜索点选结果后，滚动到目标消息并高亮。
  useJumpToMessage(session.id)

  // 切换会话时关闭对话内搜索。
  useEffect(() => {
    setSearchOpen(false)
  }, [session.id])

  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} onSearch={() => setSearchOpen(true)} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.headerActions}>
            <IconButton
              size="m"
              icon={<IconSearchOutline16 />}
              tooltip={t('inChatSearch')}
              tooltipPlacement="bottom"
              onClick={() => setSearchOpen(true)}
            />
          </div>
        </div>
      )}
      {searchOpen ? (
        <ConversationSearch
          key={session.id}
          session={session}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
