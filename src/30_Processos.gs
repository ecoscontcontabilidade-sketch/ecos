/**
 * 30_Processos.gs — Regras de negócio: tarefa do ClickUp → processo,
 * linha do tempo, visão pública (mínima) e visão interna.
 */

/** Nomes (configuráveis) dos campos personalizados por papel. */
function nomesCampos_() {
  return {
    email: prop_('CAMPO_EMAIL'),
    nomeCliente: prop_('CAMPO_NOME_CLIENTE'),
    empresa: prop_('CAMPO_EMPRESA'),
    cnpj: prop_('CAMPO_CNPJ'),
    orientacao: prop_('CAMPO_ORIENTACAO'),
    codigo: prop_('CAMPO_CODIGO')
  };
}

/** Valor legível de um campo personalizado do ClickUp. */
function valorCampo_(cf) {
  if (!cf || cf.value === undefined || cf.value === null || cf.value === '') return '';
  var v = cf.value;
  if (cf.type === 'drop_down' && cf.type_config && cf.type_config.options) {
    var opt = cf.type_config.options.filter(function (o) { return String(o.orderindex) === String(v) || o.id === v; })[0];
    return opt ? String(opt.name) : '';
  }
  if (typeof v === 'object') return '';
  return String(v).trim();
}

/** Localiza campos personalizados da tarefa pelo nome configurado. */
function camposDaTarefa_(task, nomes) {
  var porNome = {};
  (task.custom_fields || []).forEach(function (cf) { porNome[normalizar_(cf.name)] = cf; });
  var saida = {};
  Object.keys(nomes).forEach(function (papel) {
    var cf = porNome[normalizar_(nomes[papel])];
    saida[papel] = cf ? { id: cf.id, valor: valorCampo_(cf) } : null;
  });
  return saida;
}

/** "ALTERAÇÃO CONTRATUAL - ATS LOGISTICA" → { tipo, empresa } */
function separarNomeTarefa_(nome) {
  var n = String(nome || '').trim();
  var i = n.indexOf(' - ');
  if (i < 0) return { tipo: n, empresa: '' };
  return { tipo: n.slice(0, i).trim(), empresa: n.slice(i + 3).trim() };
}

/**
 * Converte uma tarefa da API do ClickUp no modelo interno de processo.
 * Função pura (sem chamadas externas) — coberta pelos testes automatizados.
 */
function mapearTarefa_(task, ctx) {
  ctx = ctx || {};
  var nomes = ctx.nomesCampos || {};
  var campos = camposDaTarefa_(task, nomes);
  var partes = separarNomeTarefa_(task.name);
  var tag = normalizar_(ctx.tag || '');
  var tags = (task.tags || []).map(function (t) { return t.name; });
  var statusNome = task.status && task.status.status ? task.status.status : '';
  var v = function (papel) { return campos[papel] ? campos[papel].valor : ''; };

  return {
    taskId: String(task.id),
    listId: task.list ? String(task.list.id) : '',
    nome: String(task.name || ''),
    nomeLegivel: tituloLegivel_(task.name),
    tipo: tituloLegivel_(partes.tipo),
    empresa: v('empresa') || tituloLegivel_(partes.empresa) || tituloLegivel_(task.name),
    cnpj: v('cnpj'),
    email: v('email'),
    nomeCliente: v('nomeCliente'),
    orientacao: v('orientacao'),
    codigoCampo: v('codigo'),
    campos: campos,
    statusClickUp: statusNome,
    statusTipo: task.status ? task.status.type : '',
    statusKey: mapearStatus_(statusNome, ctx.aliases),
    responsaveis: (task.assignees || []).map(function (a) { return a.username || a.email || ''; }).filter(String),
    criadoEm: Number(task.date_created) || 0,
    atualizadoEm: Number(task.date_updated) || 0,
    prazo: Number(task.due_date) || 0,
    descricao: limparTexto_(task.text_content || task.description || '', 4000),
    url: task.url || '',
    tags: tags,
    elegivel: !tag || tags.some(function (t) { return normalizar_(t) === tag; })
  };
}

function contextoMapeamento_() {
  return { nomesCampos: nomesCampos_(), tag: prop_('TAG_ACOMPANHAMENTO'), aliases: statusAliases_() };
}

