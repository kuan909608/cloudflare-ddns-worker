const options: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
};

const localFormatter = new Intl.DateTimeFormat('zh-TW', options);

export function formatLocalDateTime(value: string | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return timeZone
    ? new Intl.DateTimeFormat('zh-TW', { ...options, timeZone }).format(date)
    : localFormatter.format(date);
}
