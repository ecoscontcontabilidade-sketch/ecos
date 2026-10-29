/**
 * 50_Notificacoes.gs — E-mails ao cliente com prevenção de duplicidade.
 *
 * Regras:
 *  - uma notificação por evento de mudança (chave = eventoId);
 *  - o registro é criado como ENVIANDO antes do envio; se a execução cair no
 *    meio, o registro fica ENVIANDO e NÃO é reenviado automaticamente — a equipe
 *    decide no painel (reenvio controlado);
 *  - ENVIADO significa "aceito pelo serviço de e-mail do Google", não "entregue";
 *  - sem e-mail válido: registra SEM_EMAIL, sinaliza pendência e não bloqueia a
 *    atualização de status.
 */

/** ctx: { eventoId, proc, linha, anteriorKey, novoKey, usuario } */
function notificar_(ctx) {
  var existente = notificacaoPorEvento_(ctx.eventoId);
  if (existente) return existente;

  var p = ctx.proc;
  var n = {
    id: tokenAleatorio_().slice(0, 20),
    eventoId: ctx.eventoId,
    taskId: p.taskId,
    criadoEm: agora_(),
    destinatario: mascararEmail_(p.email),
    destinatarioHash: p.email ? hashComSal_(String(p.email).trim().toLowerCase()) : '',
    statusAnterior: ctx.anteriorKey || '',
    statusNovo: ctx.novoKey,
    situacao: SITUACAO_NOTIF.ENVIANDO,
    tentativas: 0,
    ultimaTentativa: '',
    erro: '',
    usuario: ctx.usuario || 'sistema'
  };

  if (!propBool_('NOTIFICACOES_ATIVAS')) {
    n.situacao = SITUACAO_NOTIF.DESATIVADA;
    n.erro = 'Notificações desativadas na configuração (NOTIFICACOES_ATIVAS).';
    inserir_(ABAS.NOTIFICACOES, n);
    concluirNotificacao_(n, ctx.linha);
    return n;
  }
  if (!emailValido_(p.email)) {
    n.situacao = SITUACAO_NOTIF.SEM_EMAIL;
    n.erro = p.email ? 'E-mail do cliente inválido.' : 'Processo sem e-mail do cliente cadastrado no ClickUp.';
    inserir_(ABAS.NOTIFICACOES, n);
    concluirNotificacao_(n, ctx.linha);
    return n;
  }

  inserir_(ABAS.NOTIFICACOES, n);
  tentarEnvio_(n, p, ctx.linha, ctx.anteriorKey, ctx.novoKey);
  return n;
}

function tentarEnvio_(n, p, linha, anteriorKey, novoKey) {
  n.tentativas = (Number(n.tentativas) || 0) + 1;
  n.ultimaTentativa = agora_();
  n.situacao = SITUACAO_NOTIF.ENVIANDO;
  n.erro = '';
  atualizar_(ABAS.NOTIFICACOES, n);
  try {
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Cota diária de envio de e-mails esgotada.');
    enviarEmailStatus_(p, linha, anteriorKey, novoKey);
    n.situacao = SITUACAO_NOTIF.ENVIADO;
  } catch (e) {
    n.situacao = SITUACAO_NOTIF.FALHOU;
    n.erro = limparTexto_(e.message || String(e), 300);
    console.error('Falha ao enviar e-mail (notificação ' + n.id + '): ' + n.erro);
  }
  atualizar_(ABAS.NOTIFICACOES, n);
  concluirNotificacao_(n, linha);
  return n;
}

