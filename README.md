# Tarefas: demo offline

Gerenciador pessoal de tarefas com quatro campos independentes: Quando, Até, Repetir e Lembrar.
O escopo e as regras (R1 a R12) estão no [documento de escopo](https://claude.ai/artifact/2c4hW8AsWTP1yRBnESSNKY).

Não há etapa de build nem dependências: são arquivos estáticos em HTML, CSS e JavaScript.

## Rodar no PC

Na pasta do projeto:

```bash
python -m http.server 8765 --bind 127.0.0.1
```

- App: http://localhost:8765/
- Testes das regras: http://localhost:8765/tests/index.html
- Testes do servidor (worker com SQLite em memória no lugar do D1): http://localhost:8765/tests/worker-harness.html

## Instalar no Android

O Chrome no Android só instala o app e permite o uso offline se ele estiver em HTTPS.

1. Publique esta pasta em uma hospedagem estática, como GitHub Pages ou Cloudflare Pages.
2. Abra o endereço no Chrome do celular.
3. No menu do Chrome, toque em "Adicionar à tela inicial" ou "Instalar app".
4. Em Config., no app, toque em "Ativar notificações".

A hospedagem guarda só o código. As tarefas ficam no aparelho.

## Temas

Em Config., escolha entre Barquinho (claro, padrão), Diamante (escuro), Folha (claro), Marca-texto (claro) ou Sistema, que alterna entre Diamante e Barquinho.
No Marca-texto, dá para trocar a cor do destaque por uma das oito sugestões ou por qualquer outra.

As fontes ficam em `fonts/` para funcionar offline: Bitter, Manrope, Nunito, Figtree e Bricolage Grotesque, do Google Fonts (licença SIL Open Font License).

Botões em cinza são funções planejadas, ainda sem ação.

## Sincronização

Em Config. > Sincronização, crie a conta no aparelho que tem os dados e entre com ela nos outros. Entrar substitui as tarefas locais do aparelho pelas da sincronização.

O servidor (`server/worker.js`) roda em Cloudflare Workers com banco D1. A senha não sai do aparelho: ele envia ao servidor uma prova derivada com PBKDF2 (600 mil iterações). O servidor guarda só o hash dessa prova e das sessões, e bloqueia novas tentativas por 15 minutos após 5 erros. As tarefas ficam no banco sem criptografia de ponta a ponta. Na edição do mesmo campo em dois aparelhos, a mais recente vence.

## Lembretes com o app fechado

Em Config. > Lembretes com o app fechado, marque "Receber neste aparelho" em cada aparelho. É preciso estar conectado na sincronização.

- A cada minuto, um Cron Trigger do Worker procura os avisos vencidos e manda um push **sem conteúdo** para cada aparelho inscrito. Ao receber, o service worker busca em `/push/due` o título e o texto. Sem criptografia por mensagem e com a assinatura VAPID guardada por 12 horas, o envio gasta pouca CPU.
- A agenda é calculada no aparelho (`js/push-core.js`) e enviada ao servidor depois de cada sincronização, só quando muda. Ela cobre 14 dias, com no máximo 250 avisos.
- Se o app estiver aberto na tela, ele mesmo avisa, e o push não repete o aviso.
- Vários lembretes por tarefa, "Insistir até eu reagir" (a cada 5, 10, 15 ou 30 min, até 12 vezes) e resumo diário com as tarefas de Hoje. O resumo e o intervalo valem para a conta toda.
- O par de chaves VAPID é criado pelo próprio Worker e guardado no D1. As tabelas `push_subs` e `push_queue` também são criadas sozinhas.
- O Worker precisa do Cron Trigger `* * * * *`, configurado na implantação.

## Limitações desta versão

- Sem sincronização, cada aparelho tem dados próprios, e limpar os dados do navegador apaga as tarefas. Faça backups.
- Com o app fechado, tocar em Concluir ou Adiar abre o app para registrar a ação.
- Sem widget Android, Google Agenda, listas compartilhadas ou importação direta do To Do.

## Estado do projeto (6 de novembro de 2026)

### Lote B, publicado em 6 de novembro (app) e 9 de novembro (servidor)

- Lembretes com o app fechado (push enviado pelo servidor), ativados por aparelho em Config.
- Vários lembretes por tarefa, lembrete insistente e resumo diário.
- Formato dos dados: as tarefas ganharam os campos opcionais `extraReminders`, `insist` e `snoozedFor`. Nada foi removido nem renomeado. O login não mudou.
- Servidor implantado em 9/11 com o Cron Trigger `* * * * *`. O cron roda por volta do segundo 18 de cada minuto, o que dá cerca de 20 segundos de atraso.
- Medido na Cloudflare, numa cópia descartável do Worker: 6 ms de CPU no minuto com envio (incluindo a assinatura VAPID) e 2 ms nos minutos sem aviso. Chamadas normais ficam em torno de 4 ms.

### Lote A, publicado em 6 de novembro

- Importante (estrela e visão própria), tags com filtro e busca.
- Repetição a partir da conclusão e "terminar após N vezes".
- Modos do campo Até em Config.: A (campo único), B (dois campos) e C (fim dentro de Repetir).
- Arrastar para ordenar em Hoje e nas listas, também pelas setas do teclado.
- Datas digitadas no campo de adicionar, com prévia e opção de ignorar ("pagar luz sexta 9h", "toda segunda", "até 30/11").
- Próximos dias em Lista, Calendário, Kanban (por lista) e Matriz (importante × urgente).
- "Compartilhar para Tarefas" no Android, atalhos no ícone (Nova tarefa, Próximos dias) e teclas N e / no note.
- Correção do modo offline, que podia guardar arquivos antigos e exigir várias recargas para mostrar uma versão nova.

- **Publicado:** https://brunoignr-code.github.io/tarefas/, com o tema Barquinho como padrão e os temas Diamante, Folha e Marca-texto em Config.
- **Servidor:** Cloudflare Worker `tarefas-sync`, com banco D1 `tarefas` e Cron Trigger a cada minuto, no plano gratuito (sem custo; passar do limite faz o pedido falhar, não gera cobrança). Este PC não tem Node, então o deploy de `server/worker.js` é feito pela API do painel da Cloudflare, no Chrome do usuário. O Worker precisa ser reimplantado à parte: publicar no GitHub não o atualiza.
- **Migração:** as tarefas abertas do To Do foram para um JSON, fora do repositório, sem as tarefas de senha. Com o lembrete como referência, a data dele virou Quando.
- **Aparelhos:** 1 notebook e 2 celulares Android, um deles A55. O note é a base da sincronização.

### Testado

- Regras, cores, datas digitadas e agenda dos avisos em 57 testes automáticos.
- Ciclo completo do push numa cópia descartável do Worker e do D1, apagadas depois: agenda, cron, envio ao FCM e remoção da inscrição recusada.
- Servidor do lote B em 21 testes, no navegador, com SQLite em memória no lugar do D1: chaves VAPID, assinatura do JWT, inscrições, agenda, envio pelo cron sem repetição e remoção de aparelhos que saíram.
- Vários lembretes, insistência, adiamento e o painel de Config. no navegador, com dados de teste.
- Lote A no navegador, em tamanho de celular e de note, com dados de teste.
- Sincronização e login em dois aparelhos simulados, com credenciais descartáveis.
- Tema, capa e fonte em tamanho de celular, no navegador.

### Ainda não confirmado nos aparelhos reais

- Sincronização entre o note e os dois celulares.
- Instalação no Android e novo ícone. O Android pode demorar para trocar o ícone de um app já instalado.
- Notificações e os botões Concluir e Adiar.
- Uso sem internet no endereço publicado.
- Compartilhar de outro app, atalhos no ícone e arrastar com o dedo.
- Todo o lote B com o app fechado num celular real: chegada do push, atraso, Android em economia de bateria, Concluir e Adiar.

### Próximos passos conhecidos

- Coletar os feedbacks de uso real e ajustar.
- Ativar "Receber neste aparelho" nos celulares e fazer o "Testar com o app fechado".
- Congelar funções novas e, depois de 1 ou 2 semanas de uso, retirar o que não foi usado (candidatos: Kanban, Matriz e os modos B e C do Até). Hábitos, Pomodoro, Google Agenda, listas compartilhadas e importação do To Do foram desaconselhados por fugirem do objetivo.
- Definir o nome do app. Hoje ele aparece como "Tarefas" na capa e no ícone instalado.
- Atualizar o canvas de temas, que ainda mostra "Ajustes" e não tem o Barquinho.
- Escopo e decisões: [documento de escopo](https://claude.ai/artifact/2c4hW8AsWTP1yRBnESSNKY). O catálogo ainda traz a ordem antiga de algumas fases.

## Estrutura

- `server/worker.js`: servidor de sincronização e login.
- `js/sync-core.js` e `js/sync.js`: regras de junção e conversa com o servidor.
- `js/push-core.js` e `js/push.js`: agenda dos avisos com o app fechado e inscrição do aparelho.

- `js/rules.js`: regras de datas, sem dependência de tela ou banco.
- `js/parse.js`: entende datas, horários e repetições digitadas.
- `js/theme.js`: temas e cálculos de cor do marca-texto.
- `js/db.js`: armazenamento local em IndexedDB.
- `js/app.js`: telas e interações.
- `sw.js`: cache offline, avisos recebidos por push e botões das notificações. Ao mudar a lista de arquivos, atualize `FILES` e `CACHE`. A cada publicação, suba `CACHE` e `APP_VERSION` (em `js/app.js`), que aparece no rodapé de Config.
- `tests/`: testes das regras, executados no navegador.
- `tools/make_icons.py`: gera os ícones em `icons/`.
