/**
 * 30_Relatorios.gs — Visões calculadas no servidor: agenda do dia, totais do mês,
 * DRE gerencial projetada, inadimplentes e saldo diário projetado.
 *
 * Tudo é recalculado a cada carga a partir dos lançamentos: não há totais gravados
 * que possam ficar desatualizados.
 */

function somar_(lista, fn) {
  return centavos_(lista.reduce(function (s, x) { return s + Number(fn(x) || 0); }, 0));
}

/** Agenda do dia (sempre relativa a hoje, independente do mês escolhido). */
function agendaDoDia_(todos, hoje) {
  var abertos = todos.filter(function (l) { return l.situacao === SITUACAO.ABERTO; });
  var limite = somarDias_(hoje, 7);
  var porVenc = function (a, b) { return a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : b.valor - a.valor; };
  var sel = function (tipo, cond) { return abertos.filter(function (l) { return l.tipo === tipo && cond(l); }).sort(porVenc); };
  var hojeF = function (l) { return l.vencimento === hoje; };
  var atrasoF = function (l) { return l.vencimento < hoje; };
  var proxF = function (l) { return l.vencimento > hoje && l.vencimento <= limite; };
  var r = {
    receberHoje: sel(TIPO.RECEITA, hojeF),
    pagarHoje: sel(TIPO.DESPESA, hojeF),
    receberAtrasado: sel(TIPO.RECEITA, atrasoF),
    pagarAtrasado: sel(TIPO.DESPESA, atrasoF),
    receberProximos: sel(TIPO.RECEITA, proxF),
    pagarProximos: sel(TIPO.DESPESA, proxF),
    recebidoHoje: todos.filter(function (l) { return l.situacao === SITUACAO.PAGO && l.tipo === TIPO.RECEITA && l.dataPagamento === hoje; }),
    pagoHoje: todos.filter(function (l) { return l.situacao === SITUACAO.PAGO && l.tipo === TIPO.DESPESA && l.dataPagamento === hoje; })
  };
  var totais = {};
  Object.keys(r).forEach(function (k) {
    totais[k] = somar_(r[k], function (l) { return l.situacao === SITUACAO.PAGO ? l.valorPago : l.valor; });
  });
  r.totais = totais;
  return r;
}

/** Clientes com recebimentos vencidos e não baixados (todos os meses). */
function inadimplentes_(todos, hoje) {
  var grupos = {};
  todos.forEach(function (l) {
    if (l.tipo !== TIPO.RECEITA || l.situacao !== SITUACAO.ABERTO || l.vencimento >= hoje) return;
    var k = normalizar_(l.contraparte);
    if (!grupos[k]) grupos[k] = { contraparte: l.contraparte, itens: [] };
    grupos[k].itens.push(l);
  });
  return Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    g.itens.sort(function (a, b) { return a.vencimento < b.vencimento ? -1 : 1; });
    g.total = somar_(g.itens, function (l) { return l.valor; });
    g.quantidade = g.itens.length;
    g.maisAntigo = g.itens[0].vencimento;
    g.diasAtraso = diferencaDias_(g.maisAntigo, hoje);
    return g;
  }).sort(function (a, b) { return b.total - a.total || b.diasAtraso - a.diasAtraso; });
}

/** Totais de um tipo no mês. */
function totaisTipo_(lista, hoje) {
  var pagos = lista.filter(function (l) { return l.situacao === SITUACAO.PAGO; });
  var abertos = lista.filter(function (l) { return l.situacao === SITUACAO.ABERTO; });
  var vencidos = abertos.filter(function (l) { return l.vencimento < hoje; });
  var aVencer = abertos.filter(function (l) { return l.vencimento >= hoje; });
  return {
    previsto: somar_(lista, valorEfetivo_),
    realizado: somar_(pagos, function (l) { return l.valorPago; }),
    emAberto: somar_(abertos, function (l) { return l.valor; }),
    vencido: somar_(vencidos, function (l) { return l.valor; }),
    aVencer: somar_(aVencer, function (l) { return l.valor; }),
    qtd: lista.length,
    qtdPagos: pagos.length,
    qtdVencidos: vencidos.length
  };
}

/**
 * DRE gerencial do mês. "Projetado" usa o valor pago quando houve baixa e o
 * previsto nos demais; "Realizado" considera só as baixas.
 */
