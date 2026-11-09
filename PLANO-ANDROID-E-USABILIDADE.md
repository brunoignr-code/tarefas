# Plano: app Android (item 7) e usabilidade do zero (item 8)

Escrito em 9/11/2026, depois da v11.

**Andamento (9/11):** item 7 feito pelo caminho 1 (TWA), por decisão sua, até o app amadurecer; widget depois. Ver "App Android" no README. Item 8 ainda não começou.

## 7. O que falta para ser um app Android

### Onde estamos

Instalado pelo Chrome ("Instalar app"), o app já aparece na gaveta do Android com ícone e nome próprios, abre sem a barra do navegador e recebe notificações pelo servidor (push web). O que um app nativo daria a mais:

| Recurso | App instalado pelo Chrome (hoje) | Casca nativa |
|---|---|---|
| Lembrete com o app fechado | Depende do servidor da Cloudflare e da internet, com cerca de 20 s de atraso | Alarme do próprio Android, exato, sem internet e sem servidor |
| Concluir e Adiar pela notificação | Abre o app para registrar | Registra direto, sem abrir |
| Som e canal de notificação próprios | Os do Chrome | Próprios, ajustáveis nas configurações do Android |
| Widget na tela inicial | Não | Sim (exige código Kotlin) |
| Economia de bateria da Samsung | Afeta o Chrome | Dá para liberar só este app (como no Sentinela) |

### O que o Sentinela já resolveu

No projeto Sentinela (`C:\Python - local\safe-at-home`) você já fez: Android Studio instalado, depuração USB ligada nos aparelhos, instalação por cabo com o botão Run, permissões de alarme exato e de notificação, e bateria "Irrestrito" na Samsung. Tudo isso se reaproveita aqui. O Firebase do Sentinela não é necessário: os lembretes seriam locais.

### Caminhos

1. **TWA (Trusted Web Activity), por Bubblewrap ou PWABuilder.** Empacota o site atual num APK. É rápido, mas pouco muda na prática: os lembretes continuam vindo do servidor. Exige o arquivo `assetlinks.json` na raiz do domínio (`brunoignr-code.github.io/.well-known/`), o que pede um repositório `brunoignr-code.github.io` à parte. Bubblewrap precisa de Node, que este PC não tem.
2. **Casca Kotlin com WebView e alarmes nativos (recomendado).** Um projeto Android como o do Sentinela, que abre o mesmo HTML/CSS/JS do app, guardado dentro do APK, e oferece uma ponte para o JavaScript agendar lembretes com o `AlarmManager`. As notificações ganham Concluir e Adiar de verdade. Não precisa de Node nem de Firebase.
3. **Capacitor.** Faz o mesmo que o caminho 2 com plugins prontos, mas exige instalar Node e aprender a ferramenta.

### Proposta para o próximo chat (caminho 2)

1. Criar `android/` neste repositório: Kotlin, `minSdk` 29 (cobre o A55), WebView com os arquivos do app copiados no build.
2. Ponte JS ↔ Android: `agendarLembretes(lista)`, usando a mesma agenda de `js/push-core.js`, e `cancelar(id)`. Receiver para disparar a notificação com Concluir, Adiar e Abrir, e reagendar tudo depois que o celular reinicia.
3. No app web: se estiver dentro da casca, usar a ponte; senão, seguir com o push do servidor.
4. Instalação por cabo, como no Sentinela. Sem Play Store, que exige a taxa de US$ 25 e um teste fechado com 12 pessoas por 14 dias.
5. Testar no A55: lembrete com o celular bloqueado, sem internet, depois de reiniciar e com economia de bateria.

**Decisões suas:** caminho 2 ou 1; se o app instalado pelo Chrome continua em paralelo (no note, sim); se o widget entra já ou depois.

**Atenção:** a casca tem armazenamento próprio. Na primeira abertura, é preciso entrar na conta para sincronizar.

## 8. Usabilidade do zero

### Método

1. Listar as tarefas principais e medir quantos toques cada uma leva hoje: anotar algo em 3 segundos, ver o que fazer hoje, concluir, adiar, criar uma repetição, achar uma tarefa, mudar de lista.
2. Passar cada tela pelas 10 heurísticas de Nielsen, com prints em tamanho de celular.
3. Propor a nova versão num protótipo navegável (artifact) para você aprovar antes de mexer no app.
4. Implementar em lotes pequenos, com o tema Diamante como base.

### Problemas já percebidos (ponto de partida)

- **Config.:** longa e misturada. Notificações, servidor, backup, aparência, modos do Até e integrações desativadas estão na mesma tela.
- **Termos:** Quando e Até não se explicam sozinhos. Há três modos do Até, e o lembrete aparece separado da data.
- **Detalhes da tarefa:** formulário longo, com repetição, lembretes, insistir, lista, tags, etapas e notas, tudo aberto.
- **Hoje:** "Sincronizar agora" ocupa espaço. Os lembretes vencidos ficam em destaque, mas sem ordem clara.
- **Próximos:** quatro modos (Lista, Calendário, Kanban e Matriz), sendo que dois podem sair (decisão de 9/11).
- **Gestos que faltam:** deslizar para concluir ou adiar, segurar para mover.
- **Primeira vez:** não há explicação nem exemplos. As telas vazias poderiam ensinar.
- **Botões desativados:** Google Agenda e Importar do To Do continuam visíveis sem funcionar.

### Resultado esperado

Um app que se usa sem pensar. O que aparece por padrão: título, quando, lembrete e repetição. O resto fica em "Mais opções". Config. fica curta, com seções.
