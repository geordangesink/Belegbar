/**
 * Synthesized invoice texts for parser tests. Layouts mirror real-world
 * documents (Stripe receipts, Google Ads, Amazon EU, Apple, German classics,
 * the user's own invoice template) with entirely fictitious person/company
 * data — no confidential content.
 */

export const STRIPE_EUR_RECEIPT = `
Page 1 of 1
Receipt
Invoice number
AB12CDEF-0009
Receipt number 1111-2222
Date paid
April 30, 2026
Nimbus Cloud Ireland Limited
1 Sample Quay
Dublin
D01 XY99
Ireland
billing@nimbus.example
IE VAT IE1234567FA
Bill to
Max Beispiel
Musterstraße 1
12345 Beispielstadt
Germany
max@example.com
€23.00 paid on April 30, 2026
Description
Qty
Unit price
Tax
Amount
Nimbus Plus Subscription (per seat)
Apr 30–May 30, 2026
1
€19.33
19%
€19.33
Subtotal
€19.33
Total excluding tax
€19.33
VAT - Germany (19% on €19.33)
€3.67
Total
€23.00
Amount paid
€23.00
Payment history
Payment method
Date
Amount paid
Receipt number
Mastercard - 0000
April 30, 2026
€23.00
1111-2222
`

export const STRIPE_USD_RECEIPT = `
Page 1 of 1
Receipt
Invoice number
ZZ98WXYZ-0005
Receipt number 3333-4444
Date paid
October 7, 2025
Nimbus AI, LLC
100 Sample Street
San Francisco, California 94158
United States
ar@nimbus.example
EU OSS VAT EU372999999
Bill to
Max Beispiel
Musterstraße 1
12345 Beispielstadt
Germany
max@example.com
$59.50 paid on October 7, 2025
Description
Qty
Unit price
Tax
Amount
Nimbus API usage credit
1
$50.00
19%
$50.00
Subtotal
$50.00
Total excluding tax
$50.00
VAT - Germany (19% on $50.00)
$9.50
(€8.11)
Total
$59.50
Amount paid
$59.50
Charged €53.70 using 1 USD = 0.9024 EUR
`

export const STRIPE_REFUND_RECEIPT = `
Page 1 of 1
Receipt
Invoice number
QQ11RRSS-0005
Receipt number 5555-6666
Date paid
January 21, 2026
Klerk Systems, Inc.
200 Sample Market Street
San Francisco, California 94114
United States
support@klerk.example
Bill to
Max Beispiel
Musterstraße 1
12345 Beispielstadt
Germany
max@example.com
$29.75 paid on January 21, 2026
Pro – SMS Tier A
$0.00
Pro – Monthly Active Users (MAUs)
$0.00
Pro – Base Fee
$25.00
Subtotal
$25.00
Total excluding tax
$25.00
VAT - Germany (19% on $25.00)
$4.75
Total
$29.75
Amount paid
$29.75
Refunded on February 8, 2026
$10.44
Total refunded without credit note
$10.44
`

export const GOOGLE_ADS_INVOICE = `Page 1 of 2
Invoice
Invoice number: 1234567890
..............................................................
1234567890
..............................................................
30 Nov 2025
..............................................................
9999-8888-7777
..............................................................
111-222-3333
Details
Invoice number
Invoice date
Billing ID
Account ID
€30.69
Beispiel Ads
Total in EUR
€30.69
€0.00
€30.69
Summary for 2 Nov 2025 - 30 Nov 2025
Subtotal in EUR
VAT (0%)
Total in EUR
Beispiel Ads Ireland Limited
Sample House
Barrow Street
Dublin 4
Ireland
VAT number: IE 6388999V
Bill to
Max Beispiel
Musterstraße 1
12345 Beispielstadt
Germany
Services subject to the reverse charge - VAT to be accounted for by the recipient as per Article 196 of Council Directive 2006/112/EC
This invoice was generated electronically and automatically, without a cash register.
`

