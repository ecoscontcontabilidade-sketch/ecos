/**
 * 70_Api.gs — Entrada do Web App e funções chamadas pelo navegador.
 *
 * ATENÇÃO: toda função global sem "_" pode ser chamada por qualquer visitante via
 * google.script.run. Por isso:
 *  - funções do portal (portal*) só retornam a visão pública mínima;
 *  - funções do painel (admin*) exigem token de sessão validado no servidor;
 *  - IDs vindos do navegador são sempre conferidos contra a base e o ClickUp.
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var pagina = p.p === 'admin' ? 'Admin' : 'Portal';
  var t = HtmlService.createTemplateFromFile(pagina);
  t.codigoInicial = String(p.c || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 24);
  t.nomeExibicao = prop_('NOME_EXIBICAO');
  return t.evaluate()
    .setTitle(pagina === 'Admin' ? 'Painel — ' + APP.NOME : 'Acompanhe seu processo — ' + prop_('NOME_EXIBICAO'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Inclui um arquivo HTML parcial (usado nos templates). */
function include_(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

/** Converte exceções em mensagens seguras para o navegador. */
function executarApi_(nome, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroApp) throw new Error(e.message);
    if (e instanceof ErroIntegracao) {
      console.error(nome + ' — integração: ' + e.message);
      throw new Error('Não foi possível comunicar com o ClickUp agora (' + e.message + '). Nenhuma alteração foi confirmada.');
    }
    console.error(nome + ' — erro inesperado: ' + (e && e.stack ? e.stack : e));
    throw new Error('Não foi possível concluir a operação. Tente novamente em instantes.');
  }
}

/* =================== Portal público =================== */

function portalConfig() {
  return executarApi_('portalConfig', function () {
    return {
      nomeExibicao: prop_('NOME_EXIBICAO'),
      assinatura: prop_('ASSINATURA'),
      logo: logoDataUri_(),
      whatsapp: linkWhatsApp_('Olá! Gostaria de falar sobre o meu processo.'),
      contatoEmail: prop_('CONTATO_EMAIL'),
      contatoTelefone: prop_('CONTATO_TELEFONE'),
      etapas: STATUS_FLUXO.map(function (s) { return s.nome; })
    };
  });
}

/** Consulta pública por código. Mensagem de erro idêntica para formato inválido e inexistente. */
function portalConsultar(codigoBruto, chaveCliente) {
  return executarApi_('portalConsultar', function () {
    var k = verificarLimiteConsulta_(chaveCliente);
    var naoEncontrado = new ErroApp('Não encontramos um processo com este código. Confira o código recebido por e-mail e tente novamente.', 'NAO_ENCONTRADO');
    var codigo = normalizarCodigo_(codigoBruto);
    if (!codigo) { registrarFalhaConsulta_(k); throw naoEncontrado; }
    var linha = processoPorCodigo_(codigo);
    if (!linha || !linha.ativo) { registrarFalhaConsulta_(k); throw naoEncontrado; }

    var proc = null;
    var emCache = false;
    try {
      proc = mapearTarefa_(cuTarefa_(linha.taskId), contextoMapeamento_());
      if (proc.listId !== String(prop_('CLICKUP_LIST_ID')) || !proc.elegivel) {
        registrarFalhaConsulta_(k);
        throw naoEncontrado;
      }
    } catch (e) {
      if (e instanceof ErroApp) throw e;
      // ClickUp indisponível: mostra o último estado confirmado, sinalizando.
      console.warn('portalConsultar: usando dados locais. ' + e.message);
      proc = null;
      emCache = true;
    }
    return montarVisaoPublica_(proc, linha, eventosDaTarefa_(linha.taskId), mensagens_(), { dadosEmCache: emCache });
  });
}

/* =================== Autenticação do painel =================== */

function adminSolicitarCodigo(email) {
  return executarApi_('adminSolicitarCodigo', function () { return solicitarCodigo_(email); });
}

function adminValidarCodigo(email, codigo) {
  return executarApi_('adminValidarCodigo', function () { return validarCodigo_(email, codigo); });
}

function adminSair(token) {
  return executarApi_('adminSair', function () { encerrarSessao_(token); return { ok: true }; });
}

/* =================== Painel administrativo =================== */

