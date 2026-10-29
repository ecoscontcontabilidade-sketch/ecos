# Operação, limites, LGPD e manutenção

## 1. Limites e cotas relevantes

Confira os valores atuais em https://developers.google.com/apps-script/guides/services/quotas e na documentação de rate limits do ClickUp: eles mudam com o tempo e com o plano.

| Recurso | Limite (referência) | Uso pela Central |
| --- | --- | --- |
| E-mails/dia (conta @gmail.com) | **100 destinatários** | 1 por mudança de status + códigos de login. Acima disso, contrate Google Workspace (1.500/dia) |
| Tempo total de gatilhos/dia (conta gratuita) | 90 min | ~288 execuções/dia de 2 a 5 s ≈ 10 a 25 min |
| Duração de uma execução | 6 min | Sincronização incremental leva segundos. A reconciliação lê ~150 tarefas (2 páginas) |
| Chamadas UrlFetch/dia | 20.000 | ~600/dia + uso do painel |
| CacheService | 100 KB por valor, TTL máx. 6 h | Sessões, códigos, mapeamento de códigos, logo |
| Propriedades do script | 9 KB por valor, 500 KB no total | Configuração |
| ClickUp API | 100 req/min por token (Free/Unlimited/Business) | Bem abaixo; em HTTP 429 o cliente espera e repete |
| Paginação ClickUp | 100 tarefas por página | Tratada automaticamente |

**Latência**: mudanças feitas no ClickUp aparecem em até `SYNC_MINUTOS` (5 min), ou na hora em que alguém abre o painel, que sincroniza antes de exibir.

**Cota de e-mail esgotada**: a notificação fica `FALHOU` ("Cota diária…") e pode ser reenviada no dia seguinte pelo painel.

## 2. "Enviado" ≠ "entregue"

`ENVIADO` significa que o MailApp aceitou a mensagem. O Apps Script não informa entrega, abertura nem rejeição posterior; devoluções chegam como e-mail na caixa da conta remetente. Monitore essa caixa.

## 3. LGPD — dados, acesso e retenção

| Dado | Onde | Finalidade | Retenção |
| --- | --- | --- | --- |
| Nome da empresa, tipo do processo | ClickUp (oficial) e aba Processos | Exibir o acompanhamento | Enquanto o processo existir; após remoção do ClickUp + `RETENCAO_DIAS`, apagados da planilha |
| E-mail do cliente | **Somente no ClickUp** | Enviar notificações | Política do ClickUp |
| E-mail mascarado + hash | Aba Notificacoes | Auditoria de envio sem guardar o endereço | `RETENCAO_DIAS` (padrão 2 anos) |
| CNPJ | Somente no ClickUp | Filtro do painel | Política do ClickUp |
| Histórico de eventos (status, origem, e-mail do usuário interno) | Aba Eventos | Auditoria e divergências | `RETENCAO_DIAS` |
| Códigos de login, sessões | Cache (memória temporária) | Autenticação | 10 min / 6 h |

- **Base legal sugerida**: execução de contrato (prestação do serviço societário). Valide com o DPO/jurídico.
- **Acesso**: planilha e projeto apenas na conta da Ecos; painel apenas para `ADMIN_EMAILS`. Revise a lista de administradores sempre que alguém sair da equipe (o efeito é imediato).
- **Pedido de exclusão do titular**: apague o e-mail no ClickUp, remova a etiqueta e apague as linhas da tarefa nas abas da planilha (filtre pelo ID da tarefa).
- **Retenção**: o gatilho diário apaga eventos/notificações mais antigos que `RETENCAO_DIAS` (mínimo 30).
- **Código vazado**: botão "Gerar novo código" no painel (o antigo deixa de funcionar na hora).

## 4. Rotina de operação

| Frequência | Ação |
| --- | --- |
| Diária | Conferir no painel os indicadores "Falhas de notificação" e "Sem e-mail do cliente" |
| Semanal | Aba **Configuração** do painel: último erro de sincronização, cota de e-mail, gatilhos |
| Ao incluir um processo | Etiqueta + e-mail do cliente + "Nome do cliente"; enviar o link (botão "Copiar link do cliente") |
| Ao sair alguém da equipe | Remover de `ADMIN_EMAILS`; se gerou o token do ClickUp, gerar outro token |
| Trimestral | Trocar o token do ClickUp; revisar as mensagens por status |

**Execuções e logs**: editor do Apps Script → **Execuções**. Erros de sincronização também ficam na aba Eventos (`ERRO_SINCRONIZACAO`).

## 5. Solução de problemas

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| "ClickUp recusou a autenticação (HTTP 401)" | Token inválido ou revogado | Gerar novo token e atualizar `CLICKUP_TOKEN` |
| "O status … não existe na lista do ClickUp" | Status não criado ou com grafia diferente | Ajustar a lista (passo 1.1) |
| Processo não aparece no painel | Sem etiqueta | "Ativar acompanhamento" ou etiqueta no ClickUp |
| E-mails não chegam | Sem e-mail/inválido, cota, `NOTIFICACOES_ATIVAS=false`, spam | Ver a seção Notificações do processo |
| Notificação "Verificar" | A execução caiu durante o envio | Confirmar com o cliente; reenviar se necessário |
| Portal mostra aviso de dados não confirmados | ClickUp indisponível | Exibe o último estado registrado; volta sozinho |
| Gatilho parou | Erro de autorização após alterar escopos | Rodar `instalar` novamente e reautorizar |

## 6. Manutenção e evolução

- **Mudar cores/fontes**: só o bloco `:root` de `src/Styles.html` (e as cores fixas de `EmailStatus.html`, que clientes de e-mail exigem inline).
- **Mudar textos**: aba **Mensagens** do painel (sem publicar nova versão).
- **Novo status no fluxo**: incluir em `STATUS_FLUXO` (`00_Config.gs`), em `MENSAGENS_PADRAO` (`20_Store.gs`) e no ClickUp; atualizar os testes.
- **Antes de publicar uma versão**: `npm test`, revisar o diff com foco em funções globais novas (toda função sem `_` é pública), publicar como **nova versão da mesma implantação**.
- **Evoluções possíveis**:
  - Webhooks em tempo real usando um intermediário (ex.: Cloud Run/Cloud Functions) que valide `X-Signature` e repasse ao Apps Script. A sincronização periódica continua como rede de segurança.
  - Google Workspace para maior cota de e-mail e remetente `@ecoscont.com.br` (com `GmailApp` + alias, que exige o escopo amplo do Gmail).
  - Domínio próprio para o portal (página no site da Ecos com o Web App incorporado).
  - Datas oficiais por etapa via `GET /task/{id}/time_in_status` (exige o ClickApp "Total time in Status").
  - Envio por WhatsApp (API oficial do WhatsApp Business), reaproveitando o registro de notificações.
