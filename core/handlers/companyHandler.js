// core/handlers/companyHandler.js
const { loadKnowledge } = require('../../data/loadData');

function safeNorm(s) {
  try {
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    // Fallback hvis \p{Letter} ikke støttes i regex-motoren
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9æøåéèüöß\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function has(text, ...needles) {
  const t = safeNorm(text);
  return needles.some(n => t.includes(safeNorm(n)));
}

function detectCompanyIntent(text) {
  if (!text) return null;
  // Adresse
  if (has(text, 'adresse', 'adressen', 'hvor kan jeg levere', 'hvor levere', 'hvor ligger dere', 'leveringssteder')) {
    return 'company_address';
  }
  // Åpningstider
  if (has(text, 'åpningstid', 'apningstid', 'åpent', 'apent', 'når har dere åpent', 'nar har dere apent', 'åpner', 'stengt')) {
    return 'company_hours';
  }
  // Telefon
  if (has(text, 'telefon', 'telefonnummer', 'ring', 'nummeret deres')) {
    return 'company_phone';
  }
  // E-post
  if (has(text, 'epost', 'e-post', 'email', 'mail')) {
    return 'company_email';
  }
  // Leveringstid (praktisk)
  if (has(text, 'leveringstid', 'hvor lang tid', 'når ferdig', 'ventetid')) {
    return 'company_delivery';
  }
  return null;
}

function handleCompanyIntent(intent, meta) {
  try {
    const m = meta || {};
    const c = m.company || {};
    const d = m.delivery || {};

    const src = c._source || d._source || m._source || null;

    switch (intent) {
      case 'company_address': {
        const tbg = c.adresser && c.adresser.tonsberg ? `• ${c.adresser.tonsberg}\n` : '';
        const osl = c.adresser && c.adresser.oslo ? `• ${c.adresser.oslo}\n` : '';
        const lines = (tbg + osl).trim();
        if (!lines) return null;
        return {
          type: 'answer',
          text: `Du kan levere hos oss på:\n\n${lines}\n\nVi tar også imot postforsendelser.`,
          meta: src ? { source: src } : undefined
        };
      }
      case 'company_hours': {
        const hv = c.apningstider && c.apningstider.hverdager ? `• Hverdager: ${c.apningstider.hverdager}\n` : '';
        const lo = c.apningstider && c.apningstider.lordag ? `• Lørdag: ${c.apningstider.lordag}\n` : '';
        const so = c.apningstider && c.apningstider.sondag ? `• Søndag: ${c.apningstider.sondag}\n` : '';
        const txt = (hv + lo + so).trim();
        if (!txt) return null;
        return { type: 'answer', text: `Våre åpningstider:\n${txt}\n`, meta: src ? { source: src } : undefined };
      }
      case 'company_phone': {
        if (!c.telefon) return null;
        return { type: 'answer', text: `Telefon: ${c.telefon}`, meta: src ? { source: src } : undefined };
      }
      case 'company_email': {
        if (!c.epost) return null;
        return { type: 'answer', text: `E-post: ${c.epost}`, meta: src ? { source: src } : undefined };
      }
      case 'company_delivery': {
        const std = d.standard_dager ? `${d.standard_dager}` : null;
        const rush = d.rush_mulig ? ` Ekspress kan være mulig${d.rush_tillegg ? ` (${d.rush_tillegg})` : ''}.` : '';
        if (!std && !rush) return null;
        return {
          type: 'answer',
          text: `Leveringstid er normalt ${std || 'noen dager'}.${rush ? rush : ''}`,
          meta: src ? { source: src } : undefined
        };
      }
      default:
        return null;
    }
  } catch {
    // Aldri kast videre – returnér heller null så kjernen kan prøve neste handler eller fallback
    return null;
  }
}

module.exports = { detectCompanyIntent, handleCompanyIntent };
