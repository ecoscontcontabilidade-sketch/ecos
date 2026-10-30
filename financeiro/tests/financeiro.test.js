/**
 * Testes do Financeiro ECOS (node --test). "Hoje" é fixado em 30/10/2026 (São Paulo).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { criarAmbiente, ambienteInstalado, exec, PROPRIETARIO } = require('./harness');

const HOJE = '2026-10-30';

function cliente(g, extra) {
  return g.finSalvarRecorrencia(Object.assign({
    tipo: 'RECEITA', contraparte: 'Alfa Celulares', categoria: 'Honorários mensais', valor: 550, dia: 10, forma: 'Pix', inicio: '2026-10'
  }, extra || {}), '2026-10');
}

function despesa(g, extra) {
  return g.finSalvarRecorrencia(Object.assign({
    tipo: 'DESPESA', contraparte: 'Domínio Sistemas', categoria: 'Softwares e sistemas', valor: 900, dia: 30, forma: 'Pix', inicio: '2026-10'
  }, extra || {}), '2026-10');
}

const doMes = (p, nome) => p.receitas.concat(p.despesas).filter((l) => l.contraparte === nome);

/* ---------------- Instalação e acesso ---------------- */

test('instalar cria as abas e o plano de categorias; reinstalar não duplica', () => {
  const amb = ambienteInstalado();
  const nomes = amb.ss.getSheets().map((s) => s.getName());
  ['Lancamentos', 'Recorrencias', 'Categorias', 'Config', 'Log'].forEach((n) => assert.ok(nomes.includes(n), n));
  assert.ok(!nomes.includes('Página1'));
  const qtd = amb.ss.getSheetByName('Categorias').getLastRow();
  exec(amb, (g) => g.instalar());
  assert.equal(amb.ss.getSheetByName('Categorias').getLastRow(), qtd);
  assert.equal(amb.props.PROPRIETARIO, PROPRIETARIO);
});

test('funções do navegador exigem usuário autorizado', () => {
  const amb = ambienteInstalado();
  amb.usuarioAtivo = '';
  assert.throws(() => exec(amb, (g) => g.finCarregar('2026-10')), /Entre com a sua conta Google/);
  amb.usuarioAtivo = 'intruso@gmail.com';
  assert.throws(() => exec(amb, (g) => g.finCarregar('2026-10')), /não tem acesso/);
  assert.throws(() => exec(amb, (g) => g.finSalvarLancamento({ tipo: 'RECEITA' }, '2026-10')), /não tem acesso/);
  amb.usuarioAtivo = 'equipe@ecoscont.com.br';
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  assert.equal(p.mes, '2026-10');
  assert.equal(p.usuario, 'equipe@ecoscont.com.br');
});

test('instalação e importação só pelo proprietário no editor', () => {
  const amb = ambienteInstalado();
  amb.usuarioAtivo = 'equipe@ecoscont.com.br';
  assert.throws(() => exec(amb, (g) => g.instalar()), /conta proprietária/);
  assert.throws(() => exec(amb, (g) => g.importarFluxoDeCaixa()), /conta proprietária/);
  const novo = criarAmbiente({ usuarioAtivo: 'alguem@gmail.com', usuarioEfetivo: PROPRIETARIO });
  assert.throws(() => novo.g.instalar(), /conta proprietária/);
});

test('mês inválido cai no mês atual', () => {
  const amb = ambienteInstalado();
  assert.equal(exec(amb, (g) => g.finCarregar('abc')).mes, '2026-10');
  assert.equal(exec(amb, (g) => g.finCarregar('')).mes, '2026-10');
});

/* ---------------- Recorrências e geração ---------------- */

test('cadastro recorrente gera a previsão do mês uma única vez', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => cliente(g));
  exec(amb, (g) => despesa(g));
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  exec(amb, (g) => g.finCarregar('2026-10'));
  const p2 = exec(amb, (g) => g.finCarregar('2026-10'));
  assert.equal(p2.receitas.length, 1);
  assert.equal(p2.despesas.length, 1);
  const r = p.receitas[0];
  assert.equal(r.vencimento, '2026-10-10');
  assert.equal(r.status, 'VENCIDO');
  assert.equal(r.diasAtraso, 20);
  assert.equal(r.origem, 'RECORRENTE');
  assert.equal(p.despesas[0].status, 'HOJE');
});

test('abrir mês futuro gera os meses intermediários; mês passado não é gerado sozinho', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => cliente(g, { inicio: '2026-09' }));
  const dez = exec(amb, (g) => g.finCarregar('2026-12'));
  assert.equal(dez.receitas.length, 1);
  assert.equal(exec(amb, (g) => g.finCarregar('2026-11')).receitas.length, 1);
  assert.equal(exec(amb, (g) => g.finCarregar('2026-09')).receitas.length, 0);
  const set = exec(amb, (g) => g.finGerarPrevisoes('2026-09'));
  assert.equal(set.receitas.length, 1);
  assert.match(set.aviso, /1 previsão gerada/);
  assert.match(exec(amb, (g) => g.finGerarPrevisoes('2026-09')).aviso, /Nenhuma previsão nova/);
  // Fora do limite de 12 meses: nada é gerado automaticamente.
  assert.equal(exec(amb, (g) => g.finCarregar('2028-01')).receitas.length, 0);
});