/** Visão interna de um processo (lista do painel). */
function visaoInterna_(p, linha, ultimaNotif, diasSemAtualizacao) {
  var st = statusPorChave_(p.statusKey);
  var parado = p.atualizadoEm && (agora_() - p.atualizadoEm) > diasSemAtualizacao * 86400000;
  return {
    taskId: p.taskId,
    codigo: linha ? linha.codigo : '',
    acompanhamento: !!(linha && linha.ativo && p.elegivel),
    empresa: p.empresa,
    processo: p.tipo,
    nome: p.nomeLegivel,
    cnpj: p.cnpj,
    statusClickUp: p.statusClickUp,
    statusKey: p.statusKey || '',
    status: st ? st.nome : p.statusClickUp,
    grupo: st ? st.grupo : (p.statusTipo === 'closed' ? 'fechado' : 'fora'),
    responsaveis: p.responsaveis,
    criadoEm: p.criadoEm,
    atualizadoEm: p.atualizadoEm,
    atualizadoTexto: fmtDataHora_(p.atualizadoEm),
    prazoTexto: fmtData_(p.prazo),
    semAtualizacao: !!parado && p.statusKey !== 'DEFERIDO' && p.statusTipo !== 'closed',
    temEmail: emailValido_(p.email),
    emailMascarado: mascararEmail_(p.email),
    pendencia: p.statusKey === 'EXIGENCIA' || !emailValido_(p.email),
    notificacao: ultimaNotif ? { situacao: ultimaNotif.situacao, data: fmtDataHora_(Number(ultimaNotif.ultimaTentativa) || Number(ultimaNotif.criadoEm)) } : null,
    url: p.url
  };
}

/** Dashboard: sincroniza (incremental) e devolve processos + indicadores. */
function adminResumo(token) {
  return executarApi_('adminResumo', function () {
    var usuario = exigirAdmin_(token);
    var aviso = '';
    try {
      sincronizar_({ origem: 'PAINEL', esperaMs: 5000 });
    } catch (e) {
      aviso = 'Sincronização falhou: ' + (e.message || e) + '. Exibindo dados do ClickUp sem processar mudanças.';
    }
    var listId = prop_('CLICKUP_LIST_ID');
    var tarefas = cuTarefasDaLista_(listId, {});
    var ctx = contextoMapeamento_();
    var idx = indiceProcessos_();
    var ultimas = {};
    lerTodos_(ABAS.NOTIFICACOES).forEach(function (n) {
      var u = ultimas[n.taskId];
      if (!u || Number(n.criadoEm) > Number(u.criadoEm)) ultimas[String(n.taskId)] = n;
    });
    var dias = propInt_('DIAS_SEM_ATUALIZACAO', 15);
    var processos = [];
    var outras = [];
    tarefas.forEach(function (task) {
      var p = mapearTarefa_(task, ctx);
      if (p.listId && p.listId !== String(listId)) return;
      if (p.elegivel) processos.push(visaoInterna_(p, idx[p.taskId], ultimas[p.taskId], dias));
      else if (p.statusTipo !== 'closed') outras.push({ taskId: p.taskId, nome: p.nomeLegivel, status: p.statusClickUp, atualizadoTexto: fmtDataHora_(p.atualizadoEm) });
    });

    var kpi = { ativos: 0, aguardando: 0, andamento: 0, exigencia: 0, deferidos: 0, semAtualizacao: 0, semEmail: 0, falhasNotificacao: 0, foraDoFluxo: 0 };
    var porResp = {};
    processos.forEach(function (x) {
      var encerrado = x.grupo === 'deferido' || x.grupo === 'fechado';
      if (!encerrado) kpi.ativos++;
      if (x.grupo === 'aguardando') kpi.aguardando++;
      if (x.grupo === 'andamento') kpi.andamento++;
      if (x.grupo === 'exigencia') kpi.exigencia++;
      if (x.grupo === 'deferido') kpi.deferidos++;
      if (x.grupo === 'fora') kpi.foraDoFluxo++;
      if (x.semAtualizacao) kpi.semAtualizacao++;
      if (!x.temEmail && !encerrado) kpi.semEmail++;
      if (x.notificacao && x.notificacao.situacao === SITUACAO_NOTIF.FALHOU) kpi.falhasNotificacao++;
      if (!encerrado) (x.responsaveis.length ? x.responsaveis : ['Sem responsável']).forEach(function (r) { porResp[r] = (porResp[r] || 0) + 1; });
    });

    return {
      usuario: usuario,
      processos: processos,
      semAcompanhamento: outras.slice(0, 200),
      kpi: kpi,
      porResponsavel: Object.keys(porResp).sort().map(function (r) { return { nome: r, total: porResp[r] }; }),
      etapas: STATUS_FLUXO.map(function (s) { return { key: s.key, nome: s.nome, grupo: s.grupo }; }),
      ultimaSincronizacao: fmtDataHora_(propInt_('ULTIMA_SINCRONIZACAO', 0)),
      ultimoErroSync: prop_('ULTIMO_ERRO_SYNC', ''),
      diasSemAtualizacao: dias,
      tag: prop_('TAG_ACOMPANHAMENTO'),
      aviso: aviso,
      geradoEm: fmtDataHora_(agora_())
    };
  });
}

