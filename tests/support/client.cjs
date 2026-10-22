const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function clientFunction(name, helpers, scope, file = 'app/page.tsx') {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(ast)};`);
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const code = [...helpers, name].map(key => { if (!declarations.has(key)) throw new Error('Missing ' + key); return declarations.get(key); }).join('\n') + `\nreturn ${name};`;
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('require', 'exports', ...Object.keys(scope), js)(require, {}, ...Object.values(scope));
}
module.exports = { clientFunction };
