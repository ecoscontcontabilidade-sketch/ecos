/**
 * 01_Util.gs — Utilitários genéricos: erros, texto, datas, hashes, códigos, lock.
 */

/** Erro com mensagem segura para exibir ao usuário. */
function ErroApp(mensagem, codigo) {
  this.name = 'ErroApp';
  this.message = mensagem;
  this.codigo = codigo || 'ERRO';
  this.stack = (new Error(mensagem)).stack;
}
ErroApp.prototype = Object.create(Error.prototype);
ErroApp.prototype.constructor = ErroApp;

/** Erro de integração (ClickUp). A mensagem nunca contém o token. */
function ErroIntegracao(mensagem, status) {
  this.name = 'ErroIntegracao';
  this.message = mensagem;
  this.status = status || 0;
  this.stack = (new Error(mensagem)).stack;
}
ErroIntegracao.prototype = Object.create(Error.prototype);
ErroIntegracao.prototype.constructor = ErroIntegracao;

/** Minúsculas, sem acentos, espaços colapsados. */
function normalizar_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Remove caracteres de controle e limita o tamanho de textos livres. */
function limparTexto_(s, max) {
  var t = String(s === null || s === undefined ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return max && t.length > max ? t.slice(0, max) : t;
}

function agora_() {
  return Date.now();
}

/** Data/hora no padrão brasileiro (dd/MM/yyyy HH:mm). */
function fmtDataHora_(ms) {
  if (!ms) return '';
  return Utilities.formatDate(new Date(Number(ms)), APP.TIMEZONE, "dd/MM/yyyy HH:mm");
}

function fmtData_(ms) {
  if (!ms) return '';
  return Utilities.formatDate(new Date(Number(ms)), APP.TIMEZONE, 'dd/MM/yyyy');
}

function bytesParaHex_(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function sha256Hex_(texto) {
  return bytesParaHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8));
}

/** Hash com "sal" do projeto — usado para e-mails e códigos armazenados em cache. */
function hashComSal_(texto) {
  return sha256Hex_(prop_('HASH_SALT', 'ecos') + '|' + texto);
}

/**
 * Bytes aleatórios. Utilities.getUuid() gera UUID v4 (aleatório); combinamos
 * vários UUIDs e o instante atual em um SHA-256 para obter 32 bytes.
 */
function bytesAleatorios_() {
  var semente = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random();
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, semente).map(function (b) {
    return b < 0 ? b + 256 : b;
  });
}

function tokenAleatorio_() {
  return bytesParaHex_(bytesAleatorios_());
}

/** Alfabeto Crockford Base32 (sem I, L, O, U) — 32 símbolos, sem viés com byte & 31. */
var ALFABETO_CODIGO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Código público de acompanhamento: ECOS-XXXX-XXXX-XXXX (12 símbolos, 60 bits).
 * Não tem relação com o ID da tarefa no ClickUp e não é sequencial.
 */
function gerarCodigoPublico_() {
  var b = bytesAleatorios_();
  var s = '';
  for (var i = 0; i < 12; i++) s += ALFABETO_CODIGO.charAt(b[i] & 31);
  return 'ECOS-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}

/**
 * Normaliza o código digitado pelo cliente. Aceita minúsculas, espaços, sem
 * hífens e com/sem o prefixo ECOS. Retorna null se o formato for inválido.
 */
function normalizarCodigo_(entrada) {
  if (entrada === null || entrada === undefined) return null;
  var s = String(entrada).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.indexOf('ECOS') === 0 && s.length === 16) s = s.slice(4);
  if (s.length !== 12) return null;
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  for (var i = 0; i < s.length; i++) if (ALFABETO_CODIGO.indexOf(s.charAt(i)) < 0) return null;
  return 'ECOS-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}

function emailValido_(email) {
  var e = String(email || '').trim();
  return e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(e);
}

/** j***@g***.com — usado em logs/tabelas para minimizar dados pessoais. */
function mascararEmail_(email) {
  var e = String(email || '').trim();
  var at = e.indexOf('@');
  if (at < 1) return '';
  var usuario = e.slice(0, at);
  var dominio = e.slice(at + 1);
  var ponto = dominio.lastIndexOf('.');
  var nomeDom = ponto > 0 ? dominio.slice(0, ponto) : dominio;
  var tld = ponto > 0 ? dominio.slice(ponto) : '';
  return usuario.charAt(0) + '***@' + nomeDom.charAt(0) + '***' + tld;
}

/** "ALTERAÇÃO CONTRATUAL - ATS LOGISTICA" → "Alteração Contratual - Ats Logistica" (só se tudo em maiúsculas). */
var PALAVRAS_MINUSCULAS = ['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'para', 'por', 'com'];
var SIGLAS_MANTIDAS = ['MEI', 'ME', 'EPP', 'LTDA', 'SA', 'S/A', 'CNPJ', 'DBE', 'VRE', 'JUCESP', 'EIRELI', 'SLU', 'CLI', 'TFE', 'IR', 'CRECI', 'PJ', 'PF', 'SN', 'II', 'III'];

function tituloLegivel_(s) {
  var t = String(s || '').trim();
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().split(/(\s+|-|\/)/).map(function (p, i) {
    var up = p.toUpperCase();
    if (SIGLAS_MANTIDAS.indexOf(up) >= 0) return up;
    if (i > 0 && PALAVRAS_MINUSCULAS.indexOf(p) >= 0) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join('');
}

/** Executa fn com o lock do script (exclusão mútua entre gatilhos e usuários). */
function comLock_(fn, esperaMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(esperaMs || 30000)) {
    throw new ErroApp('O sistema está processando outra atualização. Tente novamente em alguns segundos.', 'OCUPADO');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Contador de janela fixa em cache — usado para limitar tentativas.
 * Retorna o valor após o incremento.
 */
function incrementarContador_(chave, janelaSeg) {
  var cache = CacheService.getScriptCache();
  var k = 'rl:' + chave;
  var agora = agora_();
  var reg = lerRegistroContador_(cache.get(k), agora);
  if (!reg) reg = { n: 0, fim: agora + janelaSeg * 1000 };
  reg.n++;
  // Mantém o fim original da janela: novas tentativas não prolongam o bloqueio.
  var restante = Math.max(1, Math.ceil((reg.fim - agora) / 1000));
  cache.put(k, JSON.stringify(reg), restante);
  return reg.n;
}

function lerContador_(chave) {
  var reg = lerRegistroContador_(CacheService.getScriptCache().get('rl:' + chave), agora_());
  return reg ? reg.n : 0;
}

function lerRegistroContador_(bruto, agora) {
  if (!bruto) return null;
  try {
    var reg = JSON.parse(bruto);
    return reg && reg.fim > agora ? reg : null;
  } catch (e) {
    return null;
  }
}

/** Garante que a execução vem do proprietário (editor) ou de um gatilho real. */
function exigirContextoInterno_(e) {
  if (e && e.triggerUid) {
    var ok = ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === String(e.triggerUid); });
    if (ok) return;
  }
  var ativo = '';
  var efetivo = '';
  try { ativo = Session.getActiveUser().getEmail(); } catch (x) { ativo = ''; }
  try { efetivo = Session.getEffectiveUser().getEmail(); } catch (x) { efetivo = ''; }
  if (!ativo || !efetivo || ativo.toLowerCase() !== efetivo.toLowerCase()) {
    throw new Error('Operação não permitida.');
  }
}
