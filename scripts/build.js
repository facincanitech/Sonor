// Gera o index.html minificado (o que vai pro GitHub Pages e pro APK) a
// partir do arquivo-fonte legível backup/index-source.html. Nunca edite o
// index.html da raiz diretamente — ele é gerado, não é fonte.
const fs = require('fs');
const path = require('path');
const { minify } = require('html-minifier-terser');

const SRC = path.join(__dirname, '..', 'backup', 'index-source.html');
const OUT = path.join(__dirname, '..', 'index.html');

async function build() {
  const src = fs.readFileSync(SRC, 'utf8');
  const min = await minify(src, {
    collapseWhitespace: true,
    removeComments: true,
    minifyJS: true,
    minifyCSS: true,
    removeAttributeQuotes: false,
  });
  const guard = '<!-- ARQUIVO GERADO por scripts/build.js a partir de backup/index-source.html. NAO EDITE AQUI, edite o source e rode "npm run build". -->\n';
  fs.writeFileSync(OUT, guard + min);
  const before = Buffer.byteLength(src, 'utf8');
  const after = Buffer.byteLength(min, 'utf8');
  console.log(`index.html minificado: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
}

build().catch((err) => {
  console.error('Erro ao minificar:', err);
  process.exit(1);
});
