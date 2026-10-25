export interface NumberToken {
  value: number;
  text: string;
  decimals: number;
  sig: number;
  percent: boolean;
  line: number;
  column: number;
}

const MANTISSA = '[+−–-]?\\d+(?:,\\d{3}(?!\\d))*(?:\\.\\d+)?';
const EXPONENT = '[+−–-]?\\d+';
const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+',
};

function printedNumber(text: string): number {
  return Number(text.replace(/,/g, '').replace(/[−–]/g, '-'));
}

function precision(mantissa: string): { decimals: number; sig: number } {
  const unsigned = mantissa.replace(/[+−–,-]/g, '');
  const decimals = unsigned.includes('.') ? unsigned.split('.')[1].length : 0;
  const digits = unsigned.replace('.', '').replace(/^0+/, '');
  const significant = decimals > 0 ? digits : digits.replace(/0+$/, '');
  return { decimals, sig: significant.length || Math.max(1, decimals) };
}

export function tokeniseLine(line: string, lineIndex = 0): NumberToken[] {
  const scientific = new RegExp(
    `(${MANTISSA})(?:[Ee](${EXPONENT})|\\s*[×x·]\\s*10(?:\\s*\\^\\s*(${EXPONENT})|([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)|([+−–-]\\d+)))(%?)`,
    'y',
  );
  const plain = new RegExp(`(${MANTISSA})(%?)`, 'y');
  const date = /(?:19|20)\d{2}-\d{2}(?:-\d{2})?(?!\d)/y;
  const tokens: NumberToken[] = [];

  for (let column = 0; column < line.length;) {
    if (column > 0 && /[\d.]/.test(line[column - 1])) {
      column++;
      continue;
    }
    date.lastIndex = column;
    const dateRun = date.exec(line);
    if (dateRun) {
      column += dateRun[0].length;
      continue;
    }

    scientific.lastIndex = column;
    plain.lastIndex = column;
    const sci = scientific.exec(line);
    const match = sci ?? plain.exec(line);
    if (!match) {
      column++;
      continue;
    }
    const end = column + match[0].length;
    if (/\d/.test(line[end] ?? '') || /\.\d/.test(line.slice(end, end + 2))) {
      column = end;
      continue;
    }
    const mantissa = match[1];
    const exponent = sci
      ? printedNumber((sci[2] ?? sci[3] ?? sci[4] ?? sci[5]).replace(/[⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUPERSCRIPTS[c]))
      : 0;
    tokens.push({
      value: printedNumber(mantissa) * 10 ** exponent,
      text: match[0],
      ...precision(mantissa),
      percent: (sci ? sci[6] : match[2]) === '%',
      line: lineIndex,
      column,
    });
    column = end;
  }
  return tokens;
}

export function tokenisePage(lines: string[]): NumberToken[] {
  return lines.flatMap((line, index) => tokeniseLine(line, index));
}

export function valueMatchesToken(
  v: number,
  t: NumberToken,
  opts: { percentAxis?: boolean } = {},
): boolean {
  const equals = (printed: number): boolean =>
    Number.isFinite(v) && Number.isFinite(printed)
    && Math.abs(v - printed) <= 1e-9 * Math.max(1, Math.abs(printed));
  if (equals(t.value)) return true;
  if (!opts.percentAxis) return false;
  if (!t.percent && t.value >= 0 && t.value <= 1) return equals(t.value * 100);
  if (t.percent && v >= 0 && v <= 1) return equals(t.value / 100);
  return false;
}
