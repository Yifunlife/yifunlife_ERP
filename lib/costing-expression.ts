// Restricted arithmetic only: no JavaScript, functions, variables, or external references.
export function evaluateCostingExpression(expression: string): number | null {
  if (!expression.trim() || expression.length > 256 || /[^\d.eE+\-*/()\s]/.test(expression)) return null;
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+\-*/()]/g) || [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) return null;
  let index = 0;
  const atom = (): number => {
    const token = tokens[index++];
    if (token === "+") return atom();
    if (token === "-") return -atom();
    if (token === "(") { const value = add(); if (tokens[index++] !== ")") throw Error(); return value; }
    if (!token || !/^[\d.]/.test(token)) throw Error();
    return Number(token);
  };
  const multiply = (): number => { let value = atom(); while (["*", "/"].includes(tokens[index])) { const op = tokens[index++]; const right = atom(); value = op === "*" ? value * right : value / right; } return value; };
  const add = (): number => { let value = multiply(); while (["+", "-"].includes(tokens[index])) { const op = tokens[index++]; const right = multiply(); value = op === "+" ? value + right : value - right; } return value; };
  try { const value = add(); return index === tokens.length && Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : null; } catch { return null; }
}
