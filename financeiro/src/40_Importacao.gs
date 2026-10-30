/**
 * 40_Importacao.gs — Importa a planilha "Ecos - Fluxo de caixa 2026" (aba "Fluxo de Caixa").
 *
 * 1. Cada linha vira um lançamento BAIXADO (histórico realizado), com a categoria
 *    convertida para o plano de categorias da DRE. Rodar de novo não duplica:
 *    cada linha tem uma chave própria.
 * 2. A partir dos 3 últimos meses importados, sugere os cadastros recorrentes:
 *    clientes com honorários mensais e despesas que se repetem. Eles começam a
 *    gerar previsões no mês seguinte ao último mês importado e podem ser
 *    ajustados na aba Cadastros.
 */

/** Regras de conversão das categorias antigas. A primeira regra que casar vence. */
var REGRAS_IMPORTACAO = [
  // Saídas — pelo fornecedor (as categorias antigas desses fornecedores são inconsistentes)
  { tipo: 'DESPESA', contraparte: /dominio|jettax|claude|digiforte|google|canva/, categoria: 'Softwares e sistemas' },
  { tipo: 'DESPESA', contraparte: /meta ?ads|facebook|instagram/, categoria: 'Mídia paga' },
  { tipo: 'DESPESA', contraparte: /doco/, categoria: 'Agência de marketing' },
  { tipo: 'DESPESA', contraparte: /dare|jucesp|junta/, categoria: 'Taxas e DAREs de processos' },
  { tipo: 'DESPESA', contraparte: /webcert|certificado/, categoria: 'Certificados digitais (custo)' },
  // Saídas — pela categoria/descrição antiga
  { tipo: 'DESPESA', categoriaAntiga: /cbd|reserva|aplica/, categoria: 'Reserva / aplicação' },
  { tipo: 'DESPESA', descricao: /pr[oó] ?labore/, categoria: 'Pró-labore / distribuição' },
  // Na planilha antiga, "Salário" é a retirada dos sócios.
  { tipo: 'DESPESA', categoriaAntiga: /^salario/, categoria: 'Pró-labore / distribuição' },
  { tipo: 'DESPESA', categoriaAntiga: /aplicativo|software/, categoria: 'Softwares e sistemas' },
  { tipo: 'DESPESA', categoriaAntiga: /internet/, categoria: 'Internet e telefone' },
  { tipo: 'DESPESA', categoriaAntiga: /aluguel/, categoria: 'Aluguel' },
  { tipo: 'DESPESA', categoriaAntiga: /agua|luz/, categoria: 'Água e energia' },
  { tipo: 'DESPESA', categoriaAntiga: /crc/, categoria: 'Anuidade CRC' },
  { tipo: 'DESPESA', categoriaAntiga: /midia/, categoria: 'Mídia paga' },
  { tipo: 'DESPESA', categoriaAntiga: /certificado/, categoria: 'Certificados digitais (custo)' },
  { tipo: 'DESPESA', descricao: /dare|certid/, categoria: 'Taxas e DAREs de processos' },
  { tipo: 'DESPESA', descricao: /comiss/, categoria: 'Comissões e parcerias' },
  { tipo: 'DESPESA', categoriaAntiga: /imposto/, categoria: 'Taxas e multas do escritório' },
  { tipo: 'DESPESA', categoriaAntiga: /transporte|uber|gasolina|estacionamento/, categoria: 'Transporte' },
  { tipo: 'DESPESA', categoriaAntiga: /material/, categoria: 'Material de escritório' },
  { tipo: 'DESPESA', categoriaAntiga: /curso/, categoria: 'Cursos e treinamentos' },
  { tipo: 'DESPESA', categoria: 'Outras despesas' },
  // Entradas
  { tipo: 'RECEITA', descricao: /saldo inicial/, categoria: 'Aporte / transferência recebida' },
  { tipo: 'RECEITA', descricao: /honor/, categoria: 'Honorários mensais' },
  { tipo: 'RECEITA', descricao: /irpf|imposto de renda|\bir\b/, categoria: 'IRPF' },
  { tipo: 'RECEITA', descricao: /regulariz/, categoria: 'Regularização' },
  { tipo: 'RECEITA', descricao: /abertura|altera|desenquadr|encerr|baixa|contrato|transforma/, categoria: 'Abertura, alteração e baixa' },
  { tipo: 'RECEITA', categoriaAntiga: /certificado/, categoria: 'Certificado digital' },
  { tipo: 'RECEITA', descricao: /certificado/, categoria: 'Certificado digital' },
  { tipo: 'RECEITA', categoriaAntiga: /outras receitas/, categoria: 'Outras receitas' },
  { tipo: 'RECEITA', categoria: 'Outros serviços avulsos' }
];