/** Carrega e valida uma tarefa da lista configurada (nunca confia no ID do navegador). */
function tarefaAutorizada_(taskId) {
  var id = String(taskId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) throw new ErroApp('Processo inválido.', 'VALIDACAO');
  var task;
  try {
    task = cuTarefa_(id);
  } catch (e) {
    if (e instanceof ErroIntegracao && (e.status === 404 || e.status === 401 || e.status === 403)) {
      throw new ErroApp('Processo não encontrado no ClickUp.', 'NAO_ENCONTRADO');
    }
    throw e;
  }
  var p = mapearTarefa_(task, contextoMapeamento_());
  if (p.listId !== String(prop_('CLICKUP_LIST_ID'))) throw new ErroApp('Esta tarefa não pertence à lista de processos.', 'NAO_AUTORIZADO');
  return p;
}

function detalheProcesso_(p) {
  var linha = processoPorTask_(p.taskId);
  var dias = propInt_('DIAS_SEM_ATUALIZACAO', 15);
  var notifs = notificacoesDaTarefa_(p.taskId);
  var eventos = eventosDaTarefa_(p.taskId);
  var base = visaoInterna_(p, linha, notifs[0], dias);
  base.descricao = p.descricao;
  base.orientacao = p.orientacao;
  base.temCampoOrientacao = !!(p.campos.orientacao && p.campos.orientacao.id);
  base.nomeCliente = p.nomeCliente;
  base.prazo = p.prazo;
  base.criadoTexto = fmtDataHora_(p.criadoEm);
  base.linkPublico = linha && linha.ativo ? linkAcompanhamento_(linha.codigo) : '';
  base.etapas = montarLinhaDoTempo_(p.statusKey || (linha ? linha.statusFluxo : ''), historicoDeEtapas_(eventos));
  base.camposAusentes = Object.keys(p.campos).filter(function (k) { return !p.campos[k]; }).map(function (k) { return nomesCampos_()[k]; });
  base.eventos = eventos.slice().reverse().map(function (e) {
    var a = statusPorChave_(String(e.statusAnterior)), n = statusPorChave_(String(e.statusNovo));
    return {
      dataHora: fmtDataHora_(Number(e.dataHora)), tipo: e.tipo,
      de: a ? a.nome : String(e.statusAnterior || ''), para: n ? n.nome : String(e.statusNovo || ''),
      origem: e.origem, usuario: e.usuario, sync: e.resultadoSync, notificacao: e.notificacao, detalhe: e.detalhe
    };
  });
  base.notificacoes = notifs.map(function (n) {
    var s = statusPorChave_(String(n.statusNovo));
    var travada = n.situacao === SITUACAO_NOTIF.ENVIANDO && (agora_() - Number(n.ultimaTentativa || n.criadoEm)) > 10 * 60000;
    return {
      id: n.id, criadoEm: fmtDataHora_(Number(n.criadoEm)), ultimaTentativa: fmtDataHora_(Number(n.ultimaTentativa)),
      destinatario: n.destinatario, status: s ? s.nome : String(n.statusNovo), situacao: travada ? 'VERIFICAR' : n.situacao,
      tentativas: n.tentativas, erro: n.erro, usuario: n.usuario,
      podeReenviar: (s && s.key === p.statusKey) || (s && !p.statusKey && linha && linha.statusFluxo === s.key)
    };
  });
  return base;
}

function adminDetalhe(token, taskId) {
  return executarApi_('adminDetalhe', function () {
    exigirAdmin_(token);
    return detalheProcesso_(tarefaAutorizada_(taskId));
  });
}