test('dia 31 vira o último dia do mês', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => cliente(g, { dia: 31, inicio: '2027-02' }));
  const fev = exec(amb, (g) => g.finCarregar('2027-02'));
  assert.equal(fev.receitas[0].vencimento, '2027-02-28');
});

test('editar cadastro atualiza previsões em aberto; desativar cancela as dos meses seguintes', () => {
  const amb = ambienteInstalado();
  const p = exec(amb, (g) => cliente(g));
  const rec = p.recorrencias[0];
  exec(amb, (g) => g.finCarregar('2026-11'));
  exec(amb, (g) => g.finSalvarRecorrencia(Object.assign({}, rec, { valor: '600,00', dia: 15 }), '2026-10'));
  const out = exec(amb, (g) => g.finCarregar('2026-10'));
  assert.equal(out.receitas[0].valor, 600);
  assert.equal(out.receitas[0].vencimento, '2026-10-15');
  assert.equal(exec(amb, (g) => g.finCarregar('2026-11')).receitas[0].valor, 600);

  exec(amb, (g) => g.finSalvarRecorrencia(Object.assign({}, rec, { valor: 600, dia: 15, ativo: false }), '2026-10'));
  assert.equal(exec(amb, (g) => g.finCarregar('2026-10')).receitas.length, 1, 'mês atual fica para decisão manual');
  assert.equal(exec(amb, (g) => g.finCarregar('2026-11')).receitas.length, 0);
  assert.equal(exec(amb, (g) => g.finCarregar('2026-12')).receitas.length, 0);
});

test('validações do cadastro', () => {
  const amb = ambienteInstalado();
  assert.throws(() => exec(amb, (g) => cliente(g, { valor: 0 })), /maior que zero/);
  assert.throws(() => exec(amb, (g) => cliente(g, { dia: 40 })), /dia do vencimento/);
  assert.throws(() => exec(amb, (g) => cliente(g, { categoria: 'Softwares e sistemas' })), /categoria de receita/);
  assert.throws(() => exec(amb, (g) => cliente(g, { contraparte: '  ' })), /Informe o cliente/);
  assert.throws(() => exec(amb, (g) => cliente(g, { inicio: '2026-10', fim: '2026-09' })), /término/);
});

/* ---------------- Lançamentos, baixa, estorno, exclusão ---------------- */

test('incluir previsão avulsa, editar e validar', () => {
  const amb = ambienteInstalado();
  let p = exec(amb, (g) => g.finSalvarLancamento({ tipo: 'RECEITA', contraparte: 'Cliente Abertura', categoria: 'Abertura, alteração e baixa', valor: '1.200,50', vencimento: '2026-11-05', descricao: 'Abertura 2/2' }, '2026-11'));
  assert.equal(p.receitas.length, 1);
  const l = p.receitas[0];
  assert.equal(l.valor, 1200.5);
  assert.equal(l.grupo, 'AVULSOS');
  p = exec(amb, (g) => g.finSalvarLancamento(Object.assign({}, l, { valor: 1300, vencimento: '2026-11-08' }), '2026-11'));
  assert.equal(p.receitas[0].valor, 1300);
  assert.equal(p.receitas[0].vencimento, '2026-11-08');
  assert.throws(() => exec(amb, (g) => g.finSalvarLancamento({ tipo: 'RECEITA', contraparte: 'X', categoria: 'Honorários mensais', valor: 10, vencimento: '2026-02-30' })), /vencimento válida/);
  assert.throws(() => exec(amb, (g) => g.finSalvarLancamento({ tipo: 'XPTO', contraparte: 'X' })), /Tipo inválido/);
  assert.throws(() => exec(amb, (g) => g.finSalvarLancamento(Object.assign({}, l, { tipo: 'DESPESA', categoria: 'Outras despesas' }))), /trocar o tipo/);
});

test('baixa integral, baixa parcial com saldo, estorno e exclusão', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => cliente(g));
  let p = exec(amb, (g) => g.finCarregar('2026-10'));
  const id = p.receitas[0].id;

  p = exec(amb, (g) => g.finBaixar(id, { valorPago: 400, dataPagamento: '2026-10-29', forma: 'Asaas', gerarSaldo: true }, '2026-10'));
  const pago = p.receitas.find((l) => l.id === id);
  assert.equal(pago.status, 'PAGO');
  assert.equal(pago.valorPago, 400);
  assert.equal(pago.forma, 'Asaas');
  const saldo = p.receitas.find((l) => l.id !== id);
  assert.equal(saldo.valor, 150);
  assert.equal(saldo.status, 'VENCIDO');
  assert.match(saldo.descricao, /\(saldo\)/);

  assert.throws(() => exec(amb, (g) => g.finBaixar(id, {}, '2026-10')), /já foi baixado/);
  assert.throws(() => exec(amb, (g) => g.finExcluir(id, '2026-10')), /Estorne a baixa/);
  assert.throws(() => exec(amb, (g) => g.finBaixar(saldo.id, { dataPagamento: '2026-11-15' }, '2026-10')), /futuro/);

  p = exec(amb, (g) => g.finEstornar(id, '2026-10'));
  const estornado = p.receitas.find((l) => l.id === id);
  assert.equal(estornado.status, 'VENCIDO');
  assert.equal(estornado.valorPago, null);
  assert.equal(estornado.valor, 550);

  // Excluir a previsão recorrente: some da tela e não volta ao recarregar o mês.
  exec(amb, (g) => g.finExcluir(id, '2026-10'));
  p = exec(amb, (g) => g.finCarregar('2026-10'));
  assert.equal(p.receitas.filter((l) => l.id === id).length, 0);
  assert.equal(p.receitas.length, 1);
  const log = amb.ss.getSheetByName('Log').rows.map((r) => r[2]);
  ['BAIXAR', 'SALDO', 'ESTORNAR', 'EXCLUIR'].forEach((a) => assert.ok(log.includes(a), a));
});

