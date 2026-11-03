// A deliberately small Markdown subset for model-written summaries. Rendering builds DOM nodes with textContent only:
// no HTML, images, or URLs from the model ever reach the page. Timestamps appear only in key takeaways, never in this body.

const LIST_ITEM = /^( *)([-*+]|\d{1,3}[.)]) +(.*)$/;
const FENCE = /^ *(```+|~~~+) *([\w+-]*) *$/;
const TABLE_DIVIDER = /^ *\|? *:?-{2,}:? *(\| *:?-{2,}:? *)*\|? *$/;

// Drops segment citations and time tokens: from stray model output, and from summaries saved when the body carried timestamps.
export function stripCitations(markdown) {
  return String(markdown || "")
    .replace(/ *\[\[(?:t:\d+|S\d+(?:\s*,\s*S\d+)*)\]\]/g, "")
    .replace(/[ \t]+$/gm, "");
}

const indent = line => line.match(/^ */)[0].length;
const blank = line => !line.trim();

function startsBlock(line) {
  return /^ {0,3}#{1,6} /.test(line) || FENCE.test(line) || /^ {0,3}>/.test(line) || LIST_ITEM.test(line)
    || /^ {0,3}:::/.test(line) || /^ {0,3}(-{3,}|\*{3,}) *$/.test(line);
}

export function parseMarkdown(text) {
  return parseBlocks(String(text || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i += 1; continue; }
    let match;
    if ((match = FENCE.exec(line))) {
      const body = [];
      for (i += 1; i < lines.length && !lines[i].trim().startsWith(match[1]); i += 1) body.push(lines[i]);
      blocks.push({type: "code", language: match[2], text: body.join("\n")}); i += 1; continue;
    }
    if ((match = /^ {0,3}:::\s*spoiler\b *(.*)$/i.exec(line))) {
      const body = [];
      for (i += 1; i < lines.length && !/^ {0,3}::: *$/.test(lines[i]); i += 1) body.push(lines[i]);
      blocks.push({type: "spoiler", label: match[1].trim() || "Spoiler", children: parseBlocks(body)}); i += 1; continue;
    }
    if (/^ {0,3}::: *$/.test(line)) { i += 1; continue; }
    if ((match = /^ {0,3}(#{1,6}) +(.*?)[ #]*$/.exec(line))) {
      blocks.push({type: "heading", level: match[1].length, text: match[2]}); i += 1; continue;
    }
    if (/^ {0,3}(-{3,}|\*{3,}) *$/.test(line)) { blocks.push({type: "rule"}); i += 1; continue; }
    if (line.trim().startsWith("|") && TABLE_DIVIDER.test(lines[i + 1] || "")) {
      const cells = row => row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
      const header = cells(line), rows = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i += 1) rows.push(cells(lines[i]));
      blocks.push({type: "table", header, rows}); continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^ {0,3}>/.test(lines[i]); i += 1) body.push(lines[i].replace(/^ {0,3}> ?/, ""));
      blocks.push({type: "quote", children: parseBlocks(body)}); continue;
    }
    if ((match = LIST_ITEM.exec(line))) { i = parseList(lines, i, blocks); continue; }
    const paragraph = [];
    for (; i < lines.length && !blank(lines[i]) && (!paragraph.length || !startsBlock(lines[i])); i += 1) paragraph.push(lines[i].trim());
    blocks.push({type: "paragraph", text: paragraph.join(" ")});
  }
  return blocks;
}

function parseList(lines, start, blocks) {
  const first = LIST_ITEM.exec(lines[start]);
  const base = first[1].length, ordered = /\d/.test(first[2]);
  const list = {type: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: []};
  let i = start;
  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i]);
    if (!match || match[1].length !== base || /\d/.test(match[2]) !== ordered) break;
    const contentIndent = base + match[2].length + 1;
    const body = [match[3]];
    for (i += 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (blank(line)) {
        const next = lines.slice(i + 1).find(candidate => !blank(candidate));
        if (next === undefined || indent(next) <= base) break;
        body.push(""); continue;
      }
      if (indent(line) > base) { body.push(line.slice(Math.min(indent(line), contentIndent))); continue; }
      if (startsBlock(line)) break;
      body.push(line.trim()); // Lazy paragraph continuation.
    }
    const task = /^\[([ xX])\] +/.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    list.items.push({checked: task ? task[1] !== " " : null, children: parseBlocks(body)});
    while (i < lines.length && blank(lines[i])) {
      const next = lines.slice(i).find(candidate => !blank(candidate));
      if (!next || !LIST_ITEM.test(next) || indent(next) !== base) break;
      i += 1;
    }
  }
  blocks.push(list);
  return i;
}

// Inline: `code`, **bold**, *italic*, _italic_, and [text](…) reduced to its text.
export function parseInline(text) {
  const nodes = [];
  let buffer = "";
  const flush = () => { if (buffer) { nodes.push({type: "text", text: buffer}); buffer = ""; } };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let match;
    if (rest[0] === "\\" && /[\\`*_{}[\]()<>#+.!|~-]/.test(rest[1] || "")) { buffer += rest[1]; i += 2; continue; }
    if ((match = /^(`+)([\s\S]+?)\1/.exec(rest))) { flush(); nodes.push({type: "code", text: match[2].trim()}); i += match[0].length; continue; }
    if ((match = /^(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/.exec(rest))) { flush(); nodes.push({type: "strong", children: parseInline(match[2])}); i += match[0].length; continue; }
    if ((match = /^([*_])(\S(?:[\s\S]*?\S)?)\1(?![*_\w])/.exec(rest)) && !(match[1] === "_" && /\w/.test(text[i - 1] || ""))) {
      flush(); nodes.push({type: "em", children: parseInline(match[2])}); i += match[0].length; continue;
    }
    if ((match = /^\[([^\]]+)\]\([^)\s]*\)/.exec(rest))) { flush(); nodes.push(...parseInline(match[1])); i += match[0].length; continue; }
    buffer += rest[0]; i += 1;
  }
  flush();
  return nodes;
}

// Headings shift down one level by default so a document's ## sits below the panel's own headings.
export function renderMarkdown(text, doc, {headingOffset = 1} = {}) {
  const el = (tag, className) => { const node = doc.createElement(tag); if (className) node.className = className; return node; };
  const textNode = value => doc.createTextNode ? doc.createTextNode(value) : Object.assign(el("span"), {textContent: value});
  const inline = (parent, nodes) => {
    for (const node of nodes) {
      if (node.type === "text") parent.appendChild(textNode(node.text));
      else if (node.type === "code") { const code = el("code"); code.textContent = node.text; parent.appendChild(code); }
      else if (node.type === "strong" || node.type === "em") { const wrap = el(node.type); inline(wrap, node.children); parent.appendChild(wrap); }
    }
    return parent;
  };
  const tight = children => children.length === 1 && children[0].type === "paragraph";
  const blocks = (parent, nodes) => {
    for (const node of nodes) parent.appendChild(block(node));
    return parent;
  };
  const block = node => {
    switch (node.type) {
      case "heading": return inline(el(`h${Math.min(6, node.level + headingOffset)}`), parseInline(node.text));
      case "paragraph": return inline(el("p"), parseInline(node.text));
      case "rule": return el("hr");
      case "code": {
        const pre = el("pre"), code = el("code");
        if (node.language) code.setAttribute("data-language", node.language);
        code.textContent = node.text; pre.appendChild(code); return pre;
      }
      case "quote": return blocks(el("blockquote"), node.children);
      case "spoiler": {
        const details = el("details", "md-spoiler"), summary = el("summary");
        inline(summary, parseInline(node.label)); details.appendChild(summary); return blocks(details, node.children);
      }
      case "table": {
        const wrap = el("div", "md-table"), table = el("table"), head = el("thead"), headRow = el("tr"), body = el("tbody");
        for (const cell of node.header) headRow.appendChild(inline(el("th"), parseInline(cell)));
        head.appendChild(headRow);
        for (const row of node.rows) {
          const tr = el("tr");
          node.header.forEach((_, index) => tr.appendChild(inline(el("td"), parseInline(row[index] || ""))));
          body.appendChild(tr);
        }
        table.append(head, body); wrap.appendChild(table); return wrap;
      }
      case "list": {
        const list = el(node.ordered ? "ol" : "ul", node.items.some(item => item.checked !== null) ? "md-tasks" : "");
        if (node.ordered && node.start !== 1) list.setAttribute("start", String(node.start));
        for (const item of node.items) {
          const li = el("li");
          let target = li;
          if (item.checked !== null) {
            const label = el("label"), box = el("input");
            box.type = "checkbox"; box.checked = item.checked;
            target = el("span");
            label.append(box, target); li.appendChild(label);
          }
          if (tight(item.children)) inline(target, parseInline(item.children[0].text));
          else blocks(target, item.children);
          list.appendChild(li);
        }
        return list;
      }
      default: return el("div");
    }
  };
  return parseMarkdown(text).map(block);
}

// Exported Markdown should work anywhere: spoilers become <details>.
export function exportableMarkdown(text) {
  return String(text || "")
    .replace(/^ {0,3}:::\s*spoiler\b *(.*)$/gim, (_, label) => `<details><summary>${(label.trim() || "Spoiler").replace(/[<>&]/g, "")}</summary>\n`)
    .replace(/^ {0,3}::: *$/gm, "\n</details>");
}