/**
 * Alteração de status pela plataforma (Cenário B).
 * statusEsperado: status do ClickUp exibido na tela — evita sobrescrever uma
 * alteração feita por outra pessoa nesse intervalo.
 */
function adminAlterarStatus(token, taskId, novoKey, statusEsperado) {
  return executarApi_('adminAlterarStatus', function () {
    var usuario = exigirAdmin_(token);
    var st = statusPorChave_(String(novoKey));
    if (!st) throw new ErroApp('Status inválido.', 'VALIDACAO');

    return comLock_(function () {
      var p = tarefaAutorizada_(taskId);
      if (!p.elegivel) throw new ErroApp('Ative o acompanhamento deste processo antes de alterar o status pela Central.', 'VALIDACAO');
      if (statusEsperado !== undefined && statusEsperado !== null && normalizar_(statusEsperado) !== normalizar_(p.statusClickUp)) {
        throw new ErroApp('O status deste processo foi alterado no ClickUp ("' + p.statusClickUp + '"). Atualize a tela antes de continuar.', 'CONFLITO');
      }
      if (p.statusKey === st.key) throw new ErroApp('O processo já está em "' + st.nome + '".', 'VALIDACAO');

      var idx = indiceProcessos_();
      var linha = idx[p.taskId];
      if (!linha) {
        // Garante o registro (e o status anterior) antes de alterar.
        processarTarefa_(p, null, idx, { origem: 'PLATAFORMA', usuario: usuario, primeira: false });
        linha = idx[p.taskId];
      } else if (normalizar_(linha.statusClickUp) !== normalizar_(p.statusClickUp)) {
        // Mudança feita no ClickUp ainda não sincronizada: registra antes.
        registrarMudancaStatus_(p, linha, { origem: 'CLICKUP', usuario: '' });
      }

      var nomeClickUp = nomeStatusNoClickUp_(p.listId, st.key);
      var resposta;
      try {
        cuAlterarStatus_(p.taskId, nomeClickUp);
        // Relê a tarefa: a confirmação vem do estado gravado no ClickUp (com campos personalizados).
        resposta = cuTarefa_(p.taskId);
      } catch (e) {
        registrarEvento_({ taskId: p.taskId, codigo: linha.codigo, tipo: 'ERRO_ALTERACAO_STATUS', statusAnterior: linha.statusFluxo,
          statusNovo: st.key, origem: 'PLATAFORMA', usuario: usuario, resultadoSync: 'FALHA', detalhe: e.message });
        throw e;
      }
      var confirmado = mapearTarefa_(resposta, contextoMapeamento_());
      if (confirmado.statusKey !== st.key) {
        registrarEvento_({ taskId: p.taskId, codigo: linha.codigo, tipo: 'ERRO_ALTERACAO_STATUS', statusAnterior: linha.statusFluxo,
          statusNovo: st.key, origem: 'PLATAFORMA', usuario: usuario, resultadoSync: 'NAO_CONFIRMADO',
          detalhe: 'ClickUp retornou o status "' + confirmado.statusClickUp + '".' });
        throw new ErroApp('O ClickUp não confirmou a alteração (status retornado: "' + confirmado.statusClickUp + '").', 'INTEGRACAO');
      }
      var res = registrarMudancaStatus_(confirmado, linha, { origem: 'PLATAFORMA', usuario: usuario });
      var detalhe = detalheProcesso_(confirmado);
      detalhe.resultado = { notificado: res.notificado, eventoId: res.eventoId };
      return detalhe;
    });
  });
}

/** Grava a orientação ao cliente (campo do ClickUp) — exibida apenas em "Exigência". */
function adminSalvarOrientacao(token, taskId, texto) {
  return executarApi_('adminSalvarOrientacao', function () {
    var usuario = exigirAdmin_(token);
    var p = tarefaAutorizada_(taskId);
    var campo = p.campos.orientacao;
    if (!campo || !campo.id) throw new ErroApp('Crie o campo "' + nomesCampos_().orientacao + '" na lista do ClickUp para usar este recurso.', 'CONFIG');
    var valor = limparTexto_(texto, 2000);
    cuGravarCampo_(p.taskId, campo.id, valor);
    var linha = processoPorTask_(p.taskId);
    registrarEvento_({ taskId: p.taskId, codigo: linha ? linha.codigo : '', tipo: 'ORIENTACAO_ATUALIZADA', origem: 'PLATAFORMA',
      usuario: usuario, resultadoSync: 'CONFIRMADO_CLICKUP', detalhe: valor ? 'Orientação ao cliente atualizada.' : 'Orientação ao cliente removida.' });
    return detalheProcesso_(tarefaAutorizada_(taskId));
  });
}

