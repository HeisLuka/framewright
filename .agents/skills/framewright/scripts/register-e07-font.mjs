import { GlobalFonts } from '@napi-rs/canvas';

const files = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
];
for (const file of files) {
  const ok = GlobalFonts.registerFromPath(file, 'DejaVu Sans');
  if (!ok) throw new Error(`Failed to register ${file}`);
}
console.log('E07 registered DejaVu Sans regular/bold');
