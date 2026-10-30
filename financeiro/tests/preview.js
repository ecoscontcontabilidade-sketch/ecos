/**
 * Gera capturas de tela do Financeiro com o backend simulado (Playwright).
 * Uso: node financeiro/tests/preview.js <pasta-de-saida> [linhas.json]
 *
 * linhas.json (opcional): linhas da aba "Fluxo de Caixa" já exportadas, no formato
 * [["", "aaaa-mm-dd", valor, forma, conta, cliente/fornecedor, categoria, descrição], ...].
 * Sem ele, usa um pequeno conjunto de demonstração. Não versione dados reais.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { ambienteInstalado, exec } = require('./harness');

const saida = process.argv[2] || path.join(__dirname, '..', '..', 'preview', 'financeiro');
const arquivoLinhas = process.argv[3];
fs.mkdirSync(saida, { recursive: true });

const DEMO = [
  ['', '2026-08-03', -2012.52, 'Pix', '', 'Sócio A', 'Salário', 'Salário'],
  ['', '2026-07-03', -2000, 'Pix', '', 'Sócio A', 'Salário', 'Salário'],
  ['', '2026-08-10', -900, 'Pix', '', 'Dominio Sistemas', 'Aplicativo', 'Software'],
  ['', '2026-07-10', -900, 'Pix', '', 'Dominio Sistemas', 'Aplicativo', 'Software'],
  ['', '2026-08-05', 350, 'Pix', '', 'Cliente Alfa', 'Serviço', 'Honorários mensais'],
  ['', '2026-08-12', 500, 'Pix', '', 'Cliente Beta', 'Serviço', 'Honorários mensais'],
  ['', '2026-08-28', 200, 'Pix', '', 'Cliente Gama', 'Serviço', 'Honorários mensais'],
  ['', '2026-08-30', 720, 'Pix', '', 'Cliente Beta', 'Serviço', 'Alteração de contrato']
];

function prepararAmbiente() {
  const amb = ambienteInstalado();
  amb.props.FLUXO_ORIGEM_ID = 'origem';
  const sh = amb.origem.insertSheet('Fluxo de Caixa');
  sh.rows.push(['', 'Data', 'Valor', 'Forma de Pgmt.', 'Conta destino', 'Cliente/Fornecedor', 'Categoria', 'Descrição']);
  const linhas = arquivoLinhas ? JSON.parse(fs.readFileSync(arquivoLinhas, 'utf8')) : DEMO;
  linhas.forEach((l) => sh.rows.push(l));
  exec(amb, (g) => g.importarFluxoDeCaixa());
  exec(amb, (g) => g.finGerarPrevisoes('2026-09'));
  exec(amb, (g) => g.finDefinirSaldoInicial('2026-09', 3216.41));
  // Simula o uso: parte de setembro e de outubro já baixada.
  const set = exec(amb, (g) => g.finCarregar('2026-09'));
  set.receitas.concat(set.despesas).forEach((l, i) => {
    if (i % 5 !== 0) exec(amb, (g) => g.finBaixar(l.id, { dataPagamento: l.vencimento }, '2026-09'));
  });
  const out = exec(amb, (g) => g.finCarregar('2026-10'));
  out.receitas.concat(out.despesas).forEach((l, i) => {
    if (l.vencimento < '2026-10-28' && i % 3 !== 0) exec(amb, (g) => g.finBaixar(l.id, { dataPagamento: l.vencimento }, '2026-10'));
  });
  exec(amb, (g) => g.finSalvarLancamento({ tipo: 'RECEITA', contraparte: 'Abertura — novo cliente', categoria: 'Abertura, alteração e baixa', valor: 800, vencimento: '2026-11-04', descricao: 'Abertura de CNPJ 2/2' }, '2026-10'));
  return amb;
}

const STUB = `<script>
(function () {
  function runner() {
    var ok = function () {}, falha = function () {};
    var r = new Proxy({}, {
      get: function (_, nome) {
        if (nome === 'withSuccessHandler') return function (f) { ok = f; return r; };
        if (nome === 'withFailureHandler') return function (f) { falha = f; return r; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          window.__chamar(nome, args).then(function (x) { if (x.erro) falha(new Error(x.erro)); else ok(x.ok); });
        };
      }
    });
    return r;
  }
  window.google = { script: { get run() { return runner(); } } };
})();
</script>`;

(async () => {
  const amb = prepararAmbiente();
  amb.g.doGet({});
  const html = amb.templates.Index.replace('<head>', '<head>' + STUB);
  const navegador = await chromium.launch();
  for (const [nome, vp] of [['desktop', { width: 1280, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const ctx = await navegador.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.exposeFunction('__chamar', (fn, args) => {
      try { return { ok: JSON.parse(JSON.stringify(exec(amb, (g) => g[fn].apply(null, args)))) }; } catch (e) { return { erro: e.message }; }
    });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lstReceberHoje li');
    for (const aba of ['hoje', 'receber', 'pagar', 'inadimplentes', 'dashboard', 'cadastros']) {
      await page.click(`.aba[data-aba="${aba}"]`);
      await page.waitForTimeout(150);
      if (aba === 'dashboard') {
        const box = await page.locator('#grafSaldo svg').boundingBox();
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
      }
      await page.screenshot({ path: path.join(saida, `${aba}-${nome}.png`), fullPage: true });
    }
    if (nome === 'desktop') {
      await page.click('.aba[data-aba="hoje"]');
      await page.click('#lstReceberAtrasado .btn');
      await page.waitForSelector('#dlgBaixa[open]');
      await page.fill('#formBaixa [name=valorPago]', '100,00');
      await page.screenshot({ path: path.join(saida, 'baixa-desktop.png') });
    }
    await ctx.close();
  }
  await navegador.close();
  console.log('Capturas em ' + saida);
})().catch((e) => { console.error(e); process.exit(1); });
