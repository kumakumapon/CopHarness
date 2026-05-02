import { randomBytes } from 'node:crypto';
import { type SkillDefinition } from '../skill';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

export const generatePassword: SkillDefinition = {
  name: 'generatePassword',
  description:
    'Generates a cryptographically secure random password. ' +
    'Supports controlling length and character classes (uppercase, digits, symbols).',
  parameters: {
    type: 'object',
    properties: {
      length: {
        type: 'number',
        description: 'Password length (8–128). Defaults to 16.',
        minimum: 8,
        maximum: 128,
      },
      includeUppercase: {
        type: 'boolean',
        description: 'Include uppercase letters (A–Z). Defaults to true.',
      },
      includeDigits: {
        type: 'boolean',
        description: 'Include digits (0–9). Defaults to true.',
      },
      includeSymbols: {
        type: 'boolean',
        description: 'Include symbols (!@#$%^&*...). Defaults to true.',
      },
    },
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const length =
      typeof args.length === 'number'
        ? Math.min(128, Math.max(8, Math.floor(args.length)))
        : 16;
    const includeUppercase = args.includeUppercase !== false;
    const includeDigits = args.includeDigits !== false;
    const includeSymbols = args.includeSymbols !== false;

    let charset = LOWER;
    if (includeUppercase) charset += UPPER;
    if (includeDigits) charset += DIGITS;
    if (includeSymbols) charset += SYMBOLS;

    if (charset.length === 0) {
      return { content: 'Error: at least one character class must be enabled', isError: true };
    }

    // Rejection sampling to avoid modulo bias
    const result: string[] = [];
    const maxUsable = Math.floor(256 / charset.length) * charset.length;
    while (result.length < length) {
      const buf = randomBytes(length * 2);
      for (let i = 0; i < buf.length && result.length < length; i++) {
        const byte = buf[i];
        if (byte < maxUsable) {
          result.push(charset[byte % charset.length]);
        }
      }
    }
    return { content: result.join('') };
  },
};
