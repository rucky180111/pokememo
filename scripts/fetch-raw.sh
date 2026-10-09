#!/bin/sh
# データ再生成用の元データを raw/ に取得する (図鑑・習得技・日本語名・使用率)
set -e
mkdir -p raw && cd raw
SD=https://raw.githubusercontent.com/smogon/pokemon-showdown/master
PA=https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv
ST=https://raw.githubusercontent.com/pkmn/smogon/main/data/stats
curl -fsS -o sd_data_pokedex.ts $SD/data/pokedex.ts
curl -fsS -o sd_data_moves.ts $SD/data/moves.ts
curl -fsS -o dl_champions_learnsets.ts $SD/data/mods/champions/learnsets.ts
curl -fsS -o dl_champions_moves.ts $SD/data/mods/champions/moves.ts
for f in pokemon_species_names move_names ability_names item_names; do curl -fsS -o papi_$f.csv $PA/$f.csv; done
curl -fsS -o stats_gen9championsbattlestadiumsingles.json $ST/gen9championsbattlestadiumsingles.json
curl -fsS -o stats_gen9championsvgc2026.json $ST/gen9championsvgc2026.json
curl -fsS $ST/state.json | sed -n 's/.*"last": *"\([0-9-]*\)".*/\1/p' | head -1 > stats_month.txt
