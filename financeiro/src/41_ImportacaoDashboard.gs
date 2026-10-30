/**
 * 41_ImportacaoDashboard.gs — Importa o "Dashboard Financeiro Ecos 2026" (HTML com a
 * conciliação C6 Bank × Asaas). É a fonte mais completa: cada lançamento bancário já
 * vem classificado, os clientes estão identificados e a inadimplência foi conferida
 * contra os Pix recebidos.
 *
 * O arquivo é lido no navegador (o app não precisa de acesso ao Drive) e só a conta
 * proprietária pode importar. O que entra:
 *  1. Todos os lançamentos como BAIXADOS, com a categoria convertida para a DRE.
 *     Transferências entre contas próprias (Asaas → C6) ficam de fora: o recebimento
 *     já conta quando entra no Asaas.
 *  2. Clientes recorrentes (pagamento em 3 meses ou mais, sem ter parado) e despesas
 *     fixas, a partir dos 3 últimos meses fechados. Quem já pagou no mês em curso só
 *     começa a gerar previsão no mês seguinte.
 *  3. A inadimplência real (cobranças sem pagamento nem por Asaas nem por Pix) como
 *     previsões vencidas em aberto.
 *  4. O saldo inicial de cada mês, pelo extrato do C6.
 */

var LIMITE_LINHAS_DASHBOARD = 20000;

/** Converte categoria/subcategoria do dashboard para o plano de categorias. null = não importar. */
function categoriaDashboard_(cat, sub, valor, nome, recorrentes) {
  var c = normalizar_(cat), s = normalizar_(sub), entrada = valor > 0;
  if (c === 'transferencia interna') return null;
  if (c === 'receita de servicos') {
    if (/parceria|terceiriza/.test(s)) return 'Parcerias e terceirização';
    if (/certificado/.test(s)) return 'Certificado digital';
    if (/altera|abertura|baixa/.test(s)) return 'Abertura, alteração e baixa';
    if (/honorario/.test(s)) return recorrentes[normalizar_(nome)] ? 'Honorários mensais' : 'Outros serviços avulsos';
    return 'Outros serviços avulsos';
  }
  if (c === 'remuneracao dos socios') return 'Pró-labore / distribuição';
  if (c === 'folha e equipe') return 'Salários';
  if (c === 'entrada de socio') return 'Aporte / transferência recebida';
  if (c === 'aplicacao financeira') return entrada ? 'Resgate de aplicação' : 'Reserva / aplicação';
  if (c === 'estornos') return entrada ? 'Estornos e devoluções recebidas' : 'Estornos e devoluções enviadas';
  if (c === 'repasse de gateway') return 'Outras receitas';
  if (entrada) return 'Outras receitas';
  if (c === 'marketing') return /trafego|meta|midia/.test(s) ? 'Mídia paga' : /impresso/.test(s) ? 'Material impresso' : 'Agência de marketing';
  if (c === 'sistemas e softwares') return 'Softwares e sistemas';
  if (c === 'impostos') {
    if (/\bdas\b/.test(s)) return 'Simples Nacional (DAS)';
    if (/dare/.test(s)) return 'Taxas e DAREs de processos';
    if (/municipal/.test(s)) return 'Tributos municipais';
    return 'DARF (tributos federais)';
  }
  if (c === 'custo direto de servico') return 'Certificados digitais (custo)';
  if (c === 'servicos de terceiros') return /parceir/.test(s) ? 'Comissões e parcerias' : 'Serviços de terceiros';
  if (c === 'custos financeiros') return /saque/.test(s) ? 'Retirada / transferência enviada' : 'Tarifas bancárias e de cobrança';
  if (c === 'despesas a esclarecer') return 'A esclarecer';
  if (c === 'alimentacao') return 'Alimentação';
  if (c === 'deslocamento') return 'Transporte';
  if (c === 'material/equipamentos') return 'Material de escritório';
  if (c === 'capacitacao') return 'Cursos e treinamentos';
  if (c === 'telefonia/internet') return 'Internet e telefone';
  return 'Outras despesas';
}

