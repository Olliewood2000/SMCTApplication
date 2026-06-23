'use client';

import { useState, useEffect, useCallback } from 'react';
import LeadsSection from '../components/LeadsSection';
import MessagesSection from '../components/MessagesSection';

const NAV_ITEMS = [
  {
    key: 'leads',
    label: 'Leads',
    subtitle: 'Track and update sellers with clean, fast lead actions.',
    title: 'Leads pipeline',
    Icon: LeadsIcon,
  },
  {
    key: 'messages',
    label: 'Messages',
    subtitle: 'Manage ongoing chats and stay on top of replies.',
    title: 'Customer messages',
    Icon: MessagesIcon,
  },
];

export default function Page() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [band, setBand] = useState('all');
  const [activeTab, setActiveTab] = useState('leads');
  const [focusLeadId, setFocusLeadId] = useState(null);
  const [messagesRefreshSignal, setMessagesRefreshSignal] = useState(0);

  const loadLeads = useCallback(async (bandFilter) => {
    setLoading(true);
    const res = await fetch(`/api/leads?band=${encodeURIComponent(bandFilter)}`);
    if (res.status === 401) {
      setAuthed(false);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setLeads(data.leads || []);
    setAuthed(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLeads(band);
  }, [band, loadLeads]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthed(true);
      loadLeads(band);
    } else {
      setLoginError('Wrong password');
    }
  }

  async function updateLead(id, fields) {
    const res = await fetch('/api/leads/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, fields }),
    });
    if (res.ok) {
      const { lead } = await res.json();
      setLeads((prev) => prev.map((l) => (l.id === id ? lead : l)));
    }
  }

  // ---------- Login screen ----------
  if (!authed) {
    return (
      <div style={loginWrap}>
        <div className="smct-card" style={loginCard}>
          <h1 style={{ fontSize: 28, marginBottom: 6, marginTop: 0 }}>SMCT Leads</h1>
          <p style={{ color: 'var(--smct-muted)', marginTop: 0, marginBottom: 22, fontSize: 14 }}>
            Enter your dashboard password
          </p>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={inputStyle}
              autoFocus
            />
            <button type="submit" className="smct-primary-btn" style={{ width: '100%', marginTop: 12 }}>
              Log in
            </button>
            {loginError && (
              <p style={{ color: 'var(--smct-danger)', fontSize: 13, marginTop: 10 }}>{loginError}</p>
            )}
          </form>
        </div>
      </div>
    );
  }

  function openMessagesForLead(lead) {
    setFocusLeadId(lead.id);
    setActiveTab('messages');
  }

  return (
    <div className="smct-app-shell">
      <aside className="smct-sidebar">
        <div className="smct-sidebar-brand">
          <div className="smct-logo">SM</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--smct-text)' }}>
              Sell My Cars Today
            </div>
            <div style={{ fontSize: 12, color: 'var(--smct-muted)' }}>
              Lead workspace
            </div>
          </div>
        </div>
        <nav className="smct-sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`smct-nav-item ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => setActiveTab(item.key)}
            >
              <item.Icon />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="smct-sidebar-footer">
          <button className="smct-nav-item">
            <SettingsIcon />
            Settings
          </button>
          <button className="smct-nav-item">
            <AccountIcon />
            Account
          </button>
        </div>
      </aside>

      <section className={`smct-main ${activeTab === 'messages' ? 'smct-main-messages' : ''}`}>
        <div className="smct-mobile-brand">
          <div className="smct-logo">SM</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--smct-text)' }}>
                  Sell My Cars Today
                </div>
                <div style={{ fontSize: 11, color: 'var(--smct-muted)' }}>
                  Lead workspace
                </div>
              </div>
              {activeTab === 'messages' && (
                <button
                  className="smct-ghost-btn smct-mobile-brand-refresh"
                  onClick={() => setMessagesRefreshSignal((v) => v + 1)}
                >
                  Refresh
                </button>
              )}
            </div>
          </div>
        </div>
        <div className={`smct-content ${activeTab === 'messages' ? 'smct-content-messages' : ''}`}>
          {activeTab === 'leads' ? (
            <LeadsSection
              leads={leads}
              loading={loading}
              band={band}
              onBandChange={setBand}
              onRefresh={() => loadLeads(band)}
              onUpdateLead={updateLead}
              onOpenMessages={openMessagesForLead}
            />
          ) : (
            <MessagesSection focusLeadId={focusLeadId} refreshSignal={messagesRefreshSignal} />
          )}
        </div>
      </section>

      <nav className="smct-mobile-bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`smct-mobile-nav-item ${activeTab === item.key ? 'active' : ''}`}
            onClick={() => setActiveTab(item.key)}
          >
            <item.Icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--smct-border)', background: 'var(--smct-surface)', color: 'var(--smct-text)',
  fontSize: 15, boxSizing: 'border-box',
};
const loginWrap = {
  minHeight: '100vh',
  background: 'linear-gradient(180deg, var(--smct-section) 0%, var(--smct-login-gradient-end) 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 18,
};
const loginCard = {
  width: '100%',
  maxWidth: 420,
  padding: 24,
};

function LeadsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <line x1="4.2" y1="6" x2="11.8" y2="6" stroke="currentColor" strokeWidth="1.3" />
      <line x1="4.2" y1="9" x2="9.8" y2="9" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function MessagesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5.4a2 2 0 0 1-2 2H8l-3 2V10.6H4.5a2 2 0 0 1-2-2V3.2Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm0-1.4 1.1.2.4 1.5a5.6 5.6 0 0 1 1.2.7l1.5-.5.8.9-.7 1.4a5.7 5.7 0 0 1 .1 1.4l1.2 1-.2 1.2-1.5.4a5.7 5.7 0 0 1-.7 1.2l.5 1.5-.9.8-1.4-.7a5.7 5.7 0 0 1-1.4.1l-1 1.2-1.2-.2-.4-1.5a5.7 5.7 0 0 1-1.2-.7l-1.5.5-.8-.9.7-1.4a5.7 5.7 0 0 1-.1-1.4L1.7 8l.2-1.2 1.5-.4c.2-.4.4-.8.7-1.2l-.5-1.5.9-.8 1.4.7c.5-.1.9-.1 1.4-.1l1-1.2Z" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5.2" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.2 13.4c.8-2 2.4-3 4.8-3s4 .9 4.8 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
