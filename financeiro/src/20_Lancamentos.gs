/**
 * 20_Lancamentos.gs — Regras de negócio: previsões, baixas, estornos, exclusões,
 * recorrências (honorários e despesas fixas) e geração das previsões do mês.
 *
 * O mês de um lançamento é o mês do vencimento (visão gerencial de caixa projetado).
 */

/** Situação exibida: PAGO, CANCELADO, VENCIDO, HOJE ou A_VENCER. */
function statusDe_(l, hoje) {
  if (l.situacao === SITUACAO.CANCELADO) return STATUS.CANCELADO;
  if (l.situacao === SITUACAO.PAGO) return STATUS.PAGO;
  if (l.vencimento < hoje) return STATUS.VENCIDO;
  if (l.vencimento === hoje) return STATUS.HOJE;
  return STATUS.A_VENCER;
}

/** Valor que conta no resultado: o pago, se já houve baixa; senão o previsto. */
function valorEfetivo_(l) {
  return l.situacao === SITUACAO.PAGO ? Number(l.valorPago || 0) : Number(l.valor || 0);
}

/** Objeto enviado ao navegador (sem campos internos de planilha). */
function visaoLancamento_(l, hoje, mapaCat) {
  var st = statusDe_(l, hoje);
  return {
    id: l.id,
    tipo: l.tipo,
    vencimento: l.vencimento,
    descricao: String(l.descricao || ''),
    contraparte: String(l.contraparte || ''),
    categoria: String(l.categoria || ''),
    grupo: grupoDoLancamento_(l, mapaCat),
    valor: Number(l.valor || 0),
    valorPago: l.situacao === SITUACAO.PAGO ? Number(l.valorPago || 0) : null,
    dataPagamento: l.situacao === SITUACAO.PAGO ? l.dataPagamento : '',
    forma: String(l.forma || ''),
    origem: String(l.origem || ''),
    recorrenciaId: String(l.recorrenciaId || ''),
    observacao: String(l.observacao || ''),
    situacao: l.situacao,
    status: st,
    diasAtraso: st === STATUS.VENCIDO ? diferencaDias_(l.vencimento, hoje) : 0
  };
}

function lancamentoPorId_(id) {
  var l = lerTodos_(ABAS.LANCAMENTOS).filter(function (x) { return x.id === String(id || ''); })[0];
  if (!l) throw new ErroFin('Lançamento não encontrado. Atualize a tela.');
  return l;
}

function validarTipo_(tipo) {
  if (tipo !== TIPO.RECEITA && tipo !== TIPO.DESPESA) throw new ErroFin('Tipo inválido.');
  return tipo;
}

function validarCategoria_(nome, tipo) {
  var c = categoriaPorNome_(nome, tipo);
  if (!c) throw new ErroFin('Escolha uma categoria de ' + (tipo === TIPO.RECEITA ? 'receita' : 'despesa') + '.');
  return c.nome;
}

function validarValorPositivo_(v, rotulo) {
  var n = lerValor_(v);
  if (isNaN(n) || n <= 0) throw new ErroFin('Informe ' + rotulo + ' maior que zero.');
  if (n > 10000000) throw new ErroFin('Valor muito alto. Confira ' + rotulo + '.');
  return n;
}

function validarData_(s, rotulo) {
  if (!ehDataIso_(s)) throw new ErroFin('Informe ' + rotulo + ' válida.');
  return s;
}

function validarForma_(f) {
  f = limparTexto_(f, 40);
  return f && FORMAS.indexOf(f) < 0 ? 'Pix' : (f || 'Pix');
}

