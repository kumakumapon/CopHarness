import { type SkillDefinition } from '../skill';

// ---------------------------------------------------------------------------
// Safe arithmetic evaluator (no eval / Function constructor)
// Supports: +, -, *, /, %, ^ (power), parentheses, unary minus/plus,
// math functions: abs, sqrt, cbrt, round, floor, ceil, trunc, sign,
//                 sin, cos, tan, asin, acos, atan, log, log2, log10, exp,
//                 min, max
// Constants: pi, e
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }
  | { kind: 'ident'; value: string }
  | { kind: 'eof' };

const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const MATH_FUNCTIONS1: Record<string, (x: number) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  trunc: Math.trunc,
  sign: Math.sign,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
};

const MATH_FUNCTIONS2: Record<string, (a: number, b: number) => number> = {
  atan2: Math.atan2,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) num += expr[i++];
      if ((num.match(/\./g) ?? []).length > 1) throw new Error(`Invalid number: ${num}`);
      tokens.push({ kind: 'num', value: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z_0-9]/.test(expr[i])) ident += expr[i++];
      tokens.push({ kind: 'ident', value: ident });
      continue;
    }
    if ('+-*/%^'.includes(ch)) { tokens.push({ kind: 'op', value: ch }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma' }); i++; continue; }
    throw new Error(`Unexpected character: "${ch}"`);
  }
  tokens.push({ kind: 'eof' });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }
  private expect(kind: Token['kind']): Token {
    const t = this.consume();
    if (t.kind !== kind) throw new Error(`Expected ${kind}, got ${t.kind}`);
    return t;
  }

  parse(): number {
    const result = this.parseExpr();
    if (this.peek().kind !== 'eof') throw new Error('Unexpected token after expression');
    return result;
  }

  private parseExpr(): number { return this.parseAddSub(); }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    while (this.peek().kind === 'op' && (this.peek() as { kind: 'op'; value: string }).value === '+' || (this.peek().kind === 'op' && (this.peek() as { kind: 'op'; value: string }).value === '-')) {
      const op = (this.consume() as { kind: 'op'; value: string }).value;
      const right = this.parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parsePower();
    while (
      this.peek().kind === 'op' &&
      ['*', '/', '%'].includes((this.peek() as { kind: 'op'; value: string }).value)
    ) {
      const op = (this.consume() as { kind: 'op'; value: string }).value;
      const right = this.parsePower();
      if (op === '*') left = left * right;
      else if (op === '/') { if (right === 0) throw new Error('Division by zero'); left = left / right; }
      else left = left % right;
    }
    return left;
  }

  private parsePower(): number {
    const base = this.parseUnary();
    if (this.peek().kind === 'op' && (this.peek() as { kind: 'op'; value: string }).value === '^') {
      this.consume();
      const exp = this.parseUnary(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  }

  private parseUnary(): number {
    if (this.peek().kind === 'op' && (this.peek() as { kind: 'op'; value: string }).value === '-') {
      this.consume();
      return -this.parseUnary();
    }
    if (this.peek().kind === 'op' && (this.peek() as { kind: 'op'; value: string }).value === '+') {
      this.consume();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.peek();
    if (t.kind === 'num') { this.consume(); return t.value; }
    if (t.kind === 'lparen') {
      this.consume();
      const val = this.parseExpr();
      this.expect('rparen');
      return val;
    }
    if (t.kind === 'ident') {
      this.consume();
      const name = t.value.toLowerCase();
      if (name in MATH_CONSTANTS) return MATH_CONSTANTS[name];
      // Check if next token is '(' → function call
      if (this.peek().kind === 'lparen') {
        this.consume(); // consume '('
        const args: number[] = [];
        if (this.peek().kind !== 'rparen') {
          args.push(this.parseExpr());
          while (this.peek().kind === 'comma') {
            this.consume();
            args.push(this.parseExpr());
          }
        }
        this.expect('rparen');
        if (name in MATH_FUNCTIONS1 && args.length === 1) {
          return MATH_FUNCTIONS1[name](args[0]);
        }
        if (name in MATH_FUNCTIONS2 && args.length === 2) {
          return MATH_FUNCTIONS2[name](args[0], args[1]);
        }
        throw new Error(`Unknown function or wrong argument count: ${name}(${args.join(', ')})`);
      }
      throw new Error(`Unknown constant: ${name}`);
    }
    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }
}

function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}

export const calculator: SkillDefinition = {
  name: 'calculator',
  description:
    'Safely evaluates a mathematical expression and returns the result. ' +
    'Supports arithmetic (+, -, *, /, %, ^), parentheses, and math functions ' +
    '(abs, sqrt, cbrt, round, floor, ceil, sin, cos, tan, log, log2, log10, exp, min, max, pow, atan2) ' +
    'and constants (pi, e).',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression to evaluate, e.g. "2 * (3 + 4)" or "sqrt(16) + pi"',
      },
    },
    required: ['expression'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const expression = String(args.expression ?? '').trim();
    if (!expression) return { content: 'Error: empty expression', isError: true };
    try {
      const result = evaluate(expression);
      if (!isFinite(result)) return { content: String(result) };
      // Format: avoid unnecessary decimals for integers
      const formatted = String(result);
      return { content: formatted };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