/** Reflete o resultado no processo (painel) e no evento de origem (histórico). */
function concluirNotificacao_(n, linha) {
  if (linha) {
    linha.ultimaNotificacao = n.situacao + ' ' + fmtDataHora_(Number(n.ultimaTentativa) || Number(n.criadoEm));
    linha.pendenciaEmail = n.situacao === SITUACAO_NOTIF.SEM_EMAIL || simNao_(linha.pendenciaEmail);
    if (linha._linha) atualizar_(ABAS.PROCESSOS, linha);
  }
  try {
    var sh = aba_(ABAS.EVENTOS);
    if (sh.getLastRow() < 2) return;
    var cel = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(n.eventoId)).matchEntireCell(true).findNext();
    if (cel) sh.getRange(cel.getRow(), ABAS.EVENTOS.colunas.indexOf('notificacao') + 1).setValue(n.situacao);
  } catch (e) {
    console.warn('Não foi possível atualizar o evento da notificação: ' + e.message);
  }
}

/**
 * Reenvio controlado (painel). Só reenvia se o processo ainda estiver no mesmo
 * status da notificação. ENVIADO/ENVIANDO exigem confirmação explícita (forcar).
 */
function reenviarNotificacao_(notifId, usuario, forcar) {
  var n = notificacaoPorId_(notifId);
  if (!n) throw new ErroApp('Notificação não encontrada.', 'NAO_ENCONTRADO');
  if ((n.situacao === SITUACAO_NOTIF.ENVIADO || n.situacao === SITUACAO_NOTIF.ENVIANDO) && !forcar) {
    throw new ErroApp('Esta notificação já consta como ' + n.situacao + '. Confirme o reenvio para prosseguir.', 'CONFIRMAR');
  }
  var linha = processoPorTask_(n.taskId);
  if (!linha || !linha.ativo) throw new ErroApp('O processo não está mais em acompanhamento.', 'VALIDACAO');
  var p = mapearTarefa_(cuTarefa_(n.taskId), contextoMapeamento_());
  var atual = p.statusKey || linha.statusFluxo;
  if (atual !== String(n.statusNovo)) {
    throw new ErroApp('O status do processo mudou desde esta notificação; ela não pode ser reenviada.', 'VALIDACAO');
  }
  if (!emailValido_(p.email)) {
    throw new ErroApp('O processo continua sem e-mail válido no ClickUp. Cadastre o e-mail e tente novamente.', 'VALIDACAO');
  }
  n.destinatario = mascararEmail_(p.email);
  n.destinatarioHash = hashComSal_(String(p.email).trim().toLowerCase());
  n.usuario = usuario;
  tentarEnvio_(n, p, linha, String(n.statusAnterior), String(n.statusNovo));
  registrarEvento_({ taskId: n.taskId, codigo: linha.codigo, tipo: 'NOTIFICACAO_REENVIADA', origem: 'PLATAFORMA', usuario: usuario,
    notificacao: n.situacao, detalhe: 'Reenvio da notificação ' + n.id + (forcar ? ' (confirmado)' : '') });
  return n;
}

/* ---------- Montagem e envio ---------- */

function dadosEmailStatus_(p, linha, anteriorKey, novoKey) {
  var msgs = mensagens_();
  var m = msgs[novoKey];
  var st = statusPorChave_(novoKey);
  var direcao = direcaoMudanca_(anteriorKey, novoKey);
  var titulo = direcao === 'retrocesso' ? 'Seu processo foi atualizado' : m.tituloEmail;
  return {
    nomeExibicao: prop_('NOME_EXIBICAO'),
    assinatura: prop_('ASSINATURA'),
    saudacao: p.nomeCliente ? 'Olá, ' + p.nomeCliente + '.' : 'Olá!',
    empresa: p.empresa,
    titulo: titulo,
    processo: p.tipo || p.nomeLegivel,
    status: st.nome,
    grupo: st.grupo,
    dataHora: fmtDataHora_(agora_()),
    mensagem: m.mensagem,
    orientacao: novoKey === 'EXIGENCIA' ? limparTexto_(p.orientacao, 2000) : '',
    proximosPassos: novoKey === 'DEFERIDO' ? m.proximosPassos : '',
    link: linkAcompanhamento_(linha.codigo),
    codigo: linha.codigo,
    whatsapp: linkWhatsApp_('Olá! Gostaria de falar sobre o processo ' + linha.codigo + '.'),
    contatoEmail: prop_('CONTATO_EMAIL'),
    contatoTelefone: prop_('CONTATO_TELEFONE'),
    temLogo: false
  };
}