/** Cria ou edita uma previsão. Lançamentos pagos aceitam correção dos dados da baixa. */
function salvarLancamento_(dados, usuario) {
  dados = dados || {};
  var tipo = validarTipo_(dados.tipo);
  var registro = {
    vencimento: validarData_(dados.vencimento, 'a data de vencimento'),
    descricao: limparTexto_(dados.descricao, 200),
    contraparte: limparTexto_(dados.contraparte, 120),
    categoria: validarCategoria_(dados.categoria, tipo),
    valor: validarValorPositivo_(dados.valor, 'o valor'),
    forma: validarForma_(dados.forma),
    observacao: limparTexto_(dados.observacao, 500)
  };
  if (!registro.contraparte) throw new ErroFin(tipo === TIPO.RECEITA ? 'Informe o cliente.' : 'Informe o fornecedor.');
  if (!registro.descricao) registro.descricao = registro.categoria;

  if (dados.id) {
    var l = lancamentoPorId_(dados.id);
    if (l.situacao === SITUACAO.CANCELADO) throw new ErroFin('Este lançamento foi excluído.');
    if (l.tipo !== tipo) throw new ErroFin('Não é possível trocar o tipo de um lançamento.');
    Object.keys(registro).forEach(function (k) { l[k] = registro[k]; });
    if (l.situacao === SITUACAO.PAGO) {
      if (dados.valorPago !== undefined && dados.valorPago !== '') l.valorPago = validarValorPositivo_(dados.valorPago, 'o valor pago');
      if (dados.dataPagamento) l.dataPagamento = validarData_(dados.dataPagamento, 'a data do pagamento');
    }
    l.atualizadoEm = agoraIso_();
    l.atualizadoPor = usuario;
    atualizar_(ABAS.LANCAMENTOS, l);
    registrarLog_(usuario, 'EDITAR', l.id, l.contraparte + ' · ' + l.valor);
    return l;
  }

  var novo = Object.assign(registro, {
    id: novoId_('L'),
    tipo: tipo,
    situacao: SITUACAO.ABERTO,
    valorPago: '',
    dataPagamento: '',
    origem: 'MANUAL',
    recorrenciaId: '',
    chave: '',
    criadoEm: agoraIso_(),
    criadoPor: usuario,
    atualizadoEm: agoraIso_(),
    atualizadoPor: usuario
  });
  inserir_(ABAS.LANCAMENTOS, novo);
  registrarLog_(usuario, 'INCLUIR', novo.id, novo.contraparte + ' · ' + novo.valor);
  return novo;
}

/**
 * Baixa (registra o pagamento/recebimento). Se o valor pago for menor que o previsto
 * e "gerarSaldo" for verdadeiro, a diferença vira uma nova previsão em aberto.
 */
function baixar_(id, dados, usuario, hoje) {
  dados = dados || {};
  var l = lancamentoPorId_(id);
  if (l.situacao === SITUACAO.PAGO) throw new ErroFin('Este lançamento já foi baixado.');
  if (l.situacao === SITUACAO.CANCELADO) throw new ErroFin('Este lançamento foi excluído.');
  var valorPago = dados.valorPago === undefined || dados.valorPago === '' ? Number(l.valor) : validarValorPositivo_(dados.valorPago, 'o valor pago');
  var data = dados.dataPagamento ? validarData_(dados.dataPagamento, 'a data do pagamento') : hoje;
  if (data > somarDias_(hoje, 1)) throw new ErroFin('A data do pagamento não pode estar no futuro.');

  var saldo = centavos_(Number(l.valor) - valorPago);
  l.situacao = SITUACAO.PAGO;
  l.valorPago = valorPago;
  l.dataPagamento = data;
  if (dados.forma) l.forma = validarForma_(dados.forma);
  l.atualizadoEm = agoraIso_();
  l.atualizadoPor = usuario;
  atualizar_(ABAS.LANCAMENTOS, l);
  registrarLog_(usuario, 'BAIXAR', l.id, l.contraparte + ' · ' + valorPago + ' em ' + data);

  var restante = null;
  if (dados.gerarSaldo && saldo > 0) {
    restante = {
      id: novoId_('L'), tipo: l.tipo, vencimento: l.vencimento,
      descricao: limparTexto_(l.descricao + ' (saldo)', 200), contraparte: l.contraparte, categoria: l.categoria,
      valor: saldo, situacao: SITUACAO.ABERTO, valorPago: '', dataPagamento: '', forma: l.forma,
      origem: 'SALDO', recorrenciaId: l.recorrenciaId, chave: '', observacao: 'Saldo da baixa parcial de ' + l.id,
      criadoEm: agoraIso_(), criadoPor: usuario, atualizadoEm: agoraIso_(), atualizadoPor: usuario
    };
    inserir_(ABAS.LANCAMENTOS, restante);
    registrarLog_(usuario, 'SALDO', restante.id, 'Saldo de ' + l.id + ': ' + saldo);
  }
  return { lancamento: l, saldo: restante };
}

/** Desfaz a baixa: o lançamento volta a ficar em aberto com o valor previsto original. */
function estornar_(id, usuario) {
  var l = lancamentoPorId_(id);
  if (l.situacao !== SITUACAO.PAGO) throw new ErroFin('Só é possível estornar um lançamento baixado.');
  var antes = l.valorPago + ' em ' + l.dataPagamento;
  l.situacao = SITUACAO.ABERTO;
  l.valorPago = '';
  l.dataPagamento = '';
  l.atualizadoEm = agoraIso_();
  l.atualizadoPor = usuario;
  atualizar_(ABAS.LANCAMENTOS, l);
  registrarLog_(usuario, 'ESTORNAR', l.id, antes);
  return l;
}

