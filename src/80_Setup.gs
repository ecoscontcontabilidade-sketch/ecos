/**
 * 80_Setup.gs — Instalação e manutenção. Execute estas funções pelo EDITOR do
 * Apps Script (menu Executar). Todas recusam execução vinda do navegador.
 *
 * Ordem recomendada (ver docs/IMPLANTACAO.md):
 *   1. Propriedades do script: CLICKUP_TOKEN e ADMIN_EMAILS (manualmente).
 *   2. descobrirIdsClickUp()    — lista Workspace/Space/Folder/List IDs no log.
 *   3. aplicarConfiguracaoEcos() — grava os IDs e valores padrão da Ecos.
 *   4. instalar()               — cria a base auxiliar, mensagens e gatilhos.
 *   5. verificarConfiguracao()  — confere status e campos no ClickUp.
 *   6. Publicar o Web App e gravar APP_URL.
 *   7. sincronizarAgora()       — primeira sincronização (não envia e-mails).
 */

/** IDs levantados na análise de 29/10/2026 (lista "Processos"). Confirme com descobrirIdsClickUp(). */
var IDS_ECOS = {
  CLICKUP_TEAM_ID: '90132062538',
  CLICKUP_SPACE_ID: '90138710247',
  CLICKUP_FOLDER_ID: '',
  CLICKUP_LIST_ID: '901326635055',
  LOGO_FILE_ID: '1pWHgJJ7xleiUB6KCEl07pZ5e6Cn7wgmN'
};

/** Grava IDs e valores padrão (sem sobrescrever o que já estiver preenchido). */
function aplicarConfiguracaoEcos() {
  exigirContextoInterno_();
  var props = PropertiesService.getScriptProperties();
  var atuais = props.getProperties();
  var novos = {};
  var valores = {};
  Object.keys(CONFIG_PADRAO).forEach(function (k) { valores[k] = CONFIG_PADRAO[k]; });
  Object.keys(IDS_ECOS).forEach(function (k) { valores[k] = IDS_ECOS[k]; });
  Object.keys(valores).forEach(function (k) {
    if (!atuais[k] && valores[k] !== '') novos[k] = valores[k];
  });
  if (!atuais.HASH_SALT) novos.HASH_SALT = tokenAleatorio_();
  props.setProperties(novos, false);
  memoProps_ = null;
  console.log('Propriedades gravadas: ' + Object.keys(novos).filter(function (k) { return PROPRIEDADES_SECRETAS.indexOf(k) < 0; }).join(', '));
}

