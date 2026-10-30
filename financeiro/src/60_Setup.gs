/**
 * 60_Setup.gs — Instalação e importação. Executar pelo editor do Apps Script.
 *
 * Estas funções não terminam em "_" para aparecerem no menu de execução do editor,
 * por isso conferem que quem executa é o proprietário do projeto.
 */

function exigirProprietario_() {
  var ativo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var efetivo = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var dono = prop_('PROPRIETARIO', '');
  if (!ativo || ativo !== efetivo || (dono && ativo !== dono)) {
    throw new Error('Execute esta função pelo editor do Apps Script, com a conta proprietária.');
  }
  return ativo;
}

/**
 * Cria a planilha do financeiro (se ainda não existir) com as abas e o plano de
 * categorias. Pode ser executada de novo sem perder dados.
 */
function instalar() {
  var usuario = exigirProprietario_();
  if (!prop_('PROPRIETARIO', '')) setProp_('PROPRIETARIO', usuario);
  if (!prop_('FIN_EMAILS', '')) setProp_('FIN_EMAILS', usuario);
  if (!prop_('FIN_SPREADSHEET_ID', '')) {
    var ss = SpreadsheetApp.create('Financeiro ECOS — base (não editar a estrutura)');
    setProp_('FIN_SPREADSHEET_ID', ss.getId());
  }
  limparMemoria_();
  Object.keys(ABAS).forEach(function (k) { aba_(ABAS[k]); });
  var existentes = {};
  lerTodos_(ABAS.CATEGORIAS).forEach(function (c) { existentes[normalizar_(c.nome) + '|' + c.tipo] = true; });
  CATEGORIAS_PADRAO.forEach(function (c) {
    if (!existentes[normalizar_(c[0]) + '|' + c[1]]) inserir_(ABAS.CATEGORIAS, { nome: c[0], tipo: c[1], grupo: c[2], ativa: true });
  });
  var pagina1 = planilha_().getSheetByName('Página1') || planilha_().getSheetByName('Sheet1');
  if (pagina1 && planilha_().getSheets().length > 1) planilha_().deleteSheet(pagina1);
  registrarLog_(usuario, 'INSTALAR', '', 'versão ' + FIN.VERSAO);
  var url = planilha_().getUrl();
  console.log('Base do financeiro: ' + url);
  return url;
}

/**
 * Importa a planilha "Ecos - Fluxo de caixa 2026". O ID vem da propriedade
 * FLUXO_ORIGEM_ID. Pode ser executada de novo: linhas já importadas são ignoradas.
 */
function importarFluxoDeCaixa() {
  var usuario = exigirProprietario_();
  var id = prop_('FLUXO_ORIGEM_ID', '');
  if (!id) throw new Error('Defina a propriedade FLUXO_ORIGEM_ID com o ID da planilha de fluxo de caixa.');
  limparMemoria_();
  var r = comLock_(function () { return importarFluxo_(lerFluxoOrigem_(id), usuario); });
  console.log(JSON.stringify(r));
  return r;
}

/** Diagnóstico rápido da configuração. */
function verificarConfiguracao() {
  exigirProprietario_();
  limparMemoria_();
  var r = {
    planilha: prop_('FIN_SPREADSHEET_ID', '') ? planilha_().getUrl() : 'NÃO INSTALADA',
    usuariosAutorizados: usuariosAutorizados_(),
    categorias: categorias_().length,
    lancamentos: lerTodos_(ABAS.LANCAMENTOS).length,
    recorrencias: lerTodos_(ABAS.RECORRENCIAS).length
  };
  console.log(JSON.stringify(r, null, 2));
  return r;
}
