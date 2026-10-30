# Financeiro ECOS — controle interno de contas a receber e a pagar

Painel interno em **Google Apps Script** para abrir no dia e saber **o que receber e o que pagar**. Projeta os honorários do mês, registra as baixas, mostra os inadimplentes e monta uma **DRE gerencial projetada em tempo real** a partir das provisões de despesas.

**Uso exclusivamente interno.** A ferramenta não envia e-mail, cobrança, boleto nem mensagem a clientes. Ela convive com o Asaas: quem paga por lá também é baixado aqui, com a forma "Asaas".

## Abas

| Aba | O que mostra |
| --- | --- |
| **Hoje** | A receber e a pagar hoje, recebimentos e pagamentos em atraso (todos os meses), próximos 7 dias e saldo projetado no fim do mês. Botão **Baixar** em cada item. |
| **A receber** | Previsões de recebimento do mês com filtros (em aberto, vencidos, hoje, a vencer, recebidos) e busca. Incluir, editar, baixar, estornar e excluir. |
| **A pagar** | O mesmo para as despesas do mês. |
| **Inadimplentes** | Clientes com recebimentos vencidos e não baixados, agrupados, com dias de atraso e total. |
| **Dashboard e DRE** | Receitas, despesas, resultado e margem projetados x realizados, inadimplência do mês, saldo de caixa dia a dia (realizado e projetado), despesas por grupo e a DRE gerencial. |
| **Cadastros** | Clientes com honorário mensal e despesas fixas: valor, dia de vencimento, forma, início/término, ativo. |

O mês é escolhido no topo (‹ ›). A aba Hoje é sempre relativa à data de hoje.

## Regras

- **Previsões recorrentes**: ao abrir o mês atual ou um mês futuro (até 12 meses), cada cadastro ativo gera uma previsão com vencimento no dia informado (dia 31 vira o último dia do mês). A geração é idempotente: uma previsão por cadastro e mês, mesmo que ela seja excluída ou movida. Meses passados só são gerados pelo botão **Gerar previsões do mês exibido**.
- **Editar um cadastro** atualiza as previsões em aberto deste mês em diante. **Desativar** cancela as dos meses seguintes. A do mês atual continua, e a equipe decide se exclui.
- **Baixa**: valor e data editáveis, sem data no futuro. Se o valor pago for menor que o previsto, a diferença pode virar uma nova previsão em aberto (baixa parcial).
- **Excluir** é uma exclusão lógica: o lançamento sai das telas e fica registrado na planilha. Lançamentos baixados precisam ser estornados antes de excluir.
- **Mês do lançamento** = mês do vencimento (visão gerencial de caixa projetado).
- **DRE**: *Projetado* soma o valor pago dos baixados e o previsto dos em aberto. *Realizado* soma só as baixas. Reservas, aplicações e transferências ficam fora da DRE e entram apenas no caixa.
- **Saldo de caixa**: parte do saldo inicial informado no mês (no Dashboard, em "Saldo inicial"). Sem ele, usa o último mês informado mais as baixas dos meses seguintes. Até hoje considera só as baixas; depois, as previsões em aberto. **Critério conservador**: recebimentos em atraso não entram na projeção, e pagamentos em atraso entram como se fossem pagos hoje.
- **Inadimplência do mês** = recebimentos vencidos em aberto ÷ total que já venceu no mês.

### Estrutura da DRE

```
  Honorários recorrentes
  Serviços avulsos (abertura/alteração/baixa, regularização, IRPF, certificado…)
= Receita bruta
(−) Impostos sobre o faturamento (DAS, ISS)
= Receita líquida
(−) Custos dos serviços (DAREs/taxas de processos, certificados, comissões)
= Lucro bruto
(−) Folha e equipe · Administrativas (softwares, internet, alimentação…) · Marketing · Impostos, taxas e multas · Outras (inclui "A esclarecer")
= Resultado operacional
(+) Outras receitas
= Resultado antes da remuneração dos sócios
(−) Remuneração dos sócios (pró-labore / distribuição)
= Resultado do mês
```

O plano de categorias fica na aba `Categorias` da planilha. Dá para incluir categorias (nome, tipo `RECEITA`/`DESPESA`, grupo da DRE) ou desativá-las (`ativa` = `false`). Os grupos válidos estão em `src/00_Config.gs` (`GRUPOS`).

## Instalação

1. Crie um projeto em <https://script.google.com> com a conta `ecos.cont.contabilidade@gmail.com` (projeto **separado** da Central de Processos) e copie os arquivos de `financeiro/src/`, incluindo `appsscript.json` (ative "Mostrar arquivo de manifesto" nas configurações). Também dá para usar o `clasp` com `financeiro/.clasp.json.example`.
2. No editor, execute **`instalar`** e autorize. É criada a planilha "Financeiro ECOS — base", com o link no registro de execução. O proprietário passa a ser o único usuário autorizado.
3. **Publique**: Implantar → Nova implantação → App da Web, **Executar como: usuário que acessa o app** e **Quem pode acessar: qualquer pessoa com conta do Google**. O Google exige login, e cada pessoa só lê ou grava se a planilha base tiver sido compartilhada com ela.
4. **Importe o histórico**: com a conta proprietária, abra o painel e use **Cadastros → Importar o Dashboard Financeiro** (detalhes abaixo). Revise os cadastros sugeridos.
5. **Equipe**: compartilhe a planilha base (Editor) com cada pessoa e inclua os e-mails na propriedade `FIN_EMAILS` (separados por vírgula). No primeiro acesso, cada pessoa autoriza o app; o aviso de "app não verificado" é esperado em projetos internos.
6. Execute `verificarConfiguracao` para conferir.

