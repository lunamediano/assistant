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

  // Leveringstid (praktisk/turnaround)
  if (has(text, 'leveringstid', 'hvor lang tid', 'tar det lang tid å få ferdig', 'må jeg vente lenge', 'når ferdig')) {
    return 'company_delivery';
  }

  // Henting/levering (pickup/bring/utkjøring)
  if (has(
    text,
    'henting', 'henter dere', 'kan dere hente', 'hente hos meg', 'hent og bring',
    'leverer dere', 'levering hjemme', 'utkjøring', 'bud', 'transport', 'hente/levere'
  )) {
    return 'company_pickup';
  }

  return null;
}

function handleCompanyIntent(intent, meta) {
  if (!meta || !meta.company) return null;
  const c = meta.company;
  const d = meta.delivery || {};

  switch (intent) {
    case 'company_address':
      return {
        type: 'answer',
        text:
          `Om du ønsker, så kan du levere oppdrag til hos oss på:\n\n` +
          (c.adresser?.tonsberg ? `• ${c.adresser.tonsberg}\n` : '') +
          (c.adresser?.oslo ? `• ${c.adresser.oslo}\n` : '') +
          `\nVi tar også imot postforsendelser. Men ring oss gjerne, eller skriv en e-post, for å få et nøyaktig prisestimat, og/eller for å gjøre en avtale om innlevering av materiale.`,
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

    case 'company_pickup':
      return {
        type: 'answer',
        text:
          `Vi henter og leverer materiale i Vestfold. Fra andre steder i landet har vi andre løsninger. ` +
          `Vennligst ta kontakt på telefon ${c.telefon || ''}`.trim() +
          `${c.telefon && c.epost ? ' eller ' : ''}` +
          `${c.epost ? `e-post ${c.epost}` : ''}` +
          ` for å gjøre en avtale.`,
        meta: { source: c._source }
      };

    default:
      return null;
  }
}

module.exports = { detectCompanyIntent, handleCompanyIntent };
