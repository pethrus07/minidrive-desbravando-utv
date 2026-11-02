# Histórico · Mini Drive

## A feature de 15/07/2026 que não chegou ao git

Em 15/07/2026 o `worker.js` ganhou, na cópia de trabalho de então (`Downloads\minidrive-worker-v2\minidrive-worker`):

- nomes de exibição para as subpastas do fluxo novo do Estúdio (`audio`, `transcricao`,
  `referencias`, `revisoes`, `pacote`);
- botão "Baixar (.zip)" dentro de qualquer pasta, montando o zip no navegador com JSZip a
  partir de `/list` e `/file`, sem rota nova;
- MIME de áudio ampliado (`ogg`, `oga`, `opus`, `m4a`, `aac`, `flac`).

**Procurado em 01/11/2026 e não encontrado:**

| onde | resultado |
|---|---|
| histórico deste repositório (todos os branches, `git log -S baixarPasta`) | nada |
| produção (fonte baixado do Worker `minidrive` em 01/11/2026) | nada; a versão no ar equivale ao `main` |
| a pasta antiga em `Downloads` | não existe mais |
| `Projetos`, `Arquivo-projetos`, `Desktop` | nada |

A mudança ficou só na cópia de trabalho e se perdeu quando o projeto mudou de pasta. Resta a
descrição acima. Se ainda fizer falta, é reimplementar (estimativa curta: uma função no
navegador e três entradas no mapa de nomes).
