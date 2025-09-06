// assistant/handlers/companyHandler.js
const { loadKnowledge } = require('../../data/loadData');

function detectCompanyIntent(text) {
  const lower = text.toLowerCase();

  if (lower.includes('adresse') || lower.includes('hvor ligger') || lower.includes('hvor kan jeg levere')) {
    return 'company_address';
  }
  if (lower.includes('åpningstid') || lower.includes('åpent') || lower.includes('når har dere åpent')) {
    return 'company_hours';
  }
  if (lower.includes('telefon') || lower.includes('nummer') || lower.includes('ring')) {
    return 'company_phone';
  }
  if (lower.includes('epost') || lower.includes('email') || lower.includes('mail')) {
    return 'company_email';
  }
  if (lower.includes('leveringstid') || lower.includes('hvor lang tid')) {
    return 'company_delivery';
  }

  return null;
}

function handleCompanyIntent(intent, meta) {
  if (!meta || !meta.company) return null;

  const c = meta.company;
  const d = meta.delivery || {};
  const p = meta.prices || {};

  switch (intent) {
    case 'company_address':
      return {
        type: 'answer',
        text: `Du kan levere hos oss på:\n\n- ${c.adresser?.tonsberg}\n- ${c.adresser?.oslo}\n\nVi tar også imot postforsendelser.`,
        meta: { source: c._source }
      };
    case 'company_hours':
      return {
        type: 'answer',
        text: `Våre åpningstider er:\n- Hverdager: ${c.apningstider?.hverdager}\n- Lørdag: ${c.apningstider?.lordag}\n- Søndag: ${c.apningstider?.sondag}`,
        meta: { source: c._source }
      };
    case 'company_phone':
      return {
        type: 'answer',
        text: `Telefonnummeret vårt er ${c.telefon}.`,
        meta: { source: c._source }
      };
    case 'company_email':
      return {
        type: 'answer',
        text: `Du kan kontakte oss på e-post: ${c.epost}`,
        meta: { source: c._source }
      };
    case 'company_delivery':
      return {
        type: 'answer',
        text: `Leveringstid er normalt ${d.standard_dager || 'noen dager'}. ` +
              (d.rush_mulig ? `Ekspress er mulig (${d.rush_tillegg}).` : ''),
        meta: { source: d._source || c._source }
      };
    default:
      return null;
  }
}

module.exports = { detectCompanyIntent, handleCompanyIntent };
