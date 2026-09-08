"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  matchIntent,
  CHAT_QUICK_REPLIES,
  CHAT_GREETING,
  type ChatAnswer,
} from "@/lib/chat"
import { whatsappUrl } from "@/lib/contact"

interface Message {
  id: number
  text: string
  who: "bot" | "user"
  whatsapp?: boolean
}

let nextId = 0

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [value, setValue] = useState("")
  const [typing, setTyping] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && messages.length === 0) {
      const t = window.setTimeout(() => {
        setMessages([{ id: nextId++, text: CHAT_GREETING, who: "bot" }])
      }, 350)
      return () => window.clearTimeout(t)
    }
  }, [open, messages.length])

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  function push(text: string, who: "bot" | "user", whatsapp?: boolean) {
    setMessages((prev) => [...prev, { id: nextId++, text, who, whatsapp }])
  }

  function botReply(answer: ChatAnswer) {
    setTyping(true)
    window.setTimeout(() => {
      setTyping(false)
      push(answer.text, "bot", answer.whatsapp)
    }, 650)
  }

  function send(raw: string) {
    const text = raw.trim()
    if (!text || typing) return
    push(text, "user")
    setValue("")
    botReply(matchIntent(text))
  }

  return (
    <>
      <motion.button
        type="button"
        className="chat-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar chat" : "Abrir chat"}
        aria-expanded={open}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7, duration: 0.3 }}
        whileHover={{ scale: 1.08 }}
      >
        <span className="chat-fab-badge" aria-hidden="true" />
        {!open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="chat-panel"
            role="dialog"
            aria-label="Chat con PixelArch"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.19, 1, 0.22, 1] }}
          >
            <div className="chat-head">
              <div className="chat-ava" aria-hidden="true">🤖</div>
              <div className="chat-id">
                <b>PixelBot</b>
                <span>En línea · demo</span>
              </div>
            </div>

            <div className="chat-body" ref={bodyRef}>
              {messages.map((m) =>
                m.who === "bot" ? (
                  <div key={m.id} className="msg bot">
                    {m.text}
                    {m.whatsapp && (
                      <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer">
                        Escribinos por WhatsApp →
                      </a>
                    )}
                  </div>
                ) : (
                  <div key={m.id} className="msg user">
                    {m.text}
                  </div>
                )
              )}
              {typing && (
                <div className="msg bot typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>

            <div className="chat-chips">
              {CHAT_QUICK_REPLIES.map((chip) => (
                <button key={chip.label} type="button" onClick={() => send(chip.label)}>
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="chat-input">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send(value)
                }}
                placeholder="Escribí tu consulta..."
                aria-label="Escribí tu consulta"
              />
              <button type="button" onClick={() => send(value)} aria-label="Enviar">
                →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .chat-fab {
          position: fixed;
          bottom: 20px;
          left: 20px;
          z-index: 55;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 24px rgba(139,92,246,0.45);
        }
        .chat-fab-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #25d366;
          border: 2px solid #07060c;
        }
        .chat-panel {
          position: fixed;
          bottom: 88px;
          left: 20px;
          z-index: 55;
          width: min(360px, calc(100vw - 40px));
          border-radius: 18px;
          overflow: hidden;
          background: linear-gradient(160deg, #171321, #110e1a);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 30px 70px -25px rgba(0,0,0,0.8);
          display: flex;
          flex-direction: column;
        }
        .chat-head {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 15px 18px;
          background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(34,211,238,0.14));
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .chat-ava {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 17px;
          flex-shrink: 0;
        }
        .chat-id b { font-size: 0.92rem; display: block }
        .chat-id span {
          font-family: var(--font-mono);
          font-size: 0.64rem;
          color: #34d399;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .chat-id span::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 6px #34d399;
        }
        .chat-body {
          height: 280px;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .msg {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 14px;
          font-size: 0.85rem;
          line-height: 1.55;
        }
        .msg.bot { background: rgba(255,255,255,0.06); border-bottom-left-radius: 4px; align-self: flex-start }
        .msg.user {
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          font-weight: 600;
          border-bottom-right-radius: 4px;
          align-self: flex-end;
        }
        .msg a { color: #22d3ee; font-weight: 600; text-decoration: underline; display: inline-block; margin-top: 8px }
        .msg.typing { display: flex; gap: 4px; align-items: center; padding: 13px 14px }
        .msg.typing span {
          width: 6px; height: 6px; border-radius: 50%;
          background: rgba(255,255,255,0.4);
          animation: chat-dot 1.1s ease-in-out infinite;
        }
        .msg.typing span:nth-child(2) { animation-delay: 0.15s }
        .msg.typing span:nth-child(3) { animation-delay: 0.3s }
        @keyframes chat-dot { 0%,60%,100% { opacity: 0.3; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-3px) } }
        .chat-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 14px }
        .chat-chips button {
          font-family: var(--font-mono);
          font-size: 0.66rem;
          color: #22d3ee;
          border: 1px solid rgba(34,211,238,0.3);
          background: rgba(34,211,238,0.07);
          border-radius: 999px;
          padding: 6px 12px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .chat-chips button:hover { background: rgba(34,211,238,0.18) }
        .chat-input { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.08) }
        .chat-input input {
          flex: 1;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 10px 12px;
          color: var(--color-text);
          font-family: var(--font-body);
          font-size: 0.85rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .chat-input input:focus { border-color: #8b5cf6 }
        .chat-input button {
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          width: 42px;
          cursor: pointer;
          font-size: 1rem;
          flex-shrink: 0;
        }
      `}</style>
    </>
  )
}