/**
 * Testes automatizados da Central de Processos (node --test tests/).
 * Cobrem: mapeamento de status, linha do tempo, códigos públicos, sincronização
 * (Cenário A), alteração pela plataforma (Cenário B), falhas (Cenário C),
 * deduplicação de e-mails, e-mail ausente, autenticação e isolamento do portal.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarAmbiente, ambienteInstalado } = require('./harness');

const TAG = 'acompanhamento-cliente';

/** Simula uma nova execução do Apps Script (memória por execução zerada). */
function exec(amb, fn) {
  amb.g.memoProps_ = null;
  return fn(amb.g);
}

function tarefaSocietaria(amb, id, status, campos, extra) {
  return amb.clickup.criarTarefa(Object.assign({
    id, name: 'ALTERAÇÃO CONTRATUAL - ATS LOGISTICA', status, tags: [TAG],
    campos: Object.assign({ 'E-mail do cliente': 'cliente@empresa.com.br', 'Nome do cliente': 'Ana', CNPJ: '12.345.678/0001-90' }, campos || {})
  }, extra || {}));
}

function loginAdmin(amb, email) {
  email = email || 'admin@ecos.com.br';
  exec(amb, (g) => g.adminSolicitarCodigo(email));
  const msg = amb.emails[amb.emails.length - 1];
  const codigo = msg.body.match(/(\d{6})/)[1];
  return exec(amb, (g) => g.adminValidarCodigo(email, codigo)).token;
}

/* ---------------- Regras puras ---------------- */

test('mapeia os 7 status com a nomenclatura exata (case/acentos)', () => {
  const { g } = criarAmbiente();
  assert.equal(g.mapearStatus_('aguardando documentação'), 'AGUARDANDO_DOCUMENTACAO');
  assert.equal(g.mapearStatus_('Viabilidade'), 'VIABILIDADE');
  assert.equal(g.mapearStatus_('dbe'), 'DBE');
  assert.equal(g.mapearStatus_('vre digital - jucesp'), 'VRE_JUCESP');
  assert.equal(g.mapearStatus_('EM ANÁLISE'), 'EM_ANALISE');
  assert.equal(g.mapearStatus_('exigencia'), 'EXIGENCIA');
  assert.equal(g.mapearStatus_('deferido'), 'DEFERIDO');
  assert.equal(g.mapearStatus_('to do'), null);
  assert.equal(g.mapearStatus_('complete', { complete: 'DEFERIDO' }), 'DEFERIDO');
  assert.deepEqual(Array.from(g.STATUS_FLUXO, (s) => s.nome),
    ['Aguardando Documentação', 'Viabilidade', 'DBE', 'VRE Digital - JUCESP', 'Em análise', 'Exigência', 'Deferido']);
});

test('linha do tempo: concluídas, atual, futuras, exigência e retrocesso', () => {
  const { g } = criarAmbiente();
  const est = (atual, hist) => Array.from(g.montarLinhaDoTempo_(atual, hist), (e) => e.estado);
  assert.deepEqual(est('DBE', []), ['concluida', 'concluida', 'atual', 'futura', 'futura', 'futura', 'futura']);
  assert.deepEqual(est('EXIGENCIA', []), ['concluida', 'concluida', 'concluida', 'concluida', 'concluida', 'atencao', 'futura']);
  assert.deepEqual(est('DEFERIDO', []).slice(5), ['nao_ocorreu', 'final']);
  assert.deepEqual(est('DEFERIDO', [{ statusKey: 'EXIGENCIA', dataHora: 5 }]).slice(5), ['concluida', 'final']);
  // Retrocesso: etapa posterior que já ocorreu volta a ser futura e sem data.
  const tl = g.montarLinhaDoTempo_('VIABILIDADE', [{ statusKey: 'DBE', dataHora: 10 }, { statusKey: 'VIABILIDADE', dataHora: 20 }]);
  assert.equal(tl[2].estado, 'futura');
  assert.equal(tl[2].data, 0);
  assert.equal(tl[1].data, 20);
  assert.deepEqual(est('', []), Array(7).fill('futura'));
});

test('direção da mudança define o título do e-mail', () => {
  const { g } = criarAmbiente();
  assert.equal(g.direcaoMudanca_('DBE', 'VRE_JUCESP'), 'avanco');
  assert.equal(g.direcaoMudanca_('EM_ANALISE', 'DBE'), 'retrocesso');
  assert.equal(g.direcaoMudanca_('EM_ANALISE', 'EXIGENCIA'), 'exigencia');
  assert.equal(g.direcaoMudanca_('EXIGENCIA', 'EM_ANALISE'), 'avanco');
});

