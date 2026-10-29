/**
 * 00_Config.gs — Constantes da aplicação e acesso centralizado à configuração.
 *
 * Toda configuração fica nas Propriedades do Script (Configurações do projeto →
 * Propriedades do script). Segredos (token do ClickUp) NUNCA são enviados ao
 * navegador, gravados em planilha ou registrados em log.
 *
 * Convenção de segurança: funções terminadas em "_" são privadas e não podem ser
 * chamadas pelo navegador via google.script.run. Toda função pública (sem "_")
 * valida o chamador antes de executar qualquer coisa.
 */

var APP = {
  NOME: 'Central de Processos',
  VERSAO: '1.0.0',
  TIMEZONE: 'America/Sao_Paulo',
  CLICKUP_API: 'https://api.clickup.com/api/v2'
};

/**
 * Fluxo oficial de status — nomenclatura exata definida pela Ecos.
 * A ordem do array define a ordem da linha do tempo.
 * "Exigência" é uma etapa intermediária: pode ou não ocorrer.
 */
var STATUS_FLUXO = [
  { key: 'AGUARDANDO_DOCUMENTACAO', nome: 'Aguardando Documentação', grupo: 'aguardando' },
  { key: 'VIABILIDADE', nome: 'Viabilidade', grupo: 'andamento' },
  { key: 'DBE', nome: 'DBE', grupo: 'andamento' },
  { key: 'VRE_JUCESP', nome: 'VRE Digital - JUCESP', grupo: 'andamento' },
  { key: 'EM_ANALISE', nome: 'Em análise', grupo: 'andamento' },
  { key: 'EXIGENCIA', nome: 'Exigência', grupo: 'exigencia', opcional: true },
  { key: 'DEFERIDO', nome: 'Deferido', grupo: 'deferido', final: true }
];

/** Valores padrão das propriedades não secretas. */
var CONFIG_PADRAO = {
  NOME_EXIBICAO: 'Ecos Contabilidade',
  ASSINATURA: 'Contabilidade próxima, moderna e descomplicada.',
  TAG_ACOMPANHAMENTO: 'acompanhamento-cliente',
  CAMPO_EMAIL: 'E-mail do cliente',
  CAMPO_NOME_CLIENTE: 'Nome do cliente',
  CAMPO_EMPRESA: 'Empresa',
  CAMPO_CNPJ: 'CNPJ',
  CAMPO_ORIENTACAO: 'Orientação ao cliente',
  CAMPO_CODIGO: 'Código de acompanhamento',
  WHATSAPP: '5511915172014',
  CONTATO_EMAIL: 'contato@ecoscont.com.br',
  CONTATO_TELEFONE: '(11) 91517-2014',
  SYNC_MINUTOS: '5',
  DIAS_SEM_ATUALIZACAO: '15',
  RETENCAO_DIAS: '730',
  NOTIFICACOES_ATIVAS: 'true',
  NOTIFICAR_PRIMEIRA_SINCRONIZACAO: 'false',
  STATUS_ALIASES: '{}'
};

/** Propriedades que jamais podem sair do servidor. */
var PROPRIEDADES_SECRETAS = ['CLICKUP_TOKEN', 'HASH_SALT'];

var memoProps_ = null;

/** Lê uma propriedade do script (com valor padrão). Memoriza por execução. */
function prop_(chave, padrao) {
  if (!memoProps_) memoProps_ = PropertiesService.getScriptProperties().getProperties();
  var v = memoProps_[chave];
  if (v === undefined || v === null || String(v).trim() === '') {
    if (padrao !== undefined) return padrao;
    return CONFIG_PADRAO[chave] !== undefined ? CONFIG_PADRAO[chave] : '';
  }
  return String(v).trim();
}

function propInt_(chave, padrao) {
  var n = parseInt(prop_(chave, padrao !== undefined ? String(padrao) : undefined), 10);
  return isNaN(n) ? (padrao || 0) : n;
}

function propBool_(chave) {
  return String(prop_(chave)).toLowerCase() === 'true';
}

function setProp_(chave, valor) {
  PropertiesService.getScriptProperties().setProperty(chave, String(valor));
  if (memoProps_) memoProps_[chave] = String(valor);
}

/** Lista de e-mails autorizados a acessar o painel administrativo. */
function adminsAutorizados_() {
  return prop_('ADMIN_EMAILS', '')
    .split(/[,;\s]+/)
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return e; });
}

/** Mapa opcional de status adicionais do ClickUp para etapas do fluxo (JSON). */
function statusAliases_() {
  try {
    var bruto = JSON.parse(prop_('STATUS_ALIASES') || '{}');
    var saida = {};
    Object.keys(bruto).forEach(function (k) {
      var alvo = String(bruto[k]).toUpperCase();
      if (statusPorChave_(alvo)) saida[normalizar_(k)] = alvo;
    });
    return saida;
  } catch (e) {
    console.warn('STATUS_ALIASES inválido; ignorado.');
    return {};
  }
}

function statusPorChave_(key) {
  for (var i = 0; i < STATUS_FLUXO.length; i++) if (STATUS_FLUXO[i].key === key) return STATUS_FLUXO[i];
  return null;
}

function indiceStatus_(key) {
  for (var i = 0; i < STATUS_FLUXO.length; i++) if (STATUS_FLUXO[i].key === key) return i;
  return -1;
}

/** Converte o nome de status vindo do ClickUp na chave do fluxo (ou null). */
function mapearStatus_(nomeClickUp, aliases) {
  var n = normalizar_(nomeClickUp);
  if (!n) return null;
  for (var i = 0; i < STATUS_FLUXO.length; i++) {
    if (normalizar_(STATUS_FLUXO[i].nome) === n) return STATUS_FLUXO[i].key;
  }
  var a = aliases || {};
  return a[n] || null;
}

/** URL pública do portal (configurada após a publicação). */
function urlApp_() {
  var url = prop_('APP_URL', '');
  if (!url) {
    try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  }
  return url;
}

function linkAcompanhamento_(codigo) {
  var base = urlApp_();
  if (!base) return '';
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'c=' + encodeURIComponent(codigo);
}

function linkWhatsApp_(texto) {
  var numero = String(prop_('WHATSAPP')).replace(/\D/g, '');
  if (!numero) return '';
  return 'https://wa.me/' + numero + (texto ? '?text=' + encodeURIComponent(texto) : '');
}
