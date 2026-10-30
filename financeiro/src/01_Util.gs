/**
 * 01_Util.gs — Erros, texto, dinheiro e datas.
 *
 * Datas circulam como texto ISO "aaaa-mm-dd" e meses como "aaaa-mm": comparáveis
 * como texto, sem ambiguidade de fuso, e iguais no servidor e no navegador.
 */

/** Erro com mensagem segura para exibir ao usuário. */
function ErroFin(mensagem) {
  this.name = 'ErroFin';
  this.message = mensagem;
  this.stack = (new Error(mensagem)).stack;
}
ErroFin.prototype = Object.create(Error.prototype);
ErroFin.prototype.constructor = ErroFin;

function normalizar_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove caracteres de controle e limita o tamanho de textos livres. */
function limparTexto_(s, max) {
  var t = String(s === null || s === undefined ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return max && t.length > max ? t.slice(0, max) : t;
}

/** Arredonda para centavos. */
function centavos_(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

/** Converte "1.234,56", "1234.56" ou número em valor positivo com centavos. */
function lerValor_(v) {
  if (typeof v === 'number') return centavos_(v);
  var t = String(v === null || v === undefined ? '' : v).replace(/[R$\s]/g, '');
  if (t.indexOf(',') >= 0 || /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  return isNaN(n) ? NaN : centavos_(n);
}

function novoId_(prefixo) {
  return prefixo + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function agoraIso_() {
  return Utilities.formatDate(new Date(), FIN.TIMEZONE, 'yyyy-MM-dd HH:mm');
}

function hojeIso_() {
  return Utilities.formatDate(new Date(), FIN.TIMEZONE, 'yyyy-MM-dd');
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function ehDataIso_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  var p = s.split('-').map(Number);
  return p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= diasNoMes_(p[0] + '-' + pad2_(p[1]));
}

function ehMes_(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
}

function mesDe_(dataIso) {
  return String(dataIso).slice(0, 7);
}

function diasNoMes_(mes) {
  var p = mes.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
}

/** Soma (ou subtrai) meses a "aaaa-mm". */
function somarMeses_(mes, n) {
  var p = mes.split('-').map(Number);
  var total = p[0] * 12 + (p[1] - 1) + n;
  return Math.floor(total / 12) + '-' + pad2_(total % 12 + 1);
}

function somarDias_(dataIso, n) {
  var p = dataIso.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function diferencaDias_(deIso, ateIso) {
  var a = deIso.split('-').map(Number), b = ateIso.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/** Dia de vencimento dentro do mês (dia 31 em fevereiro vira o último dia). */
function dataNoMes_(mes, dia) {
  var d = Math.min(Math.max(parseInt(dia, 10) || 1, 1), diasNoMes_(mes));
  return mes + '-' + pad2_(d);
}

/** Converte o valor de uma célula de data (Date ou texto) em "aaaa-mm-dd". */
function paraDataIso_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, FIN.TIMEZONE, 'yyyy-MM-dd');
  var s = String(v).trim();
  var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return s.slice(0, 10);
}

/** Converte o valor de uma célula de mês (Date ou texto) em "aaaa-mm". */
function paraMes_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, FIN.TIMEZONE, 'yyyy-MM');
  return String(v).trim().slice(0, 7);
}

function comLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
