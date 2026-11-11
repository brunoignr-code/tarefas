# Roteiro: levar o redesenho "linha livre" para o app

Escrito em 11/11/2026, com o app na v21.1. **Andamento:** lotes 1 e 2 feitos na v22 (veja o README). Decisões do dono para os itens "(confirmar)": item 4, o ⋯ fica sempre visível; item 5, Hoje tudo por horário (não por grupos); item 9, telas de edição sem barra. Itens 3 e 8 foram feitos como indicado aqui. Destinado a quem for implementar (outro chat, outro modelo).
O desenho foi aprovado pelo dono como direção; nenhuma linha do app foi alterada por causa dele ainda.

## 1. De onde vem o desenho

Prancheta no Claude Design: https://claude.ai/artifact/SRpwxbeMujJzeTfn1iVfva

Cada tela é um arquivo `.dc.html` (HTML com estilo em linha). Leia com a ferramenta Artifact,
ação `read`, passando o endereço acima e `path: "project/<Arquivo>.dc.html"`. O `project/canvas.json`
lista todas. Os tamanhos estão em px para um celular de 390 px de largura.

| Arquivo | Tela do app |
|---|---|
| `Livre` | Hoje |
| `HojeVazia`, `HojeEscura` | Hoje sem tarefas; Hoje no modo escuro |
| `Notebook` | Hoje a partir de 800 px de largura |
| `Proximos`, `Calendario`, `Kanban` | Próximos dias nas três visões |
| `Anotar` | Campo de anotar, com o "Entendi assim" |
| `Tarefa`, `TarefaMais`, `Repetir` | Janela da tarefa, "Mais opções" e a repetição |
| `Data`, `Horario` | Seletor de data e horário (abas) |
| `Menu`, `Adiar`, `Mover` | Menu da tarefa, adiar lembrete, mover de lista |
| `SairSemSalvar`, `SoEstaVez` | As duas perguntas da janela da tarefa |
| `Selecao` | Seleção de várias tarefas |
| `Listas`, `Lista`, `Organizar`, `ListaEditar`, `ListaMenu`, `ExcluirLista` | Tudo de listas |
| `Importantes`, `Tags`, `Concluidas`, `Lixeira` | Visões a partir de Listas |
| `Busca` | Busca |
| `Config`, `ConfigGeral`, `ConfigAparencia`, `ConfigAvisos`, `ConfigConta`, `ConfigDados`, `Entrar` | Config. e subtelas |
| `Capa` | Capa de abertura |

As pranchetas não foram conferidas renderizadas por quem as escreveu. Se uma parecer quebrada,
vale a intenção descrita aqui, não o pixel.

## 2. Regras que não mudam

Leia antes o `README.md` ("Estado do projeto") e o `PROXIMO-CHAT.md`. Em resumo:

- **Nenhuma função sai.** O pedido do dono foi redesenhar, não remover. A única retirada é a Matriz, que já saiu na v20.
- **Nada de mexer no formato dos dados, no login ou no servidor.** É só tela: `styles.css`, `js/app.js`, `index.html` e, se preciso, `js/theme.js`.
- **CSP da v20:** sem script em linha e sem nada de fora. A fonte Nunito já está em `fonts/`; não use o link do Google Fonts que aparece nas pranchetas.
- **`sw.js` sem `import`.** A cada publicação, suba `CACHE` e `APP_VERSION` e rode `python tools/conferir.py`.
- **Testes:** dados descartáveis numa origem local, apagados depois; nunca a conta real. Simule um aparelho com a versão anterior já instalada.
- **Entregue em lotes publicados** e diga o que não foi testado no celular de verdade.

## 3. O vocabulário do desenho

Cinco peças se repetem em todas as telas. Faça-as primeiro, como classes, e monte as telas com elas.

1. **Cabeçalho verde:** fundo na cor de destaque, cantos de baixo com 30 px, rótulo pequeno em maiúsculas, título de 29 px peso 900, botões redondos translúcidos de 44 px à direita.
2. **Cartão-folha:** fundo papel, sombra leve e cantos assimétricos `8px 24px 8px 24px` (28 px no cartão de destaque). É a silhueta da marca de concluir em tamanho de cartão.
3. **Ramo:** linha vertical de 2 px com uma folha por item. Usado em Hoje, Próximos, Concluídas, etapas, "Entendi assim" e "Só desta vez?". Coluna da hora à esquerda (52 px), folha (44 px), texto.
4. **Barra flutuante escura:** pílula com Hoje · Próximos · **+** · Listas · Config. O **+** é uma folha clara no centro.
5. **Folha de baixo:** painel que sobe, cantos `10px 34px 0 0`, com uma alça. Substitui os `<dialog>` de menu, mover, adiar, seletor e perguntas.