export const AMAZON_STYLE_GERMAN = `Rechnung
LU-XYZ-04
Marktplatz EU S.à r.l. - 38 avenue Beispiel, L-1855 Luxembourg
Sitz der Gesellschaft: L-1855 Luxemburg
Umsatzsteuer erklärt durch Marktplatz im Lieferland
Seite 1 von 2
USt. %

Zwischensumme
(ohne USt.)
USt.
19%
14,78 €
2,80 €
USt. Gesamt
14,78 €
2,80 €
Gesamtpreis
17,58 €
Rechnungsdetails
Bestelldatum
02.05.2026
Bestellnummer
302-0000000-0000000
Umsatzsteuer erklärt durch
Marktplatz EU S.a.r.L.
USt-IDNr.
LU12345678

Zahlungsreferenznummer AAAABBBBCCCC
Verkauft von Beispiel Elektronik Ltd.
Rechnungsdatum
/Lieferdatum
02.05.2026
Rechnungsnummer
DE63EXAMPLE1D
Zahlbetrag
17,58 €
MAX BEISPIEL
MUSTERSTRASSE 1
BEISPIELSTADT, 12345
DE
Rechnungsadresse
Max Beispiel
Musterstraße 1
Beispielstadt, 12345
DE

Lieferadresse
Max Beispiel
Musterstraße 1
Beispielstadt, 12345
DE
Bestellinformationen
Beschreibung
Menge
Stückpreis
(ohne USt.)
USt. %
Stückpreis
(inkl. USt.)
Zwischensumme
(inkl. USt.)
USB 3.0 Verlängerungskabel 5Gbps Nylon geflochten (1M) | B000000000
ASIN: B000000000
1
14,78 €
19%
17,58 €
17,58 €
Versandkosten
0,00 €
0,00 €
0,00 €
`

export const APPLE_STYLE_GERMAN = `Rechnung
Obstbaum Distribution International Ltd.
Beispiel Industrial Estate
Beispielhill, Cork
Ireland
Ust-IdNr.: DE123456789

Rechnungsnummer:   UA00000001
Bestellnummer:  AE0000000
Rechnungsdatum:  08.04.2026
Fälligkeitsdatum:   08.04.2026
Kundennummer: 100001
Ust-IdNr. des Kunden: DE987654321
Rechnung an
Max Beispiel
Musterstraße 1
12345 BEISPIELSTADT
GERMANY

Zahlungsbedingungen:  Credit Card
Versand an 100001
Artikelnummer
Materialnummer
Produktbeschreibung
Anzahl
Preis je Einheit
(exkl. MwSt.)
Summe
(exkl. MwSt.)
Steuersatz
%
000010
D0000A/A
BEISPIEL DEVELOPER PROGRAM
1
83,19
83,19
19,00

Steuernummer 12/345/67890

Dieser Rechnungsbetrag wurde beglichen mit: Credit Card

Vielen Dank für Ihren Einkauf
Netto
MwSt. MwSt.-Satz
83,19
15,81
19,00 %
Gesamtpreis (inkl. MwSt.)    EUR  99,00
Page 1 of 1
`

export const STRATO_STYLE_GERMAN = `Beispiel Hosting GmbH • Musterweg 7 • 10249 Berlin
SITZ DER GESELLSCHAFT
Berlin
REGISTERGERICHT
Berlin-Charlottenburg HRB 000000 B
BANKVERBINDUNG
Musterbank Bonn
BIC XXXXDEFFXXX
IBAN DE00 0000 0000 0000 0000 00
UST-ID-NR.
DE 123 456 789
FIRMENSITZ
Beispiel Hosting GmbH
Musterweg 7
10249 Berlin

                                              Kundennummer: 10000001
                                           Rechnungsnummer: DRP000000001
Beispiel, Max
Musterstraße 1
12345 Beispielstadt

                                                              01.12.2025

Auftragsbestätigung / Rechnung

Auftragsnr. 1234567 vom 29.07.2025
Beispiel Hosting Basic
Pos.    Artikelbezeichnung                                     EUR   Brutto
===========================================================================

     1  Beispiel Mail-Archivierung 5 GB:                       EUR     7,50
        3 Monat(e) im Voraus (vom 30.11.2025 bis 27.02.2026),
        Preis/Monat: EUR 2,50 in Summe EUR 7,50 USt.: 19,00%

===========================================================================
Umsatzsteuer (19,00%)                                          EUR     1,20
Entspricht der Summe netto                                     EUR     6,30
===========================================================================
Summe Rechnungsbetrag                                          EUR     7,50

Wir werden den Rechnungsbetrag von Ihrem PayPal-Konto abbuchen.
`

