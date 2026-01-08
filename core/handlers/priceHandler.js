function handlePriceIntent(priceIntent, meta) {
  if (!priceIntent) return null;

  const url = 'https://lunamedia.no/priskalkulator';

  return {
    type: 'answer',
    text:
      `For pris: bruk vår priskalkulator her:\n` +
      `${url}\n\n` +
      `Der får du raskt pris basert på type materiale og omfang.`,
    meta: {
      ...(meta || {}),
      source: 'price-handler',
      action: 'redirect',
      url
    }
  };
}
