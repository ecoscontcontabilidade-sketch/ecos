# Procedimento de testes

## 1. Testes automatizados (Node, sem rede)

`tests/harness.js` simula o Apps Script (planilha, cache, lock, e-mail, gatilhos, templates) e um servidor ClickUp falso. O código de `src/` roda **sem modificação**.

```bash
npm test
```

Cobertura (29 testes):

| Requisito | Teste |
| --- | --- |
| 7 status, nomenclatura e ordem | `mapeia os 7 status…` |
| Linha do tempo (concluídas, atual, futuras, exigência, retrocesso) | `linha do tempo…` |
| Código público aleatório, sem relação com o ID | `código público…` |
| Cenário A: alteração no ClickUp, sem e-mail na 1ª sincronização, sem duplicidade | `primeira sincronização…` |
| Status fora do fluxo | `status fora do fluxo…` |
| E-mail ausente | `processo sem e-mail…` |
| Falha de envio + reenvio controlado | `falha no envio…` |
| Falha da API na sincronização | `falha da API do ClickUp na sincronização…` |
| Cenário B + nenhuma duplicidade após sincronizar | `alteração pela plataforma…` |
| Conflito de edição simultânea | `conflito…` |
| Cenário C: falha no PUT | `falha do ClickUp ao alterar status…` |
| Status ausente na lista | `status inexistente…` |
| Acesso não autorizado ao painel e às funções internas | `funções administrativas…`, `funções de instalação…`, `login…` |
| Isolamento entre clientes e dados mínimos | `portal: consulta válida…` |
| Limite de tentativas | `portal: limite de tentativas…` |
| Revogação de código / remoção da etiqueta | `portal: remoção da etiqueta…` |
| ClickUp fora do ar no portal | `portal: ClickUp indisponível…` |
| Indicadores do painel | `painel: resumo…` |
| Tarefa de outra lista | `painel: tarefa de outra lista…` |
| Mensagens editáveis e escape de HTML | `mensagens editáveis…` |
| Título neutro em retrocesso | `retrocesso de etapa…` |
| Retenção LGPD | `retenção remove eventos antigos` |
| Escape de parâmetros da URL | `doGet renderiza…` |

### Capturas de tela (desktop e celular)

```bash
node tests/preview.js ./preview
```

Gera telas do portal (início e exigência), do painel (lista e detalhe) e do e-mail com dados simulados, em 1280 px e 390 px.

## 2. Testes no Apps Script (antes de liberar)

1. `executarTestesInternos` — lógica básica no ambiente real.
2. `verificarConfiguracao` — status e campos do ClickUp.
3. `enviarEmailDeTeste` — renderização real no Gmail (desktop e app).

## 3. Roteiro manual com o ClickUp real

Use uma tarefa de teste com a etiqueta e o e-mail de alguém da equipe.

| # | Ação | Resultado esperado |
| --- | --- | --- |
| 1 | Criar tarefa `TESTE - EMPRESA TESTE` em "Aguardando Documentação" com etiqueta | Em até 5 min aparece no painel com código; **nenhum** e-mail |
| 2 | Mudar no ClickUp para Viabilidade | 1 e-mail "Seu processo avançou!"; histórico com origem CLICKUP |
| 3 | Aguardar 15 min sem mudanças | Nenhum e-mail novo |
| 4 | No painel, mudar para DBE | ClickUp mostra "dbe"; 1 e-mail; origem PLATAFORMA com o seu e-mail |
| 5 | Repetir os passos para VRE, Em análise, Exigência, Deferido | Um e-mail por mudança; linha do tempo correta; Exigência com aviso Bronze; Deferido com próximos passos |
| 6 | Preencher "Orientação ao cliente" e pôr em Exigência | Orientação no portal e no e-mail |
| 7 | Voltar de Em análise para DBE | E-mail com "Seu processo foi atualizado" |
| 8 | Apagar o e-mail do cliente e mudar status | Status muda; painel mostra "Sem e-mail"; notificação SEM_EMAIL |
| 9 | Colocar `NOTIFICACOES_ATIVAS=false`, mudar status, voltar a `true` | Notificação DESATIVADA, nenhum envio |
| 10 | Revogar o token (`CLICKUP_TOKEN` inválido) e tentar mudar status no painel | Erro claro; nada muda; evento de erro. Restaurar o token |
| 11 | Abrir o portal com código alterado em 1 caractere | Mensagem genérica |
| 12 | Abrir `?p=admin` em janela anônima e chamar `google.script.run.adminResumo('x')` no console | "Sessão expirada" |
| 13 | Remover a etiqueta | Em até 5 min o código para de funcionar |
| 14 | Portal no celular (Chrome Android e Safari iOS) | Layout em coluna única, sem rolagem horizontal |

Depois dos testes, exclua a tarefa de teste e rode `reconciliarAgora` (o processo é desativado).
