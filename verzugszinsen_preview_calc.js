// Preview-Berechnung für verzugszinsenrechner_yaml_v3.html – v2 (Datum mit führenden Nullen)
// -----------------------------------------------------------------------------------------
// Ziel: "Berechnen" (#calc) reaktivieren – erzeugt Zinsstaffel & Summen direkt aus dem DOM
// Änderungen ggü. v1: neues formatDateDE() mit führenden Nullen (DD.MM.YYYY)

(function(){
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const txt= (n) => (n?.textContent || '').trim();

  // -------------------- Helpers --------------------
  function parseEuroToNumber(s){
    if (!s) return 0;
    return Number(String(s).replace(/[^0-9,\-]/g,'').replace(/\./g,'').replace(',', '.')) || 0;
  }
  function formatEuro(n){
    return n.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' €';
  }
  function parseDateDE(s){
    const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    return { d, mo, y };
  }
  function formatDateDE(o){
    if (!o) return '';
    const d = String(o.d).padStart(2,'0');
    const m = String(o.mo).padStart(2,'0');
    const y = String(o.y);
    return `${d}.${m}.${y}`;
  }
  function dateDEtoKey(o){ return `${o.y.toString().padStart(4,'0')}-${o.mo.toString().padStart(2,'0')}-${o.d.toString().padStart(2,'0')}`; }
  function cmpDate(a,b){ if(a.y!==b.y) return a.y-b.y; if(a.mo!==b.mo) return a.mo-b.mo; return a.d-b.d; }
  function cloneDate(o){ return {d:o.d, mo:o.mo, y:o.y}; }

  // 30/360 (deutsches 30E/360) – Start- UND Endtag inklusive
  function days_30_360_inclusive(a,b){
    let D1 = Math.min(a.d, 30), D2 = Math.min(b.d, 30);
    let M1 = a.mo, M2 = b.mo, Y1 = a.y, Y2 = b.y;
    return (Y2 - Y1)*360 + (M2 - M1)*30 + (D2 - D1) + 1;
  }
  function addDays_30(a, n){
    let d = a.d + n, m = a.mo, y = a.y;
    while (d > 30){ d -= 30; m += 1; if (m>12){ m=1; y++; } }
    while (d < 1){ d += 30; m -= 1; if (m<1){ m=12; y--; } }
    return {d, mo:m, y};
  }
  function minDate(a,b){ return cmpDate(a,b) <=0 ? a : b; }
  function maxDate(a,b){ return cmpDate(a,b) >=0 ? a : b; }

  // -------------------- Daten aus DOM --------------------
  function readEventsFromDOM(){
    const rows = Array.from($('#tblEvents tbody')?.querySelectorAll('tr') ?? []);
    return rows.map(tr => {
      const tds = tr.querySelectorAll('td');
      return {
        Typ: txt(tds[0]),
        Datum: parseDateDE(txt(tds[1])),
        Betrag: parseEuroToNumber(txt(tds[2])),
        Notiz: txt(tds[3])
      };
    }).filter(r => r.Datum);
  }

  function readMode(){
    const mode = (document.querySelector('input[name="mode"]:checked')?.value)||'privat';
    const custom = Number($('#customPP')?.value||0);
    if (mode==='unternehmen') return 9.0;
    if (mode==='custom') return custom||0;
    return 5.0; // privat
  }

  function readStichtagOrStop(events){
    const stopEv = events.find(e => e.Typ.toUpperCase()==='ZINSSTOP' && e.Datum);
    if (stopEv) return stopEv.Datum;
    const stichtagInput = $('#stichtag')?.value || '';
    const st = stichtagInput ? parseDateDE(stichtagInput.split('-').reverse().join('.')) : null;
    if (st) return st;
    const t = new Date();
    return { d:t.getDate(), mo:t.getMonth()+1, y:t.getFullYear() };
  }

  function readBasis(){
    const raw = window._basisCSV || [];
    const list = raw.map(r => ({
      rate: Number(String(r.basiszins_prozent||'0').replace(',','.')),
      ab: parseDateDE(String(r.gueltig_ab||''))
    })).filter(x => x.ab).sort((a,b)=>cmpDate(a.ab,b.ab));
    return list;
  }

  // -------------------- Kernlogik --------------------
  function buildSaldoZeitschnitte(events){
    const sorted = events.slice().sort((a,b)=>cmpDate(a.Datum,b.Datum));
    let saldo = 0; let started = false;
    const cuts = [];

    for (let i=0;i<sorted.length;i++){
      const e = sorted[i];
      if (e.Typ.toUpperCase()==='START'){ saldo += e.Betrag; started = true; }
      else if (e.Typ.toUpperCase()==='KOSTEN'){ saldo += e.Betrag; }
      else if (e.Typ.toUpperCase()==='ZAHLUNG'){ saldo += e.Betrag; }

      const nextDate = sorted[i+1]?.Datum;
      if (started){
        const von = e.Datum;
        const bis = nextDate ? addDays_30(nextDate, -1) : null;
        cuts.push({ von, bis, saldo });
      }
    }
    return mergeByContiguity(cuts);
  }

  function mergeByContiguity(cuts){
    const out=[];
    for (const c of cuts){
      if (!out.length) { out.push({...c}); continue; }
      const prev = out[out.length-1];
      if (prev.saldo===c.saldo && prev.bis && c.von && cmpDate(addDays_30(prev.bis,1), c.von)===0){
        prev.bis = c.bis;
      } else out.push({...c});
    }
    return out;
  }

  function splitByEnd(cuts, end){
    return cuts.map(c=>{
      const bis = c.bis ? minDate(c.bis, end) : end;
      return {von:c.von, bis, saldo:c.saldo};
    }).filter(c => cmpDate(c.von, c.bis) <= 0);
  }

  function splitByBasis(cuts, basisList){
    const out=[];
    for (const c of cuts){
      let segStart = cloneDate(c.von);
      const stop = c.bis;
      const relevant = basisList.filter(b => cmpDate(b.ab, segStart)>=0 && cmpDate(b.ab, stop)<=0);
      const marks = [segStart, ...relevant.map(b=>b.ab), addDays_30(stop,1)];
      for (let i=0;i<marks.length-1;i++){
        const v = marks[i];
        const b = addDays_30(marks[i+1], -1);
        out.push({von:v, bis:b, saldo:c.saldo});
      }
    }
    return out;
  }

  function rateForDate(basisList, addPP, onDate){
    let base = 0;
    for (const b of basisList){ if (cmpDate(b.ab, onDate) <= 0) base = b.rate; else break; }
    return base + addPP;
  }

  function buildZinsstaffel(){
    const events = readEventsFromDOM();
    if (!events.length) return {rows:[], sum:0};

    const basis = readBasis();
    const addPP = readMode();
    const stichtag = readStichtagOrStop(events);

    let cuts = buildSaldoZeitschnitte(events);
    cuts = splitByEnd(cuts, stichtag);
    cuts = splitByBasis(cuts, basis);

    const rows = [];
    let sum = 0;
    for (const s of cuts){
      const days = days_30_360_inclusive(s.von, s.bis);
      if (days <= 0 || Math.abs(s.saldo) < 0.005) continue;
      const rate = rateForDate(basis, addPP, s.von);
      const part = s.saldo * (rate/100) * (days/360);
      sum += part;
      rows.push({
        Von: formatDateDE(s.von),
        Bis: formatDateDE(s.bis),
        Banktage: days,
        Basiszins: `${(rate - addPP).toFixed(2)} %`,
        ZuschlagAbs: `+${addPP.toFixed(2)} pp`,
        Zinssatz: `${rate.toFixed(2)} %`,
        SaldoBeginn: s.saldo,
        Teilzins: part
      });
    }
    return {rows, sum};
  }

  function renderZinsstaffel(result){
    const tbody = $('#tblZinsen tbody');
    if (!tbody) return;
    const html = result.rows.map(r => (
      `<tr>
        <td>${r.Von}</td>
        <td>${r.Bis}</td>
        <td style="text-align:right">${r.Banktage}</td>
        <td style="text-align:right">${r.Basiszins}</td>
        <td style="text-align:right">${r.Zinssatz}</td>
        <td style="text-align:right">${formatEuro(r.SaldoBeginn)}</td>
        <td style="text-align:right">${formatEuro(r.Teilzins)}</td>
        <td></td><td></td>
      </tr>`
    )).join('');
    tbody.innerHTML = html;
    const sumCell = $('#sumZins');
    if (sumCell) sumCell.textContent = formatEuro(result.sum);
  }

  function renderSummen(result){
    const totals = $('#totals');
    if (!totals) return;
    const events = readEventsFromDOM();
    let saldo = 0; for (const e of events){ if (e.Typ.toUpperCase()==='START' || e.Typ.toUpperCase()==='KOSTEN') saldo += e.Betrag; if (e.Typ.toUpperCase()==='ZAHLUNG') saldo += e.Betrag; }
    const gesamt = saldo + result.sum;
    totals.innerHTML = `<p><b>Summe Zinsen:</b> ${formatEuro(result.sum)}<br>
<b>Saldo aktuell (ohne Zinsen):</b> ${formatEuro(saldo)}<br>
<b>Gesamtforderung (Saldo + Zinsen):</b> ${formatEuro(gesamt)}</p>`;
  }

  // -------------------- Bindung an Button --------------------
  function onCalc(){
    try{
      const res = buildZinsstaffel();
      renderZinsstaffel(res);
      renderSummen(res);
    }catch(e){ console.error('[preview-calc] Fehler', e); alert('Berechnung fehlgeschlagen. Siehe Konsole.'); }
  }

  function init(){
    const btn = $('#calc');
    if (!btn) return;
    if (!btn._previewBound){
      btn.addEventListener('click', onCalc, {capture:false});
      btn._previewBound = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();