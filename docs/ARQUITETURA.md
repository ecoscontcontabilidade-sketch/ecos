# Arquitetura — Central de Processos Ecos

## 1. Análise realizada (29/10/2026)

### ClickUp (consultado via API)

| Item | Valor encontrado |
| --- | --- |
| Workspace | `90132062538` |
| Space | `ECOS ASSESSORIA CONTÁBIL` — `90138710247` |
| Folder | nenhuma (lista sem pasta; a API mostra a pasta oculta `hidden`) |
| Lista | `Processos` — `901326635055` |
| Status atuais da lista | `to do`, `em andamento`, `em análise`, `deferido`, `aguardando retorno`, `licenciamento`, `gerar parcelamento`, `informar cliente`, `complete` |
| Campos personalizados | **nenhum** (na lista, no Space e no Workspace) |
| Conteúdo | ~150 tarefas. Há processos societários (alteração contratual, abertura, desenquadramento, regularização, encerramento) **misturados** com tarefas internas (IR, Instagram, cadastros SIEG, cobranças). |

Consequências para o projeto:

1. **Status**: dos 7 status exigidos, só `Em análise` e `Deferido` existem. Os outros 5 precisam ser criados na lista (procedimento em `IMPLANTACAO.md`). A aplicação não altera a configuração da lista por conta própria.
2. **Campos**: não há e-mail, CNPJ nem nome do cliente nas tarefas. O e-mail é **indispensável** para as notificações; os demais são opcionais (empresa e tipo são extraídos do nome da tarefa, no padrão `TIPO - EMPRESA` que a equipe já usa).
3. **Lista mista**: para não expor nem notificar tarefas internas, só participam da Central as tarefas com a etiqueta **`acompanhamento-cliente`** (configurável). O painel lista as tarefas sem etiqueta e permite ativá-las com um clique.

### Identidade visual (Drive)

Fonte: `Controle Interno ECOS/…/Identidade Visual.md` (declarada "fonte única de verdade", atualizada em 31/08/2026).

- Paleta: Verde Floresta `#123B2A` (primária), Verde Musgo `#5C9A4A`, Verde Névoa `#DCE6DB`, Areia `#F8F6F0` (fundo), Grafite `#201F1C` (texto), Bronze `#A8831E` (acento moderado).
- Tipografia: Fraunces (display), Manrope (títulos), Inter (corpo), IBM Plex Mono (dados).
- Regras respeitadas: fundo Areia dominante; Floresta só como destaque (barra do painel, botões, cabeçalho de tabela); Bronze apenas no alerta de "Exigência"; sem ícones clichê (calculadora, cifrão etc.).
- Logo: arquivo oficial `Logotipo simplificada - Ecos contabilidade.png` (ID `1pWHgJJ7xleiUB6KCEl07pZ5e6Cn7wgmN`), carregado do Drive **sem alteração**. Na falta dele, a interface mostra o nome em Fraunces.
- Divergência observada: o documento `ECOS-Identidade-Visual-2.0.html` (anterior) usa `#123B22` e `#A8813E`; adotamos os valores do `.md`, mais recente e declarado oficial. Todos os tokens ficam em `src/Styles.html` (`:root`) para ajuste.
- Contato oficial: WhatsApp (11) 91517-2014, `contato@ecoscont.com.br`.
- Nome: o prompt pede "Ecos Contabilidade"; o manual cita "ECOS Assessoria Contábil" como nome comercial. Fica configurável em `NOME_EXIBICAO`.

### Restrições do Google Apps Script que moldaram a arquitetura