export const OWN_TEMPLATE_EN_INCOME = `Invoice
Supplier
Max Beispiel
Date
24/01/2026
Supplier Address
Musterstraße 1
Postal Code
12345
Invoice
2026.01.1
City
Beispielstadt
Country
Germany
VAT no
not applicable
Email address
max@example.com
Services
Software Development
Bill to
Company
TAX ID
VAT ID
Ejemplo S.A. de C.V.
0623-000000-000-0
000000-0
Address
Avenida Ejemplo, Edificio Torre Muestra,
Oficina 01, Nivel 1
Postal Code
1101
City
San Salvador
Country
El Salvador
Amounts displayed in EUR
Description
Quantity
Unit Price
Amount
Contractor fee - Software Development services for January 2026
1
6,000.00
6,000.00
Remarks/Instructions:
Tax-exempt other service pursuant to §3a (2) German VAT Act – recipient is located in a third country.
„Steuerfreie sonstige Leistung gemäß §3a Abs. 2 UStG – Leistungsempfänger ist im Drittland ansässig.“
Total
6,000.00 EUR
Paid via Bank Transfer
Bank name
Musterbank
Swift Code/BIC
XXXXDEFFXXX
Bank Account number/IBAN
DE00 0000 0000 0000 0000 00
Beneficiary
Max Beispiel
`

export const OWN_TEMPLATE_DE_INCOME = `Rechnung
Lieferant
Max Beispiel
Datum
14/09/2025
Lieferantenadresse
Musterstraße 1
Postleitzahl
12345
Rechnungs Nr.
2025.09.14.1
Stadt
Beispielstadt
Land
Deutschland
Zahlungsfällig
14/10/2025
USt-IdNr.
St-Nr.
E-Mail-Adresse
max@example.com
Dienstleisungen
Consulting
Rechnung an
Firma
Muster Gesellschaft für Kommunikationsdesign mbH
St-Nr.
Ust-IdNr.
Adresse
Hauptstraße 1
Postleitzahl
69117
Stadt
Heidelberg
Land
Deutschland
Angabe in EUR
Beschreibung
Anzahl
Stückpreis
Betrag
Unterstützung und Recherche bei Einrichtung einer Werbekampagne
1
231.00
231.00
Zwischensumme (netto)
231.00 EUR
 + 19 & USt (§ 12 UStG)
43.89 EUR
------------------------------------------------------------
Rechnungsbetrag (brutto)
274.89 EUR
Zahlung durch Bank Transfer
IBAN
DE00 0000 0000 0000 0000 00
Empfänger
Max Beispiel
`

export const GROSS_ONLY_RECEIPT = `Rechnung
Beispiel Laden GmbH
Rechnungsnummer: R-1001
Datum
05.03.2026
Gesamtbetrag
EUR 11,90
Im Betrag enthaltene USt.: 19,00%
Vielen Dank für Ihren Einkauf
`

export const USDT_INVOICE_INCOME = `Date 13/07/2026
Invoice
Invoice No. 100001
Bill To:
Company
Ejemplo El Salvador, S.A. DE C.V.
Address
Condominio Muestra, Nivel 1, Oficina 01
Postal Code
NA
City
San Salvador
Country
El Salvador
Amounts displayed in
USDT
Description
Amount
Contractor fee - Software Development services for June 2026
7,550.56
Total 7,550.56 USDT
Payment Instructions:
Pay via Exchange Personal Account
Supplier
Max Beispiel
Supplier Address
Musterstraße 1
Postal Code
12345
City
Beispielstadt
Country
Germany
Tax ID No
45 000 000 000
VAT No
DE461999999
Services
Software Development
`

export const ORDER_CONFIRMATION = `Order summary
Thank you for your purchase!
Max Beispiel
Sample item
Total
€10.00
We hope to see you again soon.
`

export const AMBIGUOUS_DATE_INVOICE = `Invoice
Invoice number: A-100
Invoice date: 05/04/2026
Sample consulting services
Total
€50.00
`

export const CORROBORATED_DATE_INVOICE = `Invoice
Invoice number: A-101
Invoice date: 05/04/2026
Due date: 20/04/2026
Sample consulting services
Total
€50.00
`

export const MULTI_RATE_GERMAN = `Rechnung
Beispiel Versandhaus GmbH
Rechnungsnummer: MR-2001
Rechnungsdatum: 15.06.2026
USt.
19%
100,00 €
19,00 €
USt.
7%
50,00 €
3,50 €
Gesamtpreis
172,50 €
Zahlbetrag
172,50 €
`

export const CONFLICTING_TOTALS = `Invoice
Invoice number: CT-1
Invoice date: 10.02.2026
Total
€100.00
Gesamtbetrag
EUR 90,00
`

export const NO_AMOUNT_DOC = `Rechnung
Rechnungsnummer: NA-1
Rechnungsdatum: 01.02.2026
Hinweis: Betrag folgt separat
`

// ---------------------------------------------------------------------------
// pdf.js production-extraction artifacts (v1.2.0). pdf.js emits NUL (\u0000)
// for unmapped hyphen glyphs, keeps label+value on ONE line separated by runs
// of 2+ spaces, and flattens column headers into single-line cell rows.
// ---------------------------------------------------------------------------