/** Categorias de despesa que não viram despesa fixa (são variáveis por natureza). */
var CATEGORIAS_NAO_RECORRENTES = ['Taxas e DAREs de processos', 'Certificados digitais (custo)', 'Reserva / aplicação',
  'Retirada / transferência enviada', 'Estornos e devoluções enviadas', 'Outras despesas', 'A esclarecer', 'Transporte',
  'Alimentação', 'Material de escritório', 'Material impresso', 'Taxas e multas do escritório', 'DARF (tributos federais)',
  'Tributos municipais', 'Comissões e parcerias', 'Serviços de terceiros', 'Tarifas bancárias e de cobrança'];

function categoriaImportada_(tipo, categoriaAntiga, descricao, contraparte) {
  var ca = normalizar_(categoriaAntiga), de = normalizar_(descricao), co = normalizar_(contraparte);
  for (var i = 0; i < REGRAS_IMPORTACAO.length; i++) {
    var r = REGRAS_IMPORTACAO[i];
    if (r.tipo !== tipo) continue;
    if (r.contraparte && !r.contraparte.test(co)) continue;
    if (r.categoriaAntiga && !r.categoriaAntiga.test(ca)) continue;
    if (r.descricao && !r.descricao.test(de)) continue;
    return r.categoria;
  }
  return tipo === TIPO.RECEITA ? 'Outras receitas' : 'Outras despesas';
}

/** Lê as linhas da aba de origem, localizando o cabeçalho pelos nomes das colunas. */
function lerFluxoOrigem_(idPlanilha) {
  var ss = SpreadsheetApp.openById(idPlanilha);
  var sh = ss.getSheetByName('Fluxo de Caixa');
  if (!sh) throw new ErroFin('Aba "Fluxo de Caixa" não encontrada na planilha de origem.');
  var valores = sh.getDataRange().getValues();
  var cab = -1, col = {};
  for (var i = 0; i < Math.min(valores.length, 30) && cab < 0; i++) {
    var linha = valores[i].map(normalizar_);
    var d = linha.indexOf('data'), v = linha.indexOf('valor');
    if (d >= 0 && v === d + 1) {
      cab = i;
      col = {
        data: d, valor: v,
        forma: linha.indexOf('forma de pgmt.'),
        contraparte: linha.indexOf('cliente/fornecedor'),
        categoria: linha.indexOf('categoria'),
        descricao: linha.indexOf('descricao')
      };
    }
  }
  if (cab < 0) throw new ErroFin('Cabeçalho "Data | Valor" não encontrado na aba "Fluxo de Caixa".');
  var cel = function (l, k) { return col[k] >= 0 ? l[col[k]] : ''; };
  var saida = [];
  for (var j = cab + 1; j < valores.length; j++) {
    var l = valores[j];
    var data = paraDataIso_(cel(l, 'data'));
    var valor = typeof cel(l, 'valor') === 'number' ? cel(l, 'valor') : lerValor_(cel(l, 'valor'));
    if (!ehDataIso_(data) || !valor || isNaN(valor)) continue;
    saida.push({
      linha: j + 1, data: data, valor: centavos_(valor),
      forma: limparTexto_(cel(l, 'forma'), 40), contraparte: limparTexto_(cel(l, 'contraparte'), 120),
      categoriaAntiga: limparTexto_(cel(l, 'categoria'), 80), descricao: limparTexto_(cel(l, 'descricao'), 200)
    });
  }
  return saida;
}

/**
 * Importa o histórico e sugere as recorrências. "linhas" pode ser passado diretamente
 * (testes); senão é lido da planilha de origem.
 */
function importarFluxo_(linhas, usuario) {
  if (origemImportada_() === 'DASHBOARD') {
    throw new ErroFin('O dashboard financeiro já foi importado. Importar a planilha por cima duplicaria os valores.');
  }
  var existentes = {};
  lerTodos_(ABAS.LANCAMENTOS).forEach(function (l) { if (l.chave) existentes[l.chave] = true; });
  var novos = [], ignorados = 0, ocorrencias = {};
  linhas.forEach(function (o) {
    var tipo = o.valor > 0 ? TIPO.RECEITA : TIPO.DESPESA;
    var valor = Math.abs(o.valor);
    var chave = 'IMP|' + o.data + '|' + o.valor + '|' + normalizar_(o.contraparte) + '|' + normalizar_(o.descricao);
    // Linhas idênticas na origem são numeradas na ordem em que aparecem.
    ocorrencias[chave] = (ocorrencias[chave] || 0) + 1;
    chave += '|' + ocorrencias[chave];
    if (existentes[chave]) { ignorados++; return; }
    var forma = FORMAS.filter(function (f) { return normalizar_(f) === normalizar_(o.forma); })[0] || (normalizar_(o.forma) === 'debito' ? 'Cartão' : 'Pix');
    novos.push({
      id: novoId_('L'), tipo: tipo, vencimento: o.data,
      descricao: o.descricao || o.categoriaAntiga || '', contraparte: o.contraparte || '(sem nome)',
      categoria: categoriaImportada_(tipo, o.categoriaAntiga, o.descricao, o.contraparte),
      valor: valor, situacao: SITUACAO.PAGO, valorPago: valor, dataPagamento: o.data, forma: forma,
      origem: 'IMPORTADO', recorrenciaId: '', chave: chave, observacao: o.categoriaAntiga ? 'Categoria original: ' + o.categoriaAntiga : '',
      criadoEm: agoraIso_(), criadoPor: usuario, atualizadoEm: agoraIso_(), atualizadoPor: usuario
    });
  });
  inserirVarios_(ABAS.LANCAMENTOS, novos);
  var sugeridas = sugerirRecorrencias_(lerTodos_(ABAS.LANCAMENTOS).filter(function (l) { return l.origem === 'IMPORTADO'; }), usuario);
  registrarLog_(usuario, 'IMPORTAR', '', novos.length + ' lançamentos; ' + ignorados + ' já existiam; ' + sugeridas.clientes + ' clientes; ' + sugeridas.despesas + ' despesas fixas');
  return { importados: novos.length, ignorados: ignorados, clientes: sugeridas.clientes, despesasFixas: sugeridas.despesas, inicio: sugeridas.inicio };
}

