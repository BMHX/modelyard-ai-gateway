export function getMonthProgress(now = new Date()) {
  const elapsedDays = now.getDate();
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  return {
    elapsedDays,
    totalDays,
    remainingDays,
    progressRatio: totalDays > 0 ? elapsedDays / totalDays : 0,
  };
}

export function getProjectedMonthlySpend(currentMonthSpendUsd: number, now = new Date()) {
  const { elapsedDays, totalDays } = getMonthProgress(now);
  if (elapsedDays <= 0) {
    return currentMonthSpendUsd;
  }

  return Number(((currentMonthSpendUsd / elapsedDays) * totalDays).toFixed(2));
}

export function getDailyBurnRate(currentMonthSpendUsd: number, now = new Date()) {
  const { elapsedDays } = getMonthProgress(now);
  if (elapsedDays <= 0) {
    return 0;
  }

  return Number((currentMonthSpendUsd / elapsedDays).toFixed(2));
}

export function getDaysUntilThreshold(currentMonthSpendUsd: number, thresholdUsd: number, now = new Date()) {
  const burnRate = getDailyBurnRate(currentMonthSpendUsd, now);
  if (burnRate <= 0 || thresholdUsd <= currentMonthSpendUsd) {
    return null;
  }

  return Math.ceil((thresholdUsd - currentMonthSpendUsd) / burnRate);
}
