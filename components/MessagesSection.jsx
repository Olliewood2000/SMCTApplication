'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Conversation from './Conversation';
import { getBrowserSupabase } from '../lib/supabase-client';

export default function MessagesSection({ focusLeadId, refreshSignal = 0 }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  const loadLeads = useCallback(async () => {
    const res = await fetch('/api/leads?band=all');
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();
    setLeads(data.leads || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLeads();
    const timer = setInterval(loadLeads, 8000);
    return () => clearInterval(timer);
  }, [loadLeads]);

  useEffect(() => {
    if (refreshSignal > 0) {
      loadLeads();
    }
  }, [refreshSignal, loadLeads]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return undefined;

    const channel = supabase
      .channel('leads:list')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leads' },
        (payload) => {
          setLeads((prev) =>
            prev.map((lead) => (lead.id === payload.new.id ? { ...lead, ...payload.new } : lead))
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leads' },
        (payload) => {
          setLeads((prev) => {
            if (prev.some((lead) => lead.id === payload.new.id)) return prev;
            return [payload.new, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [leads]);

  useEffect(() => {
    if (!sortedLeads.length) return;
    if (focusLeadId) {
      const match = sortedLeads.find((lead) => lead.id === focusLeadId);
      if (match) {
        setSelectedLead(match);
        return;
      }
    }
    if (!isMobile && !selectedLead) {
      setSelectedLead(sortedLeads[0]);
    }
  }, [sortedLeads, focusLeadId, isMobile, selectedLead]);

  useEffect(() => {
    if (!selectedLead) return;
    const refreshed = sortedLeads.find((lead) => lead.id === selectedLead.id);
    if (refreshed) setSelectedLead(refreshed);
  }, [sortedLeads, selectedLead]);

  const listPane = (
    <div style={listPaneStyle} className="smct-mobile-scroll-hide">
      {!isMobile && (
        <div style={listHeader}>
          <div>
            <div className="smct-section-label">Inbox</div>
            <h2 style={{ margin: '2px 0 0', fontSize: 18, color: 'var(--smct-text)' }}>Conversations</h2>
          </div>
          <button onClick={loadLeads} className="smct-ghost-btn" style={iconButton}>Refresh</button>
        </div>
      )}
      {loading && <p style={{ color: 'var(--smct-muted)', padding: '0 12px' }}>Loading…</p>}
      {!loading && sortedLeads.length === 0 && (
        <div className="smct-empty-state" style={{ minHeight: 220 }}>
          <div className="smct-empty-icon">M</div>
          <h3 style={{ margin: 0, color: 'var(--smct-text)' }}>No conversations yet</h3>
          <p style={{ margin: 0, color: 'var(--smct-muted)', fontSize: 14 }}>
            Once sellers reply, their threads will appear here.
          </p>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sortedLeads.map((lead) => {
          const active = selectedLead?.id === lead.id;
          const leadFullName = `${lead.first_name || lead['first name'] || ''} ${lead.last_name || lead['last name'] || ''}`.trim();
          return (
            <button
              key={lead.id}
              className="smct-interactive-row smct-message-row"
              style={{
                ...threadRow,
                ...(active ? threadRowActive : null),
              }}
              onClick={() => setSelectedLead(lead)}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                <div style={avatarCircle}>
                  {getInitials(leadFullName)}
                </div>
                <div style={{ minWidth: 0 }}>
                <div style={nameLine}>{leadFullName || 'Unknown seller'}</div>
                <div style={vehicleLine}>{lead.year} {lead.make} {lead.model}</div>
                <div style={previewLine}>{lead.last_message_preview || 'No messages yet'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <span style={timeStyle}>{formatInboxTime(lead.last_message_at)}</span>
                {lead.unread_count > 0 && <span style={badge}>{lead.unread_count}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const chatPane = selectedLead ? (
    <Conversation
      lead={selectedLead}
      embedded
      onBack={isMobile ? () => setSelectedLead(null) : null}
      showBackButton={isMobile}
      showChannelToggle
    />
  ) : (
    <div style={emptyState}>
      <div className="smct-empty-state" style={{ minHeight: 260 }}>
        <div className="smct-empty-icon">C</div>
        <h3 style={{ margin: 0, color: 'var(--smct-text)' }}>Select a conversation</h3>
        <p style={{ margin: 0, color: 'var(--smct-muted)', fontSize: 14 }}>
          Choose a lead on the left to open the chat thread.
        </p>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div style={mobileWrap}>
        <div
          style={{
            ...mobilePane,
            transform: selectedLead ? 'translateX(-6%)' : 'translateX(0)',
            opacity: selectedLead ? 0 : 1,
            pointerEvents: selectedLead ? 'none' : 'auto',
          }}
        >
          {listPane}
        </div>
        <div
          style={{
            ...mobilePane,
            transform: selectedLead ? 'translateX(0)' : 'translateX(6%)',
            opacity: selectedLead ? 1 : 0,
            pointerEvents: selectedLead ? 'auto' : 'none',
          }}
        >
          {chatPane}
        </div>
      </div>
    );
  }

  return (
    <div style={desktopWrap}>
      <div style={{ ...desktopPane, width: 360 }}>{listPane}</div>
      <div style={{ ...desktopPane, ...chatDesktopPane, flex: 1 }}>{chatPane}</div>
    </div>
  );
}

function formatInboxTime(value) {
  if (!value) return '';
  const d = new Date(value);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

function getInitials(name) {
  if (!name) return 'S';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'S';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

const desktopWrap = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  margin: 0,
  display: 'flex',
  border: 'none',
  borderRadius: 0,
  overflow: 'hidden',
  background: 'var(--smct-section)',
  boxShadow: 'none',
};
const desktopPane = {
  minHeight: 0,
};
const chatDesktopPane = {
  borderLeft: '1px solid var(--smct-pane-separator)',
  boxShadow: 'var(--smct-pane-inset-shadow)',
  background: 'var(--smct-chat-thread-bg)',
};
const listPaneStyle = {
  height: '100%',
  overflowY: 'auto',
  borderRight: '1px solid var(--smct-border)',
  background: 'var(--smct-surface)',
};
const listHeader = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--smct-surface)',
  padding: '14px 12px',
  borderBottom: '1px solid var(--smct-border)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
const iconButton = {
  padding: '8px 10px',
};
const threadRow = {
  width: '100%',
  border: '1px solid transparent',
  borderBottom: '1px solid var(--smct-border)',
  background: 'var(--smct-surface)',
  color: 'var(--smct-text)',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  textAlign: 'left',
  padding: '14px 12px',
  cursor: 'pointer',
};
const threadRowActive = {
  background: 'var(--smct-primary-soft)',
  borderColor: 'var(--smct-pane-separator)',
  boxShadow: 'inset 3px 0 0 var(--smct-primary)',
};
const nameLine = {
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 2,
};
const vehicleLine = {
  fontSize: 12,
  color: 'var(--smct-muted)',
  marginBottom: 4,
};
const previewLine = {
  fontSize: 13,
  color: 'var(--smct-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 220,
};
const timeStyle = {
  fontSize: 11,
  color: 'var(--smct-muted)',
};
const badge = {
  minWidth: 20,
  height: 20,
  borderRadius: 10,
  background: 'var(--smct-primary)',
  color: 'var(--smct-text-inverse)',
  fontSize: 11,
  lineHeight: '20px',
  textAlign: 'center',
  padding: '0 6px',
};
const emptyState = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--smct-text)',
  background: 'var(--smct-surface)',
};
const avatarCircle = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  background: 'var(--smct-avatar-bg)',
  color: 'var(--smct-avatar-text)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
};
const mobileWrap = {
  position: 'relative',
  height: 'calc(100dvh - 160px)',
  overflow: 'hidden',
  borderTop: 'none',
  borderRadius: 0,
};
const mobilePane = {
  position: 'absolute',
  inset: 0,
  transition: 'transform 180ms ease, opacity 180ms ease',
  background: 'var(--smct-surface)',
  willChange: 'transform, opacity',
};
