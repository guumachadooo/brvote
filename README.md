# Como o Brasil Vota (`brasil-vote-3d`)

Adaptação do projeto **How America Votes** (`usavote`) para as **Eleições Gerais Brasileiras de 2026, 2022 e 2018**.

## Funcionalidades

- **Malha Geográfica Oficial do IBGE**:
  - `data/br-ufs.json`: Contornos oficiais das 27 Unidades da Federação do IBGE.
  - `data/<uf>/municipios.json`: Polígonos municipais reais do IBGE para todos os municípios de cada estado (e as 20 Regiões Administrativas do Distrito Federal).
- **Todas as 27 Unidades da Federação**:
  - `AC`, `AL`, `AM`, `AP`, `BA`, `CE`, `DF`, `ES`, `GO`, `MA`, `MG`, `MS`, `MT`, `PA`, `PB`, `PE`, `PI`, `PR`, `RJ`, `RN`, `RO`, `RR`, `RS`, `SC`, `SE`, `SP` e `TO`.
- **Eleições Gerais de 2026 + Série Histórica (2022 e 2018)**:
  - Presidente (2º Turno e 1º Turno), Governador, Senado Federal, Deputado Federal, Deputado Estadual/Distrital e Oscilação Presidencial (`2022 → 2026`).
- **Todas as Visões e Tours Originais**:
  - `index.html`: Mapa interativo do Brasil com os 27 estados ativos (`.st.on`) e cartões de acesso rápido (`.state-card`).
  - `estado.html?uf=<uf>`: Explorador 3D completo com colunas divididas entre vencedor e segundo colocado, alternância Município / Zona Eleitoral, busca rápida por Cidade / Município / Zona Eleitoral, pintura por saldo líquido de votos ou margem %, giro automático e modo de densidade de pontos.
  - `voters.html?uf=<uf>`: Mapa WebGL de densidade de pontos com **Tour Guiado pela Densidade Demográfica** em cada estado.
  - `story.html?uf=<uf>`: Tour guiado de 60 segundos pelos municípios (do menor colégio eleitoral à capital).
  - `misread.html?uf=<uf>`: Guia interativo *"Três maneiras pelas quais um mapa eleitoral padrão engana o seu olhar"*.
  - `shade-by-votes.html?uf=<uf>`: Comparação interativa entre Vencedor leva a cor, Margem % e Saldo Líquido de Votos.
  - `why.html` e `sources.html`: Explicação metodológica e créditos por estado.

## Comandos

```bash
# Gerar malha IBGE e dados eleitorais para as 27 UFs
npm run build:data

# Iniciar servidor de desenvolvimento (porta 3000)
npm run dev

# Build de produção
npm run build
```