test('código público: formato, entropia e normalização', () => {
  const { g } = criarAmbiente();
  const vistos = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = g.gerarCodigoPublico_();
    assert.match(c, /^ECOS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    vistos.add(c);
    assert.equal(g.normalizarCodigo_(c.toLowerCase().replace(/-/g, ' ')), c);
  }
  assert.equal(vistos.size, 2000);
  assert.equal(g.normalizarCodigo_('ECOS-1234'), null);
  assert.equal(g.normalizarCodigo_('wdwmbdu50n'), null); // ID do ClickUp não é código válido
  assert.equal(g.normalizarCodigo_('ECOS-ABCD-EFGH-JKMO'), 'ECOS-ABCD-EFGH-JKM0'); // O → 0
});

test('mapeamento da tarefa extrai empresa, tipo e campos; respeita a etiqueta', () => {
  const amb = criarAmbiente();
  const t = tarefaSocietaria(amb, 't1', 'dbe');
  const p = amb.g.mapearTarefa_(JSON.parse(JSON.stringify(t)), { nomesCampos: { email: 'E-mail do cliente', cnpj: 'CNPJ' }, tag: TAG, aliases: {} });
  assert.equal(p.empresa, 'Ats Logistica');
  assert.equal(p.tipo, 'Alteração Contratual');
  assert.equal(p.email, 'cliente@empresa.com.br');
  assert.equal(p.statusKey, 'DBE');
  assert.equal(p.elegivel, true);
  const semTag = amb.clickup.criarTarefa({ id: 't2', name: 'IR 2026 - PLANEJAR DISPAROS', status: 'to do' });
  assert.equal(amb.g.mapearTarefa_(JSON.parse(JSON.stringify(semTag)), { nomesCampos: {}, tag: TAG }).elegivel, false);
});

/* ---------------- Cenário A: alteração pelo ClickUp ---------------- */

test('primeira sincronização cadastra sem enviar e-mail; mudança no ClickUp envia um único e-mail', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade');
  amb.clickup.criarTarefa({ id: 'x1', name: 'INSTAGRAM - POST', status: 'to do' }); // sem etiqueta

  const r1 = exec(amb, (g) => g.sincronizar_({}));
  assert.equal(r1.novos, 1);
  assert.equal(amb.emails.length, 0, 'não notifica na primeira sincronização');
  const linha = exec(amb, (g) => g.processoPorTask_('t1'));
  assert.match(linha.codigo, /^ECOS-/);
  assert.equal(amb.clickup.tasks.t1.custom_fields.find((f) => f.name === 'Código de acompanhamento').value, linha.codigo);
  assert.equal(exec(amb, (g) => g.processoPorTask_('x1')), null, 'tarefas sem etiqueta não entram');

  amb.clickup.mudarStatus('t1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  assert.equal(amb.emails.length, 1);
  const email = amb.emails[0];
  assert.equal(email.to, 'cliente@empresa.com.br');
  assert.equal(email.subject, 'Atualização do seu processo societário | Ecos Contabilidade');
  assert.match(email.htmlBody, /ACOMPANHAR MEU PROCESSO/);
  assert.ok(email.htmlBody.includes('?c=' + encodeURIComponent(linha.codigo)));
  assert.match(email.htmlBody, /Seu processo avançou!/);
  assert.ok(!email.htmlBody.includes('t1'), 'e-mail não expõe o ID interno da tarefa');

  // Verificações repetidas sem mudança não reenviam.
  exec(amb, (g) => g.sincronizar_({}));
  exec(amb, (g) => g.sincronizar_({ completa: true }));
  assert.equal(amb.emails.length, 1);

  const notifs = exec(amb, (g) => g.notificacoesDaTarefa_('t1'));
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].situacao, 'ENVIADO');
  assert.equal(notifs[0].destinatario, 'c***@e***.br');
  const evs = exec(amb, (g) => g.eventosDaTarefa_('t1'));
  const mud = evs.find((e) => e.tipo === 'STATUS_ALTERADO');
  assert.equal(mud.statusAnterior, 'VIABILIDADE');
  assert.equal(mud.statusNovo, 'DBE');
  assert.equal(mud.origem, 'CLICKUP');
  assert.equal(mud.notificacao, 'ENVIADO');
});