/** Stripe-style receipt as pdf.js extracts it: NUL hyphens + column cells. */
export const PDFJS_STRIPE_NUL_RECEIPT = `Page 1 of 1

Receipt

Invoice number  AB12CDEF \u0000 0009

Receipt number  2866 \u0000 2040
Date paid  April 30, 2026

Nimbus Cloud Ireland Limited

1 Sample Quay
Dublin
D01 XY99
Ireland
billing@nimbus.example
IE VAT IE1234567FA

Bill to

Max Beispiel
Musterstraße 1
12345 Beispielstadt
Germany
max@example.com

€23.00 paid on April 30, 2026

Description  Qty  Unit price  Tax  Amount

Nimbus Plus Subscription (per seat)
Apr 30 \u0000 May 30, 2026
1  €19.33  19%  €19.33

Subtotal  €19.33
Total excluding tax  €19.33
VAT - Germany  \u0000 19% on €19.33 \u0000  €3.67
Total  €23.00

Amount paid  €23.00
`

/** OCR'd English invoice of a German seller: label echo trap "Invoice Nr.:X". */
export const OCR_LABEL_ECHO_INVOICE = `Muster Cooling GmbH - Muster-Zeiss-Str. 2 - D 33999 Musterstadt
Max Contact Person Connect
Beispiel Telephone
Musterstr. 3 Fax
12345 Beispielstadt E-Mail
Customer-number 1234567
Date 06.08.2025
Invoice Nr.:F1054762
Pos. Number Description QTY Price EUR Total EUR
1 1025928 WaterBlock Pro AIO 360 Dark 1 143,99 143,99
Sum with tax EUR 143,99
shipping cost incl. VAT EUR 4,99
Total without VAT 19 % EUR 125,19
VAT 19 % EUR 23,79
Total amount EUR 148,98
`

/** Viking-style pdf.js columns: header cells aligned with a value row. */
export const PDFJS_COLUMN_TABLE_INVOICE = `DE;VK;INV;0493000211726

Muster Office Deutschland GmbH

Linus-Beispiel-Str.2
DE-63762 Musterheim
Amtsgericht: HRB 9999, Ust-ID Nr.: DE812166759

RECHNUNG

Auftraggeber

Max Beispiel
Musterstraße 1
12345 Beispielstadt
GERMANY

Kunden-Nr.  Rechnungs-Nr.  Rechnungsdatum  Fälligkeitsdatum  Auftragsdatum  Auftrags-Nr.
3000211726  4919278971  21.07.2025  20.08.2025  18.07.2025  DE-VK-801364895W

Nr.  Artikel-
Nr.
Beschreibung  Menge /
ME

1  1185098 Muster Steckdosenleiste mit Schalter
1/EA  8,49  8,49  8,49  19%

Split-/USt.%  Netto Warenwert  USt.-Betrag  Rechnungsbetrag  Gesamt USt.  Gesamtbetrag

19%  49,00  9,31  58,31  EUR  9,31  EUR  58,31

** Bezahlt mit PayPal **
`

/** The user's own income template as pdf.js extracts it: "Label  value  Label  value" cells. */
export const PDFJS_OWN_TEMPLATE_INCOME = `Invoice

Supplier  Max Beispiel  Date  24/01/2026
Supplier Address  Musterweg 3
Postal Code  69198  Invoice  2026.01.1
City  Musterstadt
Country  Germany
VAT no  not applicable
Email address  max@example.com
Services  Software Development

Bill to

Company
TAX ID
VAT ID
Ejemplo S.A. de C.V.
0623-000000-000-0
358704-8
Postal Code  1101
City  San Salvador
Country  El Salvador  Amounts displayed in EUR

Description  Quantity  Unit Price  Amount

Contractor fee - Software Development services for January 2026  1  6,000.00  6,000.00

Tax-exempt other service pursuant to §3a (2) German VAT Act — recipient is located in a third country.

Total  6,000.00 EUR
`

/** Two DIFFERENT labeled invoice numbers — the second checker must flag it. */
export const NUMBER_CONFLICT_DOC = `Rechnung
Rechnungsnummer: RE-100
Datum: 01.03.2026
Gesamtbetrag  10,00 €
Invoice number: RE-999
`

/** Labeled total contradicts the arithmetically consistent totals row. */
export const SWEEP_CONFLICT_TOTALS_DOC = `Invoice
Invoice number: SC-100
Invoice date: 01.03.2026
Zwischensumme (netto)  100,00 €
USt.-Betrag  19,00 €
Rechnungssumme  119,00 €
Total  125,00 €
`
