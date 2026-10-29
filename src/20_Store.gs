/**
 * 20_Store.gs — Base auxiliar em Google Planilha (privada do proprietário).
 *
 * O ClickUp é a fonte oficial dos processos. A planilha guarda apenas o que o
 * ClickUp não guarda: código público, último status observado (para detectar
 * mudanças), histórico de eventos, registro de notificações e mensagens.
 * Tudo é indexado pelo ID da tarefa, permitindo reconciliação a qualquer momento.
 */

var ABAS = {
  PROCESSOS: {
    nome: 'Processos',
    colunas: ['taskId', 'codigo', 'ativo', 'statusClickUp', 'statusFluxo', 'statusDesde', 'atualizadoClickUp',
      'empresa', 'processo', 'pendenciaEmail', 'ultimaNotificacao', 'criadoEm', 'atualizadoEm']
  },
  EVENTOS: {
    nome: 'Eventos',
    colunas: ['id', 'dataHora', 'taskId', 'codigo', 'tipo', 'statusAnterior', 'statusNovo', 'origem', 'usuario',
      'resultadoSync', 'notificacao', 'detalhe']
  },
  NOTIFICACOES: {
    nome: 'Notificacoes',
    colunas: ['id', 'eventoId', 'taskId', 'criadoEm', 'destinatario', 'destinatarioHash', 'statusAnterior', 'statusNovo',
      'situacao', 'tentativas', 'ultimaTentativa', 'erro', 'usuario']
  },
  MENSAGENS: {
    nome: 'Mensagens',
    colunas: ['chave', 'status', 'tituloEmail', 'mensagem', 'proximosPassos', 'atualizadoEm', 'atualizadoPor']
  }
};

/** Situações possíveis de uma notificação. "ENVIADO" = aceito pelo serviço de e-mail, não "entregue". */
var SITUACAO_NOTIF = {
  ENVIANDO: 'ENVIANDO',
  ENVIADO: 'ENVIADO',
  FALHOU: 'FALHOU',
  SEM_EMAIL: 'SEM_EMAIL',
  DESATIVADA: 'DESATIVADA'
};

var memoPlanilha_ = null;

function planilha_() {
  if (memoPlanilha_) return memoPlanilha_;
  var id = prop_('SPREADSHEET_ID', '');
  if (!id) throw new ErroApp('Base auxiliar não instalada. Execute instalar() no editor do Apps Script.', 'CONFIG');
  memoPlanilha_ = SpreadsheetApp.openById(id);
  return memoPlanilha_;
}

