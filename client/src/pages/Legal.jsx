import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Legal() {
  const { type } = useParams();
  const { t }    = useTranslation();
  return (
    <div style={{ padding: 24, maxWidth: 700, margin: '0 auto', lineHeight: 1.8, color: 'var(--text2)', fontSize: 13 }}>
      {type === 'imprint' ? (
        <><h1 style={{ color: 'var(--text)', marginBottom: 16 }}>{t('imprint')}</h1>
        <p>Verantwortlich: [DEIN NAME]<br/>Adresse: [ADRESSE]<br/>E-Mail: [E-MAIL]</p></>
      ) : (
        <><h1 style={{ color: 'var(--text)', marginBottom: 16 }}>{t('privacy')}</h1>
        <p><b>Verantwortlicher:</b> [DEIN NAME]</p>
        <h3 style={{ margin:'16px 0 8px',color:'var(--text)' }}>Erhobene Daten</h3>
        <p>E-Mail, Benutzername, Spielstatistiken.</p>
        <h3 style={{ margin:'16px 0 8px',color:'var(--text)' }}>Rechte (DSGVO Art. 15–17)</h3>
        <p>Auskunft, Berichtigung, Löschung: [E-MAIL]</p>
        <h3 style={{ margin:'16px 0 8px',color:'var(--text)' }}>Cookies</h3>
        <p>Nur technisch notwendige Auth-Cookies. Kein Tracking.</p></>
      )}
    </div>
  );
}
