'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// Renders the two-way conversation for a single lead.
export default function Conversation({
  lead,
  onClose,
  embedded = false,
  onBack = null,
  showBackButton = false,
  showChannelToggle = true,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const bottomRef = useRef(null);

  const whatsappEnabled = lead?.whatsapp_valid !== false;
  const emailEnabled = lead?.email_valid !== false;
  const leadFullName = `${lead.first_name || lead['first name'] || ''} ${lead.last_name || lead['last name'] || ''}`.trim();

  useEffect(() => {
    const preferred = lead?.preferred_channel;
    if (preferred === 'whatsapp' && whatsappEnabled) {
      setChannel('whatsapp');
      return;
    }
    if (preferred === 'email' && emailEnabled) {
      setChannel('email');
      return;
    }
    if (whatsappEnabled) {
      setChannel('whatsapp');
      return;
    }
    if (emailEnabled) {
      setChannel('email');
      return;
    }
    setChannel('whatsapp');
  }, [lead, whatsappEnabled, emailEnabled]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/messages?lead_id=${lead.id}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
    setLoading(false);
  }, [lead.id]);

  // Initial load + poll every 5s for new inbound replies
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Has the seller ever replied? If not, free-form sending is blocked
  // by WhatsApp (24h window only opens after an inbound message).
  const sellerHasReplied = messages.some((m) => m.direction === 'in');

  async function send() {
    if (!draft.trim() || sending) return;
    if (channel !== 'whatsapp') {
      setError('Email sending is coming soon. Please use WhatsApp for now.');
      return;
    }
    setSending(true);
    setError('');

    const text = draft.trim();
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage = {
      id: optimisticId,
      lead_id: lead.id,
      direction: 'out',
      channel: 'whatsapp',
      body: text,
      is_automated: false,
      status: 'sent',
      created_at: new Date().toISOString(),
      media_urls: [],
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setDraft('');

    const res = await fetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: lead.id, phone: lead.phone, message: text }),
    });

    if (res.ok) {
      // Keep optimistic message as the final outbound bubble.
      // If the backend separately logs this message, polling will reconcile naturally.
      setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: 'sent' } : m)));
    } else {
      setError('Could not send. Try again.');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(text); // restore so they don't lose it
    }
    setSending(false);
  }

  const panelUi = (
    <div style={embedded ? panelEmbedded : panel} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {showBackButton && (
              <button onClick={onBack} style={navBtn} aria-label="Back to conversations">←</button>
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--smct-text)' }}>
                {leadFullName || 'Unknown'}
              </div>
              <div style={{ color: 'var(--smct-muted)', fontSize: 13 }}>
                {lead.year} {lead.make} {lead.model} · {lead.phone}
              </div>
            </div>
          </div>
          {!!onClose && !showBackButton && (
            <button onClick={onClose} style={closeBtn} aria-label="Close conversation">✕</button>
          )}
        </div>
        {showChannelToggle && (
          <div style={channelRow}>
            <button
              style={{
                ...channelBtn,
                ...(channel === 'whatsapp' ? channelBtnActive : null),
                ...(whatsappEnabled ? null : channelBtnDisabled),
              }}
              onClick={() => whatsappEnabled && setChannel('whatsapp')}
              disabled={!whatsappEnabled}
            >
              WhatsApp
            </button>
            <button
              style={{
                ...channelBtn,
                ...(channel === 'email' ? channelBtnActive : null),
                ...(emailEnabled ? null : channelBtnDisabled),
              }}
              onClick={() => emailEnabled && setChannel('email')}
              disabled={!emailEnabled}
            >
              Email
            </button>
          </div>
        )}

        <div style={thread} className="smct-mobile-scroll-hide">
          {loading && <p style={{ color: 'var(--smct-muted)', textAlign: 'center' }}>Loading…</p>}
          {!loading && messages.length === 0 && (
            <div style={{ color: 'var(--smct-muted)', textAlign: 'center', marginTop: 40 }}>
              No messages yet. The opener will appear here once it sends.
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start',
                marginBottom: 8,
              }}
            >
              <div style={m.direction === 'out' ? bubbleOut : bubbleIn}>
                {m.body && <div>{m.body}</div>}
                {m.media_urls && m.media_urls.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: m.body ? 8 : 0 }}>
                    {m.media_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt="attachment" style={mediaThumb} />
                      </a>
                    ))}
                  </div>
                )}
                <div style={meta}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {m.direction === 'out' && m.is_automated && ' · auto'}
                  {m.direction === 'out' && m.status === 'failed' && ' · failed'}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div style={composer}>
          {error && <div style={errorBar}>{error}</div>}
          {!sellerHasReplied && !loading && messages.length > 0 && (
            <div style={noticeBar}>
              Heads up: until {leadFullName || 'the seller'} replies, WhatsApp only allows approved template messages — a free typed reply may not deliver.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a reply…"
              rows={1}
              style={input}
            />
            <button onClick={send} disabled={sending || !draft.trim()} className="smct-primary-btn" style={sendBtn}>
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
  );

  if (embedded) return panelUi;

  return (
    <div style={overlay} onClick={onClose}>
      {panelUi}
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, background: 'var(--smct-overlay)',
  display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
  zIndex: 100,
};
const panel = {
  background: 'var(--smct-surface)', width: '100%', maxWidth: 600, height: '85vh',
  borderTopLeftRadius: 16, borderTopRightRadius: 16,
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  border: '1px solid var(--smct-border)',
  boxShadow: 'var(--smct-card-shadow)',
};
const panelEmbedded = {
  background: 'var(--smct-surface)',
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};
const header = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 16px', borderBottom: '1px solid var(--smct-border)', flexShrink: 0,
  background: 'var(--smct-surface)',
  boxShadow: 'var(--smct-header-divider-shadow)',
};
const navBtn = {
  background: 'var(--smct-surface)',
  border: '1px solid var(--smct-border)',
  color: 'var(--smct-muted)',
  fontSize: 15,
  cursor: 'pointer',
  padding: '4px 9px',
  borderRadius: 8,
};
const closeBtn = {
  background: 'transparent', border: 'none', color: 'var(--smct-muted)',
  fontSize: 18, cursor: 'pointer', padding: 4,
};
const channelRow = {
  display: 'flex',
  gap: 8,
  padding: '10px 16px 12px',
  borderBottom: '1px solid var(--smct-border)',
  flexShrink: 0,
  background: 'var(--smct-surface-muted)',
};
const channelBtn = {
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid var(--smct-border)',
  background: 'var(--smct-surface)',
  color: 'var(--smct-muted)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};
const channelBtnActive = {
  background: 'var(--smct-primary-soft)',
  borderColor: 'var(--smct-primary)',
  color: 'var(--smct-primary)',
};
const channelBtnDisabled = {
  opacity: 0.45,
  cursor: 'not-allowed',
};
const thread = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
  background: 'var(--smct-chat-thread-bg)',
  backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 14px, var(--smct-chat-thread-pattern) 14px 15px)',
};
const bubbleBase = {
  maxWidth: '75%', padding: '9px 12px', borderRadius: 14,
  fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word',
};
const bubbleOut = {
  ...bubbleBase,
  background: 'var(--smct-primary)',
  color: 'var(--smct-text-inverse)',
  borderBottomRightRadius: 6,
  boxShadow: 'var(--smct-bubble-shadow)',
};
const bubbleIn = {
  ...bubbleBase,
  background: 'var(--smct-bubble-incoming-bg)',
  color: 'var(--smct-text)',
  border: '1px solid var(--smct-bubble-incoming-border)',
  borderBottomLeftRadius: 6,
  boxShadow: 'var(--smct-bubble-shadow)',
};
const meta = { fontSize: 10, opacity: 0.72, marginTop: 4, textAlign: 'right' };
const mediaThumb = {
  width: 90, height: 90, objectFit: 'cover', borderRadius: 8, cursor: 'pointer',
};
const composer = {
  padding: 12, borderTop: '1px solid var(--smct-border)', flexShrink: 0, background: 'var(--smct-surface)',
};
const input = {
  flex: 1, padding: '10px 12px', borderRadius: 10, resize: 'none',
  border: '1px solid var(--smct-border)', background: 'var(--smct-surface)', color: 'var(--smct-text)',
  fontSize: 14, fontFamily: 'inherit', maxHeight: 120,
};
const sendBtn = {
  minWidth: 88,
  padding: '0 18px',
};
const errorBar = {
  background: 'var(--smct-danger-soft)', color: 'var(--smct-danger)', fontSize: 12,
  padding: '8px 10px', borderRadius: 8, marginBottom: 8,
};
const noticeBar = {
  background: 'var(--smct-warning-soft)', color: 'var(--smct-warning-text)', fontSize: 12,
  padding: '8px 10px', borderRadius: 8, marginBottom: 8,
};
