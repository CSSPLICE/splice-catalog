export function parseCalendarDate(value: unknown, label: string): { value: string; date?: Date; error?: string } {
  if (value === undefined || value === '') return { value: '' };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { value: typeof value === 'string' ? value : '', error: `${label} must use YYYY-MM-DD format.` };
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { value, error: `${label} must be a valid calendar date.` };
  }
  return { value, date };
}

export function csvField(value: unknown): string {
  const text = String(value ?? '');
  const safe =
    typeof value === 'string' && (/^[\s\p{Cc}]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value)) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
