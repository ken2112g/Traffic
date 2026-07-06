import { readFileSync, writeFileSync } from 'fs';
const p = new URL('./src/ui/public/app.js', import.meta.url);
let lines = readFileSync(p, 'utf8').split('\n');

const fixes = [
  // openDrawer button still broken
  {
    search: `    '<button class="btn btn--primary btn--sm" onclick="openDrawer(\\\'\\' + platform + \\'&apos;)">+ Campaign</button>' +`,
    replace: "    `<button class=\"btn btn--primary btn--sm\" onclick=\"openDrawer('${platform}')\">+ Campaign</button>` +"
  },
  // showAddAccount button still broken
  {
    search: `    '<button class="btn btn--secondary btn--sm" onclick="showAddAccount(\\\'\\' + platform + \\'&apos;)">+ Account</button>' +`,
    replace: "    `<button class=\"btn btn--secondary btn--sm\" onclick=\"showAddAccount('${platform}')\">+ Account</button>` +"
  }
];

// Fix by scanning lines
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes("openDrawer(\\'\\'") || line.includes("openDrawer(\\'' + platform")) {
    lines[i] = "    `<button class=\"btn btn--primary btn--sm\" onclick=\"openDrawer('${platform}')\">+ Campaign</button>` +";
    console.log('Fixed openDrawer at line', i+1);
  }
  if (line.includes("showAddAccount(\\'\\'") || line.includes("showAddAccount(\\'' + platform")) {
    lines[i] = "    `<button class=\"btn btn--secondary btn--sm\" onclick=\"showAddAccount('${platform}')\">+ Account</button>` +";
    console.log('Fixed showAddAccount at line', i+1);
  }
  // Fix stray quote after template literal backtick on select element
  if (line.includes("`<select id=\"ptask-status\"") && line.includes(">`'")) {
    lines[i] = line.replace(">`' +", ">` +").replace(">`'+", ">` +");
    console.log('Fixed select stray quote at line', i+1);
  }
  // Fix broken reloadPlatformTasks in Refresh button
  if (line.includes("reloadPlatformTasks(") && (line.includes("\\'\\'") || line.includes("&apos;"))) {
    lines[i] = "    `<button class=\"btn btn--secondary btn--sm\" onclick=\"reloadPlatformTasks('${platform}')\">Refresh</button>` +";
    console.log('Fixed reloadPlatformTasks at line', i+1);
  }
  // Fix any remaining \'\' + platform + \'&apos; pattern
  if (line.includes("+ platform + \\'&apos;")) {
    const fn = line.match(/onclick="(\w+)\(/);
    if (fn) {
      const fnName = fn[1];
      const before = line.substring(0, line.indexOf("'<button"));
      const afterClose = line.endsWith("' +") ? " +" : "";
      // Extract button text
      const btnText = line.match(/\">([^<]+)<\/button>/);
      const text = btnText ? btnText[1] : '';
      const cls = line.match(/class="([^"]+)"/);
      const clsStr = cls ? cls[1] : '';
      lines[i] = before + '`<button class="' + clsStr + '" onclick="' + fnName + "('${platform}')" + '">' + text + '</button>`' + afterClose;
      console.log('Fixed generic onclick at line', i+1, ':', fnName);
    }
  }
}

writeFileSync(p, lines.join('\n'), 'utf8');
console.log('Done');