/**
 * The built-in palettes (Admin → Appearance). Colors: the page background and text, the accent (links, buttons),
 * red (delete buttons, errors) and yellow (warnings); everything else is mixed from these (services/paletteService.js).
 * Besides LinkSnip's own, they're inspired by the themes of Omarchy (https://github.com/omacom/omarchy).
 *
 * Every palette has to read well as it is: tests/unit/services/paletteService.test.js checks the contrast.
 */
module.exports = [
  { id: 'linksnip-dark', name: 'LinkSnip Dark', mode: 'dark', colors: { accent: '#34d399', background: '#09090b', foreground: '#fafafa', red: '#f87171', yellow: '#fbbf24' } },
  { id: 'catppuccin', name: 'Catppuccin', mode: 'dark', colors: { accent: '#89b4fa', background: '#1e1e2e', foreground: '#cdd6f4', red: '#f38ba8', yellow: '#f9e2af' } },
  { id: 'ethereal', name: 'Ethereal', mode: 'dark', colors: { accent: '#7d82d9', background: '#060b1e', foreground: '#ffcead', red: '#ed5b5a', yellow: '#e9bb4f' } },
  { id: 'everforest', name: 'Everforest', mode: 'dark', colors: { accent: '#7fbbb3', background: '#2d353b', foreground: '#d6cbb1', red: '#e88b8d', yellow: '#dbbc7f' } },
  { id: 'gruvbox', name: 'Gruvbox', mode: 'dark', colors: { accent: '#7daea3', background: '#282828', foreground: '#d4be98', red: '#eb726b', yellow: '#d8a657' } },
  { id: 'hackerman', name: 'Hackerman', mode: 'dark', colors: { accent: '#82fb9c', background: '#0b0c16', foreground: '#ddf7ff', red: '#f87171', yellow: '#fbbf24' } },
  { id: 'kanagawa', name: 'Kanagawa', mode: 'dark', colors: { accent: '#dcd7ba', background: '#1f1f28', foreground: '#dcd7ba', red: '#d37374', yellow: '#c0a36e' } },
  { id: 'last-horizon', name: 'Last Horizon', mode: 'dark', colors: { accent: '#b59790', background: '#0c0b0c', foreground: '#fafcfb', red: '#c38b7b', yellow: '#fbbf24' } },
  { id: 'lumon', name: 'Lumon', mode: 'dark', colors: { accent: '#8bc9eb', background: '#16242d', foreground: '#d6e2ee', red: '#f87171', yellow: '#fbbf24' } },
  { id: 'matte-black', name: 'Matte Black', mode: 'dark', colors: { accent: '#e68e0d', background: '#121212', foreground: '#bebebe', red: '#d35f5f', yellow: '#ffc107' } },
  { id: 'miasma', name: 'Miasma', mode: 'dark', colors: { accent: '#8a9556', background: '#222222', foreground: '#c2c2b0', red: '#f87171', yellow: '#c18058' } },
  { id: 'nord', name: 'Nord', mode: 'dark', colors: { accent: '#8ba9c6', background: '#2e3440', foreground: '#d8dee9', red: '#d3949a', yellow: '#ebcb8b' } },
  { id: 'osaka-jade', name: 'Osaka Jade', mode: 'dark', colors: { accent: '#529778', background: '#111c18', foreground: '#c1c497', red: '#ff5345', yellow: '#af7d52' } },
  { id: 'retro-82', name: 'Retro 82', mode: 'dark', colors: { accent: '#faa968', background: '#05182e', foreground: '#f6dcac', red: '#f85525', yellow: '#e97b3c' } },
  { id: 'ristretto', name: 'Ristretto', mode: 'dark', colors: { accent: '#f38d70', background: '#2c2525', foreground: '#e6d9db', red: '#fd6883', yellow: '#f9cc6c' } },
  { id: 'solitude', name: 'Solitude', mode: 'dark', colors: { accent: '#7c8488', background: '#101315', foreground: '#cacccc', red: '#de6145', yellow: '#fbbf24' } },
  { id: 'tokyo-night', name: 'Tokyo Night', mode: 'dark', colors: { accent: '#7aa2f7', background: '#1a1b26', foreground: '#a9b1d6', red: '#f7768e', yellow: '#e0af68' } },
  { id: 'vantablack', name: 'Vantablack', mode: 'dark', colors: { accent: '#8d8d8d', background: '#000000', foreground: '#ffffff', red: '#f87171', yellow: '#fbbf24' } },
  { id: 'linksnip-light', name: 'LinkSnip Light', mode: 'light', colors: { accent: '#047857', background: '#fafafa', foreground: '#09090b', red: '#dc2626', yellow: '#b45309' } },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', mode: 'light', colors: { accent: '#145ff5', background: '#eff1f5', foreground: '#4c4f69', red: '#d20f39', yellow: '#976014' } },
  { id: 'flexoki-light', name: 'Flexoki Light', mode: 'light', colors: { accent: '#205ea6', background: '#fffcf0', foreground: '#100f0f', red: '#ce4135', yellow: '#8f6f0e' } },
  { id: 'lupine', name: 'Lupine', mode: 'light', colors: { accent: '#3264eb', background: '#fafafa', foreground: '#212121', red: '#dc2626', yellow: '#b45309' } },
  { id: 'rose-pine', name: 'Rosé Pine', mode: 'light', colors: { accent: '#467881', background: '#faf4ed', foreground: '#534e73', red: '#ab526c', yellow: '#9e6210' } },
  { id: 'white', name: 'White', mode: 'light', colors: { accent: '#6e6e6e', background: '#ffffff', foreground: '#000000', red: '#dc2626', yellow: '#b45309' } }
];
