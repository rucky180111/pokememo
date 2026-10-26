# Pokémon images

Images are bundled from the Pokémon Showdown / Smogon sprite collection:
https://github.com/smogon/sprites/tree/ff5609347cebc9045347a94ee0f7f1457d2bddd6

The exact source path for every species/forme is recorded in
`src/generated/sprites.json`. Most images are from `src/champions`; the busted
Mimikyu image is from `src/sprites/gen5`. Original Pokémon artwork belongs to
its respective owners. These images are not covered by this app's code license.

Regenerate lossless WebP assets with `node scripts/build-sprites.mjs`.
The two Polteageist/Sinistcha authenticity forms share the same visible art.
Aegislash-Shield uses the base shield image; the synthetic calculation-only
Aegislash-Both entry also uses that species' shield image.