test('status fora do fluxo não notifica; retorno ao fluxo notifica', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'em análise');
  exec(amb, (g) => g.sincronizar_({}));
  amb.clickup.mudarStatus('t1', 'complete');
  exec(amb, (g) => g.sincronizar_({}));
  assert.equal(amb.emails.length, 0);
  amb.clickup.mudarStatus('t1', 'deferido');
  exec(amb, (g) => g.sincronizar_({}));
  assert.equal(amb.emails.length, 1);
  assert.match(amb.emails[0].htmlBody, /Próximos passos/);
});

test('processo sem e-mail: status atualizado, pendência registrada, sem envio', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade', { 'E-mail do cliente': undefined });
  delete amb.clickup.tasks.t1.custom_fields.find((f) => f.name === 'E-mail do cliente').value;
  exec(amb, (g) => g.sincronizar_({}));
  amb.clickup.mudarStatus('t1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  assert.equal(amb.emails.length, 0);
  const linha = exec(amb, (g) => g.processoPorTask_('t1'));
  assert.equal(linha.statusFluxo, 'DBE');
  assert.equal(exec(amb, (g) => g.simNao_(linha.pendenciaEmail)), true);
  assert.equal(exec(amb, (g) => g.notificacoesDaTarefa_('t1'))[0].situacao, 'SEM_EMAIL');
});

test('falha no envio registra FALHOU e permite reenvio controlado', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade');
  exec(amb, (g) => g.sincronizar_({}));
  amb.falharEmail = true;
  amb.clickup.mudarStatus('t1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  const n = exec(amb, (g) => g.notificacoesDaTarefa_('t1'))[0];
  assert.equal(n.situacao, 'FALHOU');
  assert.match(n.erro, /indisponível/);
  assert.equal(exec(amb, (g) => g.processoPorTask_('t1')).statusFluxo, 'DBE', 'status preservado mesmo com falha de e-mail');
  exec(amb, (g) => g.sincronizar_({}));
  assert.equal(exec(amb, (g) => g.notificacoesDaTarefa_('t1')).length, 1, 'sem nova tentativa automática');

  amb.falharEmail = false;
  const token = loginAdmin(amb);
  const antes = amb.emails.length;
  const d = exec(amb, (g) => g.adminReenviarNotificacao(token, 't1', n.id, false));
  assert.equal(d.resultado.situacao, 'ENVIADO');
  assert.equal(amb.emails.length, antes + 1);
  // Já enviada: exige confirmação explícita.
  assert.throws(() => exec(amb, (g) => g.adminReenviarNotificacao(token, 't1', n.id, false)), /Confirme o reenvio/);
});

test('falha da API do ClickUp na sincronização é registrada sem perder o cursor', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade');
  exec(amb, (g) => g.sincronizar_({}));
  const cursor = amb.props.SYNC_CURSOR;
  amb.clickup.falhas['get /list/901326635055/task'] = 503;
  assert.throws(() => exec(amb, (g) => g.sincronizar_({})), /HTTP 503/);
  assert.equal(amb.props.SYNC_CURSOR, cursor);
  assert.match(amb.props.ULTIMO_ERRO_SYNC, /503/);
  delete amb.clickup.falhas['get /list/901326635055/task'];
  amb.clickup.mudarStatus('t1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  assert.equal(amb.emails.length, 1, 'mudança ocorrida durante a falha é detectada depois');
  assert.equal(amb.props.ULTIMO_ERRO_SYNC, '');
});

/* ---------------- Cenário B: alteração pela plataforma ---------------- */

test('alteração pela plataforma atualiza o ClickUp, notifica uma vez e a sincronização não duplica', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade');
  exec(amb, (g) => g.sincronizar_({}));
  const token = loginAdmin(amb);
  const emailsLogin = amb.emails.length;

  const d = exec(amb, (g) => g.adminAlterarStatus(token, 't1', 'VRE_JUCESP', 'viabilidade'));
  assert.equal(amb.clickup.tasks.t1.status.status, 'vre digital - jucesp');
  assert.equal(d.statusKey, 'VRE_JUCESP');
  assert.equal(amb.emails.length, emailsLogin + 1);
  const ev = d.eventos.find((e) => e.tipo === 'STATUS_ALTERADO');
  assert.equal(ev.origem, 'PLATAFORMA');
  assert.equal(ev.usuario, 'admin@ecos.com.br');
  assert.equal(ev.sync, 'CONFIRMADO_CLICKUP');

  exec(amb, (g) => g.sincronizar_({}));
  exec(amb, (g) => g.sincronizar_({ completa: true }));
  assert.equal(amb.emails.length, emailsLogin + 1, 'sincronização posterior não gera outro e-mail');
});