function adminReenviarNotificacao(token, taskId, notifId, forcar) {
  return executarApi_('adminReenviarNotificacao', function () {
    var usuario = exigirAdmin_(token);
    var p = tarefaAutorizada_(taskId);
    return comLock_(function () {
      var n = notificacaoPorId_(notifId);
      if (!n || String(n.taskId) !== p.taskId) throw new ErroApp('Notificação não encontrada para este processo.', 'NAO_ENCONTRADO');
      var r = reenviarNotificacao_(notifId, usuario, !!forcar);
      var d = detalheProcesso_(tarefaAutorizada_(taskId));
      d.resultado = { situacao: r.situacao, erro: r.erro };
      return d;
    });
  });
}

/** Revoga o código público atual e gera outro (ex.: código compartilhado indevidamente). */
function adminGerarNovoCodigo(token, taskId) {
  return executarApi_('adminGerarNovoCodigo', function () {
    var usuario = exigirAdmin_(token);
    var p = tarefaAutorizada_(taskId);
    return comLock_(function () {
      var idx = indiceProcessos_();
      var linha = idx[p.taskId];
      if (!linha) throw new ErroApp('Processo ainda não está em acompanhamento.', 'VALIDACAO');
      var antigo = linha.codigo;
      linha.codigo = novoCodigoUnico_(idx);
      linha.atualizadoEm = agora_();
      atualizar_(ABAS.PROCESSOS, linha);
      CacheService.getScriptCache().remove('cod:' + hashComSal_(antigo));
      gravarCodigoNoClickUp_(p, linha.codigo);
      registrarEvento_({ taskId: p.taskId, codigo: linha.codigo, tipo: 'CODIGO_REGERADO', origem: 'PLATAFORMA', usuario: usuario,
        detalhe: 'Código anterior revogado.' });
      return detalheProcesso_(p);
    });
  });
}

/** Ativa o acompanhamento (adiciona a etiqueta no ClickUp e cadastra o processo). */
function adminAtivarAcompanhamento(token, taskId) {
  return executarApi_('adminAtivarAcompanhamento', function () {
    var usuario = exigirAdmin_(token);
    var p = tarefaAutorizada_(taskId);
    var tag = prop_('TAG_ACOMPANHAMENTO');
    if (!p.elegivel) cuAdicionarTag_(p.taskId, tag);
    return comLock_(function () {
      var p2 = tarefaAutorizada_(taskId);
      if (!p2.elegivel) throw new ErroApp('O ClickUp não confirmou a etiqueta "' + tag + '". Verifique se ela existe no Space.', 'INTEGRACAO');
      var idx = indiceProcessos_();
      processarTarefa_(p2, idx[p2.taskId], idx, { origem: 'PLATAFORMA', usuario: usuario, primeira: false });
      return detalheProcesso_(p2);
    });
  });
}

function adminSincronizar(token, completa) {
  return executarApi_('adminSincronizar', function () {
    var usuario = exigirAdmin_(token);
    var r = sincronizar_({ completa: !!completa, origem: 'PAINEL', esperaMs: 30000 });
    if (r.ignorado) throw new ErroApp('Outra sincronização está em andamento. Tente novamente em instantes.', 'OCUPADO');
    registrarEvento_({ tipo: 'SINCRONIZACAO_MANUAL', origem: 'PLATAFORMA', usuario: usuario, resultadoSync: 'OK', detalhe: JSON.stringify(r) });
    return r;
  });
}

function adminObterMensagens(token) {
  return executarApi_('adminObterMensagens', function () {
    exigirAdmin_(token);
    var m = mensagens_();
    return STATUS_FLUXO.map(function (s) { return m[s.key]; });
  });
}