### Cores

Não copie os hex das pranchetas para as telas. Ligue cada um à variável que o app já tem, para o modo
escuro e as 8 cores de destaque continuarem funcionando.

| No desenho (claro) | Papel | Variável | No escuro (`HojeEscura`) |
|---|---|---|---|
| `#0F6B4C` | destaque | `--primary` | `#7FD3A2` |
| `#FFFFFF` sobre o destaque | texto sobre o destaque | `--on-primary` | `#0B2A1D` |
| `#F3F8F3` | fundo | `--bg` | `#0F1714` |
| `#FFFEFA` | papel dos cartões | `--surface` (hoje `#FFFFFF`; passar a `#FFFEFA`) | `#17221D` |
| `#E4F0E6` | preenchimento suave | `--soft` | `#1E3329` |
| `#DCE8DE` | linhas | `--line` | `#2E4238` |
| `#BFDCC8` | ramo | nova: `--stem` | `#2E4238` |
| `#14291F` | texto e barra flutuante | `--text`; barra: nova `--bar` | texto `#E6F0EA`; barra `#1F2C26` com borda `#2E4238` |
| `#4F6358` | texto secundário | `--muted` | `#A3B5AA` |
| `#B3261E` | atrasada, excluir | `--danger` | `#F4A79D` |
| `#C98A00` / `#8A6A00` | estrela (preenchida / contorno) | `--star` | `#F2D27A` |

No escuro, o cabeçalho usa `#1C3A2C` (a `--banner` atual), não a cor de destaque cheia.
Com outra cor de destaque, o cabeçalho, as folhas e os botões principais acompanham; a barra flutuante fica sempre escura.

### Medidas

O app mede em `rem` com base de 14,5 px e tem 5 tamanhos de letra. Converta os px das pranchetas
(px ÷ 14,5) em vez de fixá-los. Alvos de toque de pelo menos 44 px.

## 4. Onde o desenho muda o comportamento

Estas são as decisões embutidas no desenho. As marcadas com **(confirmar)** não foram discutidas
a fundo com o dono: pergunte antes de implementar ou implemente do jeito indicado e avise.

1. **Navegação:** a aba Busca sai da barra e vira ícone no cabeçalho de Hoje, Próximos e Listas. A tecla `/` no notebook continua. O número de tarefas na aba Hoje não aparece na prancheta, mas deve continuar.
2. **Anotar:** no celular, o campo fixo vira o botão **+**, que abre a folha `Anotar` já com o teclado. No notebook o campo continua fixo no topo (`Notebook`). O atalho `?novo=1`, a tecla `N` e o "Compartilhar" do Android abrem a mesma folha.
3. **"Anotar e abrir" / "Anotar outra":** os dois botões ficam na folha. A opção "Depois de anotar" de Config. › Geral continua existindo e decide o que o Enter faz. **(confirmar)**
4. **Botão ⋯ das tarefas:** sai das linhas no celular; o menu abre com toque longo, como hoje. No notebook, mantenha o ⋯ ao passar o mouse, além do botão direito. **(confirmar)**
5. **Ordem em Hoje:** atrasadas, depois as feitas hoje pela hora em que foram concluídas, depois as abertas sem hora (na ordem manual, para o arrastar continuar valendo), depois as abertas com hora. **(confirmar)** A prancheta mistura feitas e abertas por horário; arrastar não está desenhado.
6. **Cartão "A seguir":** mostra o lembrete vencido mais antigo, com Concluir e Adiar. Havendo outros vencidos, um texto "e mais 2" abaixo dos botões passa para o seguinte. Sem lembrete vencido, mostra o próximo de hoje; sem nenhum, o cartão some. Isso substitui a pilha de cartões de lembrete em Hoje.
7. **Lembretes fora de Hoje:** continua a linha única da v20 ("3 lembretes pendentes · Ver em Hoje"), logo abaixo do cabeçalho. Não está desenhada.
8. **Faixa da semana em Hoje:** tocar num dia abre Próximos › Lista rolado até aquele dia. O ponto embaixo do número indica dia com tarefas. **(confirmar)**
9. **Telas de edição sem barra:** Config. por dentro, Organizar e Editar lista escondem a barra flutuante e têm botão de voltar. **(confirmar)**
10. **Notebook:** a tarefa abre num painel à direita, não numa janela por cima. Abaixo de 1100 px de largura, volte à janela.

## 5. O que existe no app e não está nas pranchetas

Tudo isto continua. Vista com as cinco peças da seção 3.