test('conflito: status alterado no ClickUp depois que a tela foi carregada', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade');
  exec(amb, (g) => g.sincronizar_({}));
  const token = loginAdmin(amb);
  amb.clickup.mudarStatus('t1', 'dbe');
  assert.throws(() => exec(amb, (g) => g.adminAlterarStatus(token, 't1', 'EM_ANALISE', 'viabilidade')), /foi alterado no ClickUp/);
  assert.equal(amb.clickup.tasks.t1.status.status, 'dbe');
});

/* ---------------- Cenário C: falha ao atualizar ---------------- */

test('falha do ClickUp ao alterar status: nada é confirmado nem notificado', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade');
  exec(amb, (g) => g.sincronizar_({}));
  const token = loginAdmin(amb);
  const antes = amb.emails.length;
  amb.clickup.falhas['put /task/t1'] = 500;
  assert.throws(() => exec(amb, (g) => g.adminAlterarStatus(token, 't1', 'DBE', 'viabilidade')), /Nenhuma alteração foi confirmada/);
  assert.equal(amb.clickup.tasks.t1.status.status, 'viabilidade');
  assert.equal(exec(amb, (g) => g.processoPorTask_('t1')).statusFluxo, 'VIABILIDADE');
  assert.equal(amb.emails.length, antes);
  assert.ok(exec(amb, (g) => g.eventosDaTarefa_('t1')).some((e) => e.tipo === 'ERRO_ALTERACAO_STATUS' && e.resultadoSync === 'FALHA'));
  delete amb.clickup.falhas['put /task/t1'];
  exec(amb, (g) => g.adminAlterarStatus(token, 't1', 'DBE', 'viabilidade'));
  assert.equal(amb.emails.length, antes + 1, 'nova tentativa controlada funciona');
});

test('status inexistente na lista do ClickUp gera erro claro', () => {
  const amb = criarAmbiente({ usuarioAtivo: 'ecos.cont.contabilidade@gmail.com', statuses: ['to do', 'viabilidade', 'complete'],
    props: { CLICKUP_TOKEN: 'pk_teste', ADMIN_EMAILS: 'admin@ecos.com.br' } });
  amb.g.instalar();
  amb.usuarioAtivo = '';
  tarefaSocietaria(amb, 't1', 'viabilidade');
  exec(amb, (g) => g.sincronizar_({}));
  const token = loginAdmin(amb);
  assert.throws(() => exec(amb, (g) => g.adminAlterarStatus(token, 't1', 'DBE', 'viabilidade')), /não existe na lista do ClickUp/);
});

/* ---------------- Segurança ---------------- */

test('funções administrativas exigem sessão válida', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'viabilidade');
  for (const fn of ['adminResumo', 'adminDetalhe', 'adminAlterarStatus', 'adminSincronizar', 'adminDiagnostico', 'adminObterMensagens']) {
    assert.throws(() => exec(amb, (g) => g[fn]('', 't1', 'DBE')), /Sessão expirada/, fn);
    assert.throws(() => exec(amb, (g) => g[fn]('a'.repeat(64), 't1', 'DBE')), /Sessão expirada/, fn);
  }
  assert.equal(amb.clickup.tasks.t1.status.status, 'viabilidade');
});

test('funções de instalação e gatilhos recusam chamadas do navegador', () => {
  const amb = ambienteInstalado();
  for (const fn of ['instalar', 'sincronizarAgora', 'descobrirIdsClickUp', 'removerGatilhos', 'enviarEmailDeTeste', 'aplicarConfiguracaoEcos']) {
    assert.throws(() => exec(amb, (g) => g[fn]()), /não permitida/, fn);
  }
  assert.throws(() => exec(amb, (g) => g.gatilhoSincronizar({ triggerUid: 'inventado' })), /não permitida/);
  assert.doesNotThrow(() => exec(amb, (g) => g.gatilhoSincronizar({ triggerUid: amb.triggers[0].getUniqueId() })));
});

test('login: e-mail não autorizado não recebe código e a resposta é idêntica', () => {
  const amb = ambienteInstalado();
  const r1 = exec(amb, (g) => g.adminSolicitarCodigo('intruso@gmail.com'));
  assert.equal(amb.emails.length, 0);
  const r2 = exec(amb, (g) => g.adminSolicitarCodigo('admin@ecos.com.br'));
  assert.equal(amb.emails.length, 1);
  assert.equal(r1.mensagem, r2.mensagem);
  assert.throws(() => exec(amb, (g) => g.adminValidarCodigo('admin@ecos.com.br', '000000')), /Código inválido/);
});

