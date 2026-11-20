import { useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'healthdost.virtualKeyboard.state'
const KEYBOARD_WIDTH = 560
const KEYBOARD_HEIGHT = 246
const ICON_SIZE = 50

const LETTER_ROWS = [
  [
    { value: 'q' },
    { value: 'w' },
    { value: 'e' },
    { value: 'r' },
    { value: 't' },
    { value: 'y' },
    { value: 'u' },
    { value: 'i' },
    { value: 'o' },
    { value: 'p' },
  ],
  [
    { value: 'a' },
    { value: 's' },
    { value: 'd' },
    { value: 'f' },
    { value: 'g' },
    { value: 'h' },
    { value: 'j' },
    { value: 'k' },
    { value: 'l' },
  ],
  [
    { type: 'shift', label: 'Shift' },
    { value: 'z' },
    { value: 'x' },
    { value: 'c' },
    { value: 'v' },
    { value: 'b' },
    { value: 'n' },
    { value: 'm' },
    { type: 'backspace', label: 'Backspace' },
  ],
  [
    { type: 'switch', label: '?123' },
    { value: ',', shift: '<' },
    { value: '.', shift: '>' },
    { value: '/', shift: '?' },
    { type: 'space', label: 'Space' },
    { type: 'enter', label: 'Enter' },
    { type: 'collapse', label: 'Collapse' },
  ],
]

const SYMBOL_ROWS = [
  [
    { value: '1' },
    { value: '2' },
    { value: '3' },
    { value: '4' },
    { value: '5' },
    { value: '6' },
    { value: '7' },
    { value: '8' },
    { value: '9' },
    { value: '0' },
  ],
  [
    { value: '-', shift: '_' },
    { value: '/', shift: '\\' },
    { value: ':', shift: ';' },
    { value: '(', shift: ')' },
    { value: '$', shift: '#' },
    { value: '&', shift: '%' },
    { value: '@', shift: '^' },
    { value: '"', shift: "'" },
    { value: '!', shift: '?' },
    { type: 'backspace', label: 'Backspace' },
  ],
  [
    { value: '.', shift: ',' },
    { value: ',', shift: '.' },
    { value: '?', shift: '!' },
    { value: '_', shift: '-' },
    { value: '+', shift: '=' },
    { value: '[', shift: '{' },
    { value: ']', shift: '}' },
    { value: '*'},
    { value: '|'},
    { value: '`', shift: '~' },
  ],
  [
    { type: 'switch', label: 'ABC' },
    { value: '<' },
    { value: '>' },
    { value: '=', shift: '+' },
    { type: 'space', label: 'Space' },
    { type: 'enter', label: 'Enter' },
    { type: 'collapse', label: 'Collapse' },
  ],
]

function clampPosition(x, y, collapsed) {
  const width = collapsed ? ICON_SIZE : KEYBOARD_WIDTH
  const height = collapsed ? ICON_SIZE : KEYBOARD_HEIGHT
  const maxX = Math.max(8, window.innerWidth - width - 8)
  const maxY = Math.max(8, window.innerHeight - height - 8)
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY),
  }
}

function isEditableTarget(el) {
  if (!el || el.disabled || el.readOnly) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    const allowedTypes = ['text', 'search', 'email', 'number', 'password', 'tel', 'url']
    return allowedTypes.includes((el.type || 'text').toLowerCase())
  }
  return false
}

