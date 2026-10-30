/**
 * 00_Config.gs — Constantes do Financeiro ECOS: tipos, situações, plano de
 * categorias e estrutura da DRE gerencial.
 *
 * Uso exclusivamente interno: nada aqui envia e-mail, cobrança ou mensagem a
 * clientes. A ferramenta só registra previsões e baixas.
 *
 * Convenção de segurança (a mesma da Central de Processos): funções terminadas
 * em "_" são privadas e não podem ser chamadas pelo navegador. Toda função
 * pública valida o usuário antes de qualquer leitura ou gravação.
 */

var FIN = {
  NOME: 'Financeiro ECOS',
  VERSAO: '1.0.0',
  TIMEZONE: 'America/Sao_Paulo',
  /** Quantos meses à frente a geração automática de previsões pode alcançar. */
  MESES_GERACAO_FUTURA: 12
};

var TIPO = { RECEITA: 'RECEITA', DESPESA: 'DESPESA' };
var SITUACAO = { ABERTO: 'ABERTO', PAGO: 'PAGO', CANCELADO: 'CANCELADO' };

/** Situação exibida (calculada a partir da situação gravada e da data de hoje). */
var STATUS = { PAGO: 'PAGO', VENCIDO: 'VENCIDO', HOJE: 'HOJE', A_VENCER: 'A_VENCER', CANCELADO: 'CANCELADO' };

var FORMAS = ['Pix', 'Asaas', 'Boleto', 'Transferência', 'Cartão', 'Débito automático', 'Dinheiro'];

/**
 * Grupos da DRE gerencial, na ordem de apresentação.
 * "foraDoResultado": entra no caixa, mas não na DRE (reservas, aportes, transferências).
 */
var GRUPOS = [
  { key: 'HONORARIOS', nome: 'Honorários recorrentes', tipo: TIPO.RECEITA },
  { key: 'AVULSOS', nome: 'Serviços avulsos', tipo: TIPO.RECEITA },
  { key: 'DEDUCOES', nome: 'Impostos sobre o faturamento', tipo: TIPO.DESPESA },
  { key: 'CUSTOS', nome: 'Custos dos serviços', tipo: TIPO.DESPESA },
  { key: 'PESSOAL', nome: 'Folha e equipe', tipo: TIPO.DESPESA },
  { key: 'ADMIN', nome: 'Despesas administrativas', tipo: TIPO.DESPESA },
  { key: 'MARKETING', nome: 'Marketing', tipo: TIPO.DESPESA },
  { key: 'TAXAS', nome: 'Impostos, taxas e multas', tipo: TIPO.DESPESA },
  { key: 'OUTRAS_DESP', nome: 'Outras despesas', tipo: TIPO.DESPESA },
  { key: 'OUTRAS_REC', nome: 'Outras receitas', tipo: TIPO.RECEITA },
  /* Remuneração dos sócios fica abaixo do resultado operacional: misturá-la com o custo distorce a margem. */
  { key: 'SOCIOS', nome: 'Remuneração dos sócios', tipo: TIPO.DESPESA },
  { key: 'NAO_OPER_E', nome: 'Entradas fora do resultado', tipo: TIPO.RECEITA, foraDoResultado: true },
  { key: 'NAO_OPER_S', nome: 'Saídas fora do resultado', tipo: TIPO.DESPESA, foraDoResultado: true }
];

