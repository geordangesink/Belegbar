/** ISO-3166 alpha-2 country detection from address text. */

const COUNTRY_NAMES: [RegExp, string][] = [
  [/\b(germany|deutschland|bundesrepublik deutschland)\b/i, 'DE'],
  [/\b(ireland|irland|éire)\b/i, 'IE'],
  [/\b(united states(?: of america)?|u\.?s\.?a\.?|california|delaware|new york|texas)\b/i, 'US'],
  [/\bel salvador\b/i, 'SV'],
  [/\b(luxembourg|luxemburg|lëtzebuerg)\b/i, 'LU'],
  [/\b(united kingdom|great britain|england|scotland|wales)\b/i, 'GB'],
  [/\bhong ?kong\b/i, 'HK'],
  [/\b(china|volksrepublik china)\b/i, 'CN'],
  [/\b(netherlands|niederlande|nederland)\b/i, 'NL'],
  [/\b(austria|österreich)\b/i, 'AT'],
  [/\b(switzerland|schweiz|suisse)\b/i, 'CH'],
  [/\b(france|frankreich)\b/i, 'FR'],
  [/\b(italy|italien|italia)\b/i, 'IT'],
  [/\b(spain|spanien|españa)\b/i, 'ES'],
  [/\b(poland|polen|polska)\b/i, 'PL'],
  [/\b(belgium|belgien|belgique)\b/i, 'BE'],
  [/\b(denmark|dänemark)\b/i, 'DK'],
  [/\b(sweden|schweden)\b/i, 'SE'],
  [/\b(czech republic|tschechien)\b/i, 'CZ'],
  [/\b(canada|kanada)\b/i, 'CA'],
  [/\b(japan)\b/i, 'JP'],
  [/\b(india|indien)\b/i, 'IN'],
  [/\b(singapore|singapur)\b/i, 'SG']
]

const KNOWN_ISO = new Set([
  'DE', 'IE', 'US', 'SV', 'LU', 'GB', 'HK', 'CN', 'NL', 'AT', 'CH', 'FR', 'IT',
  'ES', 'PL', 'BE', 'DK', 'SE', 'CZ', 'CA', 'JP', 'IN', 'SG', 'FI', 'NO', 'PT',
  'GR', 'HU', 'RO', 'BG', 'HR', 'SI', 'SK', 'EE', 'LV', 'LT', 'MT', 'CY', 'AU',
  'NZ', 'MX', 'BR', 'AR', 'KR', 'TW', 'AE', 'IL', 'TR', 'UA'
])

/**
 * Detect a country from address lines. Scans from the last line upwards
 * because the country usually terminates an address block.
 */
export function detectCountry(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim()
    if (line.length === 0) continue
    // standalone ISO code line (Amazon-style "DE")
    const isoMatch = /^([A-Z]{2})\.?$/.exec(line)
    if (isoMatch && KNOWN_ISO.has(isoMatch[1] ?? '')) return isoMatch[1] ?? null
    for (const [re, iso] of COUNTRY_NAMES) {
      if (re.test(line)) return iso
    }
  }
  return null
}

export function detectCountryInText(text: string): string | null {
  for (const [re, iso] of COUNTRY_NAMES) {
    if (re.test(text)) return iso
  }
  return null
}

/** Country implied by a VAT id prefix (DE123456789 → DE). EU OSS ids have none. */
export function countryOfVatId(vatId: string): string | null {
  const prefix = vatId.slice(0, 2).toUpperCase()
  if (prefix === 'EU') return null
  if (/^[A-Z]{2}$/.test(prefix) && KNOWN_ISO.has(prefix === 'EL' ? 'GR' : prefix)) {
    return prefix === 'EL' ? 'GR' : prefix
  }
  return null
}