| Restrição | Impacto | Decisão |
| --- | --- | --- |
| `doPost` do Web App responde com redirecionamento 302 e não expõe cabeçalhos HTTP | Webhooks do ClickUp podem falhar e a assinatura `X-Signature` não pode ser validada | **Sincronização periódica** (gatilho de tempo) + reconciliação diária |
| Portal precisa atender clientes sem conta Google | Publicação "Executar como: eu" + "Qualquer pessoa" | Toda função pública valida o chamador no servidor |
| Nessa publicação o Apps Script não identifica o visitante | Não dá para usar a conta Google para o painel | Login próprio por **código de uso único** enviado ao e-mail autorizado |
| Toda função global é chamável via `google.script.run` | Visitantes poderiam chamar funções internas | Funções internas terminam em `_` (privadas); funções públicas validam sessão/contexto |
| Não há IP do visitante | Limite de tentativas por IP impossível | Código de 60 bits + limite por navegador + freio global |
| Execução máx. 6 min; cotas diárias | Volume de chamadas e e-mails limitado | Sincronização incremental (`date_updated_gt`), cache de 10 min, controle de cota de e-mail |

## 2. Visão geral

```
                ┌──────────────────────────── Google Apps Script (executa como a conta da Ecos) ───────────────────────────┐
 Cliente ──►    │  doGet → Portal.html ──google.script.run──► portalConsultar(código)   ─┐                                │
 (navegador)    │                                                                         │                                │
 Equipe  ──►    │  doGet?p=admin → Admin.html ──► admin*(token, …) ──► exigirAdmin_()    ├─► Regras (30_Processos)        │
                │                                                                         │        │                       │
 Gatilho 5 min ─┤  gatilhoSincronizar ─► sincronizar_() ─────────────────────────────────┘        ▼                       │
 Gatilho diário ┤  gatilhoManutencaoDiaria ─► reconciliação + retenção          ┌─ ClickUp API v2 (fonte oficial) ◄─ token│
                │                                                                ├─ Planilha auxiliar (privada)            │
                │                                                                └─ MailApp (e-mails ao cliente)           │
                └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Arquivos (`src/`)

| Arquivo | Responsabilidade |
| --- | --- |
| `00_Config.gs` | Fluxo de 7 status, valores padrão, leitura de propriedades, mapeamento de status |
| `01_Util.gs` | Erros, texto, datas BR, hashes, código público, lock, contadores, verificação de contexto interno |
| `10_ClickUp.gs` | Cliente da API v2 (retentativas, 429, paginação) |
| `20_Store.gs` | Base auxiliar em planilha: processos, eventos, notificações, mensagens, retenção |
| `30_Processos.gs` | Tarefa → processo, linha do tempo, visão pública mínima |
| `40_Sync.gs` | Sincronização, detecção de mudanças, registro de mudanças, gatilhos |
| `50_Notificacoes.gs` | E-mails, deduplicação, reenvio controlado, logo |
| `60_Auth.gs` | Login do painel por código, sessões, limites de tentativa |
| `70_Api.gs` | `doGet` e funções chamadas pelo navegador (portal e painel) |
| `80_Setup.gs` | Instalação, descoberta de IDs, gatilhos, diagnóstico, e-mail de teste |
| `Styles.html` | Tokens da identidade visual e componentes compartilhados |
| `Portal.html` / `PortalScript.html` | Portal público |
| `Admin.html` / `AdminScript.html` | Painel interno |
| `EmailStatus.html` / `EmailCodigo.html` | Modelos de e-mail |

## 3. Dados

O **ClickUp é a fonte oficial**: nome, status, responsáveis, datas, e-mail e orientação são sempre lidos dele. A planilha auxiliar guarda apenas o que o ClickUp não guarda, sempre indexado pelo ID da tarefa:

| Aba | Conteúdo | Observação |
| --- | --- | --- |
| `Processos` | ID da tarefa, código público, último status observado, última etapa do fluxo, pendência de e-mail, última notificação | Base da detecção de mudanças. Não guarda e-mail nem CNPJ. |
| `Eventos` | Histórico/auditoria (mudanças, origem, usuário, resultado da sincronização e da notificação, erros, logins) | IDs determinísticos para mudanças de status |
| `Notificacoes` | Uma linha por notificação: e-mail **mascarado** + hash, status anterior/novo, situação, tentativas, erro | Chave única = evento |
| `Mensagens` | Textos por status (editáveis pelo painel) | Fallback para os textos padrão |

A reconciliação diária compara a lista inteira com a planilha: tarefas excluídas/arquivadas/movidas têm a consulta pública desativada.

## 4. Fluxos

### Cenário A — alteração no ClickUp
1. Gatilho (5 min) busca tarefas com `date_updated_gt = cursor − 2 min`.
2. Para cada tarefa com etiqueta: compara o status com o último observado.
3. Se mudou: registra `STATUS_ALTERADO` (origem CLICKUP), atualiza o registro e, se a nova etapa do fluxo for diferente da anterior, cria a notificação e envia.
4. O cursor só avança após o processamento; falhas da API não perdem mudanças.

### Cenário B — alteração pela plataforma
1. Painel envia `adminAlterarStatus(token, taskId, novoStatus, statusExibido)`.
2. Servidor valida sessão, status, tarefa (existe e pertence à lista), etiqueta e conflito (status mudou desde que a tela foi carregada?).
3. Sob lock: `PUT /task/{id}` com o nome exato do status na lista; **relê a tarefa** para confirmar.
4. Só então registra o evento (origem PLATAFORMA, usuário) e envia **uma** notificação.
5. A próxima sincronização encontra o status já registrado → nenhum e-mail extra.

### Cenário C — falhas
- Erro do ClickUp ao alterar: nada é registrado como concluído, a interface mostra o erro, o evento `ERRO_ALTERACAO_STATUS` fica no histórico, e a equipe pode tentar de novo.
- Se o `PUT` for aceito e a releitura falhar, a tela informa que a alteração não foi confirmada; a sincronização seguinte detecta o novo status e notifica uma única vez.
- Erro de e-mail após a confirmação no ClickUp: o status permanece; a notificação fica `FALHOU` com reenvio manual no painel.
- Erro de sincronização: registrado uma vez (sem repetir o mesmo erro a cada 5 min) e exibido no painel.

### Prevenção de duplicidade
- Mudança detectada só se o status difere do último registrado (gravado na mesma execução, sob `LockService`).
- ID do evento = SHA-256(tarefa | status anterior | status novo | data de atualização) → a mesma mudança vista duas vezes não gera dois eventos.
- Uma notificação por evento (verificada antes de criar).
- Registro `ENVIANDO` antes do envio: se a execução cair, o painel mostra "Verificar" e só reenvia com confirmação.
- Mudanças rápidas entre duas verificações (A→B→C em menos de 5 min) geram um e-mail só, para o status final.

### Regras de exibição
- Status fora do fluxo (`to do`, `complete` etc.) não notificam; o portal mantém a última etapa conhecida.
- `Exigência` só aparece como concluída na linha do tempo se de fato ocorreu.
- Em retrocesso, etapas posteriores voltam a "futuras" (sem data) e o e-mail usa o título neutro "Seu processo foi atualizado".
- A orientação ao cliente vem de um campo próprio do ClickUp e só aparece em `Exigência`, o que garante que o texto foi escrito para o cliente.

## 5. Segurança

- **Isolamento entre clientes**: consulta somente por código público aleatório `ECOS-XXXX-XXXX-XXXX` (60 bits; não deriva do ID da tarefa nem do CNPJ). A mesma mensagem de erro para código inexistente, inválido ou desativado.
- **Exposição mínima no portal**: empresa, tipo de processo, código, status, datas das etapas, mensagem e orientação autorizada. Sem CNPJ, e-mail, responsáveis, descrição, comentários, links ou IDs do ClickUp.
- **Painel**: código de 6 dígitos (10 min, 5 tentativas, 3 pedidos/15 min por e-mail) → sessão aleatória de 256 bits guardada só no servidor (6 h). A autorização é reconferida em cada chamada contra `ADMIN_EMAILS`.
- **IDs do navegador nunca são confiáveis**: toda ação relê a tarefa no ClickUp e confere a lista.
- **Funções internas** protegidas por `_` ou por `exigirContextoInterno_` (gatilho real ou proprietário no editor).
- **Token do ClickUp** só nas Propriedades do script; nunca vai para HTML, logs, planilha ou mensagens de erro.
- **Conteúdo não confiável** (nomes, orientações) é escapado nos templates e inserido com `textContent` no navegador.
- **Fórmulas**: textos iniciados por `= + - @` são gravados como texto na planilha.
