import { describe, expect, it } from 'vitest'
import { parseSolzgText } from './parse-solzg-text'

const SECTION_3 = `
  § 3 Bemessungsgrundlage und Freigrenze
  (3) Der Solidaritätszuschlag ist nur zu erheben, wenn die Bemessungsgrundlage
  folgenden Betrag übersteigt: 1. in den Fällen des § 32a Absatz 5 und 6 des
  Einkommensteuergesetzes 40 700 Euro, 2. in anderen Fällen 20 350 Euro.
`

const SECTION_4 = `
  § 4 Zuschlagsatz
  Der Solidaritätszuschlag beträgt 5,5 Prozent der Bemessungsgrundlage.
  Er beträgt nicht mehr als 11,9 Prozent des Unterschiedsbetrages zwischen
  der Bemessungsgrundlage und der Freigrenze. Bruchteile eines Cents bleiben
  außer Ansatz.
`

const SECTION_6 = `
  § 6 Anwendungsvorschriften
  § 3 Absatz 3 in der Fassung des Gesetzes vom 2. Dezember 2019 ist erstmals
  im Veranlagungszeitraum 2021 anzuwenden.
  § 3 Absatz 3 in der Fassung des Gesetzes vom 23. Dezember 2024 ist erstmals
  im Veranlagungszeitraum 2026 anzuwenden.
`

describe('parseSolzgText', () => {
  it('parses the current official SolzG wording and latest application year', () => {
    expect(parseSolzgText(SECTION_3, SECTION_4, SECTION_6)).toEqual({
      rules: {
        thresholdSingle: 20350,
        thresholdJoint: 40700,
        rate: 0.055,
        mitigationRate: 0.119,
        centRounding: 'down'
      },
      firstApplicableYear: 2026
    })
  })

  it('normalizes official non-breaking spaces and dotted thousands', () => {
    const section3 = SECTION_3.replace('40 700', '40.700').replace('20 350', '20 350')
    expect(parseSolzgText(section3, SECTION_4, SECTION_6)?.rules).toMatchObject({
      thresholdSingle: 20350,
      thresholdJoint: 40700
    })
  })

  it('rejects missing cent truncation, missing applicability and malformed rates', () => {
    expect(
      parseSolzgText(
        SECTION_3,
        SECTION_4.replace('Bruchteile eines Cents bleiben\n  außer Ansatz.', ''),
        SECTION_6
      )
    ).toBeNull()
    expect(parseSolzgText(SECTION_3, SECTION_4, '§ 6')).toBeNull()
    expect(
      parseSolzgText(SECTION_3, SECTION_4.replace('5,5 Prozent', '55 Prozent'), SECTION_6)
    ).toBeNull()
  })

  it('rejects inconsistent or ambiguous thresholds', () => {
    expect(
      parseSolzgText(SECTION_3.replace('40 700', '40 701'), SECTION_4, SECTION_6)
    ).toBeNull()
    expect(parseSolzgText(`${SECTION_3} ${SECTION_3}`, SECTION_4, SECTION_6)).toBeNull()
  })
})
