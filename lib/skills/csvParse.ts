import { type SkillDefinition } from '../skill';

/**
 * Minimal RFC 4180-compliant CSV parser.
 * Handles quoted fields and escaped double-quotes ("").
 */
function parseCSV(raw: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          // Escaped double-quote
          field += '"';
          i += 2;
        } else {
          inQuote = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuote = true;
      i++;
    } else if (raw.startsWith(delimiter, i)) {
      row.push(field);
      field = '';
      i += delimiter.length;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      if (i < raw.length && raw[i] === '\n') i++;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
    } else {
      field += ch;
      i++;
    }
  }

  // Flush last field / row (skip trailing empty row caused by a final newline)
  if (field !== '' || inQuote || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export const csvParse: SkillDefinition = {
  name: 'csvParse',
  description:
    'Parses a CSV string into a JSON array. ' +
    'When hasHeader is true (default), returns an array of objects using the first row as keys. ' +
    'When false, returns an array of string arrays.',
  parameters: {
    type: 'object',
    properties: {
      csv: {
        type: 'string',
        description: 'The CSV text to parse.',
      },
      delimiter: {
        type: 'string',
        description: 'Field delimiter. Defaults to ",".',
      },
      hasHeader: {
        type: 'boolean',
        description:
          'Whether the first row is a header row. Defaults to true. ' +
          'If true, returns array of objects; otherwise array of arrays.',
      },
    },
    required: ['csv'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const csv = String(args.csv ?? '').trim();
    if (!csv) return { content: '[]' };

    const delimiter = String(args.delimiter ?? ',');
    if (!delimiter) return { content: 'Error: delimiter cannot be empty', isError: true };

    const hasHeader = args.hasHeader !== false;

    try {
      const rows = parseCSV(csv, delimiter);
      if (rows.length === 0) return { content: '[]' };

      let result: unknown;
      if (hasHeader) {
        const [headers, ...dataRows] = rows;
        result = dataRows.map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, idx) => {
            obj[h] = row[idx] ?? '';
          });
          return obj;
        });
      } else {
        result = rows;
      }

      return { content: JSON.stringify(result, null, 2) };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
