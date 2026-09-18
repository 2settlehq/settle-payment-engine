/**
 * Render a Markdown file to PDF. Supports the subset of Markdown actually
 * used in docs/*.md: headings (#/##/###), horizontal rules (---), bullet
 * lists (-/*), pipe tables, paragraphs, and inline **bold**, `code`, and
 * [text](url) links (anchor links like [x](#y) render as plain bold text
 * since in-PDF anchors aren't wired up).
 *
 * Pass --landscape for wide tables that don't fit a portrait page.
 *
 * Sample commands:
 *   pnpm run docs:pdf -- docs/TRANSACTION_OVERHEAD.md
 *   pnpm run docs:pdf -- docs/USER_LTV_ESTIMATE.md --output reports/user-ltv-estimate.pdf
 *   pnpm run docs:pdf -- docs/WIDE_TABLE_DOC.md --landscape
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const inputPath = process.argv[2];
if (!inputPath || inputPath.startsWith('--')) {
  console.error('Usage: node scripts/markdown-to-pdf.js <input.md> [--output <output.pdf>]');
  process.exit(1);
}

const resolvedInput = path.resolve(process.cwd(), inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`File not found: ${resolvedInput}`);
  process.exit(1);
}

const defaultOutput = path.join(
  path.dirname(resolvedInput),
  `${path.basename(resolvedInput, path.extname(resolvedInput))}.pdf`
);
const outputPath = path.resolve(process.cwd(), getArg('--output', defaultOutput));

// =============================================================================
// Inline parsing: **bold**, `code`, [text](url)
// =============================================================================

function parseInline(text) {
  const tokens = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'bold', value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'code', value: match[2] });
    } else {
      const url = match[4];
      tokens.push(url.startsWith('#') ? { type: 'bold', value: match[3] } : { type: 'link', value: match[3], url });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return tokens;
}

function renderInline(doc, tokens, baseFont, baseSize) {
  tokens.forEach((token, i) => {
    const continued = i < tokens.length - 1;
    const opts = { continued };
    if (token.type === 'bold') {
      doc.font('Helvetica-Bold').fontSize(baseSize).text(token.value, opts);
    } else if (token.type === 'code') {
      doc.font('Courier').fontSize(baseSize - 1).fillColor('#a33').text(token.value, opts);
      doc.fillColor('black');
    } else if (token.type === 'link') {
      doc.font(baseFont).fontSize(baseSize).fillColor('#0645ad')
        .text(token.value, { ...opts, link: token.url, underline: true });
      doc.fillColor('black');
    } else {
      doc.font(baseFont).fontSize(baseSize).text(token.value, opts);
    }
  });
}

function stripInline(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1');
}

// =============================================================================
// Block parsing
// =============================================================================

function parseBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i += 1;
      continue;
    }

    if (/^-{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (line.trim().startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const rows = tableLines
        .filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim()))
        .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
      blocks.push({ type: 'table', rows });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const paragraphLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3})\s/.test(lines[i]) && !lines[i].trim().startsWith('|') && !/^[-*]\s+/.test(lines[i]) && !/^-{3,}\s*$/.test(lines[i].trim())) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

// =============================================================================
// Render
// =============================================================================

// PDFKit's standard 14 fonts (Helvetica etc.) only support WinAnsi/CP1252
// glyphs - characters outside that set (found by scanning the docs, not
// exhaustive) render as a broken-bar placeholder, so they're substituted.
// Note em/en dashes (U+2014/U+2013) ARE in WinAnsi and don't need this.
const CHAR_REPLACEMENTS = [
  [/₦/g, 'NGN '], // Naira sign, U+20A6
  [/→/g, '->'], // rightwards arrow, U+2192
  [/−/g, '-'], // math minus sign (U+2212), distinct from hyphen-minus
];
let markdown = fs.readFileSync(resolvedInput, 'utf8');
for (const [pattern, replacement] of CHAR_REPLACEMENTS) {
  markdown = markdown.replace(pattern, replacement);
}
const blocks = parseBlocks(markdown);

const doc = new PDFDocument({
  margin: 50,
  size: 'letter',
  layout: hasFlag('--landscape') ? 'landscape' : 'portrait',
  bufferPages: true,
});
doc.pipe(fs.createWriteStream(outputPath));

const CONTENT_WIDTH = doc.page.width - doc.page.margins.left - doc.page.margins.right;

for (const block of blocks) {
  if (block.type === 'heading') {
    const sizes = { 1: 20, 2: 15, 3: 12 };
    doc.moveDown(block.level === 1 ? 0.3 : 0.8);
    renderInline(doc, parseInline(block.text), 'Helvetica-Bold', sizes[block.level] || 11);
    doc.moveDown(0.4);
  } else if (block.type === 'hr') {
    doc.moveDown(0.3);
    doc.moveTo(doc.x, doc.y).lineTo(doc.x + CONTENT_WIDTH, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
  } else if (block.type === 'paragraph') {
    renderInline(doc, parseInline(block.text), 'Helvetica', 10);
    doc.moveDown(0.6);
  } else if (block.type === 'list') {
    for (const item of block.items) {
      const x = doc.x;
      doc.font('Helvetica').fontSize(10).text('-  ', { continued: true, width: CONTENT_WIDTH });
      renderInline(doc, parseInline(item), 'Helvetica', 10);
      doc.x = x;
    }
    doc.moveDown(0.5);
  } else if (block.type === 'table') {
    const colCount = block.rows[0].length;
    const colWidth = CONTENT_WIDTH / colCount;
    const startX = doc.x;

    for (const [rowIndex, row] of block.rows.entries()) {
      doc.font(rowIndex === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);

      // Measure every cell before drawing anything, so a row that doesn't
      // fit moves to the next page as a whole instead of splitting mid-row.
      let rowHeight = 0;
      for (let c = 0; c < colCount; c += 1) {
        const cellText = stripInline(row[c] || '');
        rowHeight = Math.max(rowHeight, doc.heightOfString(cellText, { width: colWidth - 6 }));
      }

      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.x = startX;
      }

      const y = doc.y;
      for (let c = 0; c < colCount; c += 1) {
        const cellText = stripInline(row[c] || '');
        const cellX = startX + c * colWidth;
        doc.font(rowIndex === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        doc.text(cellText, cellX, y, { width: colWidth - 6 });
      }

      doc.y = y + rowHeight + 6;
      if (rowIndex === 0) {
        doc.moveTo(startX, doc.y - 3).lineTo(startX + CONTENT_WIDTH, doc.y - 3).strokeColor('#999999').stroke();
      }
      doc.x = startX;
    }
    doc.moveDown(0.7);
  }

  if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
    doc.addPage();
  }
}

doc.end();
console.log(`PDF written to: ${outputPath}`);