test('baixa sem dados usa o valor previsto e a data de hoje', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => despesa(g));
  const id = exec(amb, (g) => g.finCarregar('2026-10')).despesas[0].id;
  const l = exec(amb, (g) => g.finBaixar(id, {}, '2026-10')).despesas[0];
  assert.equal(l.valorPago, 900);
  assert.equal(l.dataPagamento, HOJE);
});

/* ---------------- Agenda, inadimplência, DRE, saldo ---------------- */

function cenario() {
  const amb = ambienteInstalado();
  exec(amb, (g) => {
    cliente(g, { contraparte: 'Alfa Celulares', valor: 550, dia: 10, inicio: '2026-09' });
    cliente(g, { contraparte: 'Cliente Delta', valor: 450, dia: 30 });
    cliente(g, { contraparte: 'Cliente Epsilon', valor: 200, dia: 15 });
    despesa(g, { contraparte: 'Domínio Sistemas', valor: 900, dia: 30 });
    despesa(g, { contraparte: 'Socio Dois', categoria: 'Pró-labore / distribuição', valor: 2000, dia: 5 });
    despesa(g, { contraparte: 'Simples', categoria: 'Simples Nacional (DAS)', valor: 120, dia: 20 });
  });
  exec(amb, (g) => g.finGerarPrevisoes('2026-09'));
  let p = exec(amb, (g) => g.finCarregar('2026-10'));
  const id = (nome) => doMes(p, nome)[0].id;
  exec(amb, (g) => g.finBaixar(id('Cliente Epsilon'), { dataPagamento: '2026-10-15' }, '2026-10'));
  exec(amb, (g) => g.finBaixar(id('Socio Dois'), { dataPagamento: '2026-10-05' }, '2026-10'));
  exec(amb, (g) => g.finSalvarLancamento({ tipo: 'DESPESA', contraparte: 'Banco C6', categoria: 'Reserva / aplicação', valor: 300, vencimento: '2026-11-03' }, '2026-10'));
  exec(amb, (g) => g.finDefinirSaldoInicial('2026-10', '3.000,00'));
  return amb;
}

test('agenda do dia: hoje, atrasados e próximos 7 dias', () => {
  const amb = cenario();
  const a = exec(amb, (g) => g.finCarregar('2026-10')).agenda;
  assert.deepEqual(Array.from(a.receberHoje, (l) => l.contraparte), ['Cliente Delta']);
  assert.deepEqual(Array.from(a.pagarHoje, (l) => l.contraparte), ['Domínio Sistemas']);
  assert.deepEqual(Array.from(a.receberAtrasado, (l) => l.vencimento), ['2026-09-10', '2026-10-10']);
  assert.deepEqual(Array.from(a.pagarAtrasado, (l) => l.contraparte), ['Simples']);
  assert.deepEqual(Array.from(a.pagarProximos, (l) => l.contraparte), ['Banco C6']);
  assert.equal(a.totais.receberAtrasado, 1100);
  // A agenda é sempre de hoje, mesmo olhando outro mês.
  assert.equal(exec(amb, (g) => g.finCarregar('2026-12')).agenda.receberHoje.length, 1);
});

test('inadimplentes agrupados por cliente em todos os meses', () => {
  const amb = cenario();
  const inad = exec(amb, (g) => g.finCarregar('2026-10')).inadimplentes;
  assert.equal(inad.length, 1);
  assert.equal(inad[0].contraparte, 'Alfa Celulares');
  assert.equal(inad[0].quantidade, 2);
  assert.equal(inad[0].total, 1100);
  assert.equal(inad[0].maisAntigo, '2026-09-10');
  assert.equal(inad[0].diasAtraso, 50);
});

test('totais do mês e DRE gerencial projetada', () => {
  const amb = cenario();
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  const t = p.totais;
  assert.equal(t.receitas.previsto, 1200);
  assert.equal(t.receitas.realizado, 200);
  assert.equal(t.receitas.vencido, 550);
  assert.equal(t.receitas.aVencer, 450);
  assert.equal(t.despesas.previsto, 3020);
  assert.equal(t.despesas.realizado, 2000);
  // Inadimplência do mês: vencido (550) sobre o que já venceu (550 + 200).
  assert.equal(t.inadimplenciaPercentual, 73.3);

  const dre = Object.fromEntries(p.dre.linhas.map((l) => [l.key, l]));
  assert.equal(dre.HONORARIOS.projetado, 1200);
  assert.equal(dre.RECEITA_BRUTA.projetado, 1200);
  assert.equal(dre.DEDUCOES.projetado, 120);
  assert.equal(dre.RECEITA_LIQUIDA.projetado, 1080);
  assert.equal(dre.SOCIOS.realizado, 2000);
  assert.equal(dre.PESSOAL.realizado, 0);
  assert.equal(dre.RESULTADO_ANTES_SOCIOS.projetado, 180);
  assert.equal(t.resultadoAntesSocios, 180);
  assert.equal(t.margemOperacional, 15);
  assert.equal(dre.ADMIN.projetado, 900);
  assert.equal(dre.RESULTADO.projetado, -1820);
  assert.equal(dre.RESULTADO.realizado, -1800);
  assert.equal(t.resultadoProjetado, -1820);
  assert.equal(dre.RECEITA_BRUTA.percentual, 100);
  assert.deepEqual(Array.from(p.despesasPorGrupo, (x) => x.grupo), ['SOCIOS', 'ADMIN', 'DEDUCOES']);

  // Reserva fica fora da DRE (novembro), mas reduz o caixa.
  const nov = exec(amb, (g) => g.finCarregar('2026-11'));
  assert.equal(nov.dre.foraDoResultado.saidas.projetado, 300);
  assert.equal(nov.dre.linhas.find((l) => l.key === 'OUTRAS_DESP').projetado, 0);
});

