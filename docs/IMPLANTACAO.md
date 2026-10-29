# Manual de implantação

Tempo estimado: 40 a 60 minutos. Faça tudo **logado na conta `ecos.cont.contabilidade@gmail.com`**: os e-mails sairão dela e a planilha auxiliar será criada no Drive dela.

## Passo 1 — Preparar o ClickUp

### 1.1 Status da lista "Processos"

Na lista **Processos** (Space *ECOS ASSESSORIA CONTÁBIL*): `…` → **Lista** → **Status de tarefa** (ou *Task statuses*) e deixe estes 7 status, com esta grafia exata:

| Ordem | Status | Situação atual |
| --- | --- | --- |
| 1 | Aguardando Documentação | criar |
| 2 | Viabilidade | criar |
| 3 | DBE | criar |
| 4 | VRE Digital - JUCESP | criar |
| 5 | Em análise | já existe |
| 6 | Exigência | criar |
| 7 | Deferido | já existe |

- O ClickUp grava os nomes em minúsculas; a Central compara sem diferenciar maiúsculas ou acentos.
- Os status antigos (`to do`, `em andamento`, `aguardando retorno`, `licenciamento`, `gerar parcelamento`, `informar cliente`, `complete`) podem continuar existindo para as tarefas internas. Eles **não** geram e-mail e não aparecem na linha do tempo.
- Se quiser que algum status antigo conte como etapa do fluxo, use a propriedade `STATUS_ALIASES` (ex.: `{"complete":"DEFERIDO"}`). Por padrão, nenhum status antigo é mapeado: a Central não presume equivalências.
- Ao remover status com tarefas, o ClickUp pede para movê-las. Revise antes, porque as tarefas fechadas ficam com o status de destino.

### 1.2 Campos personalizados (lista "Processos")

`+` na coluna de campos → criar:

| Nome do campo (exato) | Tipo | Uso | Obrigatório |
| --- | --- | --- | --- |
| `E-mail do cliente` | E-mail | destinatário das notificações | **sim** |
| `Nome do cliente` | Texto | saudação "Olá, Nome." | não |
| `Empresa` | Texto | nome exibido; se vazio, usa o trecho após " - " no nome da tarefa | não |
| `CNPJ` | Texto | filtro do painel (nunca exibido ao cliente) | não |
| `Orientação ao cliente` | Área de texto (texto longo) | texto exibido ao cliente **somente** em Exigência | recomendado |
| `Código de acompanhamento` | Texto | preenchido pela Central (referência para a equipe) | recomendado |

Os nomes podem ser outros: ajuste as propriedades `CAMPO_*`. Nenhum campo existia na análise.

### 1.3 Etiqueta

Crie no Space a etiqueta **`acompanhamento-cliente`** (ou outra, configurando `TAG_ACOMPANHAMENTO`). Só tarefas com ela entram na Central. Aplique-a apenas aos processos societários de clientes, ou use o botão "Ativar acompanhamento" do painel.

### 1.4 Token de API

ClickUp → avatar → **Settings → Apps → API Token → Generate**. O token (`pk_…`) tem as permissões do usuário que o gerou: use um usuário com acesso à lista. Guarde o token só no passo 2.3.

## Passo 2 — Criar o projeto Apps Script

### Opção A — pelo navegador
1. Acesse https://script.google.com → **Novo projeto** → nome: `Central de Processos — Ecos`.
2. **Configurações do projeto** (engrenagem) → marque **"Mostrar o arquivo de manifesto appsscript.json"**.
3. Para cada arquivo de `src/`:
   - `.gs`: **+ → Script**, use o mesmo nome sem extensão (ex.: `00_Config`) e cole o conteúdo.
   - `.html`: **+ → HTML**, mesmo nome sem extensão (ex.: `Styles`, `Portal`, `PortalScript`, `Admin`, `AdminScript`, `EmailStatus`, `EmailCodigo`).
   - `appsscript.json`: substitua o conteúdo.