/** Cria a base auxiliar, semeia as mensagens e instala os gatilhos. Idempotente. */
function instalar() {
  exigirContextoInterno_();
  aplicarConfiguracaoEcos();
  memoProps_ = null;
  var id = prop_('SPREADSHEET_ID', '');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('Central de Processos — Base Auxiliar (NÃO COMPARTILHAR)');
    setProp_('SPREADSHEET_ID', ss.getId());
  }
  memoPlanilha_ = ss;
  [ABAS.PROCESSOS, ABAS.EVENTOS, ABAS.NOTIFICACOES, ABAS.MENSAGENS].forEach(function (def) {
    var sh = aba_(def);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, def.colunas.length).setValues([def.colunas]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  var padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  if (lerTodos_(ABAS.MENSAGENS).length === 0) {
    STATUS_FLUXO.forEach(function (s) {
      var m = MENSAGENS_PADRAO[s.key];
      inserir_(ABAS.MENSAGENS, { chave: s.key, status: s.nome, tituloEmail: m.tituloEmail, mensagem: m.mensagem,
        proximosPassos: m.proximosPassos, atualizadoEm: agora_(), atualizadoPor: 'instalação' });
    });
  }
  instalarGatilhos();
  console.log('Base auxiliar: ' + ss.getUrl());
  console.log('Instalação concluída. Próximo passo: verificarConfiguracao().');
}

/** (Re)instala os gatilhos de sincronização e manutenção diária. */
function instalarGatilhos() {
  exigirContextoInterno_();
  removerGatilhos();
  var minutos = propInt_('SYNC_MINUTOS', 5);
  var permitidos = [1, 5, 10, 15, 30];
  if (permitidos.indexOf(minutos) < 0) minutos = 5;
  ScriptApp.newTrigger('gatilhoSincronizar').timeBased().everyMinutes(minutos).create();
  ScriptApp.newTrigger('gatilhoManutencaoDiaria').timeBased().everyDays(1).atHour(3).inTimezone(APP.TIMEZONE).create();
  console.log('Gatilhos instalados: sincronização a cada ' + minutos + ' min e manutenção diária às 3h.');
}

function removerGatilhos() {
  exigirContextoInterno_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['gatilhoSincronizar', 'gatilhoManutencaoDiaria'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

/** Lista Workspaces, Spaces, Folders e Lists acessíveis pelo token (no log de execução). */
function descobrirIdsClickUp() {
  exigirContextoInterno_();
  cuEquipes_().forEach(function (team) {
    console.log('WORKSPACE ' + team.name + ' → CLICKUP_TEAM_ID=' + team.id);
    cuSpaces_(team.id).forEach(function (sp) {
      console.log('  SPACE ' + sp.name + ' → CLICKUP_SPACE_ID=' + sp.id);
      cuListasSemPasta_(sp.id).forEach(function (l) {
        console.log('    LISTA (sem pasta) ' + l.name + ' → CLICKUP_LIST_ID=' + l.id);
      });
      cuFolders_(sp.id).forEach(function (f) {
        console.log('    FOLDER ' + f.name + ' → CLICKUP_FOLDER_ID=' + f.id);
        cuListasDaPasta_(f.id).forEach(function (l) {
          console.log('      LISTA ' + l.name + ' → CLICKUP_LIST_ID=' + l.id);
        });
      });
    });
  });
}

/** Mostra no log o diagnóstico completo (status e campos do ClickUp, gatilhos, cota). */
function verificarConfiguracao() {
  exigirContextoInterno_();
  memoProps_ = null;
  var d = diagnostico_();
  console.log(JSON.stringify(d, null, 2));
  if (d.problemas.length) console.warn('PENDÊNCIAS:\n- ' + d.problemas.join('\n- '));
  else console.log('Configuração OK.');
}

function sincronizarAgora() {
  exigirContextoInterno_();
  console.log(JSON.stringify(sincronizar_({ origem: 'EDITOR', esperaMs: 60000 })));
}

function reconciliarAgora() {
  exigirContextoInterno_();
  console.log(JSON.stringify(sincronizar_({ completa: true, origem: 'EDITOR', esperaMs: 60000 })));
}

/** Envia um e-mail de teste com o modelo de um status para o e-mail informado. */
function enviarEmailDeTeste(destino, statusKey) {
  exigirContextoInterno_();
  var key = statusKey || 'VIABILIDADE';
  if (!statusPorChave_(key)) throw new Error('Status inválido: ' + key);
  var p = { taskId: 'teste', email: destino || Session.getEffectiveUser().getEmail(), nomeCliente: 'Cliente Teste',
    empresa: 'Empresa Exemplo Ltda', tipo: 'Alteração Contratual', nomeLegivel: 'Alteração Contratual - Empresa Exemplo',
    orientacao: key === 'EXIGENCIA' ? 'Exemplo de orientação: enviar o comprovante de endereço atualizado.' : '' };
  enviarEmailStatus_(p, { codigo: 'ECOS-TEST-E000-0000' }, 'DBE', key);
  console.log('E-mail de teste enviado para ' + mascararEmail_(p.email));
}

/** Testes de lógica executáveis no próprio Apps Script (sem chamadas externas). */
function executarTestesInternos() {
  exigirContextoInterno_();
  var falhas = [];
  var ok = function (cond, nome) { if (!cond) falhas.push(nome); };
  ok(mapearStatus_('vre digital - jucesp') === 'VRE_JUCESP', 'status VRE minúsculo');
  ok(mapearStatus_('EM ANALISE') === 'EM_ANALISE', 'status sem acento');
  ok(mapearStatus_('to do') === null, 'status fora do fluxo');
  ok(normalizarCodigo_(gerarCodigoPublico_()) !== null, 'código gerado válido');
  ok(normalizarCodigo_('123') === null, 'código curto inválido');
  var tl = montarLinhaDoTempo_('DEFERIDO', [{ statusKey: 'DBE', dataHora: 1 }]);
  ok(tl[5].estado === 'nao_ocorreu' && tl[6].estado === 'final', 'linha do tempo deferido sem exigência');
  console.log(falhas.length ? 'FALHAS: ' + falhas.join(', ') : 'Todos os testes internos passaram.');
}
