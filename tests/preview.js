/**
 * Gera capturas de tela do portal e do painel com dados simulados (Playwright).
 * Uso: node tests/preview.js <pasta-de-saida>
 * O objeto google.script.run é substituído por um stub que chama o backend
 * simulado do harness — as telas exercitam o mesmo código do Apps Script.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { ambienteInstalado } = require('./harness');

const saida = process.argv[2] || path.join(__dirname, '..', 'preview');
fs.mkdirSync(saida, { recursive: true });

function prepararAmbiente() {
  const amb = ambienteInstalado();
  const add = (id, nome, status, campos) => amb.clickup.criarTarefa({
    id, name: nome, status, tags: ['acompanhamento-cliente'],
    assignees: [{ id: 1, username: id === 't2' ? 'Breno Samadhi' : 'Eduardo da Cruz' }],
    campos: Object.assign({ 'E-mail do cliente': 'contato@cliente.com.br', 'Nome do cliente': 'Roberta' }, campos || {})
  });
  add('t1', 'ALTERAÇÃO CONTRATUAL - ATS LOGISTICA', 'viabilidade');
  add('t2', 'ABERTURA - FLAVIA CARDOSO', 'exigência', { 'Orientação ao cliente': 'Precisamos do comprovante de endereço atualizado (emitido nos últimos 90 dias) para responder à exigência da Junta Comercial.' });
  add('t3', 'DESENQUADRAMENTO - DEISY FERRARI', 'deferido');
  add('t4', 'REGULARIZAÇÃO MEI - JOSE PORFIRIO', 'aguardando documentação', { 'E-mail do cliente': '' });
  amb.clickup.criarTarefa({ id: 'x1', name: 'IR 2026 - PLANEJAR DISPAROS', status: 'to do' });
  amb.g.memoProps_ = null;
  amb.g.sincronizar_({});
  ['dbe', 'vre digital - jucesp', 'em análise'].forEach((s) => { amb.clickup.mudarStatus('t1', s); amb.g.sincronizar_({}); });
  amb.clickup.mudarStatus('t2', 'em análise'); amb.g.sincronizar_({});
  amb.clickup.mudarStatus('t2', 'exigência'); amb.g.sincronizar_({});
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
  window.google = { script: { get run() { return runner(); }, history: { replace: function () {} } } };
})();
</script>`;

/** Injeta o stub de google.script.run no início do documento. */
function comStub(html) { return html.replace('<head>', '<head>' + STUB); }

async function stub(page, amb) {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.exposeFunction('__chamar', (fn, args) => {
    amb.g.memoProps_ = null;
    try { return { ok: amb.g[fn].apply(null, args) }; } catch (e) { return { erro: e.message }; }
  });
}

(async () => {
  const amb = prepararAmbiente();
  const navegador = await chromium.launch();
  const codigo = amb.g.processoPorTask_('t2').codigo;

  amb.g.doGet({ parameter: { codigo: codigo } });
  const portalHtml = amb.templates.Portal;
  amb.g.doGet({ parameter: {} });
  const portalVazio = amb.templates.Portal;
  amb.g.doGet({ parameter: { p: 'admin' } });
  const adminHtml = amb.templates.Admin;

  for (const [nome, vp] of [['desktop', { width: 1280, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const ctx = await navegador.newContext({ viewport: vp, deviceScaleFactor: 1 });
    let page = await ctx.newPage();
    await stub(page, amb);
    await page.setContent(comStub(portalVazio), { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(saida, `portal-inicio-${nome}.png`), fullPage: true });

    page = await ctx.newPage();
    await stub(page, amb);
    await page.setContent(comStub(portalHtml), { waitUntil: 'networkidle' });
    await page.waitForSelector('#telaResultado:not(.oculto)');
    await page.screenshot({ path: path.join(saida, `portal-exigencia-${nome}.png`), fullPage: true });

    page = await ctx.newPage();
    await stub(page, amb);
    await page.setContent(comStub(adminHtml), { waitUntil: 'networkidle' });
    await page.fill('#loginEmail', 'admin@ecos.com.br');
    await page.click('#btnPedirCodigo');
    await page.waitForSelector('#formCodigo:not(.oculto)');
    const cod = amb.emails[amb.emails.length - 1].body.match(/(\d{6})/)[1];
    await page.fill('#loginCodigo', cod);
    await page.click('#btnValidar');
    await page.waitForSelector('#corpoTabela tr');
    await page.screenshot({ path: path.join(saida, `painel-${nome}.png`), fullPage: true });
    await page.click('#corpoTabela tr');
    await page.waitForSelector('#painelCorpo .cartao');
    await page.screenshot({ path: path.join(saida, `painel-detalhe-${nome}.png`), fullPage: false });
    await ctx.close();
  }

  const email = amb.emails.find((e) => /Exigência/.test(e.htmlBody));
  const pageEmail = await navegador.newPage({ viewport: { width: 640, height: 900 } });
  await pageEmail.setContent(email.htmlBody);
  await pageEmail.screenshot({ path: path.join(saida, 'email-exigencia.png'), fullPage: true });
  await navegador.close();
  console.log('Capturas em ' + saida);
})().catch((e) => { console.error(e); process.exit(1); });
