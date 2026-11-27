import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CircleHelp } from 'lucide-react'
import { ConfirmDialogContext, type ConfirmDialogOptions } from './confirmDialogContext'

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  const confirm = useCallback((nextOptions: ConfirmDialogOptions) => {
    if (resolveRef.current) {
      return Promise.reject(new Error('A confirmation dialog is already open'))
    }

    setOptions(nextOptions)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const finish = (confirmed: boolean) => {
    if (dialogRef.current?.open) dialogRef.current.close()
    setOptions(null)
    resolveRef.current?.(confirmed)
    resolveRef.current = null
  }

  useEffect(() => {
    if (options && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal()
    }
  }, [options])

  useEffect(() => () => resolveRef.current?.(false), [])

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}
      <dialog
        ref={dialogRef}
        className="confirm-dialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onCancel={(event) => {
          event.preventDefault()
          finish(false)
        }}
      >
        {options && (
          <>
            <div className="confirm-dialog-body">
              <span className={`confirm-dialog-icon ${options.variant === 'danger' ? 'danger' : ''}`}>
                {options.variant === 'danger' ? <AlertTriangle size={21} /> : <CircleHelp size={21} />}
              </span>
              <div>
                <h2 id="confirm-dialog-title">{options.title}</h2>
                <p id="confirm-dialog-description">{options.description}</p>
              </div>
            </div>
            <div className="confirm-dialog-actions">
              <button className="secondary-button" type="button" autoFocus onClick={() => finish(false)}>Cancel</button>
              <button
                className={options.variant === 'danger' ? 'primary-button confirm-dialog-danger' : 'primary-button'}
                type="button"
                onClick={() => finish(true)}
              >
                {options.confirmLabel}
              </button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmDialogContext.Provider>
  )
}