test('saldo diário: realizado até hoje, projeção conservadora e encadeamento entre meses', () => {
  const amb = cenario();
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  const s = Object.fromEntries(p.serieSaldo.map((x) => [x.data, x]));
  assert.equal(s['2026-10-04'].saldo, 3000);
  assert.equal(s['2026-10-05'].saldo, 1000);
  assert.equal(s['2026-10-15'].saldo, 1200);
  // Hoje (30/10): +450 a receber hoje, −900 Domínio, −120 Simples atrasado (pago hoje na projeção).
  assert.equal(s['2026-10-30'].saldo, 630);
  assert.equal(s['2026-10-30'].projetado, false);
  assert.equal(p.totais.saldoFinalProjetado, 630);
  assert.equal(p.totais.atrasadosReceber, 1100, 'Alfa Celulares (set + out) fora da projeção');
  assert.equal(p.totais.saldoInformado, true);

  // Novembro parte de outubro: 3000 + realizado (200 − 2000) = 1200.
  const nov = exec(amb, (g) => g.finCarregar('2026-11'));
  assert.equal(nov.totais.saldoInicial, 1200);
  assert.equal(nov.totais.saldoInformado, false);
  assert.ok(nov.serieSaldo.every((x) => x.projetado));
});

/* ---------------- Importação do fluxo de caixa ---------------- */

const LINHAS_ORIGEM = [
  ['', 'Data', 'Valor', 'Forma de Pgmt.', 'Conta destino', 'Cliente/Fornecedor', 'Categoria', 'Descrição'],
  ['', '2026-06-01', -1174.38, 'Pix', 'Profissional', 'Socio Um', 'Salário', 'Prólabore'],
  ['', '2026-06-12', 550, 'Pix', 'Profissional', 'Alfa Celulares', 'Serviço', 'Honorários'],
  ['', '2026-07-10', 550, 'Pix', 'Profissional', 'Alfa Celulares', 'Serviço', 'Honorários mensais'],
  ['', '2026-07-17', -565, 'Pix', 'Profissional', 'Jettax 360', 'Aplicativo', 'Software'],
  ['', '2026-07-31', -900, 'Pix', 'Profissional', 'Dominio Sistemas', 'Serviço', 'Mensalidade'],
  ['', '2026-08-03', -812.52, 'Pix', 'Profissional', 'Socio Um', 'Salário', 'Salário'],
  ['', '2026-08-13', -1200, 'Pix', 'Profissional', 'Socio Um', 'Salário', 'Salário'],
  ['', '2026-07-01', -1800, 'Pix', 'Profissional', 'Socio Um', 'Salário', 'Salário'],
  ['', '2026-08-10', -900, 'Pix', 'Profissional', 'Dominio Sistemas', 'Aplicativo', 'Software'],
  ['', '2026-08-26', -576.48, 'Pix', 'Profissional', 'Jettax 360', 'Serviço', 'Honorários mensais'],
  ['', '2026-08-24', -218.99, 'Pix', 'Profissional', 'DARE - Jucesp', 'Outros impostos', 'DARE de abertura'],
  ['', '2026-08-28', 720, 'Pix', 'Profissional', 'Alfa Celulares', 'Serviço', 'Alteração de contrato'],
  ['', '2026-08-31', 550, 'Pix', 'Profissional', 'Alfa Celulares', 'Serviço', 'Honorários mensais'],
  ['', '2026-08-15', 200, 'Pix', 'Profissional', 'Cliente Epsilon', 'Serviço', 'Honorários mensais'],
  ['', '2026-08-15', 200, 'Pix', 'Profissional', 'Cliente Epsilon', 'Serviço', 'Honorários mensais'],
  ['', '2026-08-28', 150, 'Pix', 'Profissional', 'Cliente IRPF', 'Serviço', 'IRPF 2025'],
  ['', '2026-06-15', -200, 'Pix', 'Profissional', 'Banco c6', 'CBD - Banco C6', 'Reserva'],
  ['', '2026-08-11', 120, 'Débito', 'Profissional', 'Contadora Parceira', 'Certificado', 'Certificado'],
  ['', 'Total', '', '', '', '', '', '']
];

function importar() {
  const amb = ambienteInstalado({ props: { FLUXO_ORIGEM_ID: 'origem' } });
  amb.props.FLUXO_ORIGEM_ID = 'origem';
  const sh = amb.origem.insertSheet('Fluxo de Caixa');
  sh.rows.push(['', '', '', '', '', 5056.77], ['', 'ENTRADAS', 'SAÍDAS']);
  LINHAS_ORIGEM.forEach((l) => sh.rows.push(l.slice()));
  return amb;
}

