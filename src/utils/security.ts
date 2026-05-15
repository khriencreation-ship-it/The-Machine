export function getValidDynamicCodes(): string[] {
  const codes: string[] = [];
  
  // We want to generate codes for the current minute, and the past 2 minutes
  // to allow for typing delays or slight clock drift.
  const now = new Date();
  
  for (let offset = 0; offset <= 2; offset++) {
    const d = new Date(now.getTime() - offset * 60000);
    
    // Format to Africa/Lagos
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).formatToParts(d);

    const p: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        p[part.type] = part.value;
      }
    }

    // parts will have year (YY), month (MM), day (DD), hour (hh), minute (mm), dayPeriod (AM/PM)
    const yy = p.year;
    const mm = p.month;
    const dd = p.day;
    const hh = p.hour;
    const min = p.minute;
    const ap = p.dayPeriod ? p.dayPeriod[0].toUpperCase() : 'A'; // 'A' or 'P'

    // Combine: YYMMDDhhmm[A/P]
    const code = `${yy}${mm}${dd}${hh}${min}${ap}`;
    codes.push(code);
  }

  return codes;
}

export function verifyDynamicCode(inputCode: string): boolean {
  if (!inputCode) return false;
  const validCodes = getValidDynamicCodes();
  // Case-insensitive check
  return validCodes.includes(inputCode.toUpperCase());
}
