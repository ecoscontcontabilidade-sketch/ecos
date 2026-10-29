/**
 * 60_Auth.gs — Autenticação do painel e limitação de tentativas.
 *
 * Por que não usar a conta Google do visitante: o Web App precisa ser publicado
 * como "Executar como: eu" + "Qualquer pessoa" para que clientes sem conta Google
 * consultem o portal. Nessa configuração o Apps Script não identifica o visitante
 * (Session.getActiveUser() vem vazio para contas externas). Por isso o painel usa
 * login próprio por código de uso único enviado ao e-mail autorizado
 * (ADMIN_EMAILS), com sessão aleatória guardada só no servidor (CacheService).
 *
 * Toda função administrativa chama exigirAdmin_(token) no servidor; o token é
 * aleatório (256 bits), expira em 6 h e a autorização do e-mail é reconferida a
 * cada chamada (remoção de ADMIN_EMAILS tem efeito imediato).
 */

var SESSAO_TTL_SEG = 6 * 60 * 60;
var OTP_TTL_SEG = 10 * 60;
var OTP_MAX_TENTATIVAS = 5;

function solicitarCodigo_(emailBruto) {
  var email = String(emailBruto || '').trim().toLowerCase();
  if (!emailValido_(email)) throw new ErroApp('Informe um e-mail válido.', 'VALIDACAO');

  // Limites: por e-mail (3 a cada 15 min) e global (30 a cada 15 min).
  var hEmail = hashComSal_('otp-req|' + email).slice(0, 32);
  if (incrementarContador_('otpreq:' + hEmail, 900) > 3 || incrementarContador_('otpreq:global', 900) > 30) {
    throw new ErroApp('Muitas solicitações. Aguarde alguns minutos e tente novamente.', 'LIMITE');
  }

  if (adminsAutorizados_().indexOf(email) >= 0) {
    var b = bytesAleatorios_();
    var num = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
    var codigo = ('000000' + (num % 1000000)).slice(-6);
    CacheService.getScriptCache().put('otp:' + hEmail, JSON.stringify({ h: hashComSal_('otp|' + email + '|' + codigo), t: 0 }), OTP_TTL_SEG);
    enviarEmailCodigoAcesso_(email, codigo);
  }
  // Mesma resposta para e-mails autorizados ou não (não revela quem é administrador).
  return { ok: true, mensagem: 'Se este e-mail estiver autorizado, você receberá um código de acesso em instantes.' };
}

function validarCodigo_(emailBruto, codigoBruto) {
  var email = String(emailBruto || '').trim().toLowerCase();
  var codigo = String(codigoBruto || '').replace(/\D/g, '');
  var erroGenerico = new ErroApp('Código inválido ou expirado. Solicite um novo código.', 'AUTENTICACAO');
  if (!emailValido_(email) || codigo.length !== 6) throw erroGenerico;

  var hEmail = hashComSal_('otp-req|' + email).slice(0, 32);
  var cache = CacheService.getScriptCache();
  var bruto = cache.get('otp:' + hEmail);
  if (!bruto) throw erroGenerico;
  var reg = JSON.parse(bruto);
  reg.t++;
  if (reg.t > OTP_MAX_TENTATIVAS) {
    cache.remove('otp:' + hEmail);
    throw erroGenerico;
  }
  if (reg.h !== hashComSal_('otp|' + email + '|' + codigo)) {
    cache.put('otp:' + hEmail, JSON.stringify(reg), OTP_TTL_SEG);
    throw erroGenerico;
  }
  cache.remove('otp:' + hEmail);
  if (adminsAutorizados_().indexOf(email) < 0) throw erroGenerico;

  var token = tokenAleatorio_();
  cache.put('ses:' + sha256Hex_(token), JSON.stringify({ email: email, criado: agora_() }), SESSAO_TTL_SEG);
  registrarEvento_({ tipo: 'LOGIN_PAINEL', origem: 'PLATAFORMA', usuario: email, detalhe: 'Acesso ao painel administrativo.' });
  return { token: token, email: email, expiraEmSeg: SESSAO_TTL_SEG };
}

/** Valida a sessão e retorna o e-mail do administrador. */
function exigirAdmin_(token) {
  var t = String(token || '');
  if (!/^[0-9a-f]{64}$/.test(t)) throw new ErroApp('Sessão expirada. Faça login novamente.', 'SESSAO');
  var bruto = CacheService.getScriptCache().get('ses:' + sha256Hex_(t));
  if (!bruto) throw new ErroApp('Sessão expirada. Faça login novamente.', 'SESSAO');
  var s = JSON.parse(bruto);
  if (adminsAutorizados_().indexOf(s.email) < 0) {
    CacheService.getScriptCache().remove('ses:' + sha256Hex_(t));
    throw new ErroApp('Acesso não autorizado.', 'SESSAO');
  }
  return s.email;
}

function encerrarSessao_(token) {
  var t = String(token || '');
  if (/^[0-9a-f]{64}$/.test(t)) CacheService.getScriptCache().remove('ses:' + sha256Hex_(t));
}

/**
 * Limite de consultas públicas. O Apps Script não fornece o IP do visitante,
 * então combinamos:
 *  - limite por navegador (chave aleatória da sessão do navegador): 10 falhas / 10 min;
 *  - freio global: acima de 60 falhas / 5 min, todas as consultas ganham atraso.
 * A defesa principal contra adivinhação é a entropia do código (60 bits).
 */
function verificarLimiteConsulta_(chaveCliente) {
  var k = String(chaveCliente || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64) || 'anonimo';
  if (lerContador_('cons:' + k) >= 10) {
    throw new ErroApp('Muitas tentativas. Aguarde alguns minutos antes de consultar novamente.', 'LIMITE');
  }
  if (lerContador_('cons:global') > 60) Utilities.sleep(3000);
  return k;
}

function registrarFalhaConsulta_(k) {
  incrementarContador_('cons:' + k, 600);
  incrementarContador_('cons:global', 300);
}