function mediana_(lista) {
  var v = lista.slice().sort(function (a, b) { return a - b; });
  if (!v.length) return 0;
  var m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Nome do dashboard ("ALFA CELULARES LTDA") em formato legível ("Alfa Celulares LTDA"), preservando siglas curtas. */
function nomeLegivel_(nome) {
  return limparTexto_(nome, 120).toLowerCase().replace(/(^|[\s\-\/(])([a-zà-ú])/g, function (m, a, b) { return a + b.toUpperCase(); })
    .replace(/\b(Ltda|Me|Eireli|Epp|Sa)\b/g, function (m) { return m.toUpperCase(); })
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, function (m) { return m.toLowerCase(); });
}

/** Qual importação já foi feita: 'PLANILHA' (fluxo de caixa), 'DASHBOARD' ou ''. */
function origemImportada_() {
  var lancs = lerTodos_(ABAS.LANCAMENTOS);
  for (var i = 0; i < lancs.length; i++) {
    var ch = String(lancs[i].chave || '');
    if (ch.indexOf('IMP|') === 0) return 'PLANILHA';
    if (ch.indexOf('DASH|') === 0) return 'DASHBOARD';
  }
  return '';
}

function validarDadosDashboard_(d) {
  if (!d || !Array.isArray(d.aud) || !d.aud.length) throw new ErroFin('Arquivo sem os lançamentos do dashboard (DATA.d.aud).');
  if (d.aud.length > LIMITE_LINHAS_DASHBOARD) throw new ErroFin('Arquivo grande demais para importar de uma vez.');
  if (!Array.isArray(d.clientes)) throw new ErroFin('Arquivo sem a lista de clientes (DATA.d.clientes).');
}

/**
 * Importa os dados do dashboard. "d" é o objeto DATA.d do HTML.
 * Pode ser executada de novo: lançamentos, cadastros e pendências já importados são ignorados.
 */
function importarDashboard_(d, usuario) {
  validarDadosDashboard_(d);
  if (origemImportada_() === 'PLANILHA') {
    throw new ErroFin('A planilha de fluxo de caixa já foi importada. Importar o dashboard por cima duplicaria os valores.');
  }

  var churn = {};
  (d.churn || []).forEach(function (n) { churn[normalizar_(n)] = true; });
  var recorrentes = {};
  d.clientes.forEach(function (c) {
    if ((c.meses || []).length >= 3 && !churn[normalizar_(c.nome)]) recorrentes[normalizar_(c.nome)] = true;
  });

  // O extrato traz o nome como veio no Pix/boleto ("12.345.678 MARIA SOUZA…"); o dashboard já
  // associou cada pagamento a um cliente. O nome do cliente é localizado por data + valor.
  var pagamentoCliente = {};
  d.clientes.forEach(function (c) {
    (c.pgtos || []).forEach(function (pg) {
      var k = pg[0] + '|' + centavos_(pg[1]);
      (pagamentoCliente[k] = pagamentoCliente[k] || []).push(c.nome);
    });
  });
  function nomeDoCliente(a) {
    var candidatos = pagamentoCliente[a[0] + '|' + centavos_(a[4])] || [];
    if (candidatos.length === 1) return candidatos[0];
    var palavras = normalizar_(a[7] + ' ' + a[3]).split(' ');
    return candidatos.filter(function (n) {
      return normalizar_(n).split(' ').some(function (w) { return w.length > 3 && palavras.indexOf(w) >= 0; });
    })[0] || a[7];
  }

  // 1. Lançamentos realizados
  var existentes = {};
  lerTodos_(ABAS.LANCAMENTOS).forEach(function (l) { if (l.chave) existentes[l.chave] = true; });
  var novos = [], ignorados = 0, foraDeEscopo = 0, ocorrencias = {};
  d.aud.forEach(function (a) {
    var data = String(a[0] || ''), conta = limparTexto_(a[1], 20), valor = Number(a[4]);
    if (!ehDataIso_(data) || !valor || isNaN(valor)) return;
    var nome = valor > 0 && normalizar_(a[5]) === 'receita de servicos' ? nomeDoCliente(a) : a[7];
    var categoria = categoriaDashboard_(a[5], a[6], valor, nome, recorrentes);
    if (!categoria) { foraDeEscopo++; return; }
    var chave = 'DASH|' + data + '|' + centavos_(valor) + '|' + normalizar_(a[3]);
    ocorrencias[chave] = (ocorrencias[chave] || 0) + 1;
    chave += '|' + ocorrencias[chave];
    if (existentes[chave]) { ignorados++; return; }
    var tipo = valor > 0 ? TIPO.RECEITA : TIPO.DESPESA;
    var v = centavos_(Math.abs(valor));
    var meio = normalizar_(a[2]);
    var forma = conta === 'Asaas' ? 'Asaas' : /cartao/.test(meio) ? 'Cartão' : /pagamento|boleto/.test(meio) ? 'Boleto' : 'Pix';
    var obs = 'Extrato ' + conta + ': ' + limparTexto_(a[3], 200) + ' · ' + limparTexto_(a[5], 60) + ' / ' + limparTexto_(a[6], 80) +
      (a[8] && a[8] !== 'alta' ? ' · confiança ' + a[8] : '');
    novos.push({
      id: novoId_('L'), tipo: tipo, vencimento: data,
      descricao: limparTexto_(a[6] || a[5], 200), contraparte: nomeLegivel_(nome || a[3]), categoria: categoria,
      valor: v, situacao: SITUACAO.PAGO, valorPago: v, dataPagamento: data, forma: forma,
      origem: 'IMPORTADO', recorrenciaId: '', chave: chave, observacao: limparTexto_(obs, 500),
      criadoEm: agoraIso_(), criadoPor: usuario, atualizadoEm: agoraIso_(), atualizadoPor: usuario
    });
  });
  inserirVarios_(ABAS.LANCAMENTOS, novos);

  var importados = lerTodos_(ABAS.LANCAMENTOS).filter(function (l) { return String(l.chave || '').indexOf('DASH|') === 0; });
  var ultimaData = importados.map(function (l) { return l.vencimento; }).sort().pop() || hojeIso_();
  var mesEmCurso = mesDe_(ultimaData);

  // 2. Recorrências
  var sugeridas = recorrenciasDoDashboard_(importados, recorrentes, mesEmCurso, usuario);

  // 3. Inadimplência real
  var pendencias = inadimplenciaDoDashboard_(d.dev || [], recorrentes, usuario);

  // 4. Saldo inicial de cada mês (extrato C6)
  var ano = ultimaData.slice(0, 4), saldos = 0;
  var abrev = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  (d.fluxo || []).forEach(function (f) {
    var i = abrev.indexOf(normalizar_(f.mes).slice(0, 3));
    if (i < 0 || typeof f.ini !== 'number') return;
    var mes = ano + '-' + pad2_(i + 1);
    if (config_('saldoInicial:' + mes) !== '') return;
    definirConfig_('saldoInicial:' + mes, centavos_(f.ini), usuario);
    saldos++;
  });

  var baixarNoAsaas = (d.qui || []).map(function (q) {
    return { cliente: nomeLegivel_(q.grupo), emAberto: centavos_(q.aberto_asaas), pagoPorPix: centavos_(q.pago_pix) };
  });
  var r = {
    importados: novos.length, ignorados: ignorados, transferenciasInternas: foraDeEscopo,
    clientes: sugeridas.clientes, despesasFixas: sugeridas.despesas, emAtraso: pendencias.quantidade,
    valorEmAtraso: pendencias.total, saldosIniciais: saldos, mesEmCurso: mesEmCurso, baixarNoAsaas: baixarNoAsaas
  };
  registrarLog_(usuario, 'IMPORTAR_DASHBOARD', '', JSON.stringify(r).slice(0, 480));
  return r;
}

/**
 * Clientes: recorrentes que pagaram honorários em algum dos 3 meses fechados; valor =
 * mediana dos pagamentos (resiste a um mês com serviço extra), dia = mediana dos dias.
 * Despesas: mesmo fornecedor e categoria em 2 dos 3 meses; valor = mediana dos totais mensais.
 */
function recorrenciasDoDashboard_(importados, recorrentes, mesEmCurso, usuario) {
  var janela = [somarMeses_(mesEmCurso, -3), somarMeses_(mesEmCurso, -2), somarMeses_(mesEmCurso, -1)];
  var jaCadastrados = {};
  recorrencias_().forEach(function (r) { jaCadastrados[r.tipo + '|' + normalizar_(r.contraparte)] = true; });
  var mapaCat = mapaCategorias_();

  var grupos = {}, pagouNoMesEmCurso = {};
  importados.forEach(function (l) {
    var m = mesDe_(l.vencimento), nome = normalizar_(l.contraparte);
    if (m === mesEmCurso) pagouNoMesEmCurso[l.tipo + '|' + nome + '|' + l.categoria] = true;
    // Receitas: o mês em curso também conta (cliente que pagou em julho e em outubro segue ativo).
    if (janela.indexOf(m) < 0 && !(l.tipo === TIPO.RECEITA && m === mesEmCurso)) return;
    if (l.tipo === TIPO.RECEITA && (l.categoria !== 'Honorários mensais' || !recorrentes[nome])) return;
    if (l.tipo === TIPO.DESPESA) {
      if (CATEGORIAS_NAO_RECORRENTES.indexOf(l.categoria) >= 0) return;
      if (grupoPorChave_(grupoDoLancamento_(l, mapaCat)).foraDoResultado) return;
    }
    var k = l.tipo + '|' + nome + '|' + l.categoria;
    if (!grupos[k]) grupos[k] = { tipo: l.tipo, contraparte: l.contraparte, categoria: l.categoria, descricao: l.descricao, porMes: {}, pagamentos: [] };
    (grupos[k].porMes[m] = grupos[k].porMes[m] || []).push(l);
    grupos[k].pagamentos.push(l);
  });

  var criados = { clientes: 0, despesas: 0 };
  Object.keys(grupos).sort().forEach(function (k) {
    var g = grupos[k];
    var meses = Object.keys(g.porMes).sort();
    if (g.tipo === TIPO.DESPESA && meses.length < 2) return;
    if (g.tipo === TIPO.RECEITA && meses[meses.length - 1] < janela[1]) return; // parou de pagar
    // O valor vem dos meses fechados; o mês em curso só entra se for o único com pagamento.
    var base = g.pagamentos.filter(function (l) { return mesDe_(l.vencimento) !== mesEmCurso; });
    if (!base.length) base = g.pagamentos;
    if (jaCadastrados[g.tipo + '|' + normalizar_(g.contraparte)]) return;
    var valor = g.tipo === TIPO.RECEITA
      ? mediana_(base.map(function (l) { return Number(l.valor); }))
      : mediana_(meses.map(function (m) { return g.porMes[m].reduce(function (s, l) { return s + Number(l.valor); }, 0); }));
    var dias = meses.map(function (m) {
      var ls = g.porMes[m].map(function (l) { return Number(l.vencimento.slice(8, 10)); }).sort(function (a, b) { return a - b; });
      return g.tipo === TIPO.RECEITA ? ls[ls.length - 1] : ls[0];
    });
    var ultimo = g.pagamentos.sort(function (a, b) { return a.vencimento < b.vencimento ? -1 : 1; })[g.pagamentos.length - 1];
    var inicio = pagouNoMesEmCurso[k] ? somarMeses_(mesEmCurso, 1) : mesEmCurso;
    inserir_(ABAS.RECORRENCIAS, {
      id: novoId_('R'), tipo: g.tipo, contraparte: g.contraparte,
      descricao: g.tipo === TIPO.RECEITA ? 'Honorários mensais' : g.descricao || g.categoria,
      categoria: g.categoria, valor: centavos_(valor), dia: Math.round(mediana_(dias)),
      forma: ultimo.forma || 'Pix', inicio: inicio, fim: '', ativo: true, documento: '',
      observacao: 'Sugerido pela importação do dashboard (' + meses.length + ' de 3 meses' +
        (pagouNoMesEmCurso[k] ? '; já pago em ' + mesEmCurso.slice(5, 7) + '/' + mesEmCurso.slice(0, 4) : '') + ')',
      criadoEm: agoraIso_(), atualizadoEm: agoraIso_(), atualizadoPor: usuario
    });
    jaCadastrados[g.tipo + '|' + normalizar_(g.contraparte)] = true;
    if (g.tipo === TIPO.RECEITA) criados.clientes++; else criados.despesas++;
  });
  return criados;
}

/**
 * Cobranças sem pagamento ("Quem realmente deve"). O que o cliente pagou abate as
 * cobranças mais antigas primeiro; o que sobra vira previsão vencida em aberto.
 */
function inadimplenciaDoDashboard_(dev, recorrentes, usuario) {
  var existentes = {};
  lerTodos_(ABAS.LANCAMENTOS).forEach(function (l) { if (l.chave) existentes[l.chave] = true; });
  var novos = [], total = 0;
  dev.forEach(function (g) {
    var cobs = (g.cobs || []).filter(function (c) { return ehDataIso_(c[0]) && Number(c[1]) > 0; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var pago = centavos_(cobs.reduce(function (s, c) { return s + Number(c[1]); }, 0) - Number(g.saldo || 0));
    cobs.forEach(function (c) {
      var valor = Number(c[1]);
      var abatido = Math.min(pago, valor);
      pago = centavos_(pago - abatido);
      var resta = centavos_(valor - abatido);
      if (resta <= 0) return;
      var chave = 'DASH|DEV|' + normalizar_(g.grupo) + '|' + c[0];
      if (existentes[chave]) return;
      existentes[chave] = true;
      total += resta;
      novos.push({
        id: novoId_('L'), tipo: TIPO.RECEITA, vencimento: c[0], descricao: 'Honorários — cobrança Asaas sem pagamento',
        contraparte: nomeLegivel_(g.grupo), categoria: recorrentes[normalizar_(g.grupo)] ? 'Honorários mensais' : 'Outros serviços avulsos',
        valor: resta, situacao: SITUACAO.ABERTO, valorPago: '', dataPagamento: '', forma: 'Asaas',
        origem: 'IMPORTADO', recorrenciaId: '', chave: chave,
        observacao: 'Conciliação Asaas × Pix: cobrança de ' + valor + (resta < valor ? ', parcialmente paga' : '') + '. Não recebido nem por Asaas nem por Pix.',
        criadoEm: agoraIso_(), criadoPor: usuario, atualizadoEm: agoraIso_(), atualizadoPor: usuario
      });
    });
  });
  inserirVarios_(ABAS.LANCAMENTOS, novos);
  return { quantidade: novos.length, total: centavos_(total) };
}
