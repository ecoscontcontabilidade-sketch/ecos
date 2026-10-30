/**
 * Ambiente simulado do Apps Script para o Financeiro ECOS (Node, sem rede).
 * Reaproveita a planilha em memória e o compilador de templates do harness da
 * Central de Processos. O código de financeiro/src roda sem modificação.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { FakeSpreadsheet, compilarTemplate } = require('../../tests/harness');

const SRC = path.join(__dirname, '..', 'src');
const PROPRIETARIO = 'ecos.cont.contabilidade@gmail.com';

function criarAmbiente(opcoes) {
  opcoes = opcoes || {};
  const props = Object.assign({}, opcoes.props || {});
  const ss = new FakeSpreadsheet();
  const origem = new FakeSpreadsheet();
  const amb = { props, ss, origem, usuarioAtivo: opcoes.usuarioAtivo || '', usuarioEfetivo: opcoes.usuarioEfetivo || '', agora: opcoes.agora || '2026-10-30T12:00:00-03:00' };

  const contexto = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.assign({}, props),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: {
      openById: (id) => (id === 'origem' ? origem : ss),
      create: () => ss
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => amb.usuarioAtivo }),
      getEffectiveUser: () => ({ getEmail: () => amb.usuarioEfetivo || amb.usuarioAtivo })
    }
  };
  // Relógio controlado: new Date() sem argumentos devolve o "agora" do teste.
  const DataReal = Date;
  function DataFalsa(...a) { return a.length ? new DataReal(...a) : new DataReal(amb.agora); }
  DataFalsa.prototype = DataReal.prototype;
  DataFalsa.UTC = DataReal.UTC;
  DataFalsa.now = () => new DataReal(amb.agora).getTime();
  contexto.Date = DataFalsa;

  const templates = {};
  contexto.HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
    createHtmlOutputFromFile: (nome) => ({ getContent: () => fs.readFileSync(path.join(SRC, nome + '.html'), 'utf8') }),
    createTemplateFromFile: (nome) => {
      const fonte = fs.readFileSync(path.join(SRC, nome + '.html'), 'utf8');
      const tpl = {};
      tpl.evaluate = () => {
        const fn = vm.runInContext('(function(__esc, __vars){ with(__vars){' + compilarTemplate(fonte) + '} })', contexto);
        const html = fn((v) => String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), tpl);
        templates[nome] = html;
        const out = { getContent: () => html, setTitle: () => out, addMetaTag: () => out, setXFrameOptionsMode: () => out };
        return out;
      };
      return tpl;
    }
  };
  amb.templates = templates;

  vm.createContext(contexto);
  fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), contexto, { filename: f });
  });
  amb.g = contexto;
  return amb;
}

/** Ambiente instalado, com o proprietário e uma colaboradora autorizados. */
function ambienteInstalado(opcoes) {
  const amb = criarAmbiente(Object.assign({ usuarioAtivo: PROPRIETARIO }, opcoes || {}));
  amb.g.instalar();
  amb.props.FIN_EMAILS = PROPRIETARIO + ', equipe@ecoscont.com.br';
  amb.g.memoProps_ = null;
  return amb;
}

/** Simula uma nova execução: zera as memórias por execução. */
function exec(amb, fn) {
  amb.g.memoProps_ = null;
  amb.g.limparMemoria_();
  return fn(amb.g);
}

module.exports = { criarAmbiente, ambienteInstalado, exec, PROPRIETARIO };