test('importação: histórico baixado com categorias convertidas', () => {
  const amb = importar();
  const r = exec(amb, (g) => g.importarFluxoDeCaixa());
  assert.equal(r.importados, 18);
  const ago = exec(amb, (g) => g.finCarregar('2026-08'));
  const cat = (nome, desc) => ago.receitas.concat(ago.despesas).find((l) => l.contraparte === nome && (!desc || l.descricao === desc)).categoria;
  assert.equal(cat('Jettax 360'), 'Softwares e sistemas');
  assert.equal(cat('Dominio Sistemas'), 'Softwares e sistemas');
  assert.equal(cat('DARE - Jucesp'), 'Taxas e DAREs de processos');
  assert.equal(cat('Alfa Celulares', 'Alteração de contrato'), 'Abertura, alteração e baixa');
  assert.equal(cat('Alfa Celulares', 'Honorários mensais'), 'Honorários mensais');
  assert.equal(cat('Cliente IRPF'), 'IRPF');
  assert.equal(cat('Contadora Parceira'), 'Certificado digital');
  assert.equal(cat('Socio Um'), 'Pró-labore / distribuição');
  assert.ok(ago.receitas.concat(ago.despesas).every((l) => l.status === 'PAGO'));
  assert.equal(ago.receitas.find((l) => l.contraparte === 'Contadora Parceira').forma, 'Cartão');
  const jun = exec(amb, (g) => g.finCarregar('2026-06'));
  assert.equal(jun.despesas.find((l) => l.descricao === 'Prólabore').categoria, 'Pró-labore / distribuição');
  assert.equal(jun.dre.foraDoResultado.saidas.realizado, 200);
});

test('importação: rodar de novo não duplica (inclusive linhas idênticas)', () => {
  const amb = importar();
  exec(amb, (g) => g.importarFluxoDeCaixa());
  const r = exec(amb, (g) => g.importarFluxoDeCaixa());
  assert.equal(r.importados, 0);
  assert.equal(r.ignorados, 18);
  const ago = exec(amb, (g) => g.finCarregar('2026-08'));
  assert.equal(ago.receitas.filter((l) => l.contraparte === 'Cliente Epsilon').length, 2);
});

test('importação: sugere clientes e despesas fixas a partir dos últimos 3 meses', () => {
  const amb = importar();
  const r = exec(amb, (g) => g.importarFluxoDeCaixa());
  assert.equal(r.inicio, '2026-09');
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  const rec = Object.fromEntries(p.recorrencias.map((x) => [x.contraparte + '|' + x.tipo, x]));
  assert.equal(rec['Alfa Celulares|RECEITA'].valor, 550);
  assert.equal(rec['Alfa Celulares|RECEITA'].dia, 31);
  assert.equal(rec['Cliente Epsilon|RECEITA'].dia, 15);
  assert.ok(!rec['Cliente IRPF|RECEITA'], 'IRPF avulso não vira recorrência');
  assert.equal(rec['Dominio Sistemas|DESPESA'].valor, 900);
  assert.equal(rec['Jettax 360|DESPESA'].valor, 576.48);
  // Salários: soma das parcelas do último mês, vencendo no dia da primeira.
  assert.equal(rec['Socio Um|DESPESA'].valor, 2012.52);
  assert.equal(rec['Socio Um|DESPESA'].dia, 3);
  assert.ok(!rec['DARE - Jucesp|DESPESA'], 'taxas de processo são variáveis');
  assert.equal(r.clientes, 2);
  assert.equal(r.despesasFixas, 3);
  // As previsões de outubro saem dos cadastros sugeridos.
  assert.equal(p.receitas.length, 2);
  assert.equal(p.receitas.find((l) => l.contraparte === 'Alfa Celulares').vencimento, '2026-10-31');
  // Reimportar não duplica cadastros.
  exec(amb, (g) => g.importarFluxoDeCaixa());
  assert.equal(exec(amb, (g) => g.finCarregar('2026-10')).recorrencias.length, 5);
});

/* ---------------- Segurança e interface ---------------- */

test('textos que parecem fórmula são gravados como texto', () => {
  const amb = ambienteInstalado();
  assert.equal(amb.g.valorGravado_('=IMPORTXML("x")'), '\'=IMPORTXML("x")');
  assert.equal(amb.g.valorGravado_('+5511'), "'+5511");
  assert.equal(amb.g.valorGravado_(-10), -10);
  exec(amb, (g) => g.finSalvarLancamento({ tipo: 'RECEITA', contraparte: '=HYPERLINK("http://x")', categoria: 'Outras receitas', valor: 10, vencimento: HOJE }, '2026-10'));
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  assert.equal(p.receitas[0].contraparte, '=HYPERLINK("http://x")');
});

test('doGet renderiza a página; o script do navegador não usa innerHTML', () => {
  const amb = ambienteInstalado();
  amb.g.doGet({});
  const html = amb.templates.Index;
  assert.match(html, /<title>|ECOS/);
  assert.match(html, /data-painel="dashboard"/);
  assert.match(html, /finCarregar/);
  const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8');
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
});

test('valores em formato brasileiro', () => {
  const { g } = criarAmbiente();
  assert.equal(g.lerValor_('1.234,56'), 1234.56);
  assert.equal(g.lerValor_('R$ 1.500'), 1500);
  assert.equal(g.lerValor_('99.9'), 99.9);
  assert.equal(g.lerValor_('-200,10'), -200.1);
  assert.ok(isNaN(g.lerValor_('abc')));
  assert.equal(g.somarMeses_('2026-12', 1), '2027-01');
  assert.equal(g.somarMeses_('2026-01', -1), '2025-12');
  assert.equal(g.somarDias_('2026-10-30', 7), '2026-11-06');
});

