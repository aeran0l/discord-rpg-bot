
function formatDuration(totalMinutes) {
  const mins = Math.max(0, Math.floor(Number(totalMinutes) || 0));

  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;

  // 1시간 미만
  if (hours <= 0) {
    return `${minutes}분`;
  }


  if (minutes === 0) {
    return `${hours}시간`;
  }


  return `${hours}시간 ${minutes}분`;
}

function formatHoursDecimal(totalMinutes, _digits = 1) {
  return formatDuration(totalMinutes);
}

module.exports = { formatDuration, formatHoursDecimal };