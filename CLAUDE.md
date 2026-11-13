# CLAUDE.md — Como o Brasil Vota

Guia de arquitetura para adaptação e expansão dos mapas eleitorais brasileiros em 3D.

## Convenções Brasileiras (TSE + IBGE)

- **Unidades Federativas (`BR_UFS` em `state.js`)**: Todas as 27 UFs identificadas pelo código IBGE de 2 dígitos (`11` Rondônia a `53` Distrito Federal).
- **Municípios (`data/br-municipios.json`)**: GeoJSON `FeatureCollection` onde cada `feature.id` começa com os 2 dígitos do código IBGE da UF (ex.: `3550308` para São Paulo, `3304557` para Rio de Janeiro, `3106200` para Belo Horizonte).
- **Cores dos Campos Políticos (`colors.js`)**:
  - `dem` (`DEM_C`, tons de vermelho `#d72f30`): Campo Trabalhista / Progressista (PT, PSB, PSOL, PDT, PCdoB, REDE).
  - `rep` (`REP_C`, tons de azul `#3b5bdb`): Campo Conservador / Liberal (PL, Republicanos, PP, PSD, UNIÃO, NOVO).
  - `other` (`OTH_C`, tons de âmbar/dourado): Outras candidaturas (MDB, PSDB, Cidadania, etc.).
- **Páginas Dinâmicas**:
  - Em vez de criar um arquivo HTML separado para cada estado, `estado.html?uf=<slug>` e `voters.html?uf=<slug>` carregam dinamicamente a UF a partir de `state.js`.

## Pipeline de Dados (`scripts/build_br_data.mjs`)

Execute `npm run build:data` para reconstruir `data/`:
- `data/br-ufs.json`: Polígonos das 27 Unidades Federativas.
- `data/br-municipios.json`: Polígonos municipais das UFs configuradas.
- `data/<uf>/results-2026.json`: Resultados por município para Presidente, Governador e Senador.
- `data/<uf>/results-history.json`: Histórico comparativo de 2022 e 2018.
- `data/<uf>/blockgroups.json`: Grade ponderada de setores censitários para a camada de pontos.
- `data/<uf>/cities.json`: Cidades de referência com hierarquia de zoom (`rank` 1, 2, 3).
- `data/<uf>/precincts.json` e `data/<uf>/precinct-shapes.json`: Zonas eleitorais subdivididas por município.