/* ---------------- Importação do Dashboard Financeiro (C6 × Asaas) ---------------- */

function dadosDashboard() {
  const r = (data, conta, meio, desc, valor, cat, sub, nome, conf) => [data, conta, meio, desc, valor, cat, sub, nome, conf || 'alta'];
  const hon = 'Honorários / serviços', rec = 'Receita de serviços';
  return {
    aud: [
      r('2026-07-10', 'C6', 'Entrada PIX', 'Pix recebido de ALFA CELULARES', 550, rec, hon, 'ALFA CELULARES LTDA'),
      r('2026-08-06', 'Asaas', 'Cobrança Pix', 'Cobrança Alfa', 550, rec, hon, 'ALFA CELULARES LTDA'),
      r('2026-09-08', 'Asaas', 'Cobrança Pix', 'Cobrança Alfa', 550, rec, hon, 'ALFA CELULARES LTDA'),
      r('2026-09-08', 'Asaas', 'Cobrança Pix', 'Cobrança Alfa', 446, rec, hon, 'ALFA CELULARES LTDA'),
      r('2026-07-16', 'C6', 'Entrada PIX', 'Pix Beta', 400, rec, hon, 'BETA AUTOPECAS LTDA'),
      r('2026-08-12', 'C6', 'Entrada PIX', 'Pix Beta', 500, rec, hon, 'BETA AUTOPECAS LTDA'),
      r('2026-09-10', 'C6', 'Entrada PIX', 'Pix Beta', 500, rec, hon, 'BETA AUTOPECAS LTDA'),
      r('2026-10-13', 'C6', 'Entrada PIX', 'Pix Beta', 500, rec, hon, 'BETA AUTOPECAS LTDA'),
      r('2026-09-02', 'C6', 'Entrada PIX', 'Pix avulso', 300, rec, hon, 'CLIENTE AVULSO'),
      r('2026-08-20', 'C6', 'Entrada PIX', 'Pix Elisa', 200, rec, hon, 'ELISA MOURA PRADO'),
      r('2026-10-11', 'C6', 'Entrada PIX', 'Pix Parceira', 650, rec, 'Parceria (certificados/rateio)', 'PARCEIRA CONTABIL LTDA', 'baixa'),
      r('2026-10-09', 'C6', 'Entrada PIX', 'Pix recebido de ECOS SOLUCOES', 518.02, 'Transferência interna', 'Asaas → C6', 'ECOS SOLUCOES EMPRESARIAIS LTDA'),
      r('2026-07-14', 'C6', 'Saída PIX', 'Pix Socio', -1850, 'Remuneração dos sócios', 'Pró-labore / distribuição', 'SOCIO UM DA SILVA', 'media'),
      r('2026-08-14', 'C6', 'Saída PIX', 'Pix Socio', -1850, 'Remuneração dos sócios', 'Pró-labore / distribuição', 'SOCIO UM DA SILVA', 'media'),
      r('2026-09-14', 'C6', 'Saída PIX', 'Pix Socio', -1850, 'Remuneração dos sócios', 'Pró-labore / distribuição', 'SOCIO UM DA SILVA', 'media'),
      r('2026-10-14', 'C6', 'Saída PIX', 'Pix Socio', -1850, 'Remuneração dos sócios', 'Pró-labore / distribuição', 'SOCIO UM DA SILVA', 'media'),
      r('2026-08-10', 'C6', 'Pagamento', 'THOMSON REUTERS BRAS', -810, 'Sistemas e softwares', 'Domínio/Onvio', 'THOMSON REUTERS BRAS'),
      r('2026-09-10', 'C6', 'Pagamento', 'THOMSON REUTERS BRAS', -810, 'Sistemas e softwares', 'Domínio/Onvio', 'THOMSON REUTERS BRAS'),
      r('2026-07-05', 'C6', 'Débito de Cartão', 'MERCADO', -50, 'Alimentação', 'Alimentação/mercado', 'MERCADO'),
      r('2026-08-05', 'C6', 'Débito de Cartão', 'MERCADO', -50, 'Alimentação', 'Alimentação/mercado', 'MERCADO'),
      r('2026-06-01', 'C6', 'Outros gastos', 'APLICAÇÃO DE CDB', -385, 'Aplicação financeira', 'CDB', 'APLICACAO DE CDB'),
      r('2026-08-12', 'C6', 'Entradas', 'RESGATE DE CDB', 620.71, 'Aplicação financeira', 'CDB', 'RESGATE DE CDB'),
      r('2026-10-13', 'C6', 'Entrada PIX', 'Pix Socio', 820.8, 'Entrada de sócio', 'Aporte/repasse', 'SOCIO UM DA SILVA', 'baixa'),
      r('2026-10-19', 'C6', 'Saída PIX', 'Pix Igor', -2220, 'Despesas a esclarecer', 'Não identificada', 'IGOR NUNES', 'baixa'),
      r('2026-10-16', 'C6', 'Saída PIX', 'Pix RECEITA FEDERAL', -86.05, 'Impostos', 'DARF', 'RECEITA FEDERAL'),
      r('2026-10-16', 'C6', 'Saída PIX', 'Pix RECEITA FEDERAL', -86.05, 'Impostos', 'DARF', 'RECEITA FEDERAL'),
      r('2026-10-24', 'C6', 'Débito de Cartão', '99* POP', -27.9, 'Deslocamento', 'Transporte urbano', '99* POP'),
      // Nome do extrato diferente do cadastro: o cliente é achado pelo pagamento (data + valor).
      r('2026-07-02', 'Asaas', 'Cobrança Pix', 'Cobrança Carla', 250, rec, hon, '11.111.111 CARLA DIAS DA COSTA'),
      r('2026-08-03', 'Asaas', 'Cobrança Pix', 'Cobrança Carla', 249.81, rec, hon, '11.111.111 CARLA DIAS DA COSTA'),
      r('2026-09-03', 'C6', 'Entrada PIX', 'Pix Carla', 250, rec, hon, 'CARLA D COSTA'),
      // Pagou em julho e em outubro: continua ativo.
      r('2026-07-17', 'C6', 'Entrada PIX', 'Pix Daniel', 100, rec, hon, 'DANIEL ROCHA LIMA'),
      r('2026-10-19', 'C6', 'Entrada PIX', 'Pix Daniel', 100, rec, hon, 'DANIEL ROCHA LIMA')
    ],
    clientes: [
      { nome: 'ALFA CELULARES LTDA', meses: [3, 4, 5, 6, 7, 8, 9] },
      { nome: 'BETA AUTOPECAS LTDA', meses: [6, 7, 8, 9, 10] },
      { nome: 'CLIENTE AVULSO', meses: [9] },
      { nome: 'ELISA MOURA PRADO', meses: [5, 6, 8] },
      { nome: 'PARCEIRA CONTABIL LTDA', meses: [3, 4, 6, 7, 8, 9, 10] },
      { nome: 'CARLA DIAS DA COSTA', meses: [6, 7, 8, 9], pgtos: [['2026-07-02', 250], ['2026-08-03', 249.81], ['2026-09-03', 250]] },
      { nome: 'DANIEL ROCHA LIMA', meses: [4, 5, 7, 10], pgtos: [['2026-07-17', 100], ['2026-10-19', 100]] }
    ],
    churn: ['ELISA MOURA PRADO'],
    dev: [
      { grupo: 'GAMA SALGADOS LTDA', saldo: 300, cobs: [['2026-08-31', 150, 'aberto'], ['2026-09-30', 150, 'aberto']] },
      { grupo: 'BETA AUTOPECAS LTDA', saldo: 50, cobs: [['2026-08-10', 550, 'aberto'], ['2026-09-10', 500, 'aberto']] }
    ],
    qui: [{ grupo: 'HELIO TEIXEIRA', aberto_asaas: 400, pago_pix: 600 }],
    fluxo: [{ mes: 'Set', ini: 6608.15 }, { mes: 'Out', ini: 6450.03 }]
  };
}