/** Plano de categorias inicial (gravado na aba "Categorias", editável na planilha). */
var CATEGORIAS_PADRAO = [
  ['Honorários mensais', TIPO.RECEITA, 'HONORARIOS'],
  ['Abertura, alteração e baixa', TIPO.RECEITA, 'AVULSOS'],
  ['Regularização', TIPO.RECEITA, 'AVULSOS'],
  ['IRPF', TIPO.RECEITA, 'AVULSOS'],
  ['Certificado digital', TIPO.RECEITA, 'AVULSOS'],
  ['Parcerias e terceirização', TIPO.RECEITA, 'AVULSOS'],
  ['Outros serviços avulsos', TIPO.RECEITA, 'AVULSOS'],
  ['Reembolso de taxas', TIPO.RECEITA, 'OUTRAS_REC'],
  ['Rendimentos', TIPO.RECEITA, 'OUTRAS_REC'],
  ['Outras receitas', TIPO.RECEITA, 'OUTRAS_REC'],
  ['Aporte / transferência recebida', TIPO.RECEITA, 'NAO_OPER_E'],
  ['Resgate de aplicação', TIPO.RECEITA, 'NAO_OPER_E'],
  ['Estornos e devoluções recebidas', TIPO.RECEITA, 'NAO_OPER_E'],

  ['Simples Nacional (DAS)', TIPO.DESPESA, 'DEDUCOES'],
  ['ISS', TIPO.DESPESA, 'DEDUCOES'],
  ['Taxas e DAREs de processos', TIPO.DESPESA, 'CUSTOS'],
  ['Certificados digitais (custo)', TIPO.DESPESA, 'CUSTOS'],
  ['Comissões e parcerias', TIPO.DESPESA, 'CUSTOS'],
  ['Serviços de terceiros', TIPO.DESPESA, 'CUSTOS'],
  ['Salários', TIPO.DESPESA, 'PESSOAL'],
  ['Encargos e benefícios', TIPO.DESPESA, 'PESSOAL'],
  ['Softwares e sistemas', TIPO.DESPESA, 'ADMIN'],
  ['Internet e telefone', TIPO.DESPESA, 'ADMIN'],
  ['Aluguel', TIPO.DESPESA, 'ADMIN'],
  ['Água e energia', TIPO.DESPESA, 'ADMIN'],
  ['Material de escritório', TIPO.DESPESA, 'ADMIN'],
  ['Anuidade CRC', TIPO.DESPESA, 'ADMIN'],
  ['Transporte', TIPO.DESPESA, 'ADMIN'],
  ['Cursos e treinamentos', TIPO.DESPESA, 'ADMIN'],
  ['Tarifas bancárias e de cobrança', TIPO.DESPESA, 'ADMIN'],
  ['Alimentação', TIPO.DESPESA, 'ADMIN'],
  ['Agência de marketing', TIPO.DESPESA, 'MARKETING'],
  ['Mídia paga', TIPO.DESPESA, 'MARKETING'],
  ['Material impresso', TIPO.DESPESA, 'MARKETING'],
  ['DARF (tributos federais)', TIPO.DESPESA, 'TAXAS'],
  ['Tributos municipais', TIPO.DESPESA, 'TAXAS'],
  ['Taxas e multas do escritório', TIPO.DESPESA, 'TAXAS'],
  ['A esclarecer', TIPO.DESPESA, 'OUTRAS_DESP'],
  ['Outras despesas', TIPO.DESPESA, 'OUTRAS_DESP'],
  ['Pró-labore / distribuição', TIPO.DESPESA, 'SOCIOS'],
  ['Reserva / aplicação', TIPO.DESPESA, 'NAO_OPER_S'],
  ['Retirada / transferência enviada', TIPO.DESPESA, 'NAO_OPER_S'],
  ['Estornos e devoluções enviadas', TIPO.DESPESA, 'NAO_OPER_S']
];

var memoProps_ = null;

function prop_(chave, padrao) {
  if (!memoProps_) memoProps_ = PropertiesService.getScriptProperties().getProperties();
  var v = memoProps_[chave];
  if (v === undefined || v === null || String(v).trim() === '') return padrao !== undefined ? padrao : '';
  return String(v).trim();
}

function setProp_(chave, valor) {
  PropertiesService.getScriptProperties().setProperty(chave, String(valor));
  if (memoProps_) memoProps_[chave] = String(valor);
}

/** E-mails autorizados (propriedade FIN_EMAILS). Vazio = somente o proprietário do script. */
function usuariosAutorizados_() {
  return prop_('FIN_EMAILS', prop_('PROPRIETARIO', ''))
    .split(/[,;\s]+/)
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return e; });
}

function grupoPorChave_(key) {
  for (var i = 0; i < GRUPOS.length; i++) if (GRUPOS[i].key === key) return GRUPOS[i];
  return null;
}
