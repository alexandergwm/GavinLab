/** Lazy boundary for non-critical search parsing and currency conversion. */
let intelligencePromise = null;

export function getSearchIntelligence() {
  intelligencePromise ||= Promise.all([
    import('./smart-input.js'),
    import('./currency.js'),
  ]).then(([smart, currency]) => ({
    buildSmartSuggestions: smart.buildSmartSuggestions,
    resolveSmartAction: smart.resolveSmartAction,
    parseCurrencyInput: currency.parseCurrencyInput,
    buildCurrencySuggestion: currency.buildCurrencySuggestion,
  })).catch((error) => {
    intelligencePromise = null;
    throw error;
  });
  return intelligencePromise;
}
