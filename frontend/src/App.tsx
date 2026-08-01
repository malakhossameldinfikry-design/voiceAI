import { useState, useEffect, useRef, useCallback } from 'react'

type Role = 'user' | 'ai'
type Gender = 'female' | 'male'

interface VoiceNote {
  id: number
  role: Role
  duration: number
  bars: number[]
  ts: Date
  audioUrl?: string
}

function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio(url)
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration === Infinity || isNaN(audio.duration)) {
        audio.currentTime = 1e101
        const onTimeUpdate = () => {
          audio.removeEventListener('timeupdate', onTimeUpdate)
          resolve(audio.duration || 0)
          audio.currentTime = 0
        }
        audio.addEventListener('timeupdate', onTimeUpdate)
      } else {
        resolve(audio.duration)
      }
    })
    audio.addEventListener('error', () => resolve(0))
  })
}

function base64ToBlob(base64: string, mime: string): Blob {
  const byteChars = atob(base64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  return new Blob([new Uint8Array(byteNumbers)], { type: mime })
}

const BACKEND_URL = 'http://127.0.0.1:8000'

interface FileAttachment {
  id: number
  name: string
  size: string
  type: 'pdf' | 'doc' | 'img' | 'other'
}

interface Message {
  id: number
  role: Role
  voiceNote?: VoiceNote
  attachment?: FileAttachment
  ts: Date
}

interface Chat {
  id: number
  label: string
  messages: Message[]
  createdAt: Date
}

function randomBars(count: number): number[] {
  return Array.from({ length: count }, () => 3 + Math.floor(Math.random() * 13))
}

let _id = 0
const uid = () => ++_id

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(date: Date) {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ─── VoiceNote Bubble ─────────────────────────────────────────────────────────
// Module-level tracker so only one voice note plays across the whole app
let currentlyPlaying: { audio: HTMLAudioElement; stop: () => void } | null = null

function VoiceNoteBubble({ note, color }: { note: VoiceNote; color: string }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const waveformRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!note.audioUrl) return
    const audio = new Audio(note.audioUrl)
    audioElRef.current = audio
    const onTime = () => setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0)
    const onEnd = () => {
      setPlaying(false)
      setProgress(0)
      if (currentlyPlaying?.audio === audio) currentlyPlaying = null
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnd)
      if (currentlyPlaying?.audio === audio) currentlyPlaying = null
    }
  }, [note.audioUrl])

  const toggle = () => {
    const audio = audioElRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      if (currentlyPlaying?.audio === audio) currentlyPlaying = null
    } else {
      // stop whatever else is currently playing, anywhere in the app
      if (currentlyPlaying && currentlyPlaying.audio !== audio) {
        currentlyPlaying.stop()
      }
      audio.play()
      setPlaying(true)
      currentlyPlaying = {
        audio,
        stop: () => {
          audio.pause()
          setPlaying(false)
        },
      }
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioElRef.current
    if (!audio || !waveformRef.current || !audio.duration || !isFinite(audio.duration)) return
    const rect = waveformRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const pct = Math.min(1, Math.max(0, clickX / rect.width))
    audio.currentTime = pct * audio.duration
    setProgress(pct * 100)
  }

  const played = Math.floor((progress / 100) * note.bars.length)

  return (
    <div className="flex items-center gap-3" style={{ minWidth: 200 }}>
      <button
        onClick={toggle}
        className="shrink-0 flex items-center justify-center rounded-full transition-all"
        style={{
          width: 36, height: 36,
          background: color,
          boxShadow: playing ? `0 0 12px ${color}88` : 'none',
          border: 'none', cursor: 'pointer',
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1.5" y="1" width="3.5" height="10" rx="1" fill="white" />
            <rect x="7" y="1" width="3.5" height="10" rx="1" fill="white" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 2l8 4-8 4V2z" fill="white" />
          </svg>
        )}
      </button>
      <div
        ref={waveformRef}
        onClick={handleSeek}
        className="flex items-center gap-[2px] flex-1"
        style={{ height: 32, cursor: note.audioUrl ? 'pointer' : 'default' }}
        title={note.audioUrl ? 'Click to seek' : undefined}
      >
        {note.bars.map((h, i) => (
          <div
            key={i}
            className="vn-bar rounded-full"
            style={{
              width: 3,
              height: Math.max(4, h),
              background: i < played ? color : `${color}44`,
              '--vn-dur': `${0.5 + Math.random() * 0.5}s`,
              '--vn-delay': `${(i / note.bars.length) * 0.3}s`,
              '--vn-state': playing ? 'running' : 'paused',
              transition: 'background 0.15s',
            } as React.CSSProperties}
          />
        ))}
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
        {playing ? `${Math.ceil(note.duration * (1 - progress / 100))}s` : `${note.duration}s`}
      </span>
    </div>
  )
}