function enviarEmailStatus_(p, linha, anteriorKey, novoKey) {
  var d = dadosEmailStatus_(p, linha, anteriorKey, novoKey);
  var logo = logoBlob_();
  d.temLogo = !!logo;
  var t = HtmlService.createTemplateFromFile('EmailStatus');
  t.d = d;
  var html = t.evaluate().getContent();
  var texto = [
    d.saudacao, '',
    'Temos uma atualização sobre o processo da empresa ' + d.empresa + '.', '',
    d.titulo, '',
    'Processo: ' + d.processo,
    'Status atual: ' + d.status,
    'Data da atualização: ' + d.dataHora, '',
    d.mensagem,
    d.orientacao ? '\nOrientações: ' + d.orientacao : '',
    d.proximosPassos ? '\nPróximos passos: ' + d.proximosPassos : '', '',
    d.link ? 'Acompanhe seu processo: ' + d.link : '',
    'Código de acompanhamento: ' + d.codigo, '',
    'Se precisar de ajuda, nossa equipe está à disposição.',
    d.nomeExibicao,
    d.assinatura
  ].join('\n');

  var opcoes = {
    to: String(p.email).trim(),
    subject: 'Atualização do seu processo societário | ' + d.nomeExibicao,
    htmlBody: html,
    body: texto,
    name: d.nomeExibicao
  };
  var replyTo = prop_('REPLY_TO', '') || prop_('CONTATO_EMAIL', '');
  if (emailValido_(replyTo)) opcoes.replyTo = replyTo;
  if (logo) opcoes.inlineImages = { logoEcos: logo };
  MailApp.sendEmail(opcoes);
}

/** Envia o código de acesso ao painel. */
function enviarEmailCodigoAcesso_(email, codigo) {
  var nome = prop_('NOME_EXIBICAO');
  var t = HtmlService.createTemplateFromFile('EmailCodigo');
  t.d = { nomeExibicao: nome, codigo: codigo, validadeMin: 10 };
  MailApp.sendEmail({
    to: email,
    subject: 'Código de acesso — ' + APP.NOME + ' | ' + nome,
    htmlBody: t.evaluate().getContent(),
    body: 'Seu código de acesso à Central de Processos é ' + codigo + '. Ele expira em 10 minutos. Se você não solicitou, ignore este e-mail.',
    name: nome
  });
}

/* ---------- Logo (arquivo oficial no Drive, sem alterações) ---------- */

function logoBlob_() {
  var id = prop_('LOGO_FILE_ID', '');
  if (!id) return null;
  try {
    return DriveApp.getFileById(id).getBlob();
  } catch (e) {
    console.warn('Logo indisponível: ' + e.message);
    return null;
  }
}

/**
 * Logo para as páginas web como data URI (cache de 6 h). O CacheService aceita
 * no máximo 100 KB por valor: arquivos maiores usam a miniatura gerada pelo Drive.
 * Recomenda-se uma versão leve (PNG até ~70 KB) em LOGO_FILE_ID.
 */
function logoDataUri_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('logo:uri');
  if (c) return c === '-' ? '' : c;
  var uri = '';
  var id = prop_('LOGO_FILE_ID', '');
  if (id) {
    try {
      var arquivo = DriveApp.getFileById(id);
      var blob = arquivo.getBlob();
      if (blob.getBytes().length > 70000) blob = arquivo.getThumbnail() || blob;
      uri = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) {
      console.warn('Logo indisponível: ' + e.message);
    }
  }
  if (uri.length < 95000) cache.put('logo:uri', uri || '-', 21600);
  return uri;
}