### Importar o histórico: Dashboard Financeiro (recomendado)

O arquivo `Dashboard_Financeiro_Ecos_2026.html` (conciliação do extrato C6 Bank com o Asaas) é a fonte mais completa. Na aba **Cadastros**, a conta proprietária escolhe o arquivo e o painel lê os dados no navegador. O app não precisa de acesso ao Drive.

| O que entra | Como |
| --- | --- |
| Lançamentos do extrato C6 e do Asaas | Baixados, com a categoria convertida para a DRE. A observação guarda a descrição original e a confiança da classificação. **Transferências Asaas → C6 ficam de fora**: o recebimento já conta quando entra no Asaas. |
| Nome do cliente | O do cadastro do dashboard. O extrato traz o nome do Pix ("12.345.678 MARIA…"), e o cliente é achado pelo pagamento (data e valor). |
| Clientes com honorário mensal | Clientes com pagamento em 3 meses ou mais, que não pararam de pagar e pagaram em agosto, setembro ou no mês em curso. Valor = mediana dos pagamentos dos 3 meses fechados (um mês com serviço extra não infla o valor). Dia = mediana dos dias de pagamento. |
| Despesas fixas | Mesmo fornecedor e categoria em 2 dos 3 meses fechados (gastos variáveis como alimentação, DARF e taxas não entram). Valor = mediana dos totais mensais. |
| Mês em curso | Quem já pagou no mês começa a gerar previsão no mês seguinte. Quem não pagou aparece "a receber". |
| Inadimplência | Só a **real** ("Quem realmente deve"): o que o cliente pagou, por Asaas ou Pix, abate as cobranças mais antigas, e o que sobra vira previsão vencida. |
| Boletos já pagos por Pix | Não viram inadimplência. A tela de conclusão lista esses clientes para dar baixa no Asaas e parar os e-mails de cobrança. |
| Saldo inicial de cada mês | Saldo do extrato C6 no primeiro dia (não sobrescreve saldo já informado). |

Rodar de novo não duplica nada. A planilha "Fluxo de caixa" e o dashboard não podem ser importados juntos: o segundo seria recusado para não duplicar valores.

### Alternativa: planilha "Ecos - Fluxo de caixa 2026"

Para importar a planilha antiga, defina a propriedade `FLUXO_ORIGEM_ID` com o ID da planilha (`1utglzkUgb8klFGOMaBr8MRD1xAZJeb9V35pd34EZODU`) e execute **`importarFluxoDeCaixa`** no editor. Ela vai só até agosto de 2026 e as categorias são menos precisas. Prefira o dashboard.

### Propriedades do script

| Propriedade | Uso |
| --- | --- |
| `FIN_SPREADSHEET_ID` | Planilha base (criada pelo `instalar`) |
| `FIN_EMAILS` | E-mails autorizados (o proprietário é incluído na instalação) |
| `PROPRIETARIO` | Conta que pode executar `instalar` e `importarFluxoDeCaixa` |
| `FLUXO_ORIGEM_ID` | Planilha de fluxo de caixa a importar (opcional) |

## Segurança

- Duas barreiras: a planilha só é acessível a quem foi compartilhado, e toda função do navegador confere o e-mail contra `FIN_EMAILS`.
- Funções internas terminam em `_` (o navegador não consegue chamá-las). `instalar` e `importarFluxoDeCaixa` só rodam no editor, pela conta proprietária.
- Dados da planilha são exibidos com `textContent`, nunca como HTML. Textos que começam com `= + - @` são gravados como texto, o que impede fórmulas injetadas.
- Toda alteração fica na aba `Log` (data, usuário, ação, lançamento).
- Nenhum dado de cliente fica no repositório: a importação lê a planilha do Drive na hora.

## Desenvolvimento

```
src/00_Config.gs       tipos, situações, grupos da DRE, plano de categorias
src/01_Util.gs         datas ISO, meses, valores em R$, lock
src/10_Store.gs        planilha base (leitura/gravação por linha, config, log)
src/20_Lancamentos.gs  previsões, baixa, estorno, exclusão, recorrências, saldo inicial
src/30_Relatorios.gs   agenda do dia, inadimplentes, totais, DRE, saldo diário
src/40_Importacao.gs   importação da planilha de fluxo de caixa
src/41_ImportacaoDashboard.gs  importação do Dashboard Financeiro (C6 × Asaas)
src/50_Api.gs          doGet e funções do navegador (fin*)
src/60_Setup.gs        instalar, importarFluxoDeCaixa, verificarConfiguracao
src/Index.html · Script.html · Styles.html   interface
tests/                 testes (node --test) e gerador de capturas
```

```bash
npm test
```

```bash
node financeiro/tests/preview.js preview/financeiro
```

O gerador de capturas aceita, como segundo argumento, o HTML do dashboard (importado pela tela) ou um JSON com as linhas do fluxo de caixa, para ver as telas com dados reais localmente. Não versione esse arquivo.
