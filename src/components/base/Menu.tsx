import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  /** 置灰不可点：用于尚无可用功能的占位项（如附件菜单里的插件） */
  disabled?: boolean
  /** 置灰项右侧的小字说明 */
  hint?: string
  onSelect?: () => void
}

/** 点击触发，向下展开；点外部或 Esc 关闭 */
export const Menu = ({
  options,
  children,
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  // 左侧对齐并再左移 5px，让菜单文字与触发元素图标对齐
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'start', alignOffset: -5, offset: 4 }
  )
  useDismiss(open, [anchorRef, floatingRef], close)

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({ open, toggle: () => setOpen((value) => !value) })}
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
            >
              {options.map((option) => (
                <div
                  key={option.key}
                  role="menuitem"
                  aria-disabled={option.disabled || undefined}
                  className={clsx(
                    styles.option,
                    option.danger && styles.danger,
                    option.disabled && styles.disabled
                  )}
                  onClick={
                    option.disabled
                      ? undefined
                      : () => {
                          setOpen(false)
                          option.onSelect?.()
                        }
                  }
                >
                  <span className={styles.icon}>{option.icon}</span>
                  {option.label}
                  {option.hint ? <span className={styles.hint}>{option.hint}</span> : null}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
