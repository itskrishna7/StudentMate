import { createContext, useContext } from 'react'

export interface ConfirmDialogOptions {
  title: string
  description: string
  confirmLabel: string
  variant?: 'default' | 'danger'
}

export interface ConfirmDialogContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
}

export const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null)

export function useConfirmDialog(): ConfirmDialogContextValue {
  const context = useContext(ConfirmDialogContext)
  if (!context) throw new Error('useConfirmDialog must be used within ConfirmDialogProvider')
  return context
}