/** Exclusão lógica: o lançamento sai das telas e não é recriado pela geração automática. */
function excluir_(id, usuario) {
  var l = lancamentoPorId_(id);
  if (l.situacao === SITUACAO.PAGO) throw new ErroFin('Estorne a baixa antes de excluir este lançamento.');
  if (l.situacao === SITUACAO.CANCELADO) return l;
  l.situacao = SITUACAO.CANCELADO;
  l.atualizadoEm = agoraIso_();
  l.atualizadoPor = usuario;
  atualizar_(ABAS.LANCAMENTOS, l);
  registrarLog_(usuario, 'EXCLUIR', l.id, l.contraparte + ' · ' + l.valor + ' · venc. ' + l.vencimento);
  return l;
}

/* ===================== Recorrências ===================== */

function recorrencias_() {
  return lerTodos_(ABAS.RECORRENCIAS);
}

function recorrenciaAtiva_(r) {
  return String(r.ativo).toLowerCase() !== 'false';
}

function visaoRecorrencia_(r) {
  return {
    id: r.id, tipo: r.tipo, contraparte: String(r.contraparte || ''), descricao: String(r.descricao || ''),
    categoria: String(r.categoria || ''), valor: Number(r.valor || 0), dia: Number(r.dia || 1),
    forma: String(r.forma || ''), inicio: r.inicio, fim: r.fim || '', ativo: recorrenciaAtiva_(r),
    documento: String(r.documento || ''), observacao: String(r.observacao || '')
  };
}

/**
 * Cria ou edita uma recorrência (honorário mensal de cliente ou despesa fixa).
 * Alterações são aplicadas às previsões EM ABERTO deste mês em diante; meses
 * passados e lançamentos já baixados não mudam. Desativar cancela as previsões
 * em aberto dos meses seguintes (a do mês atual fica, para decisão manual).
 */
function salvarRecorrencia_(dados, usuario, hoje) {
  dados = dados || {};
  var tipo = validarTipo_(dados.tipo);
  var mesAtual = mesDe_(hoje);
  var reg = {
    contraparte: limparTexto_(dados.contraparte, 120),
    descricao: limparTexto_(dados.descricao, 200),
    categoria: validarCategoria_(dados.categoria, tipo),
    valor: validarValorPositivo_(dados.valor, 'o valor'),
    dia: parseInt(dados.dia, 10),
    forma: validarForma_(dados.forma),
    inicio: dados.inicio || mesAtual,
    fim: dados.fim || '',
    ativo: dados.ativo === false || String(dados.ativo) === 'false' ? false : true,
    documento: limparTexto_(dados.documento, 30),
    observacao: limparTexto_(dados.observacao, 500)
  };
  if (!reg.contraparte) throw new ErroFin(tipo === TIPO.RECEITA ? 'Informe o cliente.' : 'Informe o fornecedor.');
  if (!(reg.dia >= 1 && reg.dia <= 31)) throw new ErroFin('Informe o dia do vencimento (1 a 31).');
  if (!ehMes_(reg.inicio)) throw new ErroFin('Mês de início inválido.');
  if (reg.fim && !ehMes_(reg.fim)) throw new ErroFin('Mês de término inválido.');
  if (reg.fim && reg.fim < reg.inicio) throw new ErroFin('O término não pode ser antes do início.');
  if (!reg.descricao) reg.descricao = reg.categoria;

  var r;
  if (dados.id) {
    r = recorrencias_().filter(function (x) { return x.id === String(dados.id); })[0];
    if (!r) throw new ErroFin('Cadastro não encontrado. Atualize a tela.');
    if (r.tipo !== tipo) throw new ErroFin('Não é possível trocar o tipo do cadastro.');
    Object.keys(reg).forEach(function (k) { r[k] = reg[k]; });
    r.atualizadoEm = agoraIso_();
    r.atualizadoPor = usuario;
    atualizar_(ABAS.RECORRENCIAS, r);
    registrarLog_(usuario, 'EDITAR_RECORRENCIA', r.id, r.contraparte + ' · ' + r.valor + ' · dia ' + r.dia);
  } else {
    r = Object.assign(reg, { id: novoId_('R'), tipo: tipo, criadoEm: agoraIso_(), atualizadoEm: agoraIso_(), atualizadoPor: usuario });
    inserir_(ABAS.RECORRENCIAS, r);
    registrarLog_(usuario, 'INCLUIR_RECORRENCIA', r.id, r.contraparte + ' · ' + r.valor + ' · dia ' + r.dia);
  }
  propagarRecorrencia_(r, usuario, mesAtual);
  return r;
}

