import { useEffect, useRef } from 'react'
import { Modal } from '../base/Modal.js'
import styles from './ImageViewer.module.css'

/** 当前打开的图片查看器，后打开的在末尾；返回键只关闭最上层 */
const openViewers: object[] = []

/**
 * 图片查看器：基于通用 Modal（Esc / 点遮罩 / 右上角 X 关闭）。
 * 打开时向 history 压入一条查看器记录：Android 返回键先回退这条记录，
 * popstate 关闭查看器，不会直接退出应用；X / 遮罩 / Esc 关闭时主动
 * history.back() 清掉这条记录，再关闭查看器。关闭后不留遮罩、不锁滚动、
 * 不动草稿与会话状态；Modal 本身不产生滚动锁。
 */
export const ImageViewer = ({
  src,
  alt,
  onClose,
}: {
  /** 原图地址（blob: 本地对象 URL） */
  src: string
  /** 文件名：标题与图片 alt */
  alt: string
  onClose: () => void
}) => {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  /** 已开始关闭：避免 popstate 与主动关闭重复触发 onClose */
  const closingRef = useRef(false)
  /** 已压入 history 记录：只有压栈成功，关闭时才 history.back() */
  const pushedRef = useRef(false)

  useEffect(() => {
    const token = {}
    openViewers.push(token)
    try {
      history.pushState({ imageViewer: true }, '')
      pushedRef.current = true
    } catch {
      // history 不可用时仍可查看图片；返回键行为退化为默认
    }
    const onPopState = () => {
      if (closingRef.current || openViewers.at(-1) !== token) {
        return
      }
      closingRef.current = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      openViewers.splice(openViewers.indexOf(token), 1)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  /** X / 遮罩 / Esc 的关闭路径：先清掉压入的 history 记录，再关闭查看器 */
  const requestClose = () => {
    if (closingRef.current) {
      return
    }
    closingRef.current = true
    if (pushedRef.current) {
      history.back()
    }
    onCloseRef.current()
  }

  return (
    <Modal
      title={<span className={styles.title}>{alt}</span>}
      closable
      className={styles.viewer}
      mainClassName={styles.main}
      onClose={requestClose}
    >
      <img src={src} alt={alt} className={styles.image} />
    </Modal>
  )
}
