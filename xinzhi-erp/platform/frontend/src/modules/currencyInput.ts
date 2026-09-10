export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

export function optionalAmountCurrencyError(
  amount: string,
  currency: string,
  amountLabel: string,
) {
  const normalizedAmount = amount.trim();
  const normalizedCurrency = normalizeCurrencyCode(currency);
  if (normalizedAmount && !normalizedCurrency) {
    return `填写${amountLabel}后请选择币种。`;
  }
  if (!normalizedAmount && normalizedCurrency) {
    return `未填写${amountLabel}时不需要选择币种。`;
  }
  if (normalizedCurrency && !CURRENCY_CODE_PATTERN.test(normalizedCurrency)) {
    return "币种须为 ISO 三位代码，例如 CNY。";
  }
  return undefined;
}