test('login: código expira após 5 tentativas erradas e admin removido perde acesso', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => g.adminSolicitarCodigo('admin@ecos.com.br'));
  const codigo = amb.emails[0].body.match(/(\d{6})/)[1];
  const errado = codigo === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) assert.throws(() => exec(amb, (g) => g.adminValidarCodigo('admin@ecos.com.br', errado)));
  assert.throws(() => exec(amb, (g) => g.adminValidarCodigo('admin@ecos.com.br', codigo)), /Código inválido/);

  const token = loginAdmin(amb, 'outra@ecos.com.br');
  assert.doesNotThrow(() => exec(amb, (g) => g.adminDiagnostico(token)));
  amb.props.ADMIN_EMAILS = 'admin@ecos.com.br';
  assert.throws(() => exec(amb, (g) => g.adminDiagnostico(token)), /não autorizado|Sessão/);
});

test('portal: consulta válida retorna só dados mínimos; inválida não revela nada', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'exigência', { 'Orientação ao cliente': 'Enviar comprovante de endereço.' }, { descricao: 'Observação interna sigilosa' });
  tarefaSocietaria(amb, 't2', 'dbe', { 'E-mail do cliente': 'outro@cliente.com' }, { name: 'ABERTURA - OUTRA EMPRESA' });
  exec(amb, (g) => g.sincronizar_({}));
  const cod = exec(amb, (g) => g.processoPorTask_('t1')).codigo;

  const r = exec(amb, (g) => g.portalConsultar(cod.toLowerCase(), 'navegador1'));
  assert.equal(r.status, 'Exigência');
  assert.equal(r.orientacao, 'Enviar comprovante de endereço.');
  assert.equal(r.etapas.length, 7);
  const json = JSON.stringify(r);
  for (const proibido of ['t1', 'clickup.com', 'cliente@empresa', '12.345.678', 'Eduardo', 'sigilosa', 'OUTRA EMPRESA', 'Outra Empresa']) {
    assert.ok(!json.includes(proibido), 'não expõe: ' + proibido);
  }

  const erros = new Set();
  for (const tentativa of ['t2', 'ECOS-0000-0000-0000', '12.345.678/0001-90', '']) {
    try { exec(amb, (g) => g.portalConsultar(tentativa, 'navegador2')); assert.fail('deveria falhar'); }
    catch (e) { erros.add(e.message); }
  }
  assert.equal(erros.size, 1, 'mesma mensagem para qualquer código inválido');
});

test('portal: limite de tentativas por navegador', () => {
  const amb = ambienteInstalado();
  for (let i = 0; i < 10; i++) assert.throws(() => exec(amb, (g) => g.portalConsultar('ECOS-0000-0000-000' + (i % 10), 'abusivo')), /Não encontramos/);
  assert.throws(() => exec(amb, (g) => g.portalConsultar('ECOS-0000-0000-0000', 'abusivo')), /Muitas tentativas/);
});

test('portal: remoção da etiqueta desativa a consulta; novo código revoga o antigo', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  const antigo = exec(amb, (g) => g.processoPorTask_('t1')).codigo;
  const token = loginAdmin(amb);
  const d = exec(amb, (g) => g.adminGerarNovoCodigo(token, 't1'));
  assert.notEqual(d.codigo, antigo);
  assert.throws(() => exec(amb, (g) => g.portalConsultar(antigo, 'n')), /Não encontramos/);
  assert.equal(exec(amb, (g) => g.portalConsultar(d.codigo, 'n')).status, 'DBE');

  amb.clickup.tasks.t1.tags = [];
  amb.clickup.mudarStatus('t1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  assert.throws(() => exec(amb, (g) => g.portalConsultar(d.codigo, 'n')), /Não encontramos/);
});

test('portal: ClickUp indisponível exibe último estado confirmado sinalizado', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  const cod = exec(amb, (g) => g.processoPorTask_('t1')).codigo;
  amb.clickup.falhas['get /task/t1'] = 503;
  const r = exec(amb, (g) => g.portalConsultar(cod, 'n'));
  assert.equal(r.status, 'DBE');
  assert.equal(r.dadosEmCache, true);
});