test('dashboard: histórico baixado, categorias e transferências internas fora', () => {
  const amb = ambienteInstalado();
  const p = exec(amb, (g) => g.finImportarDashboard(dadosDashboard()));
  const r = p.importacao;
  // A tela já volta com as previsões do mês atual geradas.
  assert.ok(p.receitas.some((l) => l.origem === 'RECORRENTE' && l.contraparte === 'Alfa Celulares LTDA'));
  assert.equal(r.importados, 31);
  assert.equal(r.transferenciasInternas, 1);
  assert.equal(r.mesEmCurso, '2026-10');
  assert.equal(r.baixarNoAsaas[0].emAberto, 400);
  const todos = [];
  ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((m) => {
    const x = exec(amb, (g) => g.finCarregar(m));
    todos.push(...x.receitas, ...x.despesas);
  });
  const cat = (nome, data) => todos.find((l) => l.contraparte === nome && (!data || l.vencimento === data)).categoria;
  assert.equal(cat('Alfa Celulares LTDA', '2026-07-10'), 'Honorários mensais');
  assert.equal(cat('Cliente Avulso'), 'Outros serviços avulsos');
  assert.equal(cat('Elisa Moura Prado'), 'Outros serviços avulsos', 'cliente que parou não é recorrente');
  assert.equal(cat('Parceira Contabil LTDA'), 'Parcerias e terceirização');
  assert.equal(cat('Socio Um da Silva', '2026-07-14'), 'Pró-labore / distribuição');
  assert.equal(cat('Socio Um da Silva', '2026-10-13'), 'Aporte / transferência recebida');
  assert.equal(cat('Thomson Reuters Bras'), 'Softwares e sistemas');
  assert.equal(cat('Aplicacao de Cdb'), 'Reserva / aplicação');
  assert.equal(cat('Resgate de Cdb'), 'Resgate de aplicação');
  assert.equal(cat('Igor Nunes'), 'A esclarecer');
  assert.equal(cat('Receita Federal'), 'DARF (tributos federais)');
  assert.ok(!todos.some((l) => /Ecos Solucoes/.test(l.contraparte)));
  assert.equal(todos.find((l) => l.vencimento === '2026-08-06').forma, 'Asaas');
  assert.match(todos.find((l) => l.contraparte === 'Igor Nunes').observacao, /confiança baixa/);
});