function dre_(doMes, mapaCat) {
  var por = {};
  GRUPOS.forEach(function (g) { por[g.key] = { projetado: 0, realizado: 0 }; });
  doMes.forEach(function (l) {
    var g = grupoDoLancamento_(l, mapaCat);
    por[g].projetado += valorEfetivo_(l);
    if (l.situacao === SITUACAO.PAGO) por[g].realizado += Number(l.valorPago || 0);
  });
  var v = function (k, campo) { return centavos_(por[k][campo]); };
  var linha = function (key, nome, natureza, fn) {
    return { key: key, nome: nome, natureza: natureza, projetado: centavos_(fn('projetado')), realizado: centavos_(fn('realizado')) };
  };
  var calc = {};
  ['projetado', 'realizado'].forEach(function (c) {
    var rb = v('HONORARIOS', c) + v('AVULSOS', c);
    var rl = rb - v('DEDUCOES', c);
    var lb = rl - v('CUSTOS', c);
    var desp = v('PESSOAL', c) + v('ADMIN', c) + v('MARKETING', c) + v('TAXAS', c) + v('OUTRAS_DESP', c);
    var ro = lb - desp;
    calc[c] = { rb: rb, rl: rl, lb: lb, desp: desp, ro: ro, res: ro + v('OUTRAS_REC', c) };
  });
  var grupo = function (key) {
    var g = grupoPorChave_(key);
    return linha(key, g.nome, g.tipo === TIPO.RECEITA ? 'receita' : 'despesa', function (c) { return v(key, c); });
  };
  var total = function (key, nome, campo) {
    return linha(key, nome, 'total', function (c) { return calc[c][campo]; });
  };
  var linhas = [
    grupo('HONORARIOS'),
    grupo('AVULSOS'),
    total('RECEITA_BRUTA', 'Receita bruta', 'rb'),
    grupo('DEDUCOES'),
    total('RECEITA_LIQUIDA', 'Receita líquida', 'rl'),
    grupo('CUSTOS'),
    total('LUCRO_BRUTO', 'Lucro bruto', 'lb'),
    grupo('PESSOAL'),
    grupo('ADMIN'),
    grupo('MARKETING'),
    grupo('TAXAS'),
    grupo('OUTRAS_DESP'),
    total('RESULTADO_OPERACIONAL', 'Resultado operacional', 'ro'),
    grupo('OUTRAS_REC'),
    total('RESULTADO', 'Resultado do mês', 'res')
  ];
  linhas.forEach(function (l) {
    l.percentual = calc.projetado.rb ? Math.round(l.projetado / calc.projetado.rb * 1000) / 10 : null;
  });
  return {
    linhas: linhas,
    foraDoResultado: {
      entradas: { projetado: v('NAO_OPER_E', 'projetado'), realizado: v('NAO_OPER_E', 'realizado') },
      saidas: { projetado: v('NAO_OPER_S', 'projetado'), realizado: v('NAO_OPER_S', 'realizado') }
    },
    margemProjetada: calc.projetado.rb ? Math.round(calc.projetado.res / calc.projetado.rb * 1000) / 10 : null,
    margemRealizada: calc.realizado.rb ? Math.round(calc.realizado.res / calc.realizado.rb * 1000) / 10 : null
  };
}

/**
 * Saldo diário do mês. Até hoje: o que foi efetivamente baixado. Depois de hoje:
 * as previsões em aberto. Critério conservador: recebimentos em atraso NÃO entram
 * na projeção; pagamentos em atraso entram como se fossem pagos hoje.
 */
function serieSaldo_(todos, mes, hoje, saldoInicial) {
  var dias = diasNoMes_(mes);
  var mov = [];
  for (var d = 0; d <= dias; d++) mov.push({ entradas: 0, saidas: 0 });
  var primeiro = mes + '-01', ultimo = mes + '-' + pad2_(dias);
  var diaDe = function (data) { return data < primeiro ? 1 : data > ultimo ? dias : Number(data.slice(8, 10)); };
  var somar = function (l, data, valor) {
    var m = mov[diaDe(data)];
    if (l.tipo === TIPO.RECEITA) m.entradas += valor; else m.saidas += valor;
  };
  var atrasadosReceber = 0;
  todos.forEach(function (l) {
    if (l.situacao === SITUACAO.PAGO) {
      if (mesDe_(l.dataPagamento) === mes) somar(l, l.dataPagamento, Number(l.valorPago || 0));
      return;
    }
    if (l.situacao !== SITUACAO.ABERTO) return;
    if (l.vencimento >= hoje) {
      if (mesDe_(l.vencimento) === mes) somar(l, l.vencimento, Number(l.valor));
    } else if (hoje >= primeiro && hoje <= ultimo) {
      if (l.tipo === TIPO.DESPESA) somar(l, hoje, Number(l.valor));
      else atrasadosReceber += Number(l.valor);
    }
  });
  var saldo = saldoInicial;
  var serie = [];
  for (var i = 1; i <= dias; i++) {
    saldo += mov[i].entradas - mov[i].saidas;
    var data = mes + '-' + pad2_(i);
    serie.push({ data: data, entradas: centavos_(mov[i].entradas), saidas: centavos_(mov[i].saidas), saldo: centavos_(saldo), projetado: data > hoje });
  }
  return { serie: serie, atrasadosReceber: centavos_(atrasadosReceber) };
}

