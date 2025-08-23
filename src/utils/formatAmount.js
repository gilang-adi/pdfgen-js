export const formatAmount = (amount) => {
  return amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

export const formatAmountWithCurrency = (
  amount,
  currency
) => {
  return `${currency} ${formatAmount(amount)}`;
};
