/**
 * 10_Store.gs — Base de dados em Google Planilha (privada; compartilhada só com a equipe).
 *
 * Nenhuma linha é apagada: lançamentos excluídos ficam com situação CANCELADO,
 * o que mantém a auditoria e impede que a geração automática recrie a previsão.
 * Como as linhas nunca mudam de posição, a gravação é feita pelo número da linha.
 */

var ABAS = {
  LANCAMENTOS: {
    nome: 'Lancamentos',
    colunas: ['id', 'tipo', 'vencimento', 'descricao', 'contraparte', 'categoria', 'valor', 'situacao',
      'valorPago', 'dataPagamento', 'forma', 'origem', 'recorrenciaId', 'chave', 'observacao',
      'criadoEm', 'criadoPor', 'atualizadoEm', 'atualizadoPor']
  },
  RECORRENCIAS: {
    nome: 'Recorrencias',
    colunas: ['id', 'tipo', 'contraparte', 'descricao', 'categoria', 'valor', 'dia', 'forma', 'inicio', 'fim',
      'ativo', 'documento', 'observacao', 'criadoEm', 'atualizadoEm', 'atualizadoPor']
  },
  CATEGORIAS: {
    nome: 'Categorias',
    colunas: ['nome', 'tipo', 'grupo', 'ativa']
  },
  CONFIG: {
    nome: 'Config',
    colunas: ['chave', 'valor', 'atualizadoEm', 'atualizadoPor']
  },
  LOG: {
    nome: 'Log',
    colunas: ['dataHora', 'usuario', 'acao', 'id', 'detalhe']
  }
};

var COLUNAS_DATA = { vencimento: true, dataPagamento: true };
var COLUNAS_MES = { inicio: true, fim: true };

var memoPlanilha_ = null;
var memoDados_ = {};

function planilha_() {
  if (memoPlanilha_) return memoPlanilha_;
  var id = prop_('FIN_SPREADSHEET_ID', '');
  if (!id) throw new ErroFin('Base do financeiro não instalada. Execute instalar() no editor do Apps Script.');
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

function valorLido_(coluna, v) {
  if (COLUNAS_DATA[coluna]) return paraDataIso_(v);
  if (COLUNAS_MES[coluna]) return paraMes_(v);
  if (v instanceof Date) return Utilities.formatDate(v, FIN.TIMEZONE, 'yyyy-MM-dd HH:mm');
  return v;
}

/** Texto iniciado por = + - @ é gravado como texto (evita fórmulas injetadas). */
function valorGravado_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  if (v === undefined || v === null) return '';
  return v;
}

/** Lê a aba inteira como objetos (memorizado por execução). Cada objeto recebe _linha. */
function lerTodos_(def) {
  if (memoDados_[def.nome]) return memoDados_[def.nome];
  var sh = aba_(def);
  var ultima = sh.getLastRow();
  var lista = [];
  if (ultima >= 2) {
    lista = sh.getRange(2, 1, ultima - 1, def.colunas.length).getValues()
      .map(function (linha, i) {
        var o = { _linha: i + 2 };
        def.colunas.forEach(function (c, j) { o[c] = valorLido_(c, linha[j]); });
        return o;
      })
      .filter(function (o) { return o[def.colunas[0]] !== ''; });
  }
  memoDados_[def.nome] = lista;
  return lista;
}

function linhaDe_(def, o) {
  return def.colunas.map(function (c) { return valorGravado_(o[c]); });
}

function inserir_(def, o) {
  var sh = aba_(def);
  sh.appendRow(linhaDe_(def, o));
  o._linha = sh.getLastRow();
  if (memoDados_[def.nome]) memoDados_[def.nome].push(o);
  return o;
}

/** Insere várias linhas de uma vez (importação). */
function inserirVarios_(def, lista) {
  if (!lista.length) return;
  var sh = aba_(def);
  var inicio = sh.getLastRow() + 1;
  sh.getRange(inicio, 1, lista.length, def.colunas.length).setValues(lista.map(function (o) { return linhaDe_(def, o); }));
  lista.forEach(function (o, i) { o._linha = inicio + i; });
  if (memoDados_[def.nome]) memoDados_[def.nome] = memoDados_[def.nome].concat(lista);
}

function atualizar_(def, o) {
  if (!o._linha) throw new ErroFin('Registro sem posição na planilha.');
  aba_(def).getRange(o._linha, 1, 1, def.colunas.length).setValues([linhaDe_(def, o)]);
  return o;
}

function limparMemoria_() {
  memoDados_ = {};
}

/* ---------------- Config (chave/valor) ---------------- */

function config_(chave) {
  var achado = lerTodos_(ABAS.CONFIG).filter(function (c) { return c.chave === chave; })[0];
  return achado ? achado.valor : '';
}

function definirConfig_(chave, valor, usuario) {
  var achado = lerTodos_(ABAS.CONFIG).filter(function (c) { return c.chave === chave; })[0];
  if (achado) {
    achado.valor = valor;
    achado.atualizadoEm = agoraIso_();
    achado.atualizadoPor = usuario || '';
    atualizar_(ABAS.CONFIG, achado);
  } else {
    inserir_(ABAS.CONFIG, { chave: chave, valor: valor, atualizadoEm: agoraIso_(), atualizadoPor: usuario || '' });
  }
}

/* ---------------- Log ---------------- */

function registrarLog_(usuario, acao, id, detalhe) {
  inserir_(ABAS.LOG, { dataHora: agoraIso_(), usuario: usuario || '', acao: acao, id: id || '', detalhe: limparTexto_(detalhe, 500) });
}

/* ---------------- Categorias ---------------- */

function categorias_() {
  return lerTodos_(ABAS.CATEGORIAS)
    .filter(function (c) { return String(c.ativa).toLowerCase() !== 'false' && grupoPorChave_(c.grupo); })
    .map(function (c) { return { nome: String(c.nome), tipo: String(c.tipo), grupo: String(c.grupo) }; });
}

function categoriaPorNome_(nome, tipo) {
  var n = normalizar_(nome);
  return categorias_().filter(function (c) { return normalizar_(c.nome) === n && (!tipo || c.tipo === tipo); })[0] || null;
}

/** Grupo da DRE de um lançamento; categorias desconhecidas caem em "Outras". */
function grupoDoLancamento_(l, mapaCategorias) {
  var c = mapaCategorias[normalizar_(l.categoria) + '|' + l.tipo];
  if (c) return c.grupo;
  return l.tipo === TIPO.RECEITA ? 'OUTRAS_REC' : 'OUTRAS_DESP';
}

function mapaCategorias_() {
  var mapa = {};
  categorias_().forEach(function (c) { mapa[normalizar_(c.nome) + '|' + c.tipo] = c; });
  return mapa;
}
