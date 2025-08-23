export function formatDate(dateString, format = 'dd/mm/yyyy') {
  if (!dateString) return '';

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const monthNum = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthStr = monthNames[date.getMonth()];

  const patterns = {
    'dd/mm/yyyy': `${day}/${monthNum}/${year}`,
    'dd mm yyyy': `${day} ${monthNum} ${year}`,
    'dd/mm/yyyy hh:mm': `${day}/${monthNum}/${year} ${hours}:${minutes}`,
    'dd/mmm/yyyy': `${day}/${monthStr}/${year}`,
    'dd mmm yyyy': `${day} ${monthStr} ${year}`,
    'dd/mmm/yyyy hh:mm': `${day}/${monthStr}/${year} ${hours}:${minutes}`,
    'dd mmm yyyy hh:mm': `${day} ${monthStr} ${year} ${hours}:${minutes}`,
  };

  return patterns[format];
}