function propagarRecorrencia_(r, usuario, mesAtual) {
  var ativa = recorrenciaAtiva_(r);
  lerTodos_(ABAS.LANCAMENTOS).forEach(function (l) {
    if (l.recorrenciaId !== r.id || l.situacao !== SITUACAO.ABERTO || l.origem !== 'RECORRENTE') return;
    var mesGerado = String(l.chave || '').split('|')[1] || mesDe_(l.vencimento);
    if (mesGerado < mesAtual) return;
    var foraDoPeriodo = mesGerado < r.inicio || (r.fim && mesGerado > r.fim);
    if ((!ativa && mesGerado > mesAtual) || foraDoPeriodo) {
      l.situacao = SITUACAO.CANCELADO;
    } else {
      l.valor = r.valor;
      l.vencimento = dataNoMes_(mesGerado, r.dia);
      l.categoria = r.categoria;
      l.contraparte = r.contraparte;
      l.descricao = r.descricao;
      l.forma = r.forma;
    }
    l.atualizadoEm = agoraIso_();
    l.atualizadoPor = usuario;
    atualizar_(ABAS.LANCAMENTOS, l);
  });
}

/**
 * Gera as previsões do mês a partir das recorrências ativas. Idempotente: a chave
 * "recorrência|mês" garante uma única previsão por mês, mesmo que ela tenha sido
 * excluída ou tenha o vencimento movido para outro mês.
 */
function gerarPrevisoes_(mes, usuario) {
  if (!ehMes_(mes)) throw new ErroFin('Mês inválido.');
  var existentes = {};
  lerTodos_(ABAS.LANCAMENTOS).forEach(function (l) { if (l.chave) existentes[l.chave] = true; });
  var novos = [];
  recorrencias_().forEach(function (r) {
    if (!recorrenciaAtiva_(r)) return;
    if (r.inicio && mes < r.inicio) return;
    if (r.fim && mes > r.fim) return;
    var chave = r.id + '|' + mes;
    if (existentes[chave]) return;
    novos.push({
      id: novoId_('L'), tipo: r.tipo, vencimento: dataNoMes_(mes, r.dia),
      descricao: r.descricao || r.categoria, contraparte: r.contraparte, categoria: r.categoria,
      valor: Number(r.valor), situacao: SITUACAO.ABERTO, valorPago: '', dataPagamento: '', forma: r.forma,
      origem: 'RECORRENTE', recorrenciaId: r.id, chave: chave, observacao: '',
      criadoEm: agoraIso_(), criadoPor: usuario, atualizadoEm: agoraIso_(), atualizadoPor: usuario
    });
  });
  inserirVarios_(ABAS.LANCAMENTOS, novos);
  if (novos.length) registrarLog_(usuario, 'GERAR_MES', mes, novos.length + ' previsões');
  return novos.length;
}

/** Geração automática ao abrir um mês: só do mês atual em diante (até 12 meses). */
function gerarAutomatico_(mes, hoje, usuario) {
  var mesAtual = mesDe_(hoje);
  if (mes < mesAtual || mes > somarMeses_(mesAtual, FIN.MESES_GERACAO_FUTURA)) return 0;
  // Gera também os meses entre o atual e o escolhido, para não deixar buracos.
  var total = 0;
  for (var m = mesAtual; m <= mes; m = somarMeses_(m, 1)) total += gerarPrevisoes_(m, usuario);
  return total;
}

/* ===================== Saldo de caixa ===================== */

/**
 * Saldo de abertura do mês. Usa o valor informado para o mês; se não houver,
 * parte do último mês informado (até 24 meses antes) e soma o realizado
 * (baixas) dos meses intermediários.
 */
function saldoInicial_(mes) {
  var informado = config_('saldoInicial:' + mes);
  if (informado !== '' && informado !== null) return { valor: Number(informado), informado: true, base: mes };
  var lancs = lerTodos_(ABAS.LANCAMENTOS);
  for (var i = 1; i <= 24; i++) {
    var anterior = somarMeses_(mes, -i);
    var v = config_('saldoInicial:' + anterior);
    if (v === '' || v === null) continue;
    var saldo = Number(v);
    lancs.forEach(function (l) {
      if (l.situacao !== SITUACAO.PAGO) return;
      var m = mesDe_(l.dataPagamento || l.vencimento);
      if (m >= anterior && m < mes) saldo += (l.tipo === TIPO.RECEITA ? 1 : -1) * Number(l.valorPago || 0);
    });
    return { valor: centavos_(saldo), informado: false, base: anterior };
  }
  return { valor: 0, informado: false, base: '' };
}

function definirSaldoInicial_(mes, valor, usuario) {
  if (!ehMes_(mes)) throw new ErroFin('Mês inválido.');
  if (valor === '' || valor === null || valor === undefined) {
    definirConfig_('saldoInicial:' + mes, '', usuario);
    return;
  }
  var n = lerValor_(valor);
  if (isNaN(n)) throw new ErroFin('Informe um valor válido.');
  definirConfig_('saldoInicial:' + mes, n, usuario);
  registrarLog_(usuario, 'SALDO_INICIAL', mes, String(n));
}
