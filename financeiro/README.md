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
(−) Pessoal e pró-labore · Administrativas (softwares, internet, aluguel…) · Marketing · Impostos, taxas e multas · Outras
= Resultado operacional
(+) Outras receitas
= Resultado do mês
```

O plano de categorias fica na aba `Categorias` da planilha. Dá para incluir categorias (nome, tipo `RECEITA`/`DESPESA`, grupo da DRE) ou desativá-las (`ativa` = `false`). Os grupos válidos estão em `src/00_Config.gs` (`GRUPOS`).

## Instalação

1. Crie um projeto em <https://script.google.com> com a conta `ecos.cont.contabilidade@gmail.com` (projeto **separado** da Central de Processos) e copie os arquivos de `financeiro/src/`, incluindo `appsscript.json` (ative "Mostrar arquivo de manifesto" nas configurações). Também dá para usar o `clasp` com `financeiro/.clasp.json.example`.
2. No editor, execute **`instalar`** e autorize. É criada a planilha "Financeiro ECOS — base", com o link no registro de execução. O proprietário passa a ser o único usuário autorizado.
3. *(Opcional, recomendado)* Importe o histórico:
   - Em Configurações do projeto → Propriedades do script, crie `FLUXO_ORIGEM_ID` com o ID da planilha **Ecos - Fluxo de caixa 2026** (`1utglzkUgb8klFGOMaBr8MRD1xAZJeb9V35pd34EZODU`).
   - Execute **`importarFluxoDeCaixa`**. Cada linha da aba "Fluxo de Caixa" vira um lançamento baixado, com a categoria convertida para o plano da DRE (ex.: Jettax/Domínio/Claude → Softwares, DAREs → Custos dos serviços). Com base nos 3 últimos meses importados, são criados os **clientes com honorário mensal** e as **despesas fixas**, ativos a partir do mês seguinte ao último importado. Pode ser executada de novo sem duplicar.
   - Na aba Cadastros, revise valores e dias. No Dashboard de setembro, informe o **saldo inicial** e use **Gerar previsões do mês exibido** se quiser baixar setembro também.
4. **Publique**: Implantar → Nova implantação → App da Web, **Executar como: usuário que acessa o app** e **Quem pode acessar: qualquer pessoa com conta do Google**. O Google exige login, e cada pessoa só lê ou grava se a planilha base tiver sido compartilhada com ela.
5. **Equipe**: compartilhe a planilha base (Editor) com cada pessoa e inclua os e-mails na propriedade `FIN_EMAILS` (separados por vírgula). No primeiro acesso, cada pessoa autoriza o app; o aviso de "app não verificado" é esperado em projetos internos.
6. Execute `verificarConfiguracao` para conferir.

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
src/40_Importacao.gs   importação do fluxo de caixa e sugestão de recorrências
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

O gerador de capturas aceita um JSON com as linhas do fluxo de caixa como segundo argumento, para ver as telas com dados reais localmente. Não versione esse arquivo.
