/**
 * 40_Sync.gs — Sincronização ClickUp → Central (Cenário A) e registro das
 * mudanças feitas pela plataforma (Cenário B).
 *
 * Estratégia: consulta periódica incremental (gatilho de tempo) usando
 * date_updated_gt com sobreposição de 2 minutos, mais uma reconciliação
 * completa diária. Webhooks do ClickUp não são usados porque o Web App do
 * Apps Script responde POST com redirecionamento 302 e não expõe os cabeçalhos
 * da requisição — impossibilitando validar a assinatura (X-Signature).
 *
 * Detecção de mudança: compara o status atual da tarefa com o último status
 * observado (aba Processos). Como o registro é atualizado na mesma execução,
 * verificações repetidas nunca reprocessam a mesma mudança.
 */

var SOBREPOSICAO_SYNC_MS = 2 * 60 * 1000;

/**
 * Sincroniza. opcoes: { completa: bool, origem: 'GATILHO'|'PAINEL'|'EDITOR' }
 * Retorna um resumo. Executa sob o lock do script.
 */
function sincronizar_(opcoes) {
  opcoes = opcoes || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(opcoes.esperaMs || 20000)) return { ignorado: true, motivo: 'Outra sincronização em andamento.' };
  try {
    return sincronizarSemLock_(opcoes);
  } finally {
    lock.releaseLock();
  }
}

function sincronizarSemLock_(opcoes) {
  var listId = prop_('CLICKUP_LIST_ID', '');
  if (!listId) throw new ErroApp('CLICKUP_LIST_ID não configurado.', 'CONFIG');
  var cursor = propInt_('SYNC_CURSOR', 0);
  var primeira = !cursor;
  var completa = !!opcoes.completa || primeira;
  var inicio = agora_();
  var resumo = { tarefas: 0, novos: 0, mudancas: 0, notificacoes: 0, desativados: 0, completa: completa };

  var tarefas;
  try {
    tarefas = cuTarefasDaLista_(listId, completa ? {} : { atualizadasDepoisDe: Math.max(0, cursor - SOBREPOSICAO_SYNC_MS) });
  } catch (e) {
    registrarFalhaSync_(e);
    throw e;
  }

  var ctx = contextoMapeamento_();
  var idx = indiceProcessos_();
  var vistos = {};
  var maiorAtualizacao = cursor;

  tarefas.forEach(function (task) {
    resumo.tarefas++;
    var p = mapearTarefa_(task, ctx);
    if (p.listId && p.listId !== String(listId)) return; // tarefa de outra lista (ex.: múltiplas listas)
    vistos[p.taskId] = true;
    maiorAtualizacao = Math.max(maiorAtualizacao, p.atualizadoEm);
    var r = processarTarefa_(p, idx[p.taskId], idx, { primeira: primeira, origem: 'CLICKUP' });
    if (r.novo) resumo.novos++;
    if (r.mudanca) resumo.mudancas++;
    if (r.notificacao) resumo.notificacoes++;
  });

  // Reconciliação completa: processos que sumiram da lista (excluídos, arquivados ou movidos).
  if (completa) {
    Object.keys(idx).forEach(function (taskId) {
      var linha = idx[taskId];
      if (linha.ativo && !vistos[taskId]) {
        linha.ativo = false;
        linha.atualizadoEm = agora_();
        atualizar_(ABAS.PROCESSOS, linha);
        registrarEvento_({ taskId: taskId, codigo: linha.codigo, tipo: 'REMOVIDO_DA_LISTA', origem: 'CLICKUP',
          detalhe: 'Tarefa não encontrada na lista (excluída, arquivada ou movida). Consulta pública desativada.' });
        resumo.desativados++;
      }
    });
    setProp_('ULTIMA_RECONCILIACAO', inicio);
  }

  setProp_('SYNC_CURSOR', Math.max(maiorAtualizacao, cursor));
  setProp_('ULTIMA_SINCRONIZACAO', inicio);
  setProp_('ULTIMO_ERRO_SYNC', '');
  return resumo;
}

/**
 * Processa uma tarefa já mapeada contra o registro local.
 * Retorna { novo, mudanca, notificacao }.
 */
