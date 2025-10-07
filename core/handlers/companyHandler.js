// core/handlers/companyHandler.js
const { loadKnowledge } = require('../../data/loadData');

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function has(text, ...needles) {
  const t = norm(text);
  return needles.some(n => t.includes(norm(n)));
}

function detectCompanyIntent(text) {
  // Tjenester / "Hva tilbyr dere?"
  if (has(
    text,
    'hva tilbyr dere',
    'hvilke tjenester',
    'hvilke tjenester tilbyr dere',
    'hva gjør dere',
    'hva kan dere hjelpe med',
    'tjenester luna media',
    'hva slags tjenester'
  )) {
    return 'company_services';
  }

  // Adresse / levering til sted
  if (has(
    text,
    'adresse', 'adressen', 'hvor kan jeg levere', 'hvor levere',
    'hvor ligger dere', 'hvor holder dere til', 'hvor holder du til',
    'hvor er dere', 'hvor er dere lokalisert', 'besøksadresse', 'leveringsadresse'
  )) {
    return 'company_address';
  }

  // Åpningstider / når åpent
  if (has(text, 'åpningstid', 'apningstid', 'åpent', 'apent', 'når har dere åpent', 'er det åpent nå', 'nar har dere apent')) {
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
  if (has(text, 'leveringstid', 'hvor lang tid', 'tar det lang tid å få ferdig', 'må jeg vente lenge', 'når ferdig')) {
    return 'company_delivery';
  }

  // Henting/levering (lokal logistikk)
  if (has(
    text,
    'henter dere', 'henting', 'leverer dere', 'levering',
    'kan dere hente', 'kan dere levere', 'hent og lever',
    'hent/lever', 'hente levert', 'hjemhenting'
  )) {
    return 'company_pickup_delivery';
  }

  return null;
}

function handleCompanyIntent(intent, meta) {
  if (!meta || !meta.company) return null;
  const c = meta.company;
  const d = meta.delivery || {};
  const services = Array.isArray(meta.services) ? meta.services : [];

  switch (intent) {
    case 'company_services': {
      if (services.length > 0) {
        const bullets = services
          .map(s => `• ${s.navn}${s.beskrivelse ? ` – ${s.beskrivelse}` : ''}`)
          .join('\n');
        return {
          type: 'answer',
          text:
            `Vi tilbyr:\n${bullets}\n\n` +
            `Vil du at vi sender et uforpliktende estimat/tilbud?`,
          meta: { source: c._source }
        };
      }
      // Fallback hvis services mangler i meta
      return {
        type: 'answer',
        text:
          `Vi digitaliserer video (VHS, Video8/Hi8, MiniDV m.fl.), smalfilm (8 mm/Super 8/16 mm), ` +
          `skanner foto/dias/negativer, tilbyr videoproduksjon (arrangement/bedrift), droneopptak og fotorestaurering. ` +
          `Vil du ha et uforpliktende tilbud?`,
        meta: { source: c._source }
      };
    }

    case 'company_address':
      return {
        type: 'answer',
        text:
          `Du kan levere oppdrag hos oss på:\n\n` +
          (c.adresser?.tonsberg ? `• ${c.adresser.tonsberg}\n` : '') +
          (c.adresser?.oslo ? `• ${c.adresser.oslo}\n` : '') +
          `\nVi tar også imot postforsendelser. Ring eller send e-post om du vil avtale innlevering og/eller få et prisestimat.`,
        meta: { source: c._source }
      };

    case 'company_hours':
      return {
        type: 'answer',
        text:
          `Våre åpningstider:\n` +
          (c.apningstider?.hverdager ? `• Hverdager: ${c.apningstider.hverdager}\n` : '') +
          (c.apningstider?.lordag ? `• Lørdag: ${c.apningstider.lordag}\n` : '') +
          (c.apningstider?.sondag ? `• Søndag: ${c.apningstider.sondag}\n` : ''),
        meta: { source: c._source }
      };

    case 'company_phone':
      return { type: 'answer', text: `Telefon: ${c.telefon}`, meta: { source: c._source } };

    case 'company_email':
      return { type: 'answer', text: `E-post: ${c.epost}`, meta: { source: c._source } };

    case 'company_delivery':
      return {
        type: 'answer',
        text:
          `Leveringstid er normalt ${d.standard_dager || 'noen dager'}. ` +
          (d.rush_mulig ? `Ekspress kan være mulig (${d.rush_tillegg}).` : ''),
        meta: { source: d._source || c._source }
      };

    case 'company_pickup_delivery':
      return {
        type: 'answer',
        text:
          `Vi henter og leverer materiale i Vestfold. Fra andre steder i landet har vi andre løsninger. ` +
          `Vennligst ta kontakt på telefon eller e-post for å gjøre en avtale.`,
        meta: { source: c._source }
      };

    default:
      return null;
  }
}

module.exports = { detectCompanyIntent, handleCompanyIntent };
