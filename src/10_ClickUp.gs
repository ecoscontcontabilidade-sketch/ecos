/**
 * 10_ClickUp.gs — Cliente da API v2 do ClickUp (somente servidor).
 *
 * Endpoints utilizados (API pública v2, autenticação por token pessoal "pk_..."):
 *   GET  /team                              — workspaces
 *   GET  /team/{team_id}/space              — spaces
 *   GET  /space/{space_id}/folder           — folders
 *   GET  /space/{space_id}/list             — listas sem pasta
 *   GET  /folder/{folder_id}/list           — listas de uma pasta
 *   GET  /list/{list_id}                    — dados da lista e status configurados
 *   GET  /list/{list_id}/field              — campos personalizados acessíveis
 *   GET  /list/{list_id}/task               — tarefas (paginado, 100 por página)
 *   GET  /task/{task_id}                    — uma tarefa
 *   PUT  /task/{task_id}                    — alterar status
 *   POST /task/{task_id}/field/{field_id}   — gravar valor de campo personalizado
 *   POST /task/{task_id}/tag/{tag_name}     — adicionar etiqueta
 *
 * Limites: o ClickUp aplica limite de requisições por token (100/min nos planos
 * Free/Unlimited/Business). Em HTTP 429 o cliente aguarda o reset informado em
 * X-RateLimit-Reset e tenta novamente.
 */

var MAX_TENTATIVAS_CLICKUP = 3;

function tokenClickUp_() {
  var t = prop_('CLICKUP_TOKEN', '');
  if (!t) throw new ErroApp('Integração com o ClickUp não configurada (CLICKUP_TOKEN ausente).', 'CONFIG');
  return t;
}

function montarQuery_(params) {
  if (!params) return '';
  var partes = [];
  Object.keys(params).forEach(function (k) {
    var v = params[k];
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      v.forEach(function (item) { partes.push(encodeURIComponent(k + '[]') + '=' + encodeURIComponent(item)); });
    } else {
      partes.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  });
  return partes.length ? '?' + partes.join('&') : '';
}

/** Requisição genérica com retentativas para 429/5xx. */
function cuFetch_(metodo, caminho, opcoes) {
  opcoes = opcoes || {};
  var url = APP.CLICKUP_API + caminho + montarQuery_(opcoes.query);
  var req = {
    method: metodo,
    headers: { Authorization: tokenClickUp_() },
    muteHttpExceptions: true,
    followRedirects: true
  };
  if (opcoes.body !== undefined) {
    req.contentType = 'application/json';
    req.payload = JSON.stringify(opcoes.body);
  }

  var resp, status, texto;
  for (var tentativa = 1; tentativa <= MAX_TENTATIVAS_CLICKUP; tentativa++) {
    try {
      resp = UrlFetchApp.fetch(url, req);
    } catch (e) {
      if (tentativa === MAX_TENTATIVAS_CLICKUP) throw new ErroIntegracao('Falha de rede ao acessar o ClickUp.', 0);
      Utilities.sleep(1000 * tentativa);
      continue;
    }
    status = resp.getResponseCode();
    if (status === 429 && tentativa < MAX_TENTATIVAS_CLICKUP) {
      var h = resp.getAllHeaders() || {};
      var reset = parseInt(h['X-RateLimit-Reset'] || h['x-ratelimit-reset'] || '0', 10);
      var espera = reset ? reset * 1000 - Date.now() : 5000;
      Utilities.sleep(Math.min(Math.max(espera, 1000), 20000));
      continue;
    }
    if (status >= 500 && tentativa < MAX_TENTATIVAS_CLICKUP) {
      Utilities.sleep(1500 * tentativa);
      continue;
    }
    break;
  }

  texto = resp.getContentText() || '';
  if (status >= 200 && status < 300) {
    return texto ? JSON.parse(texto) : {};
  }
  var detalhe = '';
  try {
    var j = JSON.parse(texto);
    detalhe = j.err || j.error || '';
    if (j.ECODE) detalhe += ' (' + j.ECODE + ')';
  } catch (e) { detalhe = ''; }
  var msg = 'ClickUp respondeu HTTP ' + status + (detalhe ? ': ' + limparTexto_(detalhe, 200) : '');
  if (status === 401) msg = 'ClickUp recusou a autenticação (HTTP 401). Verifique o CLICKUP_TOKEN.';
  if (status === 404) msg = 'Recurso não encontrado no ClickUp (HTTP 404).' + (detalhe ? ' ' + limparTexto_(detalhe, 200) : '');
  throw new ErroIntegracao(msg, status);
}

