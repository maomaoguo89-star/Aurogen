import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ThemedSelectOption = {
  value: string
  label: string
}

type ThemedSelectProps = {
  value: string
  options: ThemedSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  buttonClassName?: string
  menuClassName?: string
}

export function ThemedSelect({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select',
  className,
  buttonClassName,
  menuClassName,
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-left text-[13px] text-[var(--color-text-primary)] outline-none transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60',
          buttonClassName,
        )}
      >
        <span className={cn('truncate', !selected && 'text-[var(--color-text-tertiary)]')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--color-text-tertiary)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] p-1 shadow-[var(--shadow-lg)] backdrop-blur-[var(--blur-popover)]',
              menuClassName,
            )}
          >
            {options.length > 0 ? (
              options.map((option) => {
                const active = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-[calc(var(--radius-sm)-4px)] px-3 py-2 text-left text-[13px] transition',
                      active
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" /> : null}
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-2 text-[13px] text-[var(--color-text-tertiary)]">
                No options
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