function aba_(def) {
  var ss = planilha_();
  var sh = ss.getSheetByName(def.nome);
  if (!sh) {
    sh = ss.insertSheet(def.nome);
    sh.getRange(1, 1, 1, def.colunas.length).setValues([def.colunas]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Converte valores de célula para tipos simples serializáveis. */
function valorCelula_(v) {
  if (v instanceof Date) return v.getTime();
  return v;
}

/** Lê toda a aba como objetos. Cada objeto recebe _linha (1-based). */
function lerTodos_(def) {
  var sh = aba_(def);
  var ultima = sh.getLastRow();
  if (ultima < 2) return [];
  var valores = sh.getRange(2, 1, ultima - 1, def.colunas.length).getValues();
  return valores.map(function (linha, i) {
    var o = { _linha: i + 2 };
    def.colunas.forEach(function (c, j) { o[c] = valorCelula_(linha[j]); });
    return o;
  });
}

function paraLinha_(def, obj) {
  return def.colunas.map(function (c) {
    var v = obj[c];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 'SIM' : 'NAO';
    // Evita que textos iniciados com =, +, -, @ sejam interpretados como fórmula.
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
    return v;
  });
}

function inserir_(def, obj) {
  var sh = aba_(def);
  sh.appendRow(paraLinha_(def, obj));
  obj._linha = sh.getLastRow();
  return obj;
}

function atualizar_(def, obj) {
  if (!obj._linha) throw new Error('Registro sem linha.');
  aba_(def).getRange(obj._linha, 1, 1, def.colunas.length).setValues([paraLinha_(def, obj)]);
  return obj;
}

function simNao_(v) {
  return v === true || String(v).toUpperCase() === 'SIM' || String(v).toUpperCase() === 'TRUE';
}

/* ---------- Processos ---------- */

function indiceProcessos_() {
  var idx = {};
  lerTodos_(ABAS.PROCESSOS).forEach(function (p) {
    p.ativo = simNao_(p.ativo);
    p.taskId = String(p.taskId);
    idx[p.taskId] = p;
  });
  return idx;
}

function processoPorTask_(taskId) {
  return indiceProcessos_()[String(taskId)] || null;
}

/** Busca o processo pelo código público (com cache de 10 minutos para o mapeamento). */
function processoPorCodigo_(codigo) {
  var cache = CacheService.getScriptCache();
  var k = 'cod:' + hashComSal_(codigo);
  var taskId = cache.get(k);
  var idx = indiceProcessos_();
  if (taskId && idx[taskId] && idx[taskId].codigo === codigo) return idx[taskId];
  var ids = Object.keys(idx);
  for (var i = 0; i < ids.length; i++) {
    if (idx[ids[i]].codigo === codigo) {
      cache.put(k, ids[i], 600);
      return idx[ids[i]];
    }
  }
  return null;
}

/** Gera um código único (verifica colisão com os existentes). */
function novoCodigoUnico_(idx) {
  var existentes = {};
  Object.keys(idx || {}).forEach(function (k) { existentes[idx[k].codigo] = true; });
  for (var i = 0; i < 10; i++) {
    var c = gerarCodigoPublico_();
    if (!existentes[c]) return c;
  }
  throw new Error('Não foi possível gerar código único.');
}

/* ---------- Eventos ---------- */

function registrarEvento_(ev) {
  var obj = {
    id: ev.id || tokenAleatorio_().slice(0, 20),
    dataHora: ev.dataHora || agora_(),
    taskId: ev.taskId || '',
    codigo: ev.codigo || '',
    tipo: ev.tipo,
    statusAnterior: ev.statusAnterior || '',
    statusNovo: ev.statusNovo || '',
    origem: ev.origem || 'SISTEMA',
    usuario: ev.usuario || '',
    resultadoSync: ev.resultadoSync || '',
    notificacao: ev.notificacao || '',
    detalhe: limparTexto_(ev.detalhe || '', 500)
  };
  return inserir_(ABAS.EVENTOS, obj);
}

function eventosDaTarefa_(taskId) {
  var t = String(taskId);
  return lerTodos_(ABAS.EVENTOS).filter(function (e) { return String(e.taskId) === t; })
    .sort(function (a, b) { return Number(a.dataHora) - Number(b.dataHora); });
}

function eventoExiste_(id) {
  var sh = aba_(ABAS.EVENTOS);
  if (sh.getLastRow() < 2) return false;
  return !!sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
}

/* ---------- Notificações ---------- */

function notificacoesDaTarefa_(taskId) {
  var t = String(taskId);
  return lerTodos_(ABAS.NOTIFICACOES).filter(function (n) { return String(n.taskId) === t; })
    .sort(function (a, b) { return Number(b.criadoEm) - Number(a.criadoEm); });
}

function notificacaoPorId_(id) {
  var todas = lerTodos_(ABAS.NOTIFICACOES);
  for (var i = 0; i < todas.length; i++) if (String(todas[i].id) === String(id)) return todas[i];
  return null;
}

function notificacaoPorEvento_(eventoId) {
  var todas = lerTodos_(ABAS.NOTIFICACOES);
  for (var i = 0; i < todas.length; i++) if (String(todas[i].eventoId) === String(eventoId)) return todas[i];
  return null;
}

/* ---------- Mensagens ---------- */

var MENSAGENS_PADRAO = {
  AGUARDANDO_DOCUMENTACAO: {
    tituloEmail: 'Estamos aguardando seus documentos',
    mensagem: 'Estamos aguardando os documentos necessários para dar continuidade ao seu processo. Caso precise de orientação, entre em contato com nossa equipe.',
    proximosPassos: ''
  },
  VIABILIDADE: {
    tituloEmail: 'Seu processo avançou!',
    mensagem: 'Seu processo está na etapa de viabilidade, na qual são verificadas as condições necessárias para prosseguir com a solicitação.',
    proximosPassos: ''
  },
  DBE: {
    tituloEmail: 'Seu processo avançou!',
    mensagem: 'Seu processo está na etapa relacionada ao Documento Básico de Entrada (DBE).',
    proximosPassos: ''
  },
  VRE_JUCESP: {
    tituloEmail: 'Seu processo avançou!',
    mensagem: 'Seu processo está na etapa de tratamento pelo VRE Digital, relacionado ao registro empresarial.',
    proximosPassos: ''
  },
  EM_ANALISE: {
    tituloEmail: 'Seu processo avançou!',
    mensagem: 'Sua solicitação está em análise pelo órgão responsável. Avisaremos você quando houver uma nova atualização.',
    proximosPassos: ''
  },
  EXIGENCIA: {
    tituloEmail: 'Seu processo precisa de atenção',
    mensagem: 'Foi identificada uma exigência que precisa ser tratada para que o processo possa prosseguir. Consulte as orientações abaixo ou entre em contato com nossa equipe.',
    proximosPassos: ''
  },
  DEFERIDO: {
    tituloEmail: 'Seu processo foi marcado como deferido',
    mensagem: 'Seu processo foi marcado como deferido. Consulte o acompanhamento para verificar as informações finais e as orientações sobre os próximos passos.',
    proximosPassos: 'Nossa equipe entrará em contato para orientar sobre os próximos passos aplicáveis ao seu caso. Se preferir, fale conosco pelo WhatsApp.'
  }
};

/** Mensagens por status (planilha, com fallback para o padrão). Cache de 5 minutos. */
function mensagens_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('mensagens');
  if (c) return JSON.parse(c);
  var saida = {};
  STATUS_FLUXO.forEach(function (s) {
    var p = MENSAGENS_PADRAO[s.key];
    saida[s.key] = { chave: s.key, status: s.nome, tituloEmail: p.tituloEmail, mensagem: p.mensagem, proximosPassos: p.proximosPassos };
  });
  try {
    lerTodos_(ABAS.MENSAGENS).forEach(function (m) {
      if (saida[m.chave]) {
        if (String(m.tituloEmail).trim()) saida[m.chave].tituloEmail = String(m.tituloEmail);
        if (String(m.mensagem).trim()) saida[m.chave].mensagem = String(m.mensagem);
        saida[m.chave].proximosPassos = String(m.proximosPassos || '');
      }
    });
  } catch (e) {
    console.warn('Mensagens: usando padrão. ' + e.message);
  }
  cache.put('mensagens', JSON.stringify(saida), 300);
  return saida;
}

function salvarMensagens_(lista, usuario) {
  var existentes = {};
  lerTodos_(ABAS.MENSAGENS).forEach(function (m) { existentes[m.chave] = m; });
  lista.forEach(function (m) {
    var st = statusPorChave_(String(m.chave));
    if (!st) return;
    var obj = existentes[st.key] || { chave: st.key };
    obj.status = st.nome;
    obj.tituloEmail = limparTexto_(m.tituloEmail, 120);
    obj.mensagem = limparTexto_(m.mensagem, 1500);
    obj.proximosPassos = limparTexto_(m.proximosPassos, 1500);
    obj.atualizadoEm = agora_();
    obj.atualizadoPor = usuario;
    if (!obj.mensagem) throw new ErroApp('A mensagem do status "' + st.nome + '" não pode ficar vazia.', 'VALIDACAO');
    if (obj._linha) atualizar_(ABAS.MENSAGENS, obj); else inserir_(ABAS.MENSAGENS, obj);
  });
  CacheService.getScriptCache().remove('mensagens');
}

/* ---------- Retenção (LGPD) ---------- */

/** Remove eventos e notificações mais antigos que RETENCAO_DIAS. */
function aplicarRetencao_() {
  var dias = propInt_('RETENCAO_DIAS', 730);
  if (dias < 30) dias = 30;
  var limite = agora_() - dias * 86400000;
  var removidos = 0;
  [[ABAS.EVENTOS, 'dataHora'], [ABAS.NOTIFICACOES, 'criadoEm']].forEach(function (par) {
    var def = par[0], col = par[1];
    var linhas = lerTodos_(def).filter(function (r) { return Number(r[col]) && Number(r[col]) < limite; })
      .map(function (r) { return r._linha; }).sort(function (a, b) { return b - a; });
    var sh = aba_(def);
    linhas.forEach(function (l) { sh.deleteRow(l); removidos++; });
  });
  // Processos removidos do ClickUp há mais tempo que a retenção: apaga dados identificáveis.
  lerTodos_(ABAS.PROCESSOS).forEach(function (p) {
    if (!simNao_(p.ativo) && Number(p.atualizadoEm) && Number(p.atualizadoEm) < limite && p.empresa) {
      p.empresa = '';
      p.processo = '';
      atualizar_(ABAS.PROCESSOS, p);
    }
  });
  return removidos;
}
