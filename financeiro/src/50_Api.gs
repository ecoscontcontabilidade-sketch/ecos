/**
 * 50_Api.gs — Entrada do Web App e funções chamadas pelo navegador.
 *
 * O Web App é publicado "executar como: usuário que acessa". Assim, o Google exige
 * login e cada pessoa só lê/grava a planilha se ela tiver sido compartilhada com
 * ela. Além disso, toda função confere o e-mail contra FIN_EMAILS.
 */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.nome = FIN.NOME;
  return t.evaluate()
    .setTitle(FIN.NOME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include_(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

/** Retorna o e-mail do usuário autorizado ou interrompe a chamada. */
function exigirUsuario_() {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { email = ''; }
  if (!email) throw new ErroFin('Entre com a sua conta Google da equipe para usar o financeiro.');
  var autorizados = usuariosAutorizados_();
  if (autorizados.length && autorizados.indexOf(email) < 0) throw new ErroFin('O e-mail ' + email + ' não tem acesso ao financeiro.');
  return email;
}

/** Valida o usuário, executa e converte exceções em mensagens seguras. */
function executarApi_(nome, fn) {
  try {
    limparMemoria_();
    var usuario = exigirUsuario_();
    return fn(usuario, hojeIso_());
  } catch (e) {
    if (e instanceof ErroFin) throw new Error(e.message);
    console.error(nome + ' — erro inesperado: ' + (e && e.stack ? e.stack : e));
    throw new Error('Não foi possível concluir a operação. Tente novamente em instantes.');
  }
}

function mesValido_(mes, hoje) {
  return ehMes_(mes) ? mes : mesDe_(hoje);
}

/** Recarrega a base e devolve o painel do mês (após qualquer alteração). */
function painelAtualizado_(mes, hoje, usuario) {
  limparMemoria_();
  var p = montarPainel_(mes, hoje);
  p.usuario = usuario;
  p.categorias = categorias_();
  p.grupos = GRUPOS.map(function (g) { return { key: g.key, nome: g.nome, tipo: g.tipo, foraDoResultado: !!g.foraDoResultado }; });
  p.formas = FORMAS;
  p.proprietario = usuario === prop_('PROPRIETARIO', '').toLowerCase();
  return p;
}

/* =================== Funções do navegador =================== */

/** Carrega o mês (gera automaticamente as previsões recorrentes do mês atual em diante). */
function finCarregar(mes) {
  return executarApi_('finCarregar', function (usuario, hoje) {
    mes = mesValido_(mes, hoje);
    comLock_(function () { gerarAutomatico_(mes, hoje, usuario); });
    return painelAtualizado_(mes, hoje, usuario);
  });
}

function finSalvarLancamento(dados, mes) {
  return executarApi_('finSalvarLancamento', function (usuario, hoje) {
    comLock_(function () { salvarLancamento_(dados, usuario); });
    return painelAtualizado_(mesValido_(mes, hoje), hoje, usuario);
  });
}

function finBaixar(id, dados, mes) {
  return executarApi_('finBaixar', function (usuario, hoje) {
    comLock_(function () { baixar_(id, dados, usuario, hoje); });
    return painelAtualizado_(mesValido_(mes, hoje), hoje, usuario);
  });
}

function finEstornar(id, mes) {
  return executarApi_('finEstornar', function (usuario, hoje) {
    comLock_(function () { estornar_(id, usuario); });
    return painelAtualizado_(mesValido_(mes, hoje), hoje, usuario);
  });
}

function finExcluir(id, mes) {
  return executarApi_('finExcluir', function (usuario, hoje) {
    comLock_(function () { excluir_(id, usuario); });
    return painelAtualizado_(mesValido_(mes, hoje), hoje, usuario);
  });
}

function finSalvarRecorrencia(dados, mes) {
  return executarApi_('finSalvarRecorrencia', function (usuario, hoje) {
    mes = mesValido_(mes, hoje);
    comLock_(function () {
      salvarRecorrencia_(dados, usuario, hoje);
      gerarAutomatico_(mes, hoje, usuario);
    });
    return painelAtualizado_(mes, hoje, usuario);
  });
}

/** Gera as previsões de um mês qualquer (inclusive meses passados, sob pedido). */
function finGerarPrevisoes(mes) {
  return executarApi_('finGerarPrevisoes', function (usuario, hoje) {
    mes = mesValido_(mes, hoje);
    var n = comLock_(function () { return gerarPrevisoes_(mes, usuario); });
    var p = painelAtualizado_(mes, hoje, usuario);
    p.aviso = n ? n + (n === 1 ? ' previsão gerada.' : ' previsões geradas.') : 'Nenhuma previsão nova: o mês já estava completo.';
    return p;
  });
}

function finDefinirSaldoInicial(mes, valor) {
  return executarApi_('finDefinirSaldoInicial', function (usuario, hoje) {
    mes = mesValido_(mes, hoje);
    comLock_(function () { definirSaldoInicial_(mes, valor, usuario); });
    return painelAtualizado_(mes, hoje, usuario);
  });
}

/**
 * Importa o Dashboard Financeiro (HTML). O navegador lê o arquivo e envia o objeto DATA.d;
 * só a conta proprietária pode importar.
 */
function finImportarDashboard(dados) {
  return executarApi_('finImportarDashboard', function (usuario, hoje) {
    if (usuario !== prop_('PROPRIETARIO', '').toLowerCase()) throw new ErroFin('Somente a conta proprietária pode importar dados.');
    var r = comLock_(function () {
      var res = importarDashboard_(dados, usuario);
      gerarAutomatico_(mesDe_(hoje), hoje, usuario);
      return res;
    });
    var p = painelAtualizado_(mesDe_(hoje), hoje, usuario);
    p.importacao = r;
    return p;
  });
}