test('painel: resumo com indicadores e tarefas sem acompanhamento', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'aguardando documentação');
  tarefaSocietaria(amb, 't2', 'exigência', { 'E-mail do cliente': '' });
  tarefaSocietaria(amb, 't3', 'deferido');
  amb.clickup.criarTarefa({ id: 'x1', name: 'COTAR BANNER ECOS', status: 'to do' });
  const token = loginAdmin(amb);
  const r = exec(amb, (g) => g.adminResumo(token));
  assert.equal(r.processos.length, 3);
  assert.equal(r.kpi.ativos, 2);
  assert.equal(r.kpi.aguardando, 1);
  assert.equal(r.kpi.exigencia, 1);
  assert.equal(r.kpi.deferidos, 1);
  assert.equal(r.kpi.semEmail, 1);
  assert.equal(r.semAcompanhamento.length, 1);
  assert.equal(r.semAcompanhamento[0].taskId, 'x1');

  const d = exec(amb, (g) => g.adminAtivarAcompanhamento(token, 'x1'));
  assert.equal(d.acompanhamento, true);
  assert.match(d.codigo, /^ECOS-/);
});

test('painel: tarefa de outra lista é recusada', () => {
  const amb = ambienteInstalado();
  amb.clickup.criarTarefa({ id: 'outra', name: 'FISCAL', status: 'to do', tags: [TAG], listId: '999' });
  const token = loginAdmin(amb);
  assert.throws(() => exec(amb, (g) => g.adminDetalhe(token, 'outra')), /não pertence/);
  assert.throws(() => exec(amb, (g) => g.adminAlterarStatus(token, 'outra', 'DBE', 'to do')), /não pertence/);
});

test('mensagens editáveis são usadas no e-mail e conteúdo é escapado', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'em análise', { 'Nome do cliente': '<script>alert(1)</script>', 'Orientação ao cliente': '<b>x</b>' },
    { name: 'ABERTURA - <img src=x onerror=alert(1)>' });
  exec(amb, (g) => g.sincronizar_({}));
  const token = loginAdmin(amb);
  const lista = exec(amb, (g) => g.adminObterMensagens(token));
  const exig = lista.find((m) => m.chave === 'EXIGENCIA');
  exig.mensagem = 'Mensagem personalizada da exigência.';
  exec(amb, (g) => g.adminSalvarMensagens(token, lista));
  exec(amb, (g) => g.adminAlterarStatus(token, 't1', 'EXIGENCIA', 'em análise'));
  const html = amb.emails[amb.emails.length - 1].htmlBody;
  assert.match(html, /Mensagem personalizada da exigência\./);
  assert.match(html, /Seu processo precisa de atenção/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.throws(() => exec(amb, (g) => g.adminSalvarMensagens(token, [{ chave: 'DBE', tituloEmail: 'x', mensagem: '' }])), /não pode ficar vazia/);
});

test('retrocesso de etapa usa título neutro no e-mail', () => {
  const amb = ambienteInstalado();
  tarefaSocietaria(amb, 't1', 'em análise');
  exec(amb, (g) => g.sincronizar_({}));
  amb.clickup.mudarStatus('t1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  assert.match(amb.emails[0].htmlBody, /Seu processo foi atualizado/);
  assert.ok(!amb.emails[0].htmlBody.includes('avançou'));
});

test('retenção remove eventos antigos', () => {
  const amb = ambienteInstalado({ RETENCAO_DIAS: '30' });
  tarefaSocietaria(amb, 't1', 'dbe');
  exec(amb, (g) => g.sincronizar_({}));
  exec(amb, (g) => g.registrarEvento_({ tipo: 'TESTE', dataHora: Date.now() - 40 * 86400000 }));
  const removidos = exec(amb, (g) => g.aplicarRetencao_());
  assert.equal(removidos, 1);
});

test('doGet renderiza portal e painel com escape do código na URL', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => g.doGet({ parameter: { c: '"><script>x</script>' } }));
  assert.ok(!amb.templates.Portal.includes('<script>x</script>'));
  assert.match(amb.templates.Portal, /data-codigo="scriptxscript"/);
  exec(amb, (g) => g.doGet({ parameter: { p: 'admin' } }));
  assert.match(amb.templates.Admin, /Entrar no painel/);
});

test('scripts do navegador são JavaScript válido', () => {
  for (const arq of ['PortalScript.html', 'AdminScript.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', arq), 'utf8');
    const js = html.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
    assert.doesNotThrow(() => new vm.Script(js, { filename: arq }), arq);
  }
});