function processarTarefa_(p, linha, idx, ctx) {
  var r = { novo: false, mudanca: false, notificacao: false };

  if (!linha) {
    if (!p.elegivel) return r;
    var codigo = novoCodigoUnico_(idx);
    linha = {
      taskId: p.taskId, codigo: codigo, ativo: true,
      statusClickUp: p.statusClickUp, statusFluxo: p.statusKey || '',
      statusDesde: p.statusKey ? p.atualizadoEm : '', atualizadoClickUp: p.atualizadoEm,
      empresa: p.empresa, processo: p.tipo, pendenciaEmail: !emailValido_(p.email),
      ultimaNotificacao: '', criadoEm: agora_(), atualizadoEm: agora_()
    };
    inserir_(ABAS.PROCESSOS, linha);
    idx[p.taskId] = linha;
    var evCad = registrarEvento_({
      taskId: p.taskId, codigo: codigo, tipo: 'CADASTRO', statusNovo: p.statusKey || '',
      origem: ctx.origem || 'CLICKUP', usuario: ctx.usuario || '',
      detalhe: 'Processo incluído no acompanhamento. Status no ClickUp: "' + p.statusClickUp + '".'
    });
    gravarCodigoNoClickUp_(p, codigo);
    r.novo = true;
    if (p.statusKey && propBool_('NOTIFICAR_PRIMEIRA_SINCRONIZACAO') && !ctx.primeira) {
      var n0 = notificar_({ eventoId: evCad.id, proc: p, linha: linha, anteriorKey: '', novoKey: p.statusKey, usuario: 'sistema' });
      r.notificacao = !!n0;
    }
    return r;
  }

  // Metadados (não geram notificação).
  var alterouMeta = false;
  if (linha.empresa !== p.empresa || linha.processo !== p.tipo) {
    linha.empresa = p.empresa; linha.processo = p.tipo; alterouMeta = true;
  }
  var pend = !emailValido_(p.email);
  if (simNao_(linha.pendenciaEmail) !== pend) { linha.pendenciaEmail = pend; alterouMeta = true; }

  if (!p.elegivel) {
    if (linha.ativo) {
      linha.ativo = false; linha.atualizadoEm = agora_();
      atualizar_(ABAS.PROCESSOS, linha);
      registrarEvento_({ taskId: p.taskId, codigo: linha.codigo, tipo: 'ACOMPANHAMENTO_DESATIVADO', origem: 'CLICKUP',
        detalhe: 'Etiqueta de acompanhamento removida. Consulta pública e notificações desativadas.' });
    }
    return r;
  }
  if (!linha.ativo) {
    linha.ativo = true; alterouMeta = true;
    registrarEvento_({ taskId: p.taskId, codigo: linha.codigo, tipo: 'ACOMPANHAMENTO_REATIVADO', origem: 'CLICKUP' });
  }

  if (normalizar_(p.statusClickUp) === normalizar_(linha.statusClickUp)) {
    if (alterouMeta || Number(linha.atualizadoClickUp) !== p.atualizadoEm) {
      linha.atualizadoClickUp = p.atualizadoEm; linha.atualizadoEm = agora_();
      atualizar_(ABAS.PROCESSOS, linha);
    }
    return r;
  }

  var res = registrarMudancaStatus_(p, linha, { origem: ctx.origem || 'CLICKUP', usuario: ctx.usuario || '' });
  r.mudanca = true;
  r.notificacao = res.notificado;
  return r;
}

/**
 * Registra uma mudança efetiva de status (de qualquer origem), atualiza o
 * registro local e dispara a notificação quando a mudança for para uma etapa
 * diferente do fluxo. Deve ser chamada sob o lock.
 */
