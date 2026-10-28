// Fares are ALWAYS computed on the server from the database. The client never sends a price.
export function fareFor(cls, distanceKm) {
  return Math.round(cls.rate_paise_km * distanceKm) + cls.reservation_fee_paise;
}

// Cancellation refund tiers by time left before the boarding-station departure.
//   >= 48h : 90%   >= 12h : 75%   >= 4h : 50%   < 4h : 25%   after departure : not allowed
export function refundPercent(secondsToDeparture) {
  const h = secondsToDeparture / 3600;
  if (h >= 48) return 90;
  if (h >= 12) return 75;
  if (h >= 4) return 50;
  return 25;
}
export function refundAmount(paidPaise, secondsToDeparture) {
  return Math.floor((paidPaise * refundPercent(secondsToDeparture)) / 100);
}
