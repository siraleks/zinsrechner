// Verzugszinsen – Zusatz-Skript: Loader + LaTeX-Export (konfliktfrei, fixed)
(function(){
  // ===== Helpers =====
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const txt= (n) => (n?.textContent || '').trim();

  // --- CSV Parser (Semikolon) ---
  function parseCSV(text, sep=';') {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) return [];
    const header = lines[0].split(sep).map(h => h.trim());
    return lines.slice(1).map(line => {
      const cells = line.split(sep);
      const obj = {};
      header.forEach((h,i)=> obj[h] = (cells[i]||'').trim());
      return obj;
    });
  }

  // --- YAML/JSON (einfach) ---
// --- YAML/JSON (robuster: 2 Ebenen) ---
function parseYAMLorJSON(text){
  // 1) JSON?
  try { return JSON.parse(text); } catch(_){}

  // 2) YAML (sehr einfach, aber mit 2 Ebenen und Einrückung)
  const lines = text.split(/\r?\n/);

  // Hilfsfunktionen
  const stripComment = (s) => s.replace(/\s+#.*$/, '');
  const unquote = (s) => s.replace(/^"(.*)"$/,'$1').replace(/^'(.*)'$/,'$1').trim();

  const root = {};
  // Stack von {indent, targetObj}
  const stack = [{ indent: -1, obj: root }];

  for (let raw of lines) {
    let line = stripComment(raw);
    if (!line.trim()) continue;

    // Einrückung zählen (Spaces)
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    line = line.slice(indent);

    // Nur key: value oder key:  (ohne Listen etc.)
    const m = line.match(/^([^:#]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2];

    // Ebene anhand der Einrückung bestimmen
    while (stack.length && indent <= stack[stack.length-1].indent) {
      stack.pop();
    }
    const ctx = stack[stack.length-1].obj;

    if (val === '' || val === undefined) {
      // key:  -> Neuer Objektblock
      const child = {};
      ctx[key] = child;
      stack.push({ indent, obj: child });
    } else {
      // key: value
      ctx[key] = unquote(val);
    }
  }

  return root;
}


  // === Neu: Aktenzeichen + Schuldner robust aus YAML/JSON holen ===
function getAktenzeichenFromFall(f){
  if (!f || typeof f !== 'object') return '—';
  return f.Aktenzeichen ?? f.aktenzeichen ?? f.az ?? f.AZ ?? '—';
}

function getSchuldnerFromFall(f){
  if (!f || typeof f !== 'object') return { name: null, adresse: null };

  // mögliche Schlüssel für die Person/Firma:
  const s = f.schuldner ?? f.Schuldner ?? f.debitor ?? f.debtor ?? f.schuldnerin ?? null;
  let name = null, adresse = null;

  if (!s) {
    // sehr einfache YAMLs: direkt auf Root-Ebene als String
    if (typeof f.Schuldner === 'string') return { name: f.Schuldner.trim(), adresse: null };
    if (typeof f.schuldner === 'string') return { name: f.schuldner.trim(), adresse: null };
    return { name: null, adresse: null };
  }

  if (typeof s === 'string') {
    name = s.trim();
  } else if (typeof s === 'object') {
    if (s.name) name = String(s.name).trim();
    if (!name && (s.vorname || s.nachname)) name = [s.vorname, s.nachname].filter(Boolean).join(' ').trim();
    if (!name && (s.firma || s.unternehmen)) name = String(s.firma || s.unternehmen).trim();

    const adrObj = s.adresse ?? s.anschrift ?? s.address;
    if (typeof adrObj === 'string') {
      adresse = adrObj.trim();
    } else if (Array.isArray(adrObj)) {
      adresse = adrObj.filter(Boolean).join(', ');
    } else if (adrObj && typeof adrObj === 'object') {
      const parts = [
        adrObj.strasse ?? adrObj.str ?? adrObj.street,
        adrObj.plz ?? adrObj.postleitzahl ?? adrObj.zip,
        adrObj.ort ?? adrObj.stadt ?? adrObj.city,
        adrObj.land ?? adrObj.country
      ].filter(Boolean);
      adresse = parts.length ? parts.join(', ')
                             : Object.values(adrObj).filter(v => v!=null).map(String).join(', ');
    }
  }

  return { name: name || null, adresse: adresse || null };
}

	
  // --- DOM -> Tabellen-Daten ---
  function extractTableByHeaders(tableSelector, headerNames){
    const table = $(tableSelector);
    if (!table) return [];
    const headCells = Array.from(table.querySelectorAll('thead th')).map(th => txt(th));
    const idx = {};
    headerNames.forEach(h => {
      const i = headCells.findIndex(x => (x||'').toLowerCase() === h.toLowerCase());
      idx[h] = i; // -1 wenn nicht gefunden
    });
    return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => txt(td));
      const obj = {};
      for (const h of headerNames) obj[h] = idx[h] >= 0 ? cells[idx[h]] : '';
      return obj;
    });
  }

  // --- LaTeX Escape (UTF-8; € direkt erlaubt) ---
  function latexEscape(s){
    if (!s) return '';
    return String(s)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/([{}$&#_%])/g, '\\$1')
      .replace(/\^/g, '\\textasciicircum{}')
      .replace(/~/g, '\\textasciitilde{}');
  }

  // === Neu: Aktenzeichen + Schuldner robust aus YAML/JSON holen ===
function getAktenzeichenFromFall(f){
  if (!f || typeof f !== 'object') return '—';
  return f.Aktenzeichen ?? f.aktenzeichen ?? f.az ?? f.AZ ?? '—';
}

function getSchuldnerFromFall(f){
  if (!f || typeof f !== 'object') return { name: null, adresse: null };

  // Kandidatenfelder für die Person/Firma
  const s = f.schuldner ?? f.Schuldner ?? f.debitor ?? f.debtor ?? f.schuldnerin ?? null;
  let name = null, adresse = null;

  // Direkte Fallbacks (einfacher YAML-Loader schreibt ggf. flach)
  if (!s) {
    if (typeof f.Schuldner === 'string') return { name: f.Schuldner.trim(), adresse: null };
    if (typeof f.schuldner === 'string') return { name: f.schuldner.trim(), adresse: null };
  }

  if (typeof s === 'string') {
    name = s.trim();
  } else if (s && typeof s === 'object') {
    // Name/Firma zusammensetzen
    if (s.name) name = String(s.name).trim();
    if (!name && (s.vorname || s.nachname)) name = [s.vorname, s.nachname].filter(Boolean).join(' ').trim();
    if (!name && (s.firma || s.unternehmen)) name = String(s.firma || s.unternehmen).trim();

    // Adresse aus String/Array/Objekt akzeptieren
    const adrObj = s.adresse ?? s.anschrift ?? s.address;
    if (typeof adrObj === 'string') {
      adresse = adrObj.trim();
    } else if (Array.isArray(adrObj)) {
      adresse = adrObj.filter(Boolean).join(', ');
    } else if (adrObj && typeof adrObj === 'object') {
      const parts = [
        adrObj.strasse ?? adrObj.str ?? adrObj.street,
        adrObj.plz ?? adrObj.postleitzahl ?? adrObj.zip,
        adrObj.ort ?? adrObj.stadt ?? adrObj.city,
        adrObj.land ?? adrObj.country
      ].filter(Boolean);
      adresse = parts.length ? parts.join(', ')
                             : Object.values(adrObj).filter(v => v!=null).map(String).join(', ');
    }
  }

  return { name: name || null, adresse: adresse || null };
}



  // --- Falldaten aus #fallView ---
  function parseFall() {
  // 1) bevorzugt echte Falldaten aus dem Loader
  if (window._fall && typeof window._fall === 'object') {
    const aktenzeichen = getAktenzeichenFromFall(window._fall) || 'AZ-?';
    const s = getSchuldnerFromFall(window._fall);
    const schuldner = s.name || 'Schuldner unbekannt';
    return { schuldner, aktenzeichen };
  }

  // 2) Fallback: aus der HTML-Vorschau lesen (kompatibel zu bisher)
  const fv = $('#fallView');
  let schuldner = 'Schuldner unbekannt';
  let aktenzeichen = 'AZ-?';
  if (fv) {
    const html = fv.innerHTML;
    const akzMatch = html.match(/Aktenzeichen:<\/b>\s*([^<]+)/i);
    const schMatch = html.match(/Schuldner:<\/b>\s*([^<]+)/i);
    if (akzMatch) aktenzeichen = akzMatch[1].trim();
    if (schMatch) schuldner = schMatch[1].split('–')[0].trim();
  }
  return { schuldner, aktenzeichen };
}



  // ===== Loader initialisieren =====
  function initLoaders(){
    $('#loadBasis')?.addEventListener('click', ()=>{
      const f = $('#basisFile')?.files?.[0];
      if (!f) return alert('Bitte Basiszins-CSV auswählen.');
      const fr = new FileReader();
      fr.onload = () => {
        const rows = parseCSV(fr.result, ';');
        const last = rows[rows.length-1];
        const info = `Basiszinssätze: ${rows.length} Einträge.` + (last?.gueltig_ab ? ` Letzter: ${last.gueltig_ab}` : '');
        $('#basisInfo') && ($('#basisInfo').textContent = info);
        window._basisCSV = rows;
      };
      fr.readAsText(f, 'utf-8');
    });

    $('#loadFall')?.addEventListener('click', ()=>{
  const f = $('#fallFile')?.files?.[0];
  if (!f) return alert('Bitte Fall-YAML/JSON auswählen.');

  const fr = new FileReader();
  fr.onload = () => {
	  const data = parseYAMLorJSON(fr.result);
	  $('#fallInfo') && ($('#fallInfo').textContent = 'Fall geladen.');

	  const az = getAktenzeichenFromFall(data);
	  const s  = getSchuldnerFromFall(data);
	  const name = s.name || '—';
	  const adr  = s.adresse ? ' – ' + s.adresse : '';

	  $('#fallView') && ($('#fallView').innerHTML =
		`<p><b>Aktenzeichen:</b> ${az}<br><b>Schuldner:</b> ${name}${adr}</p>`);

	  window._fall = data;
	};

  // <<< WICHTIG: Datei wirklich lesen >>>
  fr.readAsText(f, 'utf-8');
}); // <<< WICHTIG: Handler sauber schließen



    $('#loadForderung')?.addEventListener('click', ()=>{
      const f = $('#schuldnerFile')?.files?.[0];
      if (!f) return alert('Bitte Forderungs-CSV auswählen.');
      const fr = new FileReader();
      fr.onload = () => {
        const rows = parseCSV(fr.result, ';');
        $('#forderungInfo') && ($('#forderungInfo').textContent = `Ereignisse: ${rows.length}`);
        const tbody = $('#tblEvents tbody');
        if (tbody) {
          tbody.innerHTML = rows.map(r => (
            `<tr>
              <td>${r.Typ||''}</td>
              <td>${r.Datum||''}</td>
              <td>${r.Betrag||''}</td>
              <td>${r.Notiz||''}</td>
              <td>${r.zuschlag_pp||''}</td>
              <td>${r.zinssatz_gesamt||''}</td>
            </tr>`
          )).join('');
        }
        window._events = rows;
      };
      fr.readAsText(f, 'utf-8');
    });
  }

  // ===== LaTeX – Builder =====
  function buildEventsLatex(){
    const header = ["Typ","Datum","Betrag","Notiz","zuschlag_pp","zinssatz_gesamt"];
    const rows = extractTableByHeaders('#tblEvents', header);
    if (!rows.length) return '';

    const preamble = `\\begin{longtable}{p{0.12\\textwidth} p{0.10\\textwidth} p{0.14\\textwidth} p{0.40\\textwidth} p{0.12\\textwidth} p{0.12\\textwidth}}`;
    const headerRow = '\\toprule\n' +
      '\\textbf{Typ} & \\textbf{Datum} & \\textbf{Betrag} & \\textbf{Notiz} & \\textbf{zuschlag\\_pp} & \\textbf{zinssatz\\_gesamt}\\\\\n' +
      '\\midrule\n' +
      '\\endfirsthead\n' +
      '\\toprule\n' +
      '\\textbf{Typ} & \\textbf{Datum} & \\textbf{Betrag} & \\textbf{Notiz} & \\textbf{zuschlag\\_pp} & \\textbf{zinssatz\\_gesamt}\\\\\n' +
      '\\midrule\n' +
      '\\endhead\n' +
      '\\midrule\n' +
      '\\multicolumn{6}{r}{\\emph{Fortsetzung auf der nächsten Seite}}\\\\\n' +
      '\\midrule\n' +
      '\\endfoot\n' +
      '\\bottomrule\n' +
      '\\endlastfoot\n';

    const body = rows.map(r => [
      latexEscape(r["Typ"]),
      latexEscape(r["Datum"]),
      latexEscape(r["Betrag"]),
      latexEscape(r["Notiz"]),
      latexEscape(r["zuschlag_pp"]),
      latexEscape(r["zinssatz_gesamt"])
    ].join(' & ') + ' \\\\').join('\n');

    return [
      '% Ereignisse',
      '\\section*{Ereignisse}',
      preamble,
      headerRow,
      body,
      '\\end{longtable}'
    ].join('\n');
  }

  function buildZinsstaffelLatex(){
    const allHeaders = ["Von","Bis","Banktage","Basiszins","Zuschlag/Abs.","Zinssatz gesamt","Saldo (Beginn)","Teilzins","Quelle","Vorbehalt"];
    const rowsRaw = extractTableByHeaders('#tblZinsen', allHeaders);
    if (!rowsRaw.length) return '';

    const sumZins = txt($('#sumZins')) || '';

    // reduzierte Spalten: Von | Bis | Banktage | Basiszins | Zinssatz gesamt | Saldo (Beginn) | Teilzins
    const preamble = `\\begin{longtable}{p{0.11\\textwidth} p{0.11\\textwidth} p{0.09\\textwidth} p{0.11\\textwidth} p{0.15\\textwidth} p{0.19\\textwidth} p{0.18\\textwidth}}`;
    const headerRow = '\\toprule\n' +
      '\\textbf{Von} & \\textbf{Bis} & \\textbf{Banktage} & \\textbf{Basiszins} & \\textbf{Zinssatz gesamt} & \\textbf{Saldo (Beginn)} & \\textbf{Teilzins}\\\\\n' +
      '\\midrule\n' +
      '\\endfirsthead\n' +
      '\\toprule\n' +
      '\\textbf{Von} & \\textbf{Bis} & \\textbf{Banktage} & \\textbf{Basiszins} & \\textbf{Zinssatz gesamt} & \\textbf{Saldo (Beginn)} & \\textbf{Teilzins}\\\\\n' +
      '\\midrule\n' +
      '\\endhead\n' +
      '\\midrule\n' +
      `\\multicolumn{6}{r}{\\textbf{Summe Zinsen}} & \\textbf{${latexEscape(sumZins)}}\\\\\n` +
      '\\bottomrule\n' +
      '\\endfoot\n' +
      '\\bottomrule\n' +
      '\\endlastfoot\n';

    const body = rowsRaw.map(r => {
      const row = {
        "Von": r["Von"],
        "Bis": r["Bis"],
        "Banktage": r["Banktage"],
        "Basiszins": r["Basiszins"],
        "Zinssatz gesamt": r["Zinssatz gesamt"] || r["Zuschlag/Abs."],
        "Saldo (Beginn)": r["Saldo (Beginn)"],
        "Teilzins": r["Teilzins"]
      };
      return [
        latexEscape(row["Von"]),
        latexEscape(row["Bis"]),
        latexEscape(row["Banktage"]),
        latexEscape(row["Basiszins"]),
        latexEscape(row["Zinssatz gesamt"]),
        latexEscape(row["Saldo (Beginn)"]),
        latexEscape(row["Teilzins"])
      ].join(' & ') + ' \\\\';
    }).join('\n');

    return [
      '% Zinsstaffel',
      '\\section*{Zinsstaffel (30/360 inkl.)}',
      preamble,
      headerRow,
      body,
      '\\end{longtable}'
    ].join('\n');
  }

  function buildSummenLatex(){
    const sumZins = txt($('#sumZins')) || '';
    const totals = $('#totals') ? $('#totals').innerText.trim().split('\n') : [];
    let saldoAktuell = '', gesamt = '';
    totals.forEach(line => {
      const t = line.trim();
      if (t.startsWith('Saldo aktuell')) saldoAktuell = t.split(':').slice(1).join(':').trim();
      if (t.startsWith('Gesamtforderung')) gesamt = t.split(':').slice(1).join(':').trim();
    });

    return [
      '% Summen',
      '\\section*{Summen}',
      '\\begin{itemize}[leftmargin=*,itemsep=2pt,topsep=2pt]',
      `  \\item \\textbf{Summe Zinsen:} ${latexEscape(sumZins)}`,
      saldoAktuell ? `  \\item \\textbf{Saldo aktuell (ohne Zinsen):} ${latexEscape(saldoAktuell)}` : '',
      gesamt ? `  \\item \\textbf{Gesamtforderung (Saldo + Zinsen):} ${latexEscape(gesamt)}` : '',
      '\\end{itemize}'
    ].join('\n');
  }

  function buildHinweiseLatex(){
    return [
      '% Hinweise / Kommentar',
      '\\section*{Hinweise / Kommentar}',
      '\\begin{itemize}[leftmargin=*,itemsep=2pt,topsep=2pt]',
      '  \\item Zinsmethode: Banktage 30/360, Start- und Endtag inklusive.',
      '  \\item Zinssatz = Basiszins (§ 247 BGB) + Zuschlag (Modus).',
      '  \\item Zuschlag/Abs.: Modus {variable je nach dem ob privat oder gewerblich} = Basiszins + 5 Prozentpunkte; daher in der Tabelle bereits als „Zinssatz gesamt“ enthalten.',
      '\\end{itemize}'
    ].join('\n');
  }

  function buildLatexDocument(){
    const { schuldner, aktenzeichen } = parseFall();
    const preamble = [
      '% !TeX program = lualatex',
      '\\documentclass[10pt]{article}',
      '\\usepackage{fontspec}',
      '\\usepackage{polyglossia}',
      '\\setmainlanguage{german}',
      '\\setmainfont{TeX Gyre Termes}',
      '\\usepackage[a4paper,left=22mm,right=30mm,top=22mm,bottom=22mm]{geometry}',
      '\\usepackage{microtype}',
      '\\usepackage{booktabs,longtable,array}',
      '\\usepackage{ragged2e}',
      '\\usepackage{enumitem}',
      '\\setlength{\\tabcolsep}{4pt}',
      '\\renewcommand{\\arraystretch}{1.08}',
      '\\setlength{\\LTpre}{0pt}',
      '\\setlength{\\LTpost}{6pt}',
      '\\emergencystretch=2em',
      '\\sloppy',
      '\\newcolumntype{L}[1]{>{\\RaggedRight\\arraybackslash}p{#1}}',
      '\\newcolumntype{R}[1]{>{\\RaggedLeft\\arraybackslash} p{#1}}',
      '\\newcolumntype{C}[1]{>{\\Centering\\arraybackslash}   p{#1}}',
      `\\newcommand{\\Schuldner}{${latexEscape(schuldner)}}`,
      `\\newcommand{\\Aktenzeichen}{${latexEscape(aktenzeichen)}}`,
      '\\begin{document}',
      '{\\Large \\textbf{Verzugszinsen — \\Schuldner}}\\\\[2pt]',
      '\\textbf{Aktenzeichen:} \\Aktenzeichen',
      ''
    ].join('\n');

    const parts = [
      buildEventsLatex(),
      '',
      buildZinsstaffelLatex(),
      '',
      buildSummenLatex(),
      '',
      buildHinweiseLatex(),
      '',
      '\\end{document}'
    ];

    return preamble + parts.join('\n');
  }

  // ===== Export-Click (nutzt deinen statischen Button) =====
  function initExport(){
    document.addEventListener('click', (ev)=>{
      if (ev.target && ev.target.id === 'exportLatex') {
        // Warnung, falls noch nichts berechnet wurde:
        const zRows = $$('#tblZinsen tbody tr');
        if (!zRows.length) {
          alert('Bitte zuerst „Berechnen“ ausführen – die Zinsstaffel ist leer.');
          return;
        }
        try {
          const { aktenzeichen } = parseFall();
          const tex = buildLatexDocument();
          const safeAkz = (aktenzeichen || 'Fall').replace(/[^\w\-]+/g,'_');
          const blob = new Blob([tex], {type: 'text/plain;charset=utf-8'});
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `Verzugszinsen_${safeAkz}.tex`;
          document.body.appendChild(a);
          a.click();
          setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
        } catch (e) {
          console.error('LaTeX Export failed:', e);
          alert('Konnte LaTeX nicht erzeugen. Siehe Konsole für Details.');
        }
      }
    });
  }

  // ===== Init =====
  function init(){
    initLoaders();
    initExport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
