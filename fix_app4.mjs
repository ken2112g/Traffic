import { readFileSync, writeFileSync } from 'fs';
const p = new URL('./src/ui/public/app.js', import.meta.url);
let code = readFileSync(p, 'utf8');

// Find the duplicate col-actions block and replace entirely
const dupeCheck = '<div class="gap-actions">' + "' +\n" + "      '<td class=" + '"col-actions"><div class="gap-actions">' + "' +";
const dupeIdx = code.indexOf(dupeCheck);
if (dupeIdx !== -1) {
  console.log('Found duplicate at', dupeIdx);
  const blockStart = code.lastIndexOf("      '<td class=", dupeIdx);
  const endMarker = "      '</div></td></tr>'";
  const endIdx = code.indexOf(endMarker, dupeIdx);
  if (blockStart !== -1 && endIdx !== -1) {
    const oldBlock = code.slice(blockStart, endIdx + endMarker.length);
    console.log('Old block length:', oldBlock.length);
    const nb1 = '      ' + "'<td class=" + '"col-actions"><div class="gap-actions">' + "' +\n";
    const nb2 = '      `<button class="btn btn--xs btn--secondary" onclick="toggleCampaign(' + "'${c.id}')" + '">${c.is_active?' + "'Pause':'Resume'}</button>` +\n";
    const nb3 = '      `<button class="btn btn--xs btn--secondary" onclick="triggerCampaign(' + "'${c.id}')" + '">Run</button>` +\n';
    const nb4 = '      `<button class="btn btn--xs btn--danger" onclick="deleteCampaign(' + "'${c.id}')" + '">Del</button>` +\n';
    const nb5 = "      '</div></td></tr>'";
    const newBlock = nb1 + nb2 + nb3 + nb4 + nb5;
    code = code.slice(0, blockStart) + newBlock + code.slice(blockStart + oldBlock.length);
    console.log('Replaced campaign actions block');
  }
} else {
  console.log('Duplicate not found - checking for other broken patterns');
  // Fix broken deleteCampaign with c.id
  const brokenDel = "onclick=\"deleteCampaign(\\'\\'";
  const idx = code.indexOf(brokenDel);
  if (idx !== -1) {
    // find the full button tag
    const btnStart = code.lastIndexOf("'<button", idx);
    const btnEnd = code.indexOf("'</button>'", idx);
    if (btnStart !== -1 && btnEnd !== -1) {
      const old = code.slice(btnStart, btnEnd + "'</button>'".length);
      const replacement = '`<button class="btn btn--xs btn--danger" onclick="deleteCampaign(' + "'${c.id}')" + '">Del</button>`';
      code = code.slice(0, btnStart) + replacement + code.slice(btnStart + old.length);
      console.log('Fixed deleteCampaign');
    }
  }
}

writeFileSync(p, code, 'utf8');
console.log('Done');