'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getBrowserSupabase } from '../lib/supabase-client';

const OPTIMISTIC_PREFIX = 'optimistic-';
const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_PICK_BYTES = 15 * 1024 * 1024;
const IMAGE_GROUP_WINDOW_MS = 3 * 60 * 1000;

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
  const [pendingImages, setPendingImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const bottomRef = useRef(null);
  const threadRef = useRef(null);
  const imageInputRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const lastMessageCountRef = useRef(0);

  const whatsappEnabled = lead?.whatsapp_valid !== false;
  const emailEnabled = lead?.email_valid !== false;
  const leadFullName = `${lead.first_name || lead['first name'] || ''} ${lead.last_name || lead['last name'] || ''}`.trim();
  const galleryItems = useMemo(() => buildGalleryItems(messages), [messages]);
  const galleryIndexByMessageId = useMemo(() => {
    const out = {};
    galleryItems.forEach((item, index) => {
      out[item.messageId] = index;
    });
    return out;
  }, [galleryItems]);
  const threadItems = useMemo(() => buildThreadItems(messages), [messages]);
  const activeLightboxItem = lightboxIndex !== null ? galleryItems[lightboxIndex] : null;

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
      setMessages((prev) => mergeMessagesKeepingOptimistic(prev, data.messages || []));
    }
    setLoading(false);
  }, [lead.id]);

  // Initial load + poll every 5s for new inbound replies
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase || !lead?.id) return undefined;

    const channel = supabase
      .channel(`messages:lead:${lead.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `lead_id=eq.${lead.id}`,
        },
        (payload) => {
          setMessages((prev) => upsertIncomingMessage(prev, payload.new));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `lead_id=eq.${lead.id}`,
        },
        (payload) => {
          setMessages((prev) => upsertIncomingMessage(prev, payload.new));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [lead?.id]);

  // Auto-scroll only when user is already near bottom (or first load).
  useEffect(() => {
    const count = messages.length;
    const hasNewMessage = count > lastMessageCountRef.current;
    lastMessageCountRef.current = count;

    if (!hasNewMessage && count > 0) return;
    if (!shouldStickToBottomRef.current && count > 0) return;
    bottomRef.current?.scrollIntoView({ behavior: count <= 1 ? 'auto' : 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      pendingImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, [pendingImages]);

  useEffect(() => {
    if (lightboxIndex === null) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setLightboxIndex(null);
      } else if (event.key === 'ArrowRight') {
        setLightboxIndex((prev) => {
          if (prev === null || !galleryItems.length) return prev;
          return (prev + 1) % galleryItems.length;
        });
      } else if (event.key === 'ArrowLeft') {
        setLightboxIndex((prev) => {
          if (prev === null || !galleryItems.length) return prev;
          return (prev - 1 + galleryItems.length) % galleryItems.length;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, galleryItems.length]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // Has the seller ever replied? If not, free-form sending is blocked
  // by WhatsApp (24h window only opens after an inbound message).
  const sellerHasReplied = messages.some((m) => m.direction === 'in');

  async function send() {
    const text = draft.trim();
    const hasPendingImage = pendingImages.length > 0;
    if ((!text && !hasPendingImage) || sending) return;
    if (channel !== 'whatsapp') {
      setError('Email sending is coming soon. Please use WhatsApp for now.');
      return;
    }
    setSending(true);
    setError('');

    const baseTs = Date.now();
    const optimisticTextId = `${OPTIMISTIC_PREFIX}${baseTs}`;
    const optimisticMedia = pendingImages.map((img, idx) => ({
      id: `${OPTIMISTIC_PREFIX}${baseTs}-${idx + 1}`,
      lead_id: lead.id,
      direction: 'out',
      channel: 'whatsapp',
      body: idx === 0 ? (text || null) : null,
      message_type: 'image',
      media_id: null,
      media_urls: [img.previewUrl],
      is_automated: false,
      status: 'sent',
      created_at: new Date(baseTs + idx + 1).toISOString(),
    }));
    const optimisticTextMessage = !hasPendingImage
      ? {
          id: optimisticTextId,
          lead_id: lead.id,
          direction: 'out',
          channel: 'whatsapp',
          body: text,
          is_automated: false,
          status: 'sent',
          created_at: new Date(baseTs).toISOString(),
          media_urls: [],
        }
      : null;

    setMessages((prev) => [
      ...prev,
      ...(optimisticTextMessage ? [optimisticTextMessage] : []),
      ...optimisticMedia,
    ]);
    setDraft('');

    let finalSendOk = true;
    if (hasPendingImage) {
      for (let idx = 0; idx < pendingImages.length; idx += 1) {
        const pending = pendingImages[idx];
        const optimisticId = `${OPTIMISTIC_PREFIX}${baseTs}-${idx + 1}`;
        const uploadForm = new FormData();
        uploadForm.append('file', pending.file);
        const uploadRes = await fetch('/api/upload-media', {
          method: 'POST',
          body: uploadForm,
        });

        if (!uploadRes.ok) {
          const errJson = await uploadRes.json().catch(() => null);
          setError(errJson?.error || 'Could not upload image. Try again.');
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: 'failed' } : m)));
          finalSendOk = false;
          if (idx < pendingImages.length - 1) await wait(250);
          continue;
        }

        const uploadData = await uploadRes.json();
        const mediaId = uploadData?.media_id;
        if (!mediaId) {
          setError('Could not upload image. Try again.');
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: 'failed' } : m)));
          finalSendOk = false;
          if (idx < pendingImages.length - 1) await wait(250);
          continue;
        }

        const sendRes = await fetch('/api/send-whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: lead.id,
            phone: lead.phone,
            media_id: mediaId,
            message: idx === 0 ? (text || null) : null,
            message_type: 'image',
          }),
        });

        if (!sendRes.ok) {
          const errJson = await sendRes.json().catch(() => null);
          setError(errJson?.error || 'Could not send image. Try again.');
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: 'failed' } : m)));
          finalSendOk = false;
          if (idx < pendingImages.length - 1) await wait(250);
          continue;
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticId
              ? { ...m, media_id: mediaId, body: idx === 0 ? (text || null) : null, status: 'sent' }
              : m
          )
        );
        if (idx < pendingImages.length - 1) await wait(250);
      }
    } else {
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          phone: lead.phone,
          message: text,
          message_type: 'text',
        }),
      });

      if (res.ok) {
        setMessages((prev) => prev.map((m) => (m.id === optimisticTextId ? { ...m, status: 'sent' } : m)));
      } else {
        setError('Could not send. Try again.');
        setMessages((prev) => prev.filter((m) => m.id !== optimisticTextId));
        setDraft(text); // restore so they don't lose it
        finalSendOk = false;
      }
    }

    pendingImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setPendingImages([]);

    if (!finalSendOk && text && hasPendingImage) {
      // Keep typed text if image path failed before all sends completed.
      setDraft(text);
    }
    setSending(false);
  }

  async function handleImageSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (channel !== 'whatsapp') {
      setError('Email image sending is coming soon. Please use WhatsApp for now.');
      return;
    }
    const valid = files.filter((f) => f.type?.startsWith('image/'));
    if (!valid.length) {
      setError('Please select image files only.');
      return;
    }

    const oversized = valid.filter((f) => f.size > MAX_IMAGE_PICK_BYTES);
    const candidates = valid.filter((f) => f.size <= MAX_IMAGE_PICK_BYTES);
    if (oversized.length > 0) {
      const names = oversized.map((f) => f.name).join(', ');
      setError(`Skipped ${oversized.length} file(s) over 15MB: ${names}`);
    }
    if (!candidates.length) return;

    const compressedFiles = [];
    for (const file of candidates) {
      const compressed = await compressImageForUpload(file);
      compressedFiles.push(compressed);
    }

    const next = compressedFiles.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...next]);
    if (oversized.length === 0) {
      setError('');
    }
  }

  function removePendingImage(imageId) {
    setPendingImages((prev) => {
      const target = prev.find((img) => img.id === imageId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== imageId);
    });
  }

  function handleThreadScroll(e) {
    const el = e.currentTarget;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = remaining <= 48;
  }

  function openLightboxForMessage(message) {
    const idx = galleryIndexByMessageId[String(message.id)];
    if (typeof idx === 'number') {
      setLightboxIndex(idx);
    }
  }

  function showPrevImage() {
    setLightboxIndex((prev) => {
      if (prev === null || !galleryItems.length) return prev;
      return (prev - 1 + galleryItems.length) % galleryItems.length;
    });
  }

  function showNextImage() {
    setLightboxIndex((prev) => {
      if (prev === null || !galleryItems.length) return prev;
      return (prev + 1) % galleryItems.length;
    });
  }

  const panelUi = (
    <div style={embedded ? panelEmbedded : panel} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {showBackButton && (
              <button onClick={onBack} style={navBtn} aria-label="Back to conversations">←</button>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--smct-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {leadFullName || 'Unknown'}
              </div>
              <div style={{ color: 'var(--smct-muted)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

        <div
          ref={threadRef}
          style={thread}
          className="smct-mobile-scroll-hide"
          onScroll={handleThreadScroll}
        >
          {loading && <p style={{ color: 'var(--smct-muted)', textAlign: 'center' }}>Loading…</p>}
          {!loading && messages.length === 0 && (
            <div style={{ color: 'var(--smct-muted)', textAlign: 'center', marginTop: 40 }}>
              No messages yet. The opener will appear here once it sends.
            </div>
          )}
          {threadItems.map((item) => {
            if (item.type === 'imageGroup') {
              const groupDirection = item.direction;
              const groupMessages = item.messages;
              const single = groupMessages.length === 1;
              return (
                <div
                  key={`group-${groupDirection}-${groupMessages[0]?.id || Math.random()}`}
                  style={{
                    display: 'flex',
                    justifyContent: groupDirection === 'out' ? 'flex-end' : 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  <div style={groupDirection === 'out' ? imageGroupBubbleOut : imageGroupBubbleIn}>
                    <div style={single ? imageGridSingle : imageGrid}>
                      {groupMessages.map((message) => {
                        const resolvedMediaId = getResolvedMediaId(message);
                        const mediaSrc = getMediaSrc(message, resolvedMediaId);
                        return (
                          <button
                            key={message.id}
                            type="button"
                            onClick={() => openLightboxForMessage(message)}
                            style={imageTileButton}
                          >
                            <img
                              src={mediaSrc}
                              alt="message media"
                              style={single ? groupImageLarge : groupImageThumb}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div style={meta}>
                      <span>
                        {new Date(groupMessages[groupMessages.length - 1].created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }

            const m = item.message;
            const mediaType = getMediaType(m);
            const resolvedMediaId = getResolvedMediaId(m);
            const hasProxyMedia = !!resolvedMediaId;
            const mediaSrc = hasProxyMedia ? getMediaSrc(m, resolvedMediaId) : '';
            const displayBody = getDisplayBody(m.body);
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start',
                  marginBottom: 8,
                }}
              >
                <div style={m.direction === 'out' ? bubbleOut : bubbleIn}>
                  {hasProxyMedia && mediaType === 'image' && (
                    <button type="button" onClick={() => openLightboxForMessage(m)} style={imageTileButton}>
                      <img src={mediaSrc} alt="message media" style={messageImage} />
                    </button>
                  )}

                  {hasProxyMedia && mediaType === 'video' && (
                    <video
                      src={mediaSrc}
                      controls
                      playsInline
                      preload="metadata"
                      style={messageVideo}
                    />
                  )}

                  {hasProxyMedia && mediaType === 'audio' && (
                    <audio src={mediaSrc} controls preload="metadata" style={messageAudio} />
                  )}

                  {hasProxyMedia && mediaType === 'document' && (
                    <a href={mediaSrc} target="_blank" rel="noreferrer" style={mediaFileLink}>
                      Open document
                    </a>
                  )}

                  {hasProxyMedia && !['image', 'video', 'audio', 'document'].includes(mediaType) && (
                    <a href={mediaSrc} target="_blank" rel="noreferrer" style={mediaFileLink}>
                      Open attachment
                    </a>
                  )}

                  {displayBody && <div style={{ marginTop: hasProxyMedia ? 8 : 0 }}>{displayBody}</div>}
                  {!hasProxyMedia && looksLikePlaceholderMediaBody(displayBody) && (
                    <div style={missingMediaHint}>
                      Media placeholder only (no media file ID was saved for this message).
                    </div>
                  )}
                  {m.media_urls && m.media_urls.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: displayBody ? 8 : 0 }}>
                      {m.media_urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt="attachment" style={mediaThumb} />
                        </a>
                      ))}
                    </div>
                  )}
                  <div style={meta}>
                    <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {m.direction === 'out' && m.is_automated && <span> · auto</span>}
                    {m.direction === 'out' && m.status === 'failed' && <span> · failed</span>}
                    {m.direction === 'out' && m.status !== 'failed' && (
                      <span style={{ marginLeft: 6, color: getTickStyle(m.status).color }}>
                        {getTickStyle(m.status).label}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div style={composer}>
          {error && <div style={errorBar}>{error}</div>}
          {pendingImages.length > 0 && (
            <div style={pendingImageWrap}>
              {pendingImages.map((img) => (
                <div key={img.id} style={pendingImageItem}>
                  <img src={img.previewUrl} alt="Pending upload preview" style={pendingImageThumb} />
                  <button
                    type="button"
                    onClick={() => removePendingImage(img.id)}
                    className="smct-ghost-btn"
                    style={removeImageBtn}
                    disabled={sending}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {!sellerHasReplied && !loading && messages.length > 0 && (
            <div style={noticeBar}>
              Heads up: until {leadFullName || 'the seller'} replies, WhatsApp only allows approved template messages — a free typed reply may not deliver.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelected}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="smct-ghost-btn"
              style={attachBtn}
              onClick={() => imageInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach image"
              title="Attach image"
            >
              +
            </button>
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
            <button
              onClick={send}
              disabled={sending || (!draft.trim() && pendingImages.length === 0)}
              className="smct-primary-btn"
              style={sendBtn}
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
  );

  const lightboxUi = activeLightboxItem ? (
    <div style={lightboxOverlay} onClick={() => setLightboxIndex(null)}>
      <div style={lightboxPanel} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setLightboxIndex(null)} style={lightboxCloseBtn} aria-label="Close media viewer">
          ✕
        </button>
        {!isMobileViewport && galleryItems.length > 1 && (
          <>
            <button type="button" onClick={showPrevImage} style={{ ...lightboxNavBtn, left: 16 }} aria-label="Previous image">
              ←
            </button>
            <button type="button" onClick={showNextImage} style={{ ...lightboxNavBtn, right: 16 }} aria-label="Next image">
              →
            </button>
          </>
        )}
        <div style={lightboxImageWrap}>
          <img src={activeLightboxItem.src} alt="Expanded media" style={lightboxImage} />
        </div>
        <div style={lightboxThumbStrip} className="smct-mobile-scroll-hide">
          {galleryItems.map((item, index) => (
            <button
              key={`${item.messageId}-${index}`}
              type="button"
              style={{
                ...lightboxThumbBtn,
                ...(index === lightboxIndex ? lightboxThumbBtnActive : null),
              }}
              onClick={() => setLightboxIndex(index)}
              aria-label={`Open image ${index + 1}`}
            >
              <img src={item.src} alt="" style={lightboxThumbImg} />
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  if (embedded) {
    return (
      <>
        {panelUi}
        {lightboxUi}
      </>
    );
  }

  return (
    <>
      <div style={overlay} onClick={onClose}>
        {panelUi}
      </div>
      {lightboxUi}
    </>
  );
}

function mergeMessagesKeepingOptimistic(previous, confirmed) {
  const optimistic = (previous || []).filter(
    (m) => typeof m.id === 'string' && m.id.startsWith(OPTIMISTIC_PREFIX)
  );

  const confirmedAvailable = [...confirmed];
  const unresolvedOptimistic = optimistic.filter((opt) => {
    const optTs = new Date(opt.created_at || 0).getTime();
    const matchIdx = confirmedAvailable.findIndex((msg) => {
      if (msg.direction !== 'out') return false;
      if ((msg.message_type || 'text') !== (opt.message_type || 'text')) return false;
      if (getComparableBody(msg.body) !== getComparableBody(opt.body)) return false;
      if (msg.media_id && opt.media_id && msg.media_id !== opt.media_id) return false;
      const msgTs = new Date(msg.created_at || 0).getTime();
      // Only match to a message created at (or just after) the optimistic timestamp.
      // This prevents older identical messages from incorrectly consuming optimistic entries.
      return msgTs >= optTs - 10 * 1000 && msgTs <= optTs + 5 * 60 * 1000;
    });
    if (matchIdx >= 0) {
      confirmedAvailable.splice(matchIdx, 1);
      return false;
    }
    return true;
  });

  const merged = [...confirmed, ...unresolvedOptimistic];
  merged.sort((a, b) => {
    const aTs = new Date(a.created_at || 0).getTime();
    const bTs = new Date(b.created_at || 0).getTime();
    return aTs - bTs;
  });
  return merged;
}

function getMediaType(message) {
  const type = String(message?.message_type || '').toLowerCase();
  if (['image', 'video', 'audio', 'document'].includes(type)) return type;

  const body = String(getDisplayBody(message?.body) || '').toLowerCase();
  if (body.includes('[video]')) return 'video';
  if (body.includes('[audio]') || body.includes('[voice]')) return 'audio';
  if (body.includes('[document]') || body.includes('[file]')) return 'document';
  if (body.includes('[image]') || body.includes('[photo]')) return 'image';
  return type || 'attachment';
}

function getResolvedMediaId(message) {
  return message?.media_id || extractEmbeddedMediaId(message?.body);
}

function getMediaSrc(message, resolvedMediaId) {
  if (resolvedMediaId) {
    return `/api/get-media?media_id=${encodeURIComponent(resolvedMediaId)}`;
  }
  if (message?.media_urls?.length) {
    return message.media_urls[0];
  }
  return '';
}

function extractEmbeddedMediaId(body) {
  const text = String(body || '');
  const match = text.match(/\[\[media_id:([^\]]+)\]\]/i);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function getDisplayBody(body) {
  return String(body || '')
    .replace(/\s*\[\[media_id:[^\]]+\]\]\s*/gi, ' ')
    .trim();
}

function getComparableBody(body) {
  return getDisplayBody(body).replace(/\s+/g, ' ').trim();
}

function looksLikePlaceholderMediaBody(body) {
  const text = String(body || '').trim().toLowerCase();
  return ['[video]', '[image]', '[audio]', '[document]', '[file]'].includes(text);
}

function buildGalleryItems(messages) {
  return (messages || [])
    .map((message) => {
      const resolvedMediaId = getResolvedMediaId(message);
      const mediaType = getMediaType(message);
      const src = getMediaSrc(message, resolvedMediaId);
      if (mediaType !== 'image' || !src) return null;
      return {
        messageId: String(message.id),
        src,
        createdAt: message.created_at,
      };
    })
    .filter(Boolean);
}

function buildThreadItems(messages) {
  const out = [];
  for (const message of messages || []) {
    const mediaType = getMediaType(message);
    const body = getDisplayBody(message.body);
    const resolvedMediaId = getResolvedMediaId(message);
    const canGroupImage = mediaType === 'image' && !!resolvedMediaId && !body;
    const ts = new Date(message.created_at || 0).getTime();

    if (!canGroupImage) {
      out.push({ type: 'message', message });
      continue;
    }

    const last = out[out.length - 1];
    if (
      last &&
      last.type === 'imageGroup' &&
      last.direction === message.direction &&
      ts - last.lastTimestamp <= IMAGE_GROUP_WINDOW_MS
    ) {
      last.messages.push(message);
      last.lastTimestamp = ts;
      continue;
    }

    out.push({
      type: 'imageGroup',
      direction: message.direction,
      messages: [message],
      lastTimestamp: ts,
    });
  }
  return out;
}

function upsertIncomingMessage(previous, incoming) {
  if (!incoming) return previous;

  const existingIdx = previous.findIndex((m) => m.id === incoming.id);
  if (existingIdx >= 0) {
    const copy = [...previous];
    copy[existingIdx] = { ...copy[existingIdx], ...incoming };
    return copy;
  }

  const incomingTs = new Date(incoming.created_at || 0).getTime();
  const optimisticIdx = previous.findIndex((m) => {
    if (!(typeof m.id === 'string' && m.id.startsWith(OPTIMISTIC_PREFIX))) return false;
    if (m.direction !== incoming.direction) return false;
    if ((m.message_type || 'text') !== (incoming.message_type || 'text')) return false;
    if (getComparableBody(m.body) !== getComparableBody(incoming.body)) return false;
    if (m.media_id && incoming.media_id && m.media_id !== incoming.media_id) return false;
    const optTs = new Date(m.created_at || 0).getTime();
    return incomingTs >= optTs - 10 * 1000 && incomingTs <= optTs + 5 * 60 * 1000;
  });

  const merged = [...previous];
  if (optimisticIdx >= 0) {
    merged[optimisticIdx] = incoming;
  } else {
    merged.push(incoming);
  }

  merged.sort((a, b) => {
    const aTs = new Date(a.created_at || 0).getTime();
    const bTs = new Date(b.created_at || 0).getTime();
    return aTs - bTs;
  });
  return merged;
}

function getTickStyle(status) {
  if (status === 'read') {
    return { label: '✓✓', color: 'var(--smct-status-new)' };
  }
  if (status === 'delivered') {
    return { label: '✓✓', color: 'var(--smct-muted)' };
  }
  return { label: '✓', color: 'var(--smct-muted)' };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function compressImageForUpload(file) {
  if (!(file instanceof File) || !file.type?.startsWith('image/') || file.size <= MAX_IMAGE_UPLOAD_BYTES) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }

    const dimensionSteps = [1920, 1600, 1280, 1024, 800, 640];
    const qualitySteps = [0.82, 0.72, 0.64, 0.56, 0.48, 0.4];

    let bestBlob = null;
    for (const maxDim of dimensionSteps) {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const blob = await canvasToJpegBlob(canvas, quality);
        if (!blob) continue;
        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
        }
        if (blob.size <= MAX_IMAGE_UPLOAD_BYTES) {
          bitmap.close();
          return blobToFile(blob, file.name);
        }
      }
    }

    bitmap.close();
    return bestBlob ? blobToFile(bestBlob, file.name) : file;
  } catch (err) {
    console.error('[conversation] image compression failed', {
      fileName: file.name,
      size: file.size,
      type: file.type,
      error: err,
    });
    return file;
  }
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

function blobToFile(blob, originalName) {
  const base = (originalName || 'image').replace(/\.[a-zA-Z0-9]+$/, '');
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
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
const messageImage = {
  width: 'min(240px, 100%)',
  maxHeight: 280,
  objectFit: 'cover',
  borderRadius: 10,
  display: 'block',
  cursor: 'pointer',
};
const imageTileButton = {
  border: 'none',
  padding: 0,
  margin: 0,
  background: 'transparent',
  cursor: 'pointer',
};
const imageGroupBubbleOut = {
  ...bubbleOut,
  maxWidth: '82%',
  padding: 6,
};
const imageGroupBubbleIn = {
  ...bubbleIn,
  maxWidth: '82%',
  padding: 6,
};
const imageGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 6,
};
const imageGridSingle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 0,
};
const groupImageThumb = {
  width: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'cover',
  borderRadius: 8,
  display: 'block',
};
const groupImageLarge = {
  width: '100%',
  maxHeight: 340,
  objectFit: 'cover',
  borderRadius: 8,
  display: 'block',
};
const messageVideo = {
  width: 'min(320px, 100%)',
  maxHeight: 320,
  borderRadius: 10,
  display: 'block',
  background: '#000',
};
const messageAudio = {
  width: 'min(280px, 100%)',
  marginTop: 2,
};
const mediaFileLink = {
  display: 'inline-block',
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};
const missingMediaHint = {
  marginTop: 6,
  fontSize: 11,
  opacity: 0.72,
};
const lightboxOverlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 210,
  background: 'rgba(4, 10, 7, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
};
const lightboxPanel = {
  width: 'min(1120px, 100%)',
  height: 'min(92vh, 100%)',
  borderRadius: 14,
  background: 'rgba(10, 14, 12, 0.94)',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
};
const lightboxCloseBtn = {
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 2,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
  borderRadius: 10,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 16,
};
const lightboxNavBtn = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 2,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
  borderRadius: 999,
  width: 38,
  height: 38,
  cursor: 'pointer',
  fontSize: 17,
  lineHeight: '36px',
};
const lightboxImageWrap = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 56px 12px',
};
const lightboxImage = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  borderRadius: 10,
};
const lightboxThumbStrip = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  padding: '10px 12px 12px',
  background: 'rgba(0,0,0,0.22)',
};
const lightboxThumbBtn = {
  border: '2px solid transparent',
  borderRadius: 8,
  padding: 0,
  background: 'transparent',
  cursor: 'pointer',
  flex: '0 0 auto',
};
const lightboxThumbBtnActive = {
  borderColor: 'var(--smct-primary)',
};
const lightboxThumbImg = {
  width: 58,
  height: 58,
  objectFit: 'cover',
  borderRadius: 6,
  display: 'block',
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
const attachBtn = {
  minWidth: 44,
  padding: '0 12px',
  fontSize: 22,
  lineHeight: 1,
};
const pendingImageWrap = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  marginBottom: 10,
  padding: 8,
  border: '1px solid var(--smct-border)',
  borderRadius: 10,
  background: 'var(--smct-surface-muted)',
};
const pendingImageItem = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const pendingImageThumb = {
  width: 54,
  height: 54,
  objectFit: 'cover',
  borderRadius: 8,
  display: 'block',
};
const removeImageBtn = {
  padding: '6px 10px',
  fontSize: 12,
};
const errorBar = {
  background: 'var(--smct-danger-soft)', color: 'var(--smct-danger)', fontSize: 12,
  padding: '8px 10px', borderRadius: 8, marginBottom: 8,
};
const noticeBar = {
  background: 'var(--smct-warning-soft)', color: 'var(--smct-warning-text)', fontSize: 12,
  padding: '8px 10px', borderRadius: 8, marginBottom: 8,
};
