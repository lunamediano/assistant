const { loadKnowledge } = require('../data/loadData');

(function main() {
  const data = loadKnowledge();
  console.log('Lest filer:', data.files.length);
  console.log('FAQ-poster:', data.count.faq);
  console.log(
    'Første 3 FAQ:',
    data.faq.slice(0, 3).map(x => ({ id: x.id, q: x.q, src: x.source }))
  );
})();