4. Apague o `Código.gs` vazio criado por padrão.

### Opção B — com clasp
```bash
npm install -g @google/clasp
```
```bash
clasp login
```
```bash
clasp create --type standalone --title "Central de Processos — Ecos" --rootDir src
```
```bash
clasp push
```

### 2.3 Propriedades do script (credenciais)
**Configurações do projeto → Propriedades do script → Adicionar**:

| Propriedade | Valor |
| --- | --- |
| `CLICKUP_TOKEN` | token `pk_…` do passo 1.4 |
| `ADMIN_EMAILS` | e-mails da equipe autorizada, separados por vírgula |

As demais propriedades são criadas no próximo passo com os valores da Ecos e podem ser editadas aqui depois (tabela completa no fim deste documento). Só editores do projeto veem as propriedades: não compartilhe o projeto além do necessário.

## Passo 3 — Instalar

No editor, selecione a função e clique em **Executar**:

1. `descobrirIdsClickUp` → na primeira execução, autorize os escopos (ver "Permissões"). Confira no log que `CLICKUP_LIST_ID=901326635055` corresponde à lista "Processos".
2. `instalar` → grava os IDs e padrões, cria a planilha **"Central de Processos — Base Auxiliar (NÃO COMPARTILHAR)"** e instala os gatilhos (sincronização a cada 5 min e manutenção diária às 3h).
3. `verificarConfiguracao` → o log precisa terminar em **"Configuração OK."**. Se listar pendências (status ou campos ausentes), corrija no ClickUp e rode de novo.
4. `executarTestesInternos` → "Todos os testes internos passaram."

## Passo 4 — Publicar o Web App

1. **Implantar → Nova implantação → tipo: App da Web**.
2. Descrição: `v1.0.0`. **Executar como: Eu** (`ecos.cont.contabilidade@gmail.com`). **Quem pode acessar: Qualquer pessoa**.
3. Copie a URL `https://script.google.com/macros/s/…/exec`.
4. Em Propriedades do script, crie `APP_URL` com essa URL.
5. Portal do cliente: `APP_URL`. Painel: `APP_URL?p=admin`.

Ao alterar o código, use **Implantar → Gerenciar implantações → editar → Nova versão** para manter a mesma URL (os e-mails já enviados contêm essa URL).

> **Por que "Executar como: Eu" + "Qualquer pessoa" é seguro aqui**: o código roda com os privilégios da conta da Ecos, então nenhuma função pode confiar no visitante. O portal só responde por código aleatório e devolve dados mínimos; o painel exige sessão validada no servidor; as funções de instalação recusam chamadas do navegador. Revise esses pontos (seção Segurança de `ARQUITETURA.md`) antes de cada nova versão.

## Passo 5 — Primeira sincronização e validação

1. Aplique a etiqueta e o e-mail em 1 ou 2 processos reais (de preferência com o e-mail de alguém da equipe).
2. Rode `sincronizarAgora` → cadastra os processos **sem enviar e-mails**.
3. Rode `enviarEmailDeTeste` (envia o modelo para a própria conta) e confira o visual no Gmail e no celular.
4. Siga o checklist abaixo.

## Checklist final de validação

- [ ] `verificarConfiguracao` sem pendências.
- [ ] Gatilhos `gatilhoSincronizar` e `gatilhoManutencaoDiaria` aparecem em **Acionadores**.
- [ ] Painel (`?p=admin`): login por código funciona; e-mail não autorizado não recebe código.
- [ ] Indicadores e lista batem com o ClickUp.
- [ ] Mudar o status **no ClickUp** → em até 5 min o portal mostra a nova etapa e chega **um** e-mail.
- [ ] Mudar o status **pelo painel** → ClickUp atualizado, **um** e-mail, nenhum e-mail extra após 10 min.
- [ ] Processo sem e-mail: status muda, painel mostra "Sem e-mail", nenhum envio.
- [ ] Exigência com orientação: aparece no portal e no e-mail; sem orientação, só a mensagem padrão.
- [ ] Código inválido no portal: mensagem genérica; após 10 tentativas, bloqueio temporário.
- [ ] Portal testado no celular (Android/iOS) e no computador.
- [ ] Botão do WhatsApp abre o número oficial.
- [ ] Planilha auxiliar **não** compartilhada com ninguém além da conta proprietária.

