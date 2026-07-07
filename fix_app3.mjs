import { readFileSync, writeFileSync } from 'fs';
const p = new URL('./src/ui/public/app.js', import.meta.url);
let lines = readFileSync(p, 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // --- Fix renderTargets empty state (line 314 was stripped of el.innerHTML =)
  // Detect: dangling backtick button without assignment
  if (line.trimStart().startsWith('`<button') && line.includes("openDrawer('${platform}')") && line.includes('Create Campaign')) {
    // Find the 'if (!targets.length)' context - wrap properly
    lines[i] = "    el.innerHTML = '<div class=\"empty-state\"><div class=\"empty-state-icon\">&#9711;</div><h3>No targets yet</h3><p>Create campaigns to buff accounts on ' + capitalize(platform) + '</p>' + " +
               "`<button class=\"btn btn--primary\" style=\"margin-top:16px\" onclick=\"openDrawer('${platform}')\">+ Create Campaign</button>` + '</div>';";
    console.log('Fixed renderTargets empty state at line', i+1);
  }

  // --- Fix renderPlatformCampaigns html init (line 343 was stripped of let html =)
  if (line.trimStart().startsWith('`<button') && line.includes("openDrawer('${platform}')") && line.includes('New Campaign')) {
    lines[i] = "  let html = `<div class=\"view-actions\" style=\"margin-bottom:16px\"><button class=\"btn btn--primary btn--sm\" onclick=\"openDrawer('${platform}')\">+ New Campaign</button></div>`;";
    console.log('Fixed renderPlatformCampaigns html init at line', i+1);
  }

  // --- Fix c.id patterns (toggleCampaign, triggerCampaign, deleteCampaign)
  if (line.includes("toggleCampaign(") && (line.includes("\\'\\' + c.id") || line.includes("&apos;)"))) {
    lines[i] = line.replace(/onclick="toggleCampaign\([^"]+\)"/, "onclick=\"toggleCampaign('${c.id}')\"")
                   .replace(/'\s*<button([^>]+)onclick="toggleCampaign[^"]*"([^>]*)>'/, '`<button$1onclick="toggleCampaign(\'${c.id}\')"$2>`')
                   .replace(/'\s*\+\s*\(c\.is_active\?'Pause':'Resume'\)\s*\+\s*'<\/button>'/, '${c.is_active?\'Pause\':\'Resume\'}</button>`');
    // Simpler: rebuild the whole td col-actions section
    console.log('Fixed toggleCampaign at line', i+1);
  }

  // Rebuild the entire campaign row actions column from scratch if it contains broken patterns
  if (line.includes("toggleCampaign(\\'\\' + c.id") || line.includes("toggleCampaign('' + c.id")) {
    lines[i] = "      '<td class=\"col-actions\"><div class=\"gap-actions\">' +";
    if (i+1 < lines.length) lines[i+1] = "      `<button class=\"btn btn--xs btn--secondary\" onclick=\"toggleCampaign('${c.id}')\">${c.is_active?'Pause':'Resume'}</button>` +";
    if (i+2 < lines.length && lines[i+2].includes('triggerCampaign')) lines[i+2] = "      `<button class=\"btn btn--xs btn--secondary\" onclick=\"triggerCampaign('${c.id}')\">Run</button>` +";
    if (i+3 < lines.length && lines[i+3].includes('deleteCampaign')) lines[i+3] = "      `<button class=\"btn btn--xs btn--danger\" onclick=\"deleteCampaign('${c.id}')\">Del</button>` +";
    console.log('Rebuilt campaign actions at line', i+1);
  }
}

// Targeted replacement for the 3 campaign action buttons using indexOf
const code = lines.join('\n');
let fixed = code;

// Pattern: the broken toggleCampaign line in renderPlatformCampaigns
const oldToggle = `'<button class="btn btn--xs btn--secondary" onclick="toggleCampaign(\\'\\'`;
if (fixed.includes(oldToggle)) {
  // Find the whole table row actions section and rebuild
  const idx = fixed.indexOf(oldToggle);
  const lineStart = fixed.lastIndexOf('\n', idx) + 1;
  const blockEnd = fixed.indexOf("'</div></td></tr>'", idx);
  if (blockEnd !== -1) {
    const oldBlock = fixed.slice(lineStart, blockEnd + "'</div></td></tr>'".length);
    const newBlock = "      '<td class=\"col-actions\"><div class=\"gap-actions\">' +\n" +
      "      `<button class=\"btn btn--xs btn--secondary\" onclick=\"toggleCampaign('${c.id}')\">${c.is_active?'Pause':'Resume'}</button>` +\n" +
      "      `<button class=\"btn btn--xs btn--secondary\" onclick=\"triggerCampaign('${c.id}')\">Run</button>` +\n" +
      "      `<button class=\"btn btn--xs btn--danger\" onclick=\"deleteCampaign('${c.id}')\">Del</button>` +\n" +
      "      '</div></td></tr>'";
    fixed = fixed.slice(0, lineStart) + newBlock + fixed.slice(lineStart + oldBlock.length);
    console.log('Rebuilt campaign actions block');
  }
}

writeFileSync(p, fixed, 'utf8');
console.log('Done');