/**
 * Linha do tempo das 7 etapas.
 *  - etapas anteriores à atual: "concluida" (Exigência só aparece concluída se ocorreu
 *    de fato no histórico; caso contrário "nao_ocorreu");
 *  - etapa atual: "atual" (ou "atencao" em Exigência, "final" em Deferido);
 *  - etapas posteriores: "futura" (sem data, mesmo que tenham ocorrido antes de um retrocesso).
 * historico: [{ statusKey, dataHora }] em ordem cronológica.
 */
function montarLinhaDoTempo_(statusAtualKey, historico) {
  var idxAtual = indiceStatus_(statusAtualKey);
  var ultimaData = {};
  (historico || []).forEach(function (h) {
    if (h.statusKey) ultimaData[h.statusKey] = Math.max(ultimaData[h.statusKey] || 0, Number(h.dataHora) || 0);
  });

  return STATUS_FLUXO.map(function (s, i) {
    var estado;
    if (idxAtual < 0) estado = 'futura';
    else if (i < idxAtual) estado = (s.opcional && !ultimaData[s.key]) ? 'nao_ocorreu' : 'concluida';
    else if (i === idxAtual) estado = s.key === 'EXIGENCIA' ? 'atencao' : (s.final ? 'final' : 'atual');
    else estado = 'futura';

    var data = (estado === 'futura' || estado === 'nao_ocorreu') ? 0 : (ultimaData[s.key] || 0);
    return { key: s.key, nome: s.nome, estado: estado, data: data, dataTexto: data ? fmtDataHora_(data) : '' };
  });
}

/** Histórico de etapas (apenas mudanças para status do fluxo) a partir dos eventos. */
function historicoDeEtapas_(eventos) {
  return (eventos || [])
    .filter(function (e) { return (e.tipo === 'STATUS_ALTERADO' || e.tipo === 'CADASTRO') && statusPorChave_(String(e.statusNovo)); })
    .map(function (e) { return { statusKey: String(e.statusNovo), dataHora: Number(e.dataHora) }; });
}

/** Direção da mudança: "avanco", "retrocesso", "exigencia", "inicio". */
function direcaoMudanca_(anteriorKey, novoKey) {
  if (novoKey === 'EXIGENCIA') return 'exigencia';
  var a = indiceStatus_(anteriorKey), n = indiceStatus_(novoKey);
  if (a < 0) return 'inicio';
  if (anteriorKey === 'EXIGENCIA') return 'avanco';
  return n < a ? 'retrocesso' : 'avanco';
}

/**
 * Visão pública: exposição mínima. Sem CNPJ, e-mail, responsáveis, descrição,
 * comentários, links do ClickUp ou ID interno da tarefa.
 */
function montarVisaoPublica_(proc, linha, eventos, msgs, opcoes) {
  opcoes = opcoes || {};
  var statusKey = (proc && proc.statusKey) || linha.statusFluxo || '';
  var st = statusPorChave_(statusKey);
  var m = st ? msgs[statusKey] : null;
  var atualizado = (proc && proc.atualizadoEm) || Number(linha.atualizadoClickUp) || 0;
  var orientacao = '';
  if (statusKey === 'EXIGENCIA' && proc && proc.orientacao) orientacao = limparTexto_(proc.orientacao, 2000);

  return {
    empresa: (proc && proc.empresa) || linha.empresa || '',
    processo: (proc && proc.tipo) || linha.processo || '',
    codigo: linha.codigo,
    status: st ? st.nome : 'Em preparação',
    statusKey: st ? st.key : '',
    grupo: st ? st.grupo : 'preparacao',
    atualizadoEm: fmtDataHora_(atualizado),
    statusDesde: fmtDataHora_(Number(linha.statusDesde) || 0),
    mensagem: m ? m.mensagem : 'Seu processo foi registrado e está sendo preparado pela nossa equipe. Em breve você poderá acompanhar cada etapa por aqui.',
    orientacao: orientacao,
    proximosPassos: statusKey === 'DEFERIDO' && m ? m.proximosPassos : '',
    etapas: montarLinhaDoTempo_(statusKey, historicoDeEtapas_(eventos)),
    dadosEmCache: !!opcoes.dadosEmCache
  };
}
