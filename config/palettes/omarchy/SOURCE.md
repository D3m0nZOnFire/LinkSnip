# Palettes adapted from Omarchy

These palettes are LinkSnip's adaptations of the themes in [Omarchy](https://github.com/omacom/omarchy), taken from
`themes/<name>/colors.toml` at commit `c05d90196fc0dd5c21e2e797d80ffcc60d5e39fa` (`quattro` branch). Omarchy is
released under the MIT license (`LICENSE` in this folder, which has to stay with these files). Many of the themes are
Omarchy's take on well-known color schemes (Catppuccin, Gruvbox, Nord, Rosé Pine, Tokyo Night, …).

Each file keeps only the five colors LinkSnip uses (`accent`, `background`, `foreground`, `red`, `yellow`) plus a
name. Where Omarchy's value didn't suit a web page, it was changed:

- **Readability:** text colors reach WCAG contrast on the background (4.5:1; 7:1 for the foreground), by a lighter or
  darker shade of the same hue.
- **Red and yellow mean danger and warning here:** where Omarchy's `red` isn't a red or its `yellow` isn't a yellow or
  orange (some themes use those slots for other hues), the theme's own fitting color is used if it has one (Matte
  Black's amber is its `green`), otherwise LinkSnip's red `#f87171` / `#dc2626` or amber `#fbbf24` / `#b45309`.

| Palette | Changed from Omarchy |
|---|---|
| Catppuccin | unchanged |
| Catppuccin Latte | accent: `#1e66f5` → `#145ff5`<br>yellow: `#df8e1d` → `#976014` |
| Ethereal | unchanged |
| Everforest | foreground: `#d3c6aa` → `#d6cbb1`<br>red: `#e67e80` → `#e88b8d` |
| Flexoki Light | red: `#d14d41` → `#ce4135`<br>yellow: `#d0a215` → `#8f6f0e` |
| Gruvbox | red: `#ea6962` → `#eb726b` |
| Hackerman | red: `#50f872` → `#f87171`<br>yellow: `#50f7d4` → `#fbbf24` |
| Kanagawa | red: `#c34043` → `#d37374` |
| Last Horizon | yellow: `#6b5e73` → `#fbbf24` |
| Lumon | red: `#4d86b0` → `#f87171`<br>yellow: `#6fa4c9` → `#fbbf24` |
| Lupine | red: `#c900c4` → `#dc2626`<br>yellow: `#026fde` → `#b45309` |
| Matte Black | yellow: `#b91c1c` → `#ffc107` |
| Miasma | accent: `#78824b` → `#8a9556`<br>red: `#685742` → `#f87171`<br>yellow: `#b36d43` → `#c18058` |
| Nord | accent: `#81a1c1` → `#8ba9c6`<br>red: `#bf616a` → `#d3949a` |
| Osaka Jade | accent: `#509475` → `#529778`<br>yellow: `#459451` → `#af7d52` |
| Retro 82 | unchanged |
| Ristretto | unchanged |
| Rosé Pine | accent: `#56949f` → `#467881`<br>foreground: `#575279` → `#534e73`<br>red: `#b4637a` → `#ab526c`<br>yellow: `#ea9d34` → `#9e6210` |
| Solitude | accent: `#798186` → `#7c8488`<br>red: `#565d60` → `#de6145`<br>yellow: `#d9dbdc` → `#fbbf24` |
| Tokyo Night | unchanged |
| Vantablack | red: `#a4a4a4` → `#f87171`<br>yellow: `#cecece` → `#fbbf24` |
| White | red: `#2a2a2a` → `#dc2626`<br>yellow: `#4a4a4a` → `#b45309` |

Each file names its changes in a comment too. `tests/unit/services/paletteService.test.js` checks that every built-in
palette needs no further adjustment, so a new or edited one shows up there if it doesn't read well.
