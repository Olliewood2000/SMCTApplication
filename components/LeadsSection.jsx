'use client';

import { useState } from 'react';

const STATUSES = [
  'New', 'Contacted', 'Info received', 'Decision',
  'Buying', 'Passed to dealers', 'Sold to dealer', 'Dead',
];

const STATUS_STYLES = {
  New: { text: 'var(--smct-status-new)', bg: 'var(--smct-status-new-soft)' },
  Contacted: { text: 'var(--smct-status-contacted)', bg: 'var(--smct-status-contacted-soft)' },
  'Info received': { text: 'var(--smct-status-info)', bg: 'var(--smct-status-info-soft)' },
  Decision: { text: 'var(--smct-status-decision)', bg: 'var(--smct-status-decision-soft)' },
  Buying: { text: 'var(--smct-status-buying)', bg: 'var(--smct-status-buying-soft)' },
  'Passed to dealers': { text: 'var(--smct-status-passed)', bg: 'var(--smct-status-passed-soft)' },
  'Sold to dealer': { text: 'var(--smct-status-sold)', bg: 'var(--smct-status-sold-soft)' },
  Dead: { text: 'var(--smct-status-dead)', bg: 'var(--smct-status-dead-soft)' },
};

export default function LeadsSection({
  leads,
  loading,
  band,
  onBandChange,
  onRefresh,
  onUpdateLead,
  onOpenMessages,
}) {
  const [expanded, setExpanded] = useState(null);
  const counts = {
    all: leads.length,
    SMCT: leads.filter((l) => l.band === 'SMCT').length,
    dealer: leads.filter((l) => l.band === 'Dealer source').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="smct-section-label">Lead list</div>
          <h2 style={{ margin: '3px 0 0', fontSize: 20, color: 'var(--smct-text)' }}>Active conversations</h2>
        </div>
        <button onClick={onRefresh} className="smct-ghost-btn">Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <FilterTab label={`All (${counts.all})`} active={band === 'all'} onClick={() => onBandChange('all')} />
        <FilterTab label={`SMCT (${counts.SMCT})`} active={band === 'SMCT'} onClick={() => onBandChange('SMCT')} />
        <FilterTab label={`Dealer source (${counts.dealer})`} active={band === 'Dealer source'} onClick={() => onBandChange('Dealer source')} />
      </div>

      {loading && <p style={{ color: 'var(--smct-muted)' }}>Loading…</p>}
      {!loading && leads.length === 0 && (
        <div className="smct-card smct-empty-state">
          <div className="smct-empty-icon">L</div>
          <h3 style={{ margin: 0, color: 'var(--smct-text)' }}>No leads yet</h3>
          <p style={{ margin: 0, color: 'var(--smct-muted)', fontSize: 14 }}>
            New sellers from your automation will appear here automatically.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {leads.map((lead) => {
          const isOpen = expanded === lead.id;
          const statusStyle = STATUS_STYLES[lead.status] || { text: 'var(--smct-muted)', bg: 'var(--smct-section)' };
          const leadFullName = `${lead.first_name || lead['first name'] || ''} ${lead.last_name || lead['last name'] || ''}`.trim();
          return (
            <div key={lead.id} style={cardStyle} className="smct-card">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer', gap: 10 }}
                onClick={() => setExpanded(isOpen ? null : lead.id)}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {lead.year} {lead.make} {lead.model}
                  </div>
                  <div style={{ color: 'var(--smct-muted)', fontSize: 13, marginTop: 2 }}>
                    {lead.reg} · {lead.mileage ? lead.mileage.toLocaleString() + ' mi' : '—'} · {leadFullName || '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 999, fontWeight: 600,
                    background: lead.band === 'SMCT' ? 'var(--smct-primary-soft)' : 'var(--smct-tag-soft)',
                    color: 'var(--smct-primary)',
                  }}>
                    {lead.band}
                  </span>
                  <span style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 999, fontWeight: 600,
                    background: statusStyle.bg,
                    color: statusStyle.text,
                  }}>
                    {lead.status}
                  </span>
                </div>
              </div>

              {isOpen && (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--smct-border)', paddingTop: 14 }}>
                  <Detail label="Reg" value={lead.reg} />
                  <Detail label="Fuel / engine" value={`${lead.fuel || '—'} · ${lead.engine || '—'}`} />
                  <Detail label="Colour" value={lead.colour} />
                  <Detail label="Transmission" value={lead.transmission} />
                  <Detail label="Condition" value={lead.condition} />
                  <Detail label="MOT" value={`${lead.mot_status || '—'} · exp ${lead.mot_expiry || '—'}`} />
                  <Detail label="Mileage" value={lead.mileage ? lead.mileage.toLocaleString() : '—'} />
                  <Detail label="Email" value={lead.email} />
                  <Detail label="Phone" value={lead.phone} />
                  <Detail label="Postcode" value={lead.postcode} />
                  <Detail label="Asking price" value={lead.asking_price ? '£' + lead.asking_price : '—'} />
                  {lead.last_action && (
                    <Detail label="Last action" value={`${lead.last_action}${lead.last_action_at ? ' · ' + new Date(lead.last_action_at).toLocaleString() : ''}`} />
                  )}

                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Status</label>
                    <select
                      value={lead.status}
                      onChange={(e) => onUpdateLead(lead.id, { status: e.target.value })}
                      style={selectStyle}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    {lead.band !== 'Dealer source' && (
                      <button
                        className="smct-primary-btn"
                        onClick={() => onUpdateLead(lead.id, { band: 'Dealer source', status: 'Passed to dealers' })}
                      >
                        Push to dealer
                      </button>
                    )}
                    <a href={`tel:${lead.phone}`} className="smct-ghost-btn" style={{ textDecoration: 'none' }}>Call</a>
                    <a href={`mailto:${lead.email}`} className="smct-ghost-btn" style={{ textDecoration: 'none' }}>Email</a>
                    <button className="smct-ghost-btn" onClick={() => onOpenMessages(lead)}>Messages</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer', fontWeight: 600,
        border: `1px solid ${active ? 'var(--smct-primary)' : 'var(--smct-border)'}`,
        background: active ? 'var(--smct-primary-soft)' : 'var(--smct-surface)',
        color: active ? 'var(--smct-primary)' : 'var(--smct-muted)',
      }}
    >
      {label}
    </button>
  );
}

function Detail({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--smct-muted)' }}>{label}</span>
      <span style={{ textAlign: 'right', marginLeft: 12 }}>{value}</span>
    </div>
  );
}

const cardStyle = {
  background: 'var(--smct-surface)',
  border: '1px solid var(--smct-border)',
  borderRadius: 16,
  padding: 16,
  cursor: 'pointer',
};
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--smct-border)', background: 'var(--smct-surface)', color: 'var(--smct-text)',
  fontSize: 15, boxSizing: 'border-box',
};
const selectStyle = { ...inputStyle, marginTop: 4 };
const labelStyle = { fontSize: 12, color: 'var(--smct-muted)' };