/**
 * Cria recorrências a partir dos 3 últimos meses importados:
 *  - cliente: honorários mensais no último mês ou em 2 dos 3 meses;
 *  - despesa: mesmo fornecedor e categoria em 2 dos 3 meses (exceto categorias variáveis).
 * Valor e dia vêm do mês mais recente. Não duplica cadastros com o mesmo nome e tipo.
 */
function sugerirRecorrencias_(importados, usuario) {
  if (!importados.length) return { clientes: 0, despesas: 0, inicio: '' };
  var ultimoMes = importados.map(function (l) { return mesDe_(l.vencimento); }).sort().pop();
  var meses = [somarMeses_(ultimoMes, -2), somarMeses_(ultimoMes, -1), ultimoMes];
  var inicio = somarMeses_(ultimoMes, 1);
  var jaCadastrados = {};
  recorrencias_().forEach(function (r) { jaCadastrados[r.tipo + '|' + normalizar_(r.contraparte)] = true; });

  var grupos = {};
  importados.forEach(function (l) {
    var m = mesDe_(l.vencimento);
    if (meses.indexOf(m) < 0) return;
    if (l.tipo === TIPO.RECEITA && l.categoria !== 'Honorários mensais') return;
    if (l.tipo === TIPO.DESPESA && CATEGORIAS_NAO_RECORRENTES.indexOf(l.categoria) >= 0) return;
    var k = l.tipo + '|' + normalizar_(l.contraparte) + (l.tipo === TIPO.DESPESA ? '|' + l.categoria : '');
    if (!grupos[k]) grupos[k] = { tipo: l.tipo, contraparte: l.contraparte, categoria: l.categoria, porMes: {} };
    (grupos[k].porMes[m] = grupos[k].porMes[m] || []).push(l);
  });

  var criados = { clientes: 0, despesas: 0, inicio: inicio };
  Object.keys(grupos).sort().forEach(function (k) {
    var g = grupos[k];
    var mesesPresentes = Object.keys(g.porMes).sort();
    var recente = mesesPresentes[mesesPresentes.length - 1];
    var elegivel = g.tipo === TIPO.RECEITA ? (recente === ultimoMes || mesesPresentes.length >= 2) : mesesPresentes.length >= 2;
    if (!elegivel || jaCadastrados[g.tipo + '|' + normalizar_(g.contraparte)]) return;
    var doMes = g.porMes[recente].sort(function (a, b) { return a.vencimento < b.vencimento ? -1 : 1; });
    var valor = g.tipo === TIPO.RECEITA
      ? Number(doMes[doMes.length - 1].valor)
      : centavos_(doMes.reduce(function (s, l) { return s + Number(l.valor); }, 0));
    var r = {
      id: novoId_('R'), tipo: g.tipo, contraparte: g.contraparte,
      descricao: g.tipo === TIPO.RECEITA ? 'Honorários mensais' : (doMes[0].descricao || g.categoria),
      categoria: g.categoria, valor: valor, dia: Number(doMes[0].vencimento.slice(8, 10)),
      forma: doMes[doMes.length - 1].forma || 'Pix', inicio: inicio, fim: '', ativo: true, documento: '',
      observacao: 'Sugerido pela importação (' + mesesPresentes.length + ' de 3 meses)',
      criadoEm: agoraIso_(), atualizadoEm: agoraIso_(), atualizadoPor: usuario
    };
    inserir_(ABAS.RECORRENCIAS, r);
    jaCadastrados[g.tipo + '|' + normalizar_(g.contraparte)] = true;
    if (g.tipo === TIPO.RECEITA) criados.clientes++; else criados.despesas++;
  });
  return criados;
}
