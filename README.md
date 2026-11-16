# agivigir.tech

Site pessoal de Arthur Givigir em uma página dividida: **Lado A** (podcaster) e **Lado B** (developer), com o rosto no meio como alça de um slider.

Site estático, sem framework, sem bundler e sem dependências: um script Node gera o HTML com CSS e JS embutidos.

## Comandos

```sh
npm run build        # gera dist/ (node scripts/build.mjs)
npm run dev          # build + servidor local em http://localhost:8080 com rebuild ao salvar (PORT muda a porta)
npm run episodes     # lê os RSS e atualiza content/episodes.json
npm run build:fresh  # episodes + build
```

Requer Node 20 ou superior (`.nvmrc` aponta para o 22).

## Estrutura

```
content/site.pt.json   textos e links em português (página padrão, /)
content/site.en.json   os mesmos campos em inglês (/en/)
content/episodes.json  últimos episódios, gerado por scripts/episodes.mjs (não editar à mão)
src/template.html      marcação, com chaves {{...}} para o conteúdo
src/styles.css         estilos (embutidos no HTML no build)
src/app.js             slider (embutido no <head>; sem JS, os dois lados ficam empilhados)
public/                imagens, favicon e og.png, copiados para dist/
scripts/build.mjs      build e servidor de desenvolvimento
scripts/episodes.mjs   lê os RSS do Bom dia Tech e do ADT
vercel.json            build e pasta de saída na Vercel
```

## Editando o conteúdo

Todo o texto fica nos dois JSON; mantenha os mesmos campos nos dois idiomas.

- **Status** de podcasts e projetos: `live`, `paused`, `wip`, `guest` ou `featured` (rótulos em `ui.status`).
- **App em destaque**: `"feature": true` no item de `dev.apps`.
- **Prévia de projeto web**: campo `thumb` na linha (imagem em `public/`).
- **Capa de podcast**: `"cover": null` usa a capa gerada (gradiente laranja + onda). Para usar uma imagem, coloque o arquivo em `public/` e troque por `"cover": { "src": "capa.webp", "alt": "...", "width": 600, "height": 600 }`.
- **Linhas** (`items` com `n`, `title`, `sub`, `note`): com `url` viram link; sem `url`, texto simples.
- Só são aceitos links `https://` e `mailto:`; o build falha se encontrar outro tipo ou uma imagem ausente em `public/`.

Os números dos podcasts têm data de referência no campo `pod.shows.note`.

## Episódios

As listas "Últimos episódios do Bom dia Tech" e "Últimas participações no ADT" vêm de `content/episodes.json`. O build não acessa a rede: quem lê os RSS é o `scripts/episodes.mjs`, que guarda os 5 episódios mais recentes de cada feed (no ADT, só os que citam Arthur Givigir). Se um feed falhar, a lista anterior daquele podcast é mantida.

## Deploy

O site é publicado pela Vercel a cada push. O `vercel.json` roda `scripts/episodes.mjs` e depois o build; se os RSS estiverem fora do ar, o deploy usa o `content/episodes.json` do repositório.

Para manter os episódios em dia, o workflow `.github/workflows/atualizar-episodios.yml` chama o deploy hook da Vercel todo dia às 07:00 e às sextas às 16:00 (Brasília). Ele precisa do secret `VERCEL_DEPLOY_HOOK` no repositório (Vercel → Settings → Git → Deploy Hooks).
