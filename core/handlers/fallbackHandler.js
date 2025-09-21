// core/handlers/fallbackHandler.js
const { loadKnowledge } = require('../../data/loadData');

function fallbackHandler(input) {
  const polite =
    'Jeg er ikke helt sikker – men jeg kan sjekke kunnskapsbasen nærmere om du spesifiserer hva du lurer på.';
  return { type: 'answer', text: polite };
}

// Eksporter både named og default for å være kompatibel uansett import
module.exports = { fallbackHandler };
module.exports.default = fallbackHandler;
