// Calc Reactivate Shim v2 — macht den "Berechnen"-Button wieder wirksam, egal ob
// die App per Formular-Submit ODER per JS-Funktion rechnet. Kein Overwrite deiner Logik.
// Einbinden: GANZ unten vor </body>, NACH allen anderen Skripten.
(function(){
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // --- Kandidatennamen, falls App über globale Funktion rechnet
  const CALC_FN_CANDIDATES = [
    'calcAll','Berechnen','recalc','calculate','runCalc','doCalc','compute','recompute','go','start','main'
  ];

  function callKnownCalc(){
    for (const name of CALC_FN_CANDIDATES){
      const fn = window[name];
      if (typeof fn === 'function'){
        try { console.info('[shim] call', name); fn(); return true; } catch(e){ console.warn('[shim] Fehler in', name, e); }
      }
    }
    if (window.App && typeof window.App.calculate === 'function'){
      try { console.info('[shim] call App.calculate'); window.App.calculate(); return true; } catch(e){ console.warn('[shim] Fehler in App.calculate', e); }
    }
    return false;
  }

  function triggerStichtagIfPresent(){
    const setBtn = $('#setStichtag');
    if (setBtn){ try { setBtn.click(); } catch(_){} }
  }

  function requestFormSubmitIfNeeded(){
    const btn = $('#calc');
    if (!btn) return false;
    const form = btn.closest('form');
    if (!form) return false;

    // Wenn der Code ursprünglich auf FORM-SUBMIT hört, aber der Button type="button" ist,
    // dann passiert beim Klick nichts. Wir reichen dann aktiv einen Submit nach.
    try {
      if (typeof form.requestSubmit === 'function') form.requestSubmit(btn);
      else form.submit();
      console.info('[shim] form submit triggered');
      return true;
    } catch(e){ console.warn('[shim] form submit failed', e); return false; }
  }

  function ensureCalc(){
    const btn = $('#calc');
    if (!btn) return;

    // ENTER im Stichtag-Feld triggert Berechnen
    const stichtag = $('#stichtag');
    if (stichtag && !stichtag._shimBound){
      stichtag.addEventListener('keydown', e=>{ if (e.key === 'Enter') btn.click(); });
      stichtag._shimBound = true;
    }

    // Zusätzlicher Listener, der NICHT blockiert: wir lassen alles Originale durch,
    // und starten danach unsere Fallbacks, falls keine Zinszeilen entstanden sind.
    if (!btn._shimBound){
      btn.addEventListener('click', function(){
        setTimeout(()=>{
          const hasZins = $$('#tblZinsen tbody tr').length > 0;
          if (hasZins) return; // alles gut, App hat gerechnet

          // 1) Falls App via Formular-Submit rechnet → submitten
          const submitted = requestFormSubmitIfNeeded();

          setTimeout(()=>{
            const hasZins2 = $$('#tblZinsen tbody tr').length > 0;
            if (hasZins2) return;

            // 2) Stichtag-Button klicken (manche Apps rechnen danach automatisch)
            triggerStichtagIfPresent();

            setTimeout(()=>{
              const hasZins3 = $$('#tblZinsen tbody tr').length > 0;
              if (hasZins3) return;

              // 3) Bekannte Funktionsnamen probieren
              const called = callKnownCalc();
              if (!called){
                console.warn('[shim] Keine Berechnungsfunktion gefunden. Bitte Funktionsnamen nennen, z. B. calcAll().');
              }
            }, 50);
          }, submitted ? 50 : 0);
        }, 0);
      }, {capture:false});
      btn._shimBound = true;
    }
  }

  // Diagnose: welche Kandidaten existieren?
  function logDiag(){
    const found = CALC_FN_CANDIDATES.filter(n => typeof window[n] === 'function');
    if (found.length) console.info('[shim] Gefundene Calc-Funktionen:', found.join(', '));
    else console.info('[shim] Keine globalen Calc-Funktionen gefunden. Falls vorhanden, bitte Namen mitteilen.');
  }

  function init(){
    ensureCalc();
    setTimeout(logDiag, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();