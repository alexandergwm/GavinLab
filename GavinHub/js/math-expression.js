const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)/;
const OPERATORS = new Set(['+', '-', '*', '/', '^', '%', '(', ')']);
const MAX_TOKENS = 128;
const MAX_DEPTH = 32;

function tokenize(expression) {
  const tokens = [];
  let rest = expression;

  while (rest.length) {
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      rest = rest.slice(whitespace[0].length);
      continue;
    }

    const number = rest.match(NUMBER_RE);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      rest = rest.slice(number[0].length);
    } else if (OPERATORS.has(rest[0])) {
      tokens.push({ type: rest[0] });
      rest = rest.slice(1);
    } else {
      return null;
    }

    if (tokens.length > MAX_TOKENS) return null;
  }

  return tokens;
}

class ExpressionParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.depth = 0;
  }

  peek(type) {
    return this.tokens[this.index]?.type === type;
  }

  take(type) {
    if (!this.peek(type)) return false;
    this.index += 1;
    return true;
  }

  parse() {
    const value = this.parseAdditive();
    if (value == null || this.index !== this.tokens.length) return null;
    return Number.isFinite(value) ? value : null;
  }

  parseAdditive() {
    let value = this.parseMultiplicative();
    if (value == null) return null;
    while (this.peek('+') || this.peek('-')) {
      const operator = this.tokens[this.index++].type;
      const right = this.parseMultiplicative();
      if (right == null) return null;
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  parseMultiplicative() {
    let value = this.parseUnary();
    if (value == null) return null;
    while (this.peek('*') || this.peek('/')) {
      const operator = this.tokens[this.index++].type;
      const right = this.parseUnary();
      if (right == null) return null;
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  parseUnary() {
    if (this.take('+')) return this.parseUnary();
    if (this.take('-')) {
      const value = this.parseUnary();
      return value == null ? null : -value;
    }
    return this.parsePower();
  }

  parsePower() {
    const value = this.parsePostfix();
    if (value == null || !this.take('^')) return value;
    const exponent = this.parseUnary();
    if (exponent == null) return null;
    return value ** exponent;
  }

  parsePostfix() {
    let value = this.parsePrimary();
    if (value == null) return null;
    while (this.take('%')) value /= 100;
    return value;
  }

  parsePrimary() {
    const token = this.tokens[this.index];
    if (token?.type === 'number') {
      this.index += 1;
      return token.value;
    }
    if (!this.take('(') || this.depth >= MAX_DEPTH) return null;
    this.depth += 1;
    const value = this.parseAdditive();
    this.depth -= 1;
    if (value == null || !this.take(')')) return null;
    return value;
  }
}

export function evaluateMathExpression(expression) {
  const tokens = tokenize(expression);
  if (!tokens?.length) return null;
  return new ExpressionParser(tokens).parse();
}