function registrarMudancaStatus_(p, linha, ctx) {
  var anteriorRaw = String(linha.statusClickUp || '');
  var anteriorKey = String(linha.statusFluxo || '');
  var novoKey = p.statusKey;

  // ID determinístico: a mesma mudança observada duas vezes gera o mesmo ID.
  var eventoId = sha256Hex_([p.taskId, normalizar_(anteriorRaw), normalizar_(p.statusClickUp), p.atualizadoEm].join('|')).slice(0, 24);
  var jaRegistrado = eventoExiste_(eventoId);

  linha.statusClickUp = p.statusClickUp;
  linha.atualizadoClickUp = p.atualizadoEm;
  linha.atualizadoEm = agora_();
  if (novoKey && novoKey !== anteriorKey) {
    linha.statusFluxo = novoKey;
    linha.statusDesde = ctx.dataHora || agora_();
  }
  atualizar_(ABAS.PROCESSOS, linha);

  if (jaRegistrado) return { eventoId: eventoId, notificado: false, duplicado: true };

  var deveNotificar = !!novoKey && novoKey !== anteriorKey;
  registrarEvento_({
    id: eventoId,
    dataHora: ctx.dataHora || agora_(),
    taskId: p.taskId,
    codigo: linha.codigo,
    tipo: 'STATUS_ALTERADO',
    statusAnterior: anteriorKey || anteriorRaw,
    statusNovo: novoKey || p.statusClickUp,
    origem: ctx.origem,
    usuario: ctx.usuario || '',
    resultadoSync: ctx.origem === 'PLATAFORMA' ? 'CONFIRMADO_CLICKUP' : 'DETECTADO',
    notificacao: deveNotificar ? 'PREPARANDO' : 'NAO_APLICAVEL',
    detalhe: 'ClickUp: "' + anteriorRaw + '" → "' + p.statusClickUp + '"' +
      (deveNotificar ? '' : (novoKey ? ' (mesma etapa do fluxo)' : ' (status fora do fluxo do cliente)'))
  });

  var notificado = false;
  if (deveNotificar) {
    var n = notificar_({ eventoId: eventoId, proc: p, linha: linha, anteriorKey: anteriorKey, novoKey: novoKey, usuario: ctx.usuario || 'sistema' });
    notificado = !!(n && n.situacao === SITUACAO_NOTIF.ENVIADO);
  }
  return { eventoId: eventoId, notificado: notificado, duplicado: false };
}

/** Grava o código público no campo do ClickUp, se o campo existir (melhor esforço). */
function gravarCodigoNoClickUp_(p, codigo) {
  var campo = p.campos && p.campos.codigo;
  if (!campo || !campo.id || campo.valor === codigo) return;
  try {
    cuGravarCampo_(p.taskId, campo.id, codigo);
  } catch (e) {
    console.warn('Não foi possível gravar o código no ClickUp para a tarefa ' + p.taskId + ': ' + e.message);
  }
}

/** Registra falha de sincronização sem inundar o histórico com o mesmo erro. */
function registrarFalhaSync_(e) {
  var msg = limparTexto_(e && e.message ? e.message : String(e), 300);
  if (prop_('ULTIMO_ERRO_SYNC', '') !== msg) {
    registrarEvento_({ tipo: 'ERRO_SINCRONIZACAO', origem: 'SISTEMA', resultadoSync: 'FALHA', detalhe: msg });
  }
  setProp_('ULTIMO_ERRO_SYNC', msg);
  setProp_('ULTIMO_ERRO_SYNC_EM', agora_());
}

/* ---------- Gatilhos (funções públicas protegidas) ---------- */

/** Gatilho de tempo: sincronização incremental. */
function gatilhoSincronizar(e) {
  exigirContextoInterno_(e);
  try {
    var r = sincronizar_({ origem: 'GATILHO' });
    console.log('Sincronização: ' + JSON.stringify(r));
  } catch (err) {
    console.error('Falha na sincronização: ' + err.message);
  }
}

/** Gatilho diário: reconciliação completa + retenção de dados. */
function gatilhoManutencaoDiaria(e) {
  exigirContextoInterno_(e);
  try {
    console.log('Reconciliação: ' + JSON.stringify(sincronizar_({ completa: true, origem: 'GATILHO', esperaMs: 60000 })));
  } catch (err) {
    console.error('Falha na reconciliação: ' + err.message);
  }
  try {
    console.log('Retenção: ' + comLock_(aplicarRetencao_, 60000) + ' registros removidos.');
  } catch (err2) {
    console.error('Falha na retenção: ' + err2.message);
  }
}