// ─── File Attachment Bubble ───────────────────────────────────────────────────
function AttachmentBubble({ file }: { file: FileAttachment }) {
  const icons = {
    pdf: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="2" width="14" height="18" rx="2" stroke="#60a5fa" strokeWidth="1.5" /><path d="M14 2v5h5" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" /><path d="M7 12h6M7 15h4" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" /></svg>,
    img: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#60a5fa" strokeWidth="1.5" /><circle cx="8.5" cy="8.5" r="1.5" fill="#60a5fa" /><path d="M21 15l-5-5L5 21" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" /></svg>,
    doc: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="2" width="14" height="18" rx="2" stroke="#60a5fa" strokeWidth="1.5" /><path d="M7 8h8M7 12h8M7 16h4" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" /></svg>,
    other: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="2" width="14" height="18" rx="2" stroke="#60a5fa" strokeWidth="1.5" /><path d="M14 2v5h5" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  }
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--color-panel2)', border: '1px solid var(--color-border2)', maxWidth: 260 }}>
      <div className="flex items-center justify-center rounded-lg" style={{ width: 36, height: 36, background: 'rgba(59,130,246,0.1)', flexShrink: 0 }}>
        {icons[file.type]}
      </div>
      <div className="overflow-hidden">
        <div className="truncate text-sm font-medium" style={{ color: 'var(--color-text)', maxWidth: 160 }}>{file.name}</div>
        <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{file.size}</div>
      </div>
    </div>
  )
}