export default function VirtualKeyboard() {
  const [collapsed, setCollapsed] = useState(false)
  const [shift, setShift] = useState(false)
  const [page, setPage] = useState('letters')
  const [position, setPosition] = useState({ x: 24, y: 24 })
  const dragRef = useRef(null)
  const activeElementRef = useRef(null)
  const keyboardRootRef = useRef(null)
  const collapsedTapRef = useRef({ moved: false, pointerId: null, startX: 0, startY: 0 })

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (typeof parsed?.collapsed === 'boolean') setCollapsed(parsed.collapsed)
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        setPosition(clampPosition(parsed.x, parsed.y, !!parsed.collapsed))
      }
    } catch {}
  }, [])

  useEffect(() => {
    const next = { collapsed, x: position.x, y: position.y }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [collapsed, position.x, position.y])

  useEffect(() => {
    const onFocusIn = (event) => {
      const target = event.target
      activeElementRef.current = isEditableTarget(target) ? target : null
    }
    const onFocusOut = (event) => {
      // Tapping virtual-key buttons should not clear the current input target.
      const nextFocus = event.relatedTarget
      if (nextFocus && keyboardRootRef.current?.contains(nextFocus)) {
        return
      }
      if (event.target === activeElementRef.current) {
        activeElementRef.current = null
      }
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y, collapsed))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [collapsed])

  const keyboardStyle = useMemo(
    () => ({
      position: 'fixed',
      left: `${position.x}px`,
      top: `${position.y}px`,
      zIndex: 1200,
      touchAction: 'none',
      userSelect: 'none',
    }),
    [position.x, position.y]
  )

  function startDrag(pointerId, clientX, clientY) {
    dragRef.current = {
      pointerId,
      startX: clientX,
      startY: clientY,
      startLeft: position.x,
      startTop: position.y,
    }
  }

  function moveDrag(pointerId, clientX, clientY) {
    const d = dragRef.current
    if (!d || d.pointerId !== pointerId) return
    const dx = clientX - d.startX
    const dy = clientY - d.startY
    const next = clampPosition(d.startLeft + dx, d.startTop + dy, collapsed)
    setPosition(next)
  }

  function endDrag(pointerId) {
    const d = dragRef.current
    if (!d || d.pointerId !== pointerId) return
    dragRef.current = null
  }

  function setInputValue(el, value, caretStart, caretEnd) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    if (descriptor?.set) {
      descriptor.set.call(el, value)
    } else {
      el.value = value
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    if (typeof caretStart === 'number' && typeof caretEnd === 'number') {
      el.setSelectionRange(caretStart, caretEnd)
    }
  }

  function applyKey(keyDef) {
    const el = activeElementRef.current
    if (!isEditableTarget(el)) return
    el.focus()

    const value = el.value ?? ''
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : value.length

    if (keyDef.type === 'shift') {
      setShift((prev) => !prev)
      return
    }
    if (keyDef.type === 'switch') {
      setPage((prev) => (prev === 'letters' ? 'symbols' : 'letters'))
      setShift(false)
      return
    }
    if (keyDef.type === 'collapse') {
      setCollapsed(true)
      return
    }
    if (keyDef.type === 'backspace') {
      if (start !== end) {
        const next = value.slice(0, start) + value.slice(end)
        setInputValue(el, next, start, start)
      } else if (start > 0) {
        const next = value.slice(0, start - 1) + value.slice(end)
        setInputValue(el, next, start - 1, start - 1)
      }
      return
    }
    if (keyDef.type === 'enter') {
      const next = value.slice(0, start) + '\n' + value.slice(end)
      const caret = start + 1
      setInputValue(el, next, caret, caret)
      return
    }
    if (keyDef.type === 'space') {
      const next = value.slice(0, start) + ' ' + value.slice(end)
      const caret = start + 1
      setInputValue(el, next, caret, caret)
      return
    }

    const base = keyDef.value || ''
    const isLetter = /^[a-z]$/i.test(base)
    const char = shift
      ? keyDef.shift || (isLetter ? base.toUpperCase() : base)
      : isLetter
        ? base.toLowerCase()
        : base
    const next = value.slice(0, start) + char + value.slice(end)
    const caret = start + char.length
    setInputValue(el, next, caret, caret)
    if (shift) setShift(false)
  }

  if (collapsed) {
    return (
      <div
        ref={keyboardRootRef}
        style={keyboardStyle}
        className="w-[50px] h-[50px] rounded-full bg-[#7e42ba] text-white shadow-lg border border-[#ebddfa] flex items-center justify-center"
        onPointerDown={(e) => {
          e.preventDefault()
          collapsedTapRef.current = {
            moved: false,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
          }
          startDrag(e.pointerId, e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          const tap = collapsedTapRef.current
          if (tap.pointerId !== e.pointerId) return
          if (Math.abs(e.clientX - tap.startX) > 4 || Math.abs(e.clientY - tap.startY) > 4) {
            tap.moved = true
          }
          moveDrag(e.pointerId, e.clientX, e.clientY)
        }}
        onPointerUp={(e) => {
          const tap = collapsedTapRef.current
          endDrag(e.pointerId)
          if (tap.pointerId === e.pointerId && !tap.moved) {
            setCollapsed(false)
          }
          collapsedTapRef.current.pointerId = null
        }}
      >
        <span className="text-xl leading-none">⌨</span>
      </div>
    )
  }

  return (
    <div
      ref={keyboardRootRef}
      style={keyboardStyle}
      className="w-[560px] max-w-[calc(100vw-16px)] bg-[#dcf7de] text-[#2d3035] rounded-xl shadow-2xl border border-[#7e42ba]/30"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="h-8 px-3 flex items-center justify-between bg-[#314490] rounded-t-xl cursor-move"
        onPointerDown={(e) => {
          e.preventDefault()
          startDrag(e.pointerId, e.clientX, e.clientY)
        }}
        onPointerMove={(e) => moveDrag(e.pointerId, e.clientX, e.clientY)}
        onPointerUp={(e) => endDrag(e.pointerId)}
      >
        <span className="text-xs text-[#ebddfa]">Virtual Keyboard</span>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded bg-[#ebddfa] text-[#2d3035] hover:bg-[#E0C8FF]"
          onClick={() => setCollapsed(true)}
        >
          Collapse
        </button>
      </div>

      <div className="p-2 space-y-1.5">
        {(page === 'letters' ? LETTER_ROWS : SYMBOL_ROWS).map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((keyDef, keyIndex) => {
              const isControl = ['backspace', 'enter', 'shift', 'space', 'collapse', 'switch'].includes(keyDef.type)
              const label = keyDef.label || (shift ? keyDef.shift || keyDef.value : keyDef.value)
              const widthClass =
                keyDef.type === 'space'
                  ? 'flex-[2.5]'
                  : keyDef.type === 'backspace' || keyDef.type === 'enter' || keyDef.type === 'shift'
                    ? 'flex-[1.5]'
                    : keyDef.type === 'collapse'
                      ? 'flex-[1.15]'
                      : keyDef.type === 'switch'
                        ? 'flex-[1.2]'
                      : 'flex-1'
              return (
                <button
                  key={`${rowIndex}-${keyIndex}-${keyDef.type || keyDef.value}`}
                  type="button"
                  className={`${widthClass} h-9 rounded-md border ${
                    keyDef.type === 'shift' && shift
                      ? 'bg-[#7e42ba] text-white border-[#7e42ba]'
                      : isControl
                        ? 'bg-[#ebddfa] border-[#7e42ba]/40 text-[#2d3035]'
                        : 'bg-white border-[#7e42ba]/25 text-[#2d3035]'
                  } hover:brightness-110 active:scale-[0.98] transition`}
                  onPointerDown={(e) => {
                    // Prevent button focus from stealing caret focus on touch devices.
                    e.preventDefault()
                  }}
                  onClick={() => applyKey(keyDef)}
                >
                  <span className="text-[13px]">{label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