- **Aparelhos conectados** (v21) em Config. › Conta: lista, "Sair" em cada um e "Sair dos outros aparelhos". Use um cartão-folha com uma linha por aparelho, abaixo do cartão de estado.
- **Aviso de backup do Drive atrasado** (v20) em Hoje e no topo de Config.: faixa em `--later` logo abaixo do cabeçalho.
- **Emojis das listas:** as pranchetas mostram a inicial ou `[1]`…`[10]` porque o Design não aceita emoji. No app, o emoji escolhido fica dentro do quadradinho-folha colorido; sem emoji, a inicial.
- **Botão oficial "Entrar com Google":** a prancheta `Entrar` tem só um espaço reservado.
- **Modos B e C do campo Até,** a prévia de "Ignorar datas" no anotar, a troca de senha, a lista de backups do Drive ao restaurar, a escolha de lista em "Mover para outra lista" ao excluir.
- **Mensagens de rodapé** (toast com Desfazer): pílula escura como a barra, acima dela.
- **Deslizar** para concluir e para adiar, com as faixas coloridas por baixo.
- **Demais telas no notebook:** só Hoje foi desenhada. As outras usam a mesma lateral verde e a coluna central; folhas de baixo viram janelas centradas.
- **Modo escuro e as outras 7 cores de destaque** em todas as telas, pela tabela da seção 3.

## 6. Ordem sugerida, em lotes publicáveis

Cada lote deixa o app inteiro funcionando. Telas ainda não refeitas ficam com o visual antigo, o que
é aceitável por alguns dias.

1. **Fundação.** Variáveis novas (`--stem`, `--bar`, `--surface` papel), as cinco peças como classes, barra flutuante com a navegação nova, capa. Sem refazer telas ainda.
2. **Hoje e anotar.** `Livre`, `HojeVazia`, `Anotar`, `Adiar`, cartão "A seguir", faixa da semana, aviso do Drive, linha de lembretes nas outras telas.
3. **Próximos e seletor.** `Proximos`, `Calendario`, `Kanban`, `Data`, `Horario`.
4. **Janela da tarefa.** `Tarefa`, `TarefaMais`, `Repetir`, `SairSemSalvar`, `SoEstaVez`, `Menu`, `Mover`. É a tela mais delicada (trava de edições não salvas da v18, "Só esta vez" da v19): mude a aparência sem tocar nas regras.
5. **Listas.** `Listas`, `Lista`, `Organizar`, `ListaEditar`, `ListaMenu`, `ExcluirLista`, `Importantes`, `Tags`, `Concluidas`, `Lixeira`, `Selecao`.
6. **Busca e Config.** `Busca`, `Config` e as cinco subtelas, `Entrar`, aparelhos conectados.
7. **Notebook.** Lateral verde, campo de anotar fixo, painel da tarefa à direita.

Pontos de entrada no código (v21.1, `js/app.js`): `renderNav`, `renderReminders`, `taskRow` e `taskChips`,
`renderQuickPreview`, `openSheet`, `openTaskMenu`, `openTask`, `openDateTimePicker` e `renderPicker`,
`renderSteps`, `renderSelectionBar`, `render`. As cores de destaque e os modos estão em `js/theme.js`.

## 7. Conferência de cada lote

- 69 testes das regras e os testes do servidor passando (nada neles deve mudar).
- Celular (375 px) e notebook, no claro e no escuro.
- Uma cor de destaque que não seja a Folha e o maior tamanho de letra: nada cortado.
- Teclado: Tab chega a tudo; Esc fecha as folhas; `N` e `/` funcionam.
- Service worker da versão anterior atualizando para a nova.
- `python tools/conferir.py` sem recusas; `README.md` e `PROXIMO-CHAT.md` atualizados com o que mudou e o que não foi testado no celular.

## 8. Pedido pronto para colar no outro chat

```text
Vou implementar no app "Minha lista de afazeres" o redesenho "linha livre", já desenhado.

Leia, nesta ordem: README.md ("Estado do projeto"), PROXIMO-CHAT.md e ROTEIRO-REDESENHO.md, todos
na raiz desta pasta. O roteiro diz onde estão as 38 pranchetas, as regras, as decisões de
comportamento e a ordem dos lotes.

Comece pelo lote 1 (Fundação) do roteiro. Antes de escrever código, leia as pranchetas Livre,
Proximos, Tarefa e Menu para conhecer as cinco peças que se repetem, e me faça as perguntas
marcadas "(confirmar)" na seção 4 que afetarem o lote.

Não remova nenhuma função, não mude o formato dos dados, o login nem o servidor. Publique um lote
por vez e diga o que não foi testado no celular de verdade.
```