/* ---------- Descoberta de hierarquia ---------- */

function cuEquipes_() { return (cuFetch_('get', '/team').teams) || []; }
function cuSpaces_(teamId) { return (cuFetch_('get', '/team/' + teamId + '/space', { query: { archived: 'false' } }).spaces) || []; }
function cuFolders_(spaceId) { return (cuFetch_('get', '/space/' + spaceId + '/folder', { query: { archived: 'false' } }).folders) || []; }
function cuListasSemPasta_(spaceId) { return (cuFetch_('get', '/space/' + spaceId + '/list', { query: { archived: 'false' } }).lists) || []; }
function cuListasDaPasta_(folderId) { return (cuFetch_('get', '/folder/' + folderId + '/list', { query: { archived: 'false' } }).lists) || []; }

/* ---------- Lista ---------- */

function cuLista_(listId) {
  return cuFetch_('get', '/list/' + encodeURIComponent(listId));
}

/** Status da lista, com cache de 10 minutos. */
function cuStatusDaLista_(listId) {
  var cache = CacheService.getScriptCache();
  var k = 'cu:statuses:' + listId;
  var c = cache.get(k);
  if (c) return JSON.parse(c);
  var lista = cuLista_(listId);
  var statuses = (lista.statuses || []).map(function (s) {
    return { nome: s.status, tipo: s.type, cor: s.color, ordem: s.orderindex };
  });
  cache.put(k, JSON.stringify(statuses), 600);
  return statuses;
}

function cuCamposDaLista_(listId) {
  return (cuFetch_('get', '/list/' + encodeURIComponent(listId) + '/field').fields) || [];
}

/**
 * Todas as tarefas da lista (inclui fechadas e subtarefas), paginando até o fim.
 * filtros: { atualizadasDepoisDe: ms, tags: [..] }
 */
function cuTarefasDaLista_(listId, filtros) {
  filtros = filtros || {};
  var todas = [];
  for (var pagina = 0; pagina < 100; pagina++) {
    var r = cuFetch_('get', '/list/' + encodeURIComponent(listId) + '/task', {
      query: {
        archived: 'false',
        include_closed: 'true',
        subtasks: 'true',
        page: pagina,
        order_by: 'updated',
        reverse: 'true',
        date_updated_gt: filtros.atualizadasDepoisDe || '',
        tags: filtros.tags || ''
      }
    });
    var tarefas = r.tasks || [];
    todas = todas.concat(tarefas);
    if (r.last_page === true || tarefas.length < 100) break;
  }
  return todas;
}

function cuTarefa_(taskId) {
  return cuFetch_('get', '/task/' + encodeURIComponent(taskId));
}

function cuAlterarStatus_(taskId, nomeStatus) {
  return cuFetch_('put', '/task/' + encodeURIComponent(taskId), { body: { status: nomeStatus } });
}

function cuGravarCampo_(taskId, fieldId, valor) {
  return cuFetch_('post', '/task/' + encodeURIComponent(taskId) + '/field/' + encodeURIComponent(fieldId), { body: { value: valor } });
}

function cuAdicionarTag_(taskId, tag) {
  return cuFetch_('post', '/task/' + encodeURIComponent(taskId) + '/tag/' + encodeURIComponent(tag));
}

/** Resolve o nome exato do status na lista do ClickUp a partir da chave do fluxo. */
function nomeStatusNoClickUp_(listId, key) {
  var alvo = statusPorChave_(key);
  if (!alvo) throw new ErroApp('Status inválido.', 'VALIDACAO');
  var statuses = cuStatusDaLista_(listId);
  for (var i = 0; i < statuses.length; i++) {
    if (normalizar_(statuses[i].nome) === normalizar_(alvo.nome)) return statuses[i].nome;
  }
  throw new ErroApp('O status "' + alvo.nome + '" não existe na lista do ClickUp. Configure-o na lista "Processos" antes de usá-lo.', 'CONFIG');
}
