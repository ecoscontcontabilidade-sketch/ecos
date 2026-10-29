/**
 * Ambiente simulado do Google Apps Script para testar o código de src/ em Node.
 * Simula: Utilities, PropertiesService, CacheService, LockService, SpreadsheetApp,
 * UrlFetchApp (servidor ClickUp falso), MailApp, HtmlService (templates), ScriptApp,
 * Session e DriveApp. Não faz chamadas de rede.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

function toSignedBytes(buf) {
  return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
}

/* ---------- Planilha em memória ---------- */
class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr: nr || 1, nc: nc || 1 }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const linha = this.sheet.rows[this.row - 1 + r] || [];
      const vals = [];
      for (let c = 0; c < this.nc; c++) vals.push(linha[this.col - 1 + c] === undefined ? '' : linha[this.col - 1 + c]);
      out.push(vals);
    }
    return out;
  }
  setValues(v) {
    for (let r = 0; r < this.nr; r++) {
      const idx = this.row - 1 + r;
      this.sheet.rows[idx] = this.sheet.rows[idx] || [];
      for (let c = 0; c < this.nc; c++) this.sheet.rows[idx][this.col - 1 + c] = celula(v[r][c]);
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  createTextFinder(texto) {
    const range = this;
    let inteiro = false;
    return {
      matchEntireCell(b) { inteiro = b; return this; },
      findNext() {
        for (let r = 0; r < range.nr; r++) {
          const linha = range.sheet.rows[range.row - 1 + r] || [];
          for (let c = 0; c < range.nc; c++) {
            const v = String(linha[range.col - 1 + c] === undefined ? '' : linha[range.col - 1 + c]);
            if (inteiro ? v === texto : v.indexOf(texto) >= 0) {
              const row = range.row + r;
              return { getRow: () => row };
            }
          }
        }
        return null;
      }
    };
  }
}
function celula(v) {
  // Simula a planilha: "'texto" vira texto; números permanecem números.
  if (typeof v === 'string' && v.startsWith("'")) return v.slice(1);
  return v;
}
class FakeSheet {
  constructor(nome) { this.nome = nome; this.rows = []; }
  getName() { return this.nome; }
  getLastRow() { return this.rows.length; }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr, nc); }
  appendRow(v) { this.rows.push(v.map(celula)); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  setFrozenRows() {}
}
class FakeSpreadsheet {
  constructor() { this.sheets = [new FakeSheet('Página1')]; this.id = 'ss-1'; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/ss-1'; }
  getSheetByName(n) { return this.sheets.find((s) => s.nome === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

/* ---------- Servidor ClickUp falso ---------- */
function criarClickUp(opcoes) {
  const LIST = opcoes.listId;
  const estado = {
    statuses: opcoes.statuses,
    campos: opcoes.campos,
    tasks: {},
    chamadas: [],
    falhas: {}, // ex.: { 'put /task': 500 }
    agora: Date.now()
  };
  estado.tick = () => (estado.agora += 1000);
  estado.criarTarefa = (t) => {
    const id = t.id;
    estado.tasks[id] = {
      id,
      name: t.name,
      status: { status: t.status, type: t.type || 'custom' },
      date_created: String(estado.tick()),
      date_updated: String(estado.agora),
      due_date: null,
      assignees: t.assignees || [{ id: 1, username: 'Eduardo da Cruz' }],
      tags: (t.tags || []).map((n) => ({ name: n })),
      list: { id: t.listId || LIST, name: 'Processos' },
      url: 'https://app.clickup.com/t/' + id,
      text_content: t.descricao || '',
      custom_fields: estado.campos.map((f) => {
        const o = { id: f.id, name: f.name, type: f.type };
        if (t.campos && t.campos[f.name] !== undefined) o.value = t.campos[f.name];
        return o;
      })
    };
    return estado.tasks[id];
  };
  estado.mudarStatus = (id, status) => {
    estado.tasks[id].status.status = status;
    estado.tasks[id].date_updated = String(estado.tick());
  };
  estado.fetch = (url, req) => {
    const u = new URL(url);
    const metodo = (req.method || 'get').toLowerCase();
    const p = u.pathname.replace('/api/v2', '');
    estado.chamadas.push(metodo + ' ' + p);
    if (req.headers.Authorization !== 'pk_teste') return resp(401, { err: 'Token invalid', ECODE: 'OAUTH_025' });
    for (const chave of Object.keys(estado.falhas)) {
      if ((metodo + ' ' + p).startsWith(chave)) return resp(estado.falhas[chave], { err: 'Falha simulada' });
    }
    let m;
    if (metodo === 'get' && p === '/list/' + LIST) return resp(200, { id: LIST, name: 'Processos', space: { name: 'ECOS' }, statuses: estado.statuses.map((s) => ({ status: s, type: 'custom' })) });
    if (metodo === 'get' && p === '/list/' + LIST + '/field') return resp(200, { fields: estado.campos });
    if (metodo === 'get' && p === '/list/' + LIST + '/task') {
      const gt = Number(u.searchParams.get('date_updated_gt') || 0);
      const page = Number(u.searchParams.get('page') || 0);
      const tags = u.searchParams.getAll('tags[]');
      let lista = Object.values(estado.tasks).filter((t) => t.list.id === LIST && Number(t.date_updated) > gt);
      if (tags.length) lista = lista.filter((t) => t.tags.some((x) => tags.includes(x.name)));
      lista.sort((a, b) => Number(b.date_updated) - Number(a.date_updated));
      const fatia = lista.slice(page * 100, page * 100 + 100);
      return resp(200, { tasks: clone(fatia), last_page: page * 100 + 100 >= lista.length });
    }
    if ((m = p.match(/^\/task\/([^/]+)$/))) {
      const t = estado.tasks[decodeURIComponent(m[1])];
      if (!t) return resp(404, { err: 'Task not found' });
      if (metodo === 'get') return resp(200, clone(t));
      if (metodo === 'put') {
        const body = JSON.parse(req.payload);
        if (!estado.statuses.map((s) => s.toLowerCase()).includes(String(body.status).toLowerCase())) return resp(400, { err: 'Status not found' });
        t.status.status = String(body.status).toLowerCase();
        t.date_updated = String(estado.tick());
        return resp(200, clone(t));
      }
    }
    if ((m = p.match(/^\/task\/([^/]+)\/field\/([^/]+)$/)) && metodo === 'post') {
      const t = estado.tasks[m[1]];
      const f = t.custom_fields.find((x) => x.id === m[2]);
      f.value = JSON.parse(req.payload).value;
      t.date_updated = String(estado.tick());
      return resp(200, {});
    }
    if ((m = p.match(/^\/task\/([^/]+)\/comment$/)) && metodo === 'post') {
      const t = estado.tasks[m[1]];
      t.comentarios = (t.comentarios || []).concat([JSON.parse(req.payload).comment_text]);
      return resp(200, { id: 'c' + t.comentarios.length });
    }
    if ((m = p.match(/^\/task\/([^/]+)\/tag\/([^/]+)$/)) && metodo === 'post') {
      const t = estado.tasks[m[1]];
      t.tags.push({ name: decodeURIComponent(m[2]) });
      t.date_updated = String(estado.tick());
      return resp(200, {});
    }
    return resp(404, { err: 'Rota não simulada: ' + metodo + ' ' + p });
  };
  return estado;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function resp(code, corpo) {
  return { getResponseCode: () => code, getContentText: () => JSON.stringify(corpo), getAllHeaders: () => ({}) };
}

/* ---------- Templates HtmlService ---------- */
function compilarTemplate(fonte) {
  let codigo = 'var __o=[];\n';
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let ultimo = 0, m;
  while ((m = re.exec(fonte))) {
    codigo += '__o.push(' + JSON.stringify(fonte.slice(ultimo, m.index)) + ');\n';
    if (m[1] === '=') codigo += '__o.push(__esc(' + m[2].trim().replace(/;$/, '') + '));\n';
    else if (m[1] === '!=') codigo += '__o.push(String(' + m[2].trim().replace(/;$/, '') + '));\n';
    else codigo += m[2] + '\n';
    ultimo = re.lastIndex;
  }
  codigo += '__o.push(' + JSON.stringify(fonte.slice(ultimo)) + ');\nreturn __o.join("");';
  return codigo;
}

/* ---------- Construção do contexto ---------- */
function criarAmbiente(opcoes) {
  opcoes = opcoes || {};
  const props = Object.assign({}, opcoes.props || {});
  const cache = {};
  const emails = [];
  const ss = new FakeSpreadsheet();
  const triggers = [];
  const ambiente = { props, cache, emails, ss, triggers, usuarioAtivo: opcoes.usuarioAtivo || '', falharEmail: false, cotaEmail: 100 };
  const clickup = criarClickUp({
    listId: '901326635055',
    statuses: opcoes.statuses || ['to do', 'aguardando documentação', 'viabilidade', 'dbe', 'vre digital - jucesp', 'em análise', 'exigência', 'deferido', 'complete'],
    campos: opcoes.campos !== undefined ? opcoes.campos : [
      { id: 'f-email', name: 'E-mail do cliente', type: 'email' },
      { id: 'f-nome', name: 'Nome do cliente', type: 'short_text' },
      { id: 'f-cnpj', name: 'CNPJ', type: 'short_text' },
      { id: 'f-ori', name: 'Orientação ao cliente', type: 'text' },
      { id: 'f-cod', name: 'Código de acompanhamento', type: 'short_text' }
    ]
  });
  ambiente.clickup = clickup;

  const contexto = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, texto) => toSignedBytes(crypto.createHash('sha256').update(String(texto), 'utf8').digest()),
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
      formatDate: (d, tz, fmt) => {
        const f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
        return fmt.replace('dd', p.day).replace('MM', p.month).replace('yyyy', p.year).replace('HH', p.hour).replace('mm', p.minute);
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.assign({}, props),
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: (o) => { Object.keys(o).forEach((k) => { props[k] = String(o[k]); }); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: (k) => { delete cache[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: () => ss, create: () => ss },
    UrlFetchApp: { fetch: (url, req) => clickup.fetch(url, req) },
    MailApp: {
      getRemainingDailyQuota: () => ambiente.cotaEmail,
      sendEmail: (o) => {
        if (ambiente.falharEmail) throw new Error('Serviço de e-mail indisponível (simulado)');
        emails.push(o);
        ambiente.cotaEmail--;
      }
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTE/exec' }),
      getProjectTriggers: () => triggers,
      newTrigger: (fn) => {
        const b = { timeBased: () => b, everyMinutes: () => b, everyDays: () => b, atHour: () => b, inTimezone: () => b,
          create: () => { const t = { getHandlerFunction: () => fn, getUniqueId: () => 'uid-' + triggers.length }; triggers.push(t); return t; } };
        return b;
      },
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); }
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => ambiente.usuarioAtivo }),
      getEffectiveUser: () => ({ getEmail: () => 'ecos.cont.contabilidade@gmail.com' })
    },
    DriveApp: { getFileById: () => { throw new Error('Drive indisponível no teste'); } }
  };

  const templates = {};
  contexto.HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
    createHtmlOutputFromFile: (nome) => ({ getContent: () => fs.readFileSync(path.join(SRC, nome + '.html'), 'utf8') }),
    createTemplateFromFile: (nome) => {
      const fonte = fs.readFileSync(path.join(SRC, nome + '.html'), 'utf8');
      const tpl = { __nome: nome };
      tpl.evaluate = () => {
        const corpo = compilarTemplate(fonte);
        const fn = vm.runInContext('(function(__esc, __vars){ with(__vars){' + corpo + '} })', contexto);
        const html = fn((v) => String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'), tpl);
        templates[nome] = html;
        const out = { getContent: () => html, setTitle: () => out, addMetaTag: () => out, setXFrameOptionsMode: () => out };
        return out;
      };
      return tpl;
    }
  };
  ambiente.templates = templates;

  vm.createContext(contexto);
  fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), contexto, { filename: f });
  });
  ambiente.g = contexto;
  return ambiente;
}

/** Ambiente já instalado e configurado como na Ecos. */
function ambienteInstalado(extraProps, opcoesAmbiente) {
  const amb = criarAmbiente(Object.assign({
    usuarioAtivo: 'ecos.cont.contabilidade@gmail.com',
    props: Object.assign({ CLICKUP_TOKEN: 'pk_teste', ADMIN_EMAILS: 'admin@ecos.com.br, outra@ecos.com.br', APP_URL: 'https://script.google.com/macros/s/TESTE/exec' }, extraProps || {})
  }, opcoesAmbiente || {}));
  amb.g.instalar();
  amb.g.memoProps_ = null;
  amb.usuarioAtivo = ''; // daqui em diante, chamadas simulam visitantes anônimos do Web App
  return amb;
}

module.exports = { criarAmbiente, ambienteInstalado };