function adminSalvarMensagens(token, lista) {
  return executarApi_('adminSalvarMensagens', function () {
    var usuario = exigirAdmin_(token);
    if (!Array.isArray(lista)) throw new ErroApp('Dados inválidos.', 'VALIDACAO');
    comLock_(function () { salvarMensagens_(lista, usuario); });
    registrarEvento_({ tipo: 'MENSAGENS_ATUALIZADAS', origem: 'PLATAFORMA', usuario: usuario });
    var m = mensagens_();
    return STATUS_FLUXO.map(function (s) { return m[s.key]; });
  });
}

/** Diagnóstico da configuração (nunca retorna segredos). */
function adminDiagnostico(token) {
  return executarApi_('adminDiagnostico', function () {
    exigirAdmin_(token);
    return diagnostico_();
  });
}

function diagnostico_() {
  var d = {
    versao: APP.VERSAO,
    tokenConfigurado: !!prop_('CLICKUP_TOKEN', ''),
    workspaceId: prop_('CLICKUP_TEAM_ID', ''),
    spaceId: prop_('CLICKUP_SPACE_ID', ''),
    folderId: prop_('CLICKUP_FOLDER_ID', ''),
    listId: prop_('CLICKUP_LIST_ID', ''),
    tag: prop_('TAG_ACOMPANHAMENTO'),
    appUrl: urlApp_(),
    nomeExibicao: prop_('NOME_EXIBICAO'),
    whatsapp: prop_('WHATSAPP'),
    contatoEmail: prop_('CONTATO_EMAIL'),
    syncMinutos: propInt_('SYNC_MINUTOS', 5),
    diasSemAtualizacao: propInt_('DIAS_SEM_ATUALIZACAO', 15),
    retencaoDias: propInt_('RETENCAO_DIAS', 730),
    notificacoesAtivas: propBool_('NOTIFICACOES_ATIVAS'),
    administradores: adminsAutorizados_().length,
    cotaEmailRestante: MailApp.getRemainingDailyQuota(),
    gatilhos: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }),
    ultimaSincronizacao: fmtDataHora_(propInt_('ULTIMA_SINCRONIZACAO', 0)),
    ultimaReconciliacao: fmtDataHora_(propInt_('ULTIMA_RECONCILIACAO', 0)),
    ultimoErroSync: prop_('ULTIMO_ERRO_SYNC', ''),
    lista: null, statusFaltando: [], statusExtras: [], camposEncontrados: [], camposFaltando: [], problemas: []
  };
  if (!d.tokenConfigurado) d.problemas.push('CLICKUP_TOKEN não configurado.');
  if (!d.listId) d.problemas.push('CLICKUP_LIST_ID não configurado.');
  if (!d.administradores) d.problemas.push('ADMIN_EMAILS vazio.');
  if (!prop_('APP_URL', '')) d.problemas.push('APP_URL não configurada (links dos e-mails usam a URL detectada automaticamente).');
  if (!prop_('SPREADSHEET_ID', '')) d.problemas.push('Base auxiliar não instalada (execute instalar()).');
  if (d.tokenConfigurado && d.listId) {
    try {
      var lista = cuLista_(d.listId);
      d.lista = { nome: lista.name, space: lista.space ? lista.space.name : '' };
      var nomes = (lista.statuses || []).map(function (s) { return normalizar_(s.status); });
      d.statusFaltando = STATUS_FLUXO.filter(function (s) { return nomes.indexOf(normalizar_(s.nome)) < 0; }).map(function (s) { return s.nome; });
      var aliases = statusAliases_();
      d.statusExtras = (lista.statuses || []).map(function (s) { return s.status; })
        .filter(function (s) { return !mapearStatus_(s, aliases); });
      var campos = cuCamposDaLista_(d.listId).map(function (f) { return normalizar_(f.name); });
      var nc = nomesCampos_();
      Object.keys(nc).forEach(function (k) {
        (campos.indexOf(normalizar_(nc[k])) >= 0 ? d.camposEncontrados : d.camposFaltando).push(nc[k]);
      });
      if (d.statusFaltando.length) d.problemas.push('Status ausentes na lista do ClickUp: ' + d.statusFaltando.join(', ') + '.');
      if (d.camposFaltando.indexOf(nc.email) >= 0) d.problemas.push('Campo "' + nc.email + '" ausente: nenhum e-mail poderá ser enviado.');
    } catch (e) {
      d.problemas.push('Falha ao consultar o ClickUp: ' + e.message);
    }
  }
  return d;
}
