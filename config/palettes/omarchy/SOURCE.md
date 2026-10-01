# Omarchy palettes

The `*.toml` files here are the `colors.toml` of each theme in
[Omarchy](https://github.com/omacom/omarchy) (`themes/<name>/colors.toml`), copied unchanged from commit
`c05d90196fc0dd5c21e2e797d80ffcc60d5e39fa` on the `quattro` branch. Only the colors are used; the wallpapers,
icons and editor themes are not part of LinkSnip.

Omarchy is released under the MIT license (`LICENSE` in this folder). Many themes are Omarchy's take on
well-known color schemes (Catppuccin, Gruvbox, Nord, Rosé Pine, Tokyo Night, …), which are MIT licensed as well.

To update: copy the newer `colors.toml` files over these (file name = theme folder name), update the commit above,
and run the tests (`tests/unit/services/paletteService.test.js` checks every palette stays readable).