/** Despesas do mês por grupo (projetado), para o gráfico de barras. */
function despesasPorGrupo_(doMes, mapaCat) {
  var por = {};
  doMes.forEach(function (l) {
    if (l.tipo !== TIPO.DESPESA) return;
    var g = grupoDoLancamento_(l, mapaCat);
    if (grupoPorChave_(g).foraDoResultado) return;
    por[g] = (por[g] || 0) + valorEfetivo_(l);
  });
  return Object.keys(por).map(function (k) { return { grupo: k, nome: grupoPorChave_(k).nome, valor: centavos_(por[k]) }; })
    .sort(function (a, b) { return b.valor - a.valor; });
}

/** Monta tudo o que a tela precisa para o mês escolhido. */
function montarPainel_(mes, hoje) {
  var mapaCat = mapaCategorias_();
  var todos = lerTodos_(ABAS.LANCAMENTOS).filter(function (l) { return l.situacao !== SITUACAO.CANCELADO; });
  var doMes = todos.filter(function (l) { return mesDe_(l.vencimento) === mes; });
  var visao = function (l) { return visaoLancamento_(l, hoje, mapaCat); };
  var porVenc = function (a, b) { return a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : String(a.contraparte).localeCompare(String(b.contraparte)); };

  var receitas = doMes.filter(function (l) { return l.tipo === TIPO.RECEITA; });
  var despesas = doMes.filter(function (l) { return l.tipo === TIPO.DESPESA; });
  var tr = totaisTipo_(receitas, hoje);
  var td = totaisTipo_(despesas, hoje);
  var saldoIni = saldoInicial_(mes);
  var serie = serieSaldo_(todos, mes, hoje, saldoIni.valor);
  var demonstrativo = dre_(doMes, mapaCat);
  var resultado = demonstrativo.linhas[demonstrativo.linhas.length - 1];

  var vencidoAteHoje = receitas.filter(function (l) { return l.vencimento < hoje; });
  var baseInad = somar_(vencidoAteHoje, function (l) { return l.valor; });

  var agenda = agendaDoDia_(todos, hoje);
  var agendaVisao = { totais: agenda.totais };
  Object.keys(agenda).forEach(function (k) { if (k !== 'totais') agendaVisao[k] = agenda[k].map(visao); });

  var saldoHoje = null;
  if (hoje >= mes + '-01' && mesDe_(hoje) === mes) {
    saldoHoje = serie.serie.filter(function (p) { return p.data === hoje; })[0].saldo;
  }

  return {
    mes: mes,
    hoje: hoje,
    mesAtual: mesDe_(hoje),
    receitas: receitas.sort(porVenc).map(visao),
    despesas: despesas.sort(porVenc).map(visao),
    agenda: agendaVisao,
    inadimplentes: inadimplentes_(todos, hoje).map(function (g) {
      return { contraparte: g.contraparte, total: g.total, quantidade: g.quantidade, maisAntigo: g.maisAntigo, diasAtraso: g.diasAtraso, itens: g.itens.map(visao) };
    }),
    totais: {
      receitas: tr,
      despesas: td,
      resultadoProjetado: resultado.projetado,
      resultadoRealizado: resultado.realizado,
      margemProjetada: demonstrativo.margemProjetada,
      inadimplenciaPercentual: baseInad ? Math.round(tr.vencido / baseInad * 1000) / 10 : 0,
      saldoInicial: saldoIni.valor,
      saldoInformado: saldoIni.informado,
      saldoBase: saldoIni.base,
      saldoHoje: saldoHoje,
      saldoFinalProjetado: serie.serie[serie.serie.length - 1].saldo,
      atrasadosReceber: serie.atrasadosReceber
    },
    dre: demonstrativo,
    serieSaldo: serie.serie,
    despesasPorGrupo: despesasPorGrupo_(doMes, mapaCat),
    recorrencias: recorrencias_().map(visaoRecorrencia_).sort(function (a, b) { return a.contraparte.localeCompare(b.contraparte); })
  };
}