test('dashboard: recorrências pelos 3 meses fechados; quem já pagou no mês começa no seguinte', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => g.finImportarDashboard(dadosDashboard()));
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  const rec = Object.fromEntries(p.recorrencias.map((x) => [x.contraparte, x]));
  assert.deepEqual(Object.keys(rec).sort(), ['Alfa Celulares LTDA', 'Beta Autopecas LTDA', 'Carla Dias da Costa', 'Daniel Rocha Lima', 'Socio Um da Silva', 'Thomson Reuters Bras']);
  assert.equal(rec['Carla Dias da Costa'].valor, 250);
  assert.equal(rec['Carla Dias da Costa'].dia, 3);
  assert.equal(rec['Daniel Rocha Lima'].valor, 100);
  assert.equal(rec['Daniel Rocha Lima'].inicio, '2026-11');
  assert.equal(rec['Alfa Celulares LTDA'].valor, 550, 'mediana ignora o pagamento extra de 446');
  assert.equal(rec['Alfa Celulares LTDA'].dia, 8);
  assert.equal(rec['Alfa Celulares LTDA'].forma, 'Asaas');
  assert.equal(rec['Alfa Celulares LTDA'].inicio, '2026-10');
  assert.equal(rec['Beta Autopecas LTDA'].valor, 500);
  assert.equal(rec['Beta Autopecas LTDA'].inicio, '2026-11');
  assert.equal(rec['Socio Um da Silva'].valor, 1850);
  assert.equal(rec['Socio Um da Silva'].dia, 14);
  assert.equal(rec['Socio Um da Silva'].inicio, '2026-11');
  assert.equal(rec['Thomson Reuters Bras'].inicio, '2026-10');
  // Outubro: previsão da BL (não pagou), nenhuma nova da Beta (já pagou).
  const bl = p.receitas.filter((l) => l.contraparte === 'Alfa Celulares LTDA');
  assert.equal(bl.length, 1);
  assert.equal(bl[0].origem, 'RECORRENTE');
  assert.equal(p.receitas.filter((l) => l.contraparte === 'Beta Autopecas LTDA' && l.origem === 'RECORRENTE').length, 0);
  const nov = exec(amb, (g) => g.finCarregar('2026-11'));
  assert.equal(nov.receitas.filter((l) => l.origem === 'RECORRENTE').length, 4);
  assert.equal(nov.despesas.filter((l) => l.origem === 'RECORRENTE').length, 2);
});

test('dashboard: inadimplência real, saldo inicial e DRE com remuneração dos sócios', () => {
  const amb = ambienteInstalado();
  exec(amb, (g) => g.finImportarDashboard(dadosDashboard()));
  const p = exec(amb, (g) => g.finCarregar('2026-10'));
  const inad = Object.fromEntries(p.inadimplentes.map((g) => [g.contraparte, g]));
  assert.equal(inad['Gama Salgados LTDA'].total, 300);
  assert.equal(inad['Gama Salgados LTDA'].quantidade, 2);
  assert.equal(inad['Beta Autopecas LTDA'].total, 50, 'pagamentos abatem as cobranças mais antigas');
  assert.equal(inad['Beta Autopecas LTDA'].itens[0].vencimento, '2026-09-10');
  assert.ok(!inad['Helio Teixeira'], 'pago por Pix não é inadimplente');
  assert.equal(p.totais.saldoInicial, 6450.03);
  assert.equal(p.totais.saldoInformado, true);
  const dre = Object.fromEntries(p.dre.linhas.map((l) => [l.key, l]));
  assert.equal(dre.SOCIOS.realizado, 1850);
  assert.equal(dre.RESULTADO.realizado, centavos(dre.RESULTADO_ANTES_SOCIOS.realizado - 1850));
  assert.equal(p.dre.foraDoResultado.entradas.realizado, 820.8);
});

function centavos(v) { return Math.round(v * 100) / 100; }

test('dashboard: reimportar não duplica; planilha e dashboard não se misturam; só o proprietário importa', () => {
  const amb = ambienteInstalado({ props: { FLUXO_ORIGEM_ID: 'origem' } });
  exec(amb, (g) => g.finImportarDashboard(dadosDashboard()));
  const r = exec(amb, (g) => g.finImportarDashboard(dadosDashboard())).importacao;
  assert.equal(r.importados, 0);
  assert.equal(r.ignorados, 31);
  assert.equal(r.clientes + r.despesasFixas + r.emAtraso + r.saldosIniciais, 0);
  amb.props.FLUXO_ORIGEM_ID = 'origem';
  amb.origem.insertSheet('Fluxo de Caixa').rows.push(LINHAS_ORIGEM[0], LINHAS_ORIGEM[2]);
  assert.throws(() => exec(amb, (g) => g.importarFluxoDeCaixa()), /dashboard financeiro já foi importado/);

  const outro = importar();
  exec(outro, (g) => g.importarFluxoDeCaixa());
  assert.throws(() => exec(outro, (g) => g.finImportarDashboard(dadosDashboard())), /planilha de fluxo de caixa já foi importada/);

  amb.usuarioAtivo = 'equipe@ecoscont.com.br';
  assert.throws(() => exec(amb, (g) => g.finImportarDashboard(dadosDashboard())), /Somente a conta proprietária/);
  assert.equal(exec(amb, (g) => g.finCarregar('2026-10')).proprietario, false);
  assert.throws(() => exec(amb, (g) => g.finImportarDashboard({ aud: [] })), /Somente a conta proprietária/);
  amb.usuarioAtivo = PROPRIETARIO;
  assert.throws(() => exec(amb, (g) => g.finImportarDashboard({ aud: [] })), /sem os lançamentos/);
});
