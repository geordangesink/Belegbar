/**
 * Test fixtures: trimmed excerpt of the official § 32a Abs. 1 EStG norm text
 * as served by https://www.gesetze-im-internet.de/estg/__32a.html
 * (fetched 2026-07-15, "ab dem Veranlagungszeitraum 2026" version).
 *
 * German statutory text is in the public domain (§ 5 Abs. 1 UrhG); the
 * excerpt contains no personal data. Umlauts etc. appear as the numeric
 * HTML entities the law server actually emits (the page is iso-8859-1).
 */

/** Verbatim HTML of Absatz 1 as found in the page body (trimmed). */
export const GII_32A_HTML_EXCERPT_2026 =
  '<div class="jurAbsatz">(1) <sup class="Rec">1</sup>Die tarifliche Einkommensteuer bemisst sich n' +
  'ach dem auf volle Euro abgerundeten zu versteuernden Einkommen. <sup class="Rec">2</sup>Sie betr' +
  '&#228;gt ab dem Veranlagungszeitraum 2026 vorbehaltlich der &#167;&#167; 32b, 32d, 34, 34a, 34b ' +
  'und 34c jeweils in Euro f&#252;r zu versteuernde Einkommen <dl style="font-weight:normal;font-st' +
  'yle:normal;text-decoration:none;"><dt>1.</dt><dd style="font-weight:normal;font-style:normal;tex' +
  't-decoration:none;"><div>bis 12&#160;348 Euro (Grundfreibetrag):</div><div>0;</div></dd><dt>2.</' +
  'dt><dd style="font-weight:normal;font-style:normal;text-decoration:none;"><div>von 12&#160;349 E' +
  'uro bis 17&#160;799 Euro:</div><div>(914,51 &#8226; y + 1&#160;400) &#8226; y;</div></dd><dt>3.<' +
  '/dt><dd style="font-weight:normal;font-style:normal;text-decoration:none;"><div>von 17&#160;800 ' +
  'Euro bis 69&#160;878 Euro:</div><div>(173,10 &#8226; z + 2&#160;397) &#8226; z + 1&#160;034,87;<' +
  '/div></dd><dt>4.</dt><dd style="font-weight:normal;font-style:normal;text-decoration:none;"><div' +
  '>von 69&#160;879 Euro bis 277&#160;825 Euro:</div><div>0,42 &#8226; x &#8211; 11&#160;135,63;</d' +
  'iv></dd><dt>5.</dt><dd style="font-weight:normal;font-style:normal;text-decoration:none;"><div>v' +
  'on 277&#160;826 Euro an:</div><div>0,45 &#8226; x &#8211; 19&#160;470,38.</div></dd></dl><sup cl' +
  'ass="Rec">3</sup>Die Gr&#246;&#223;e &#8222;y&#8220; ist ein Zehntausendstel des den Grundfreibe' +
  'trag &#252;bersteigenden Teils des auf einen vollen Euro-Betrag abgerundeten zu versteuernden Ei' +
  'nkommens. <sup class="Rec">4</sup>Die Gr&#246;&#223;e &#8222;z&#8220; ist ein Zehntausendstel de' +
  's 17&#160;799 Euro &#252;bersteigenden Teils des auf einen vollen Euro-Betrag abgerundeten zu ve' +
  'rsteuernden Einkommens. <sup class="Rec">5</sup>Die Gr&#246;&#223;e &#8222;x&#8220; ist das auf ' +
  'einen vollen Euro-Betrag abgerundete zu versteuernde Einkommen. <sup class="Rec">6</sup>Der sich' +
  ' ergebende Steuerbetrag ist auf den n&#228;chsten vollen Euro-Betrag abzurunden.</div>'

/**
 * The same Absatz 1, already stripped to plain text (the characters the
 * entities decode to: NBSP \u00A0, bullet \u2022, en dash \u2013).
 */
export const NORM_TEXT_32A_2026 =
  '(1) 1Die tarifliche Einkommensteuer bemisst sich nach dem auf volle Euro abgerundeten zu ' +
  'versteuernden Einkommen. 2Sie betr\u00e4gt ab dem Veranlagungszeitraum 2026 vorbehaltlich der ' +
  '\u00a7\u00a7 32b, 32d, 34, 34a, 34b und 34c jeweils in Euro f\u00fcr zu versteuernde Einkommen ' +
  '1. bis 12\u00A0348 Euro (Grundfreibetrag): 0; ' +
  '2. von 12\u00A0349 Euro bis 17\u00A0799 Euro: (914,51 \u2022 y + 1\u00A0400) \u2022 y; ' +
  '3. von 17\u00A0800 Euro bis 69\u00A0878 Euro: (173,10 \u2022 z + 2\u00A0397) \u2022 z + 1\u00A0034,87; ' +
  '4. von 69\u00A0879 Euro bis 277\u00A0825 Euro: 0,42 \u2022 x \u2013 11\u00A0135,63; ' +
  '5. von 277\u00A0826 Euro an: 0,45 \u2022 x \u2013 19\u00A0470,38. ' +
  '3Die Gr\u00f6\u00dfe \u201ey\u201c ist ein Zehntausendstel des den Grundfreibetrag \u00fcbersteigenden ' +
  'Teils des auf einen vollen Euro-Betrag abgerundeten zu versteuernden Einkommens. ' +
  '4Die Gr\u00f6\u00dfe \u201ez\u201c ist ein Zehntausendstel des 17\u00A0799 Euro \u00fcbersteigenden Teils ' +
  'des auf einen vollen Euro-Betrag abgerundeten zu versteuernden Einkommens. ' +
  '5Die Gr\u00f6\u00dfe \u201ex\u201c ist das auf einen vollen Euro-Betrag abgerundete zu versteuernde ' +
  'Einkommen. 6Der sich ergebende Steuerbetrag ist auf den n\u00e4chsten vollen Euro-Betrag abzurunden.'