## Permissões solicitadas (OAuth)

| Escopo | Motivo |
| --- | --- |
| `script.external_request` | Chamar a API do ClickUp |
| `script.send_mail` | Enviar e-mails com MailApp (sem acesso à caixa de entrada) |
| `script.scriptapp` | Criar e listar gatilhos |
| `spreadsheets` | Criar e usar a planilha auxiliar |
| `drive.readonly` | Ler o arquivo do logo no Drive |
| `userinfo.email` | Identificar o proprietário nas funções de instalação |

No ClickUp, o token herda as permissões do usuário que o gerou (leitura e edição de tarefas da lista).

## Propriedades do script (referência)

| Propriedade | Padrão | Descrição |
| --- | --- | --- |
| `CLICKUP_TOKEN` | — | **Secreto.** Token pessoal do ClickUp |
| `ADMIN_EMAILS` | — | Equipe autorizada no painel |
| `CLICKUP_TEAM_ID` / `CLICKUP_SPACE_ID` / `CLICKUP_FOLDER_ID` / `CLICKUP_LIST_ID` | IDs da análise | Localização da lista (só `CLICKUP_LIST_ID` é usado nas operações) |
| `APP_URL` | URL detectada | URL publicada (usada nos links dos e-mails) |
| `NOME_EXIBICAO` | Ecos Contabilidade | Nome no portal e remetente |
| `ASSINATURA` | Contabilidade próxima, moderna e descomplicada. | Assinatura do e-mail |
| `REPLY_TO` | `CONTATO_EMAIL` | Endereço de resposta dos e-mails |
| `WHATSAPP` | 5511915172014 | Número oficial (DDI+DDD+número) |
| `CONTATO_EMAIL` / `CONTATO_TELEFONE` | contato@ecoscont.com.br / (11) 91517-2014 | Contato exibido |
| `LOGO_FILE_ID` | 1pWHgJJ7…6KCEl07pZ5e6Cn7wgmN | Arquivo do logo no Drive (versão leve ≤ 70 KB recomendada) |
| `TAG_ACOMPANHAMENTO` | acompanhamento-cliente | Etiqueta que inclui a tarefa na Central |
| `CAMPO_EMAIL`, `CAMPO_NOME_CLIENTE`, `CAMPO_EMPRESA`, `CAMPO_CNPJ`, `CAMPO_ORIENTACAO`, `CAMPO_CODIGO` | nomes do passo 1.2 | Nomes dos campos personalizados |
| `SYNC_MINUTOS` | 5 | 1, 5, 10, 15 ou 30 (rode `instalarGatilhos` após mudar) |
| `DIAS_SEM_ATUALIZACAO` | 15 | Limite do indicador "sem atualização recente" |
| `RETENCAO_DIAS` | 730 | Retenção de eventos e notificações (mín. 30) |
| `NOTIFICACOES_ATIVAS` | true | `false` suspende os e-mails (registra como DESATIVADA) |
| `NOTIFICAR_PRIMEIRA_SINCRONIZACAO` | false | `true` envia e-mail quando um processo entra no acompanhamento (exceto na primeira sincronização geral) |
| `STATUS_ALIASES` | `{}` | JSON: status extra do ClickUp → etapa do fluxo |
| `SPREADSHEET_ID`, `HASH_SALT`, `SYNC_CURSOR`, `ULTIMA_*`, `ULTIMO_ERRO_*` | automáticos | Não editar |
