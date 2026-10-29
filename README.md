# Central de Processos — Ecos Contabilidade

Portal de acompanhamento de processos societários para clientes e painel interno para a equipe, em **Google Apps Script**, integrado à lista **Processos** do ClickUp (fonte oficial dos dados).

- **Cliente**: consulta o processo por um código seguro (`ECOS-XXXX-XXXX-XXXX`), vê a linha do tempo das 7 etapas e recebe e-mail a cada mudança efetiva de status.
- **Equipe**: painel com indicadores, filtros, histórico, alteração de status sincronizada com o ClickUp, orientação ao cliente em exigências, reenvio controlado de e-mails e mensagens editáveis.

Etapas: Aguardando Documentação → Viabilidade → DBE → VRE Digital - JUCESP → Em análise → Exigência → Deferido.

## Estrutura

```
src/          código do Apps Script (enviar ao projeto)
tests/        testes automatizados (Node) e gerador de capturas
docs/
  ARQUITETURA.md   análise do ClickUp e da identidade, decisões, fluxos, segurança
  IMPLANTACAO.md   configuração do ClickUp, instalação, publicação, checklist
  TESTES.md        testes automatizados e roteiro manual
  OPERACAO.md      cotas, LGPD, rotina, solução de problemas, evolução
```

## Início rápido

1. Configure status, campos e etiqueta no ClickUp ([docs/IMPLANTACAO.md](docs/IMPLANTACAO.md#passo-1--preparar-o-clickup)).
2. Crie o projeto Apps Script com os arquivos de `src/` e defina `CLICKUP_TOKEN` e `ADMIN_EMAILS` nas Propriedades do script.
3. Execute `instalar` e depois `verificarConfiguracao`.
4. Publique como App da Web (executar como você, acesso: qualquer pessoa) e grave `APP_URL`.
5. Portal: `APP_URL`. Painel: `APP_URL?p=admin`.

## Testes

```bash
npm test
```

## Dependências externas

| Dependência | Configuração |
| --- | --- |
| Lista "Processos" no ClickUp com os 7 status | Manual, no ClickUp (passo 1.1) |
| E-mail do cliente na descrição da tarefa (`E-mail do cliente: …`) | Por tarefa, no ClickUp (passo 1.2) |
| Etiqueta `acompanhamento-cliente` | Manual, no ClickUp (passo 1.3) |
| Token de API do ClickUp | Propriedade `CLICKUP_TOKEN` |
| Conta Google que publica e envia os e-mails | `ecos.cont.contabilidade@gmail.com` (100 e-mails/dia na conta gratuita) |