// ─── Message Row ──────────────────────────────────────────────────────────────
function MessageRow({ message, aiName, aiGender }: { message: Message; aiName: string; aiGender: Gender }) {
  const isUser = message.role === 'user'
  const vnColor = isUser ? '#60a5fa' : '#38bdf8'

  return (
    <div className={`message-in flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className="shrink-0 flex items-center justify-center rounded-full"
        style={{
          width: 34, height: 34,
          background: isUser ? 'rgba(59,130,246,0.15)' : 'rgba(56,189,248,0.13)',
          border: `1px solid ${isUser ? 'rgba(59,130,246,0.3)' : 'rgba(56,189,248,0.25)'}`,
          color: isUser ? 'var(--color-accent2)' : 'var(--color-sky)',
          marginTop: 2, flexShrink: 0,
        }}
      >
        {isUser ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        ) : aiGender === 'female' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" /><path d="M12 15v6M9 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="10" r="5" stroke="currentColor" strokeWidth="1.8" /><path d="M19 5l-4.5 4.5M19 5h-4M19 5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </div>
      <div
        className="rounded-2xl px-4 py-3"
        style={{
          background: isUser ? 'var(--color-panel2)' : 'var(--color-surface)',
          border: `1px solid ${isUser ? 'var(--color-border2)' : 'var(--color-border)'}`,
          borderRadius: isUser ? '18px 6px 18px 18px' : '6px 18px 18px 18px',
          maxWidth: '72%',
        }}
      >
        <div className="text-xs mb-2 font-medium" style={{ color: isUser ? 'var(--color-accent2)' : 'var(--color-sky)', fontFamily: 'var(--font-mono)' }}>
          {isUser ? 'You' : aiName}
        </div>
        {message.attachment && <AttachmentBubble file={message.attachment} />}
        {message.voiceNote && <VoiceNoteBubble note={message.voiceNote} color={vnColor} />}
        <div className="mt-2 text-right" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>
          {formatTime(message.ts)}
        </div>
      </div>
    </div>
  )
}

// ─── Thinking Indicator ───────────────────────────────────────────────────────
function ThinkingIndicator({ aiName }: { aiName: string }) {
  return (
    <div className="message-in flex gap-3">
      <div className="shrink-0 flex items-center justify-center rounded-full" style={{ width: 34, height: 34, background: 'rgba(56,189,248,0.13)', border: '1px solid rgba(56,189,248,0.25)', color: 'var(--color-sky)', marginTop: 2 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 3" style={{ animation: 'spin 1.5s linear infinite' }} /></svg>
      </div>
      <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px 18px 18px 18px' }}>
        <div className="text-xs mb-1.5" style={{ color: 'var(--color-sky)', fontFamily: 'var(--font-mono)' }}>{aiName}</div>
        <span className="thinking-shimmer" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>recording response...</span>
      </div>
    </div>
  )
}

// ─── Waveform ─────────────────────────────────────────────────────────────────
const BARS = 30
function WaveformVisualizer({ active, listening }: { active: boolean; listening: boolean }) {
  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height: 56 }}>
      {Array.from({ length: BARS }).map((_, i) => {
        const dist = Math.abs(i - BARS / 2) / (BARS / 2)
        return (
          <div key={i} className="wave-bar rounded-full" style={{
            width: 3, height: active ? 44 - dist * 22 : 6,
            background: listening ? 'linear-gradient(to top, var(--color-green), rgba(52,211,153,0.35))' : 'linear-gradient(to top, var(--color-accent), rgba(56,189,248,0.5))',
            '--duration': `${0.5 + Math.random() * 0.55}s`,
            '--delay': `${(i / BARS) * 0.45}s`,
            opacity: active ? 1 : 0.25,
            transition: 'height 0.35s ease, opacity 0.35s ease',
          } as React.CSSProperties} />
        )
      })}
    </div>
  )
}

// ─── Mic Button ───────────────────────────────────────────────────────────────
function MicButton({ listening, thinking, onToggle }: { listening: boolean; thinking: boolean; onToggle: () => void }) {
  return (
    <div className="relative flex items-center justify-center">
      {listening && (
        <>
          <div className="pulse-ring absolute rounded-full" style={{ width: 76, height: 76, border: '1.5px solid var(--color-green)', animationDelay: '0s' }} />
          <div className="pulse-ring absolute rounded-full" style={{ width: 76, height: 76, border: '1.5px solid var(--color-green)', animationDelay: '0.7s' }} />
        </>
      )}
      <button onClick={onToggle} disabled={thinking} className="relative z-10 flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none" style={{ width: 68, height: 68, background: listening ? 'var(--color-green)' : thinking ? 'var(--color-panel2)' : 'var(--color-accent)', boxShadow: listening ? '0 0 28px rgba(52,211,153,0.45)' : thinking ? 'none' : '0 0 22px rgba(59,130,246,0.4)', cursor: thinking ? 'not-allowed' : 'pointer', opacity: thinking ? 0.5 : 1, border: 'none' }} aria-label={listening ? 'Stop' : 'Speak'}>
        {listening ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="5" y="5" width="5" height="14" rx="1.5" fill="#060e1a" /><rect x="14" y="5" width="5" height="14" rx="1.5" fill="#060e1a" /></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="12" rx="3" fill="white" /><path d="M5 10a7 7 0 0 0 14 0" stroke="white" strokeWidth="2" strokeLinecap="round" /><line x1="12" y1="17" x2="12" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round" /><line x1="8" y1="21" x2="16" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>
        )}
      </button>
    </div>
  )
}

// ─── Gender Selector ──────────────────────────────────────────────────────────
function GenderSelector({ gender, onChange }: { gender: Gender; onChange: (g: Gender) => void }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      {(['female', 'male'] as Gender[]).map(g => (
        <button key={g} onClick={() => onChange(g)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-xs font-medium" style={{ background: gender === g ? 'var(--color-accent-soft)' : 'transparent', color: gender === g ? 'var(--color-accent2)' : 'var(--color-muted)', border: gender === g ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)' }} aria-pressed={gender === g}>
          {g === 'female' ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" /><path d="M12 14v7M9 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="11" r="5" stroke="currentColor" strokeWidth="2" /><path d="M19 4l-5 5M19 4h-4M19 4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
          {g === 'female' ? 'She' : 'He'}
        </button>
      ))}
    </div>
  )
}

// ─── Name Editor ──────────────────────────────────────────────────────────────
function NameEditor({ name, onChange }: { name: string; onChange: (n: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirm = () => { const t = draft.trim(); if (t) onChange(t); else setDraft(name); setEditing(false) }
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  if (editing) return (
    <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onBlur={confirm} onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setDraft(name); setEditing(false) } }} className="text-sm font-semibold rounded px-2 py-0.5 focus:outline-none" style={{ background: 'var(--color-panel2)', border: '1px solid var(--color-accent)', color: 'var(--color-text)', fontFamily: 'var(--font-sans)', width: 100 }} maxLength={20} aria-label="Edit assistant name" />
  )
  return (
    <button onClick={() => { setDraft(name); setEditing(true) }} className="flex items-center gap-1.5 group" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} title="Click to rename">
      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-sans)' }}>{name}</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--color-muted)', opacity: 0.6 }} className="group-hover:opacity-100 transition-opacity"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
    </button>
  )
}

// ─── File Picker ──────────────────────────────────────────────────────────────
function FilePicker({ onFile }: { onFile: (f: FileAttachment) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const type: FileAttachment['type'] = ext === 'pdf' ? 'pdf' : ['jpg','jpeg','png','gif','webp','svg'].includes(ext) ? 'img' : ['doc','docx','txt'].includes(ext) ? 'doc' : 'other'
    const kb = file.size / 1024
    onFile({ id: uid(), name: file.name, size: kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb/1024).toFixed(1)} MB`, type })
    e.target.value = ''

    if (type !== 'pdf' && type !== 'img') return
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    } catch (err) {
      console.error('File upload failed', err)
    }
  }
  return (
    <>
      <input ref={inputRef} type="file" accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif,.webp,.svg" onChange={handleChange} className="hidden" aria-label="Attach file" />
      <button onClick={() => inputRef.current?.click()} className="flex items-center justify-center rounded-xl transition-all" style={{ width: 42, height: 42, background: 'var(--color-panel2)', border: '1px solid var(--color-border2)', cursor: 'pointer', color: 'var(--color-accent2)' }} title="Attach file or PDF" aria-label="Attach file">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  chats,
  activeChatId,
  onSelect,
  onNew,
  onDelete,
  open,
  onClose,
}: {
  chats: Chat[]
  activeChatId: number
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => void
  open: boolean
  onClose: () => void
}) {
  const grouped: { label: string; items: Chat[] }[] = []
  const seen = new Map<string, Chat[]>()
  for (const chat of [...chats].reverse()) {
    const key = formatDate(chat.createdAt)
    if (!seen.has(key)) { seen.set(key, []); grouped.push({ label: key, items: seen.get(key)! }) }
    seen.get(key)!.push(chat)
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-20 md:hidden" style={{ background: 'rgba(6,14,26,0.7)' }} onClick={onClose} />
      )}

      <aside
        className="flex flex-col shrink-0 z-30"
        style={{
          width: 240,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          height: '100vh',
          position: 'sticky',
          top: 0,
          transition: 'transform 0.25s ease',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-sans)' }}>Conversations</span>
          <button onClick={onClose} className="flex items-center justify-center rounded-lg transition-colors" style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }} aria-label="Close sidebar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="px-3 py-3">
          <button
            onClick={onNew}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'var(--color-accent-soft)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--color-accent2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {chats.length === 0 && (
            <div className="text-center py-8" style={{ color: 'var(--color-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>No saved chats yet</div>
          )}
          {grouped.map(group => (
            <div key={group.label}>
              <div className="px-2 py-2 text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                {group.label}
              </div>
              {group.items.map(chat => (
                <div
                  key={chat.id}
                  className="group flex items-center gap-2 rounded-xl px-3 py-2.5 mb-1 cursor-pointer transition-all"
                  style={{
                    background: chat.id === activeChatId ? 'var(--color-panel2)' : 'transparent',
                    border: chat.id === activeChatId ? '1px solid var(--color-border2)' : '1px solid transparent',
                  }}
                  onClick={() => onSelect(chat.id)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color: chat.id === activeChatId ? 'var(--color-accent2)' : 'var(--color-muted)', flexShrink: 0 }}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="flex-1 truncate text-xs" style={{ color: chat.id === activeChatId ? 'var(--color-text)' : 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}>
                    {chat.label}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(chat.id) }}
                    className="opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-all shrink-0"
                    style={{ width: 20, height: 20, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
                    aria-label="Delete chat"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
            {chats.length} chat{chats.length !== 1 ? 's' : ''} saved
          </span>
        </div>
      </aside>
    </>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<number>(0)
  const [listening, setListening] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [aiName, setAiName] = useState('Lyra')
  const [aiGender, setAiGender] = useState<Gender>('female')
  const [pendingFile, setPendingFile] = useState<FileAttachment | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const activeChat = chats.find(c => c.id === activeChatId) ?? null
  const messages = activeChat?.messages ?? []

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50)
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, thinking, scrollToBottom])

  const updateMessages = useCallback((id: number, fn: (msgs: Message[]) => Message[]) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, messages: fn(c.messages) } : c))
  }, [])

  const addMsg = useCallback((chatId: number, role: Role, voiceNote: VoiceNote, attachment?: FileAttachment) => {
    const msg: Message = { id: uid(), role, voiceNote, attachment, ts: new Date() }
    updateMessages(chatId, msgs => {
      const updated = [...msgs, msg]
      setChats(prev => prev.map(c => {
        if (c.id !== chatId) return c
        const userCount = updated.filter(m => m.role === 'user').length
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        return { ...c, label: userCount === 1 ? `Voice note · ${timeStr}` : c.label, messages: updated }
      }))
      return updated
    })
  }, [updateMessages])

  // ─── Greeting: fetches + plays "Hey, I'm {name}. How can I help you today?" ──
  const greetedRef = useRef<Set<number>>(new Set())
  const aiNameRef = useRef(aiName)
  const aiGenderRef = useRef(aiGender)
  useEffect(() => { aiNameRef.current = aiName }, [aiName])
  useEffect(() => { aiGenderRef.current = aiGender }, [aiGender])

  const sendGreeting = useCallback(async (chatId: number) => {
    if (greetedRef.current.has(chatId)) return
    greetedRef.current.add(chatId)
    try {
      const formData = new FormData()
      formData.append('agent_name', aiNameRef.current)
      formData.append('gender', aiGenderRef.current)
      const res = await fetch(`${BACKEND_URL}/greeting`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Greeting failed: ${res.status}`)
      const data = await res.json()
      const blob = base64ToBlob(data.audio_base64, 'audio/mpeg')
      const url = URL.createObjectURL(blob)
      const duration = await getAudioDuration(url)
      const vn: VoiceNote = {
        id: uid(), role: 'ai', duration: Math.max(1, Math.round(duration)),
        bars: randomBars(20), ts: new Date(), audioUrl: url,
      }
      addMsg(chatId, 'ai', vn)
      new Audio(url).play().catch(() => {})
    } catch (err) {
      console.error('Greeting failed', err)
      greetedRef.current.delete(chatId)
    }
  }, [addMsg])

  const createChat = useCallback(() => {
    const id = uid()
    const label = `Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    const newChat: Chat = { id, label, messages: [], createdAt: new Date() }
    setChats(prev => [...prev, newChat])
    setActiveChatId(id)
    setListening(false)
    setThinking(false)
    setPendingFile(null)
    sendGreeting(id)
    return id
  }, [sendGreeting])

  // Init with one chat + greet it
  useEffect(() => {
    const id = uid()
    const initial: Chat = { id, label: 'Chat 1', messages: [], createdAt: new Date() }
    setChats([initial])
    setActiveChatId(id)
    sendGreeting(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNew = () => {
    createChat()
  }

  const handleSelect = (id: number) => {
    setActiveChatId(id)
    setListening(false)
    setThinking(false)
    setPendingFile(null)
  }

  const handleDelete = (id: number) => {
    setChats(prev => {
      const next = prev.filter(c => c.id !== id)
      if (id === activeChatId && next.length > 0) setActiveChatId(next[next.length - 1].id)
      else if (next.length === 0) {
        const newId = uid()
        const fresh: Chat = { id: newId, label: 'Chat 1', messages: [], createdAt: new Date() }
        setActiveChatId(newId)
        sendGreeting(newId)
        return [fresh]
      }
      return next
    })
  }

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
streamRef.current = stream
const mimeType = MediaRecorder.isTypeSupported('audio/webm')
  ? 'audio/webm'
  : MediaRecorder.isTypeSupported('audio/mp4')
  ? 'audio/mp4'
  : ''
const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.start()
      mediaRecorderRef.current = recorder
      setListening(true)
    } catch (err) {
      console.error('Microphone access denied or unavailable', err)
    }
  }

  const stopRecordingAndSend = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    setListening(false)

    recorder.onstop = async () => {
  streamRef.current?.getTracks().forEach(t => t.stop())
  const actualType = recorder.mimeType || 'audio/webm'
  const blob = new Blob(audioChunksRef.current, { type: actualType })
      const userAudioUrl = URL.createObjectURL(blob)
      const userDuration = await getAudioDuration(userAudioUrl)

      const userVN: VoiceNote = {
        id: uid(), role: 'user', duration: Math.max(1, Math.round(userDuration)),
        bars: randomBars(22), ts: new Date(), audioUrl: userAudioUrl,
      }
      addMsg(activeChatId, 'user', userVN, pendingFile ?? undefined)
      setPendingFile(null)
      setThinking(true)

      try {
        const ext = actualType.includes('mp4') ? 'mp4' : actualType.includes('ogg') ? 'ogg' : 'webm'
const formData = new FormData()
formData.append('audio', blob, `voice.${ext}`)
        formData.append('agent_name', aiName)
        formData.append('gender', aiGender)
        const res = await fetch(`${BACKEND_URL}/voice`, { method: 'POST', body: formData })
        if (!res.ok) throw new Error(`Server error ${res.status}`)
        const data = await res.json()

        const aiBlob = base64ToBlob(data.audio_base64, 'audio/mpeg')
        const aiAudioUrl = URL.createObjectURL(aiBlob)
        const aiDuration = await getAudioDuration(aiAudioUrl)

        const aiVN: VoiceNote = {
          id: uid(), role: 'ai', duration: Math.max(1, Math.round(aiDuration)),
          bars: randomBars(24), ts: new Date(), audioUrl: aiAudioUrl,
        }
        setThinking(false)
        addMsg(activeChatId, 'ai', aiVN)
      } catch (err) {
        console.error('Voice request failed', err)
        setThinking(false)
      }
    }

    recorder.stop()
  }

  const handleToggleListen = () => {
    if (thinking || !activeChatId) return
    if (listening) {
      stopRecordingAndSend()
    } else {
      startRecording()
    }
  }

  const isActive = listening || thinking

  return (
    <div className="flex" style={{ minHeight: '100vh', background: 'var(--color-void)', fontFamily: 'var(--font-sans)' }}>

      <div style={{ position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 30, display: 'flex', pointerEvents: sidebarOpen ? 'auto' : 'none' }}>
        <div style={{ transform: sidebarOpen ? 'translateX(0)' : 'translateX(-240px)', transition: 'transform 0.25s ease', width: 240, height: '100vh', pointerEvents: 'auto' }}>
          <Sidebar
            chats={chats}
            activeChatId={activeChatId}
            onSelect={id => { handleSelect(id); setSidebarOpen(false) }}
            onNew={() => { handleNew(); setSidebarOpen(false) }}
            onDelete={handleDelete}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      <div
        className="flex flex-col flex-1"
        style={{
          marginLeft: sidebarOpen ? 240 : 0,
          transition: 'margin-left 0.25s ease',
          minWidth: 0,
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-3 gap-3 shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="flex items-center justify-center rounded-lg transition-colors"
              style={{ width: 36, height: 36, background: sidebarOpen ? 'var(--color-accent-soft)' : 'var(--color-panel)', border: `1px solid ${sidebarOpen ? 'rgba(59,130,246,0.3)' : 'var(--color-border)'}`, cursor: 'pointer', color: 'var(--color-accent2)', flexShrink: 0 }}
              aria-label="Toggle chat history"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>

            <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 38, height: 38, background: 'linear-gradient(135deg, #1d4ed8, #0ea5e9)', boxShadow: '0 0 14px rgba(59,130,246,0.35)' }}>
              {aiGender === 'female' ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="white" strokeWidth="2" /><path d="M12 14v7M9 18h6" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="11" r="5" stroke="white" strokeWidth="2" /><path d="M19 4l-5 5M19 4h-4M19 4v4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </div>
            <div>
              <NameEditor name={aiName} onChange={setAiName} />
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="rounded-full" style={{ width: 6, height: 6, background: 'var(--color-green)', boxShadow: '0 0 6px var(--color-green)' }} />
                <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>online</span>
              </div>
            </div>
          </div>

          <GenderSelector gender={aiGender} onChange={setAiGender} />

          {/* <button onClick={handleNew} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all" style={{ background: 'var(--color-accent-soft)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--color-accent2)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><line x1="12" y1="9" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            New Chat
          </button> */}
        </header>

        {activeChat && (
          <div className="flex items-center justify-center py-2 shrink-0">
            <span className="px-3 py-0.5 rounded-full text-xs" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
              {activeChat.label}
            </span>
          </div>
        )}

        <main className="flex flex-col flex-1 items-center" style={{ maxWidth: 680, width: '100%', margin: '0 auto', padding: '0 16px' }}>
          <div ref={scrollRef} className="flex-1 w-full overflow-y-auto py-4 flex flex-col gap-4" style={{ minHeight: 0 }}>
            {messages.length === 0 && !thinking && (
              <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                <div className="flex items-center justify-center rounded-full" style={{ width: 64, height: 64, background: 'linear-gradient(135deg, rgba(29,78,216,0.3), rgba(14,165,233,0.2))', border: '1px solid rgba(59,130,246,0.25)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--color-accent2)' }}><rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>{aiName} is ready</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>Tap the mic to start a voice conversation</p>
                </div>
              </div>
            )}
            {messages.map(msg => (
              <MessageRow key={msg.id} message={msg} aiName={aiName} aiGender={aiGender} />
            ))}
            {thinking && <ThinkingIndicator aiName={aiName} />}
          </div>

          <div className="w-full mb-5 rounded-2xl px-5 py-4 flex flex-col items-center gap-4 shrink-0" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border2)' }}>
            <div className="text-xs tracking-widest uppercase" style={{ fontFamily: 'var(--font-mono)', color: listening ? 'var(--color-green)' : thinking ? 'var(--color-sky)' : 'var(--color-muted)' }}>
              {listening ? '● listening' : thinking ? '◈ processing' : '○ idle'}
            </div>
            <WaveformVisualizer active={isActive} listening={listening} />

            {pendingFile && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--color-accent-soft)', border: '1px solid rgba(59,130,246,0.25)', color: 'var(--color-accent2)', fontFamily: 'var(--font-mono)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" /><polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" /></svg>
                {pendingFile.name}
                <button onClick={() => setPendingFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', lineHeight: 1, padding: 0 }} aria-label="Remove attachment">×</button>
              </div>
            )}

            <div className="flex items-center gap-4">
              <FilePicker onFile={setPendingFile} />
              <MicButton listening={listening} thinking={thinking} onToggle={handleToggleListen} />
              <div style={{ width: 42 }} />
            </div>

            <p className="text-xs" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
              {listening ? 'tap to send voicenote' : thinking ? 'wait...' : 'tap to speak'}
            </p>

            <div className="flex items-center justify-between w-full pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-xs px-2 py-0.5 rounded" style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-panel)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>claude-sonnet-4-6</span>
              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}