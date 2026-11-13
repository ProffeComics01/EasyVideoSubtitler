<?php /* Frontend: tutta la logica è in app.js, il backend in api.php */ ?>
<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Easy Video Subtitler</title>
<link rel="stylesheet" href="style.css?v=10">
</head>
<body>
<header class="top">
  <span class="brand">▤ Easy Video Subtitler</span>
  <span id="projName" class="projname" hidden></span>
  <span id="resBar" class="resbar" hidden>
    <span id="resInfo" class="resinfo" hidden></span>
    <span class="sep" aria-hidden="true"></span>
    <span id="vpInfo" class="resinfo" title="Dimensione attuale del video nell'anteprima"></span>
    <span class="sep" aria-hidden="true"></span>
    <span class="vpbtns" title="Imposta la dimensione dell'anteprima rispetto al video originale">
      <button id="vp100" class="vpbtn" type="button">100%</button><button id="vp50" class="vpbtn" type="button">50%</button>
    </span>
  </span>
  <span id="saveState" class="save" hidden></span>
</header>
<nav id="menubar">
  <div class="menu">
    <button class="mbtn" id="mFile" aria-haspopup="true" aria-expanded="false">File</button>
    <div class="mdrop" id="fileMenu" hidden>
      <button data-m="new">Nuovo progetto</button>
      <button data-m="save">Salva<kbd>Ctrl+S</kbd></button>
      <button data-m="saveas">Salva con nome…</button>
      <button data-m="replace">Sostituisci video…</button>
      <button data-m="load">Carica…</button>
      <div class="msub" id="recentWrap">
        <button data-m="recent" class="has-sub">Recenti<span class="arr">▸</span></button>
        <div class="mdrop submenu" id="recentMenu"></div>
      </div>
      <hr>
      <label class="mchk"><input type="checkbox" id="optOpenLast" checked> Apri l'ultimo progetto all'avvio</label>
    </div>
  </div>
</nav>

<!-- HOME -->
<main id="home">
  <section class="card">
    <h2>Nuovo progetto</h2>
    <p class="hint">Carica il video da sottotitolare. Per riprendere un lavoro usa <b>File ▸ Carica</b> o <b>File ▸ Recenti</b>.</p>
    <form id="uploadForm">
      <input type="text" name="name" placeholder="Nome progetto (opzionale)">
      <label class="file">Video <input type="file" name="video" accept="video/*,.mkv" required></label>
      <button class="primary">Carica</button>
      <progress id="upProg" max="100" value="0" hidden></progress>
    </form>
    <p id="upErr" class="err"></p>
  </section>
  </main>

<!-- EDITOR -->
<main id="editor" hidden>
  <div class="grid">
    <section class="left">
      <div id="stage"><div id="vwrap"><video id="video" playsinline preload="auto"></video><div id="cropbox" hidden title="Area di ritaglio: trascina per spostare, usa gli angoli per ridimensionare"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div><div id="overlay"></div></div></div>
      <div id="hgrip" class="hgrip" title="Trascina per cambiare l'altezza del video · doppio click: ripristina"></div>
      <div class="transport">
        <button id="bStop" class="tbtn" title="Stop: ferma e torna a 0:00"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1"/></svg></button><button id="bPause" class="tbtn" title="Pausa"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3" y="2.5" width="3.6" height="11" rx="1"/><rect x="9.4" y="2.5" width="3.6" height="11" rx="1"/></svg></button><button id="bPlay" class="tbtn" title="Play (Spazio)"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 2.2v11.6a.6.6 0 0 0 .9.5l9.2-5.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5z"/></svg></button>
        <span id="tcur" class="tc">0:00.000</span>
        <input id="seek" type="range" min="0" max="1000" value="0">
        <span id="tdur" class="tc dim">0:00.000</span>
        <button id="bClip" title="Rende 12 s dal cursore con ffmpeg: identico all'export">👁 Anteprima fedele</button>
      </div>
      <div class="tabs">
        <button data-tab="tText" class="on">Testo</button>
        <button data-tab="tStyle">Stile e font</button>
        <button data-tab="tExport">Esporta</button>
      </div>
      <div id="tText" class="tab">
        <p class="hint">Incolla il testo (una frase per riga) oppure un file <b>.srt</b>, poi sincronizza a battuta o trascina i blocchi sulla timeline.</p>
        <textarea id="importText" rows="5" placeholder="Prima riga del brano&#10;Seconda riga…"></textarea>
        <div class="row">
          <button id="bImport" class="primary">Importa testo</button>
          <label class="btn">Carica .srt/.txt <input type="file" id="importFile" accept=".srt,.txt,.sub" hidden></label>
        </div>
        <div class="row">
          <button id="bTap">⏺ Sincronizza a battuta</button>
          <button id="bAdd">+ Sottotitolo qui</button>
        </div>
        <details class="keys"><summary>Scorciatoie</summary>
          <ul>
            <li><kbd>Spazio</kbd> play/pausa · <kbd>←</kbd><kbd>→</kbd> ±0,5 s (<kbd>Shift</kbd> ±5 s)</li>
            <li><kbd>Invio</kbd> in modalità battuta: segna l'inizio della frase · <kbd>Backspace</kbd> annulla l'ultimo</li>
            <li><kbd>S</kbd>/<kbd>E</kbd> imposta inizio/fine del selezionato al cursore · <kbd>Canc</kbd> elimina</li>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> annulla / ripeti</li>
            <li>Timeline: trascina blocchi o bordi · doppio click = nuovo · <kbd>Ctrl</kbd>+rotella = zoom · <kbd>Alt</kbd> = no snap</li>
          </ul>
        </details>
      </div>
      <div id="tStyle" class="tab" hidden>
        <div class="form">
          <label>Font <span id="fontName" class="dim">predefinito</span></label>
          <div class="row"><label class="btn">Carica .ttf/.otf <input type="file" id="fontFile" accept=".ttf,.otf" hidden></label><button id="fontDel">Rimuovi</button></div>
          <label>Dimensione (% altezza) <input type="number" id="sSize" step="0.1" min="1" max="30"></label>
          <label>Colore testo <input type="color" id="sColor"></label>
          <label>Colore contorno <input type="color" id="sOutlineColor"></label>
          <label>Spessore contorno (%) <input type="number" id="sOutline" step="0.05" min="0" max="3"></label>
          <label>Posizione di default <select id="sPos"><option value="bottom">In basso</option><option value="middle">Al centro</option><option value="top">In alto</option></select></label>
          <label>Margine (% altezza) <input type="number" id="sMargin" step="0.5" min="0" max="40"></label>
          <label class="chk"><input type="checkbox" id="sBold"> Grassetto</label>
          <h4>Effetti sul testo <span class="dim">(valori globali: ogni sottotitolo può sovrascrivere opacità, ombra, bagliore e sfondo)</span></h4>
          <label>Opacità (%) <input type="number" id="sOpacity" step="5" min="0" max="100"></label>
          <label>Spaziatura lettere (% font) <input type="number" id="sSpacing" step="1" min="-10" max="60"></label>
          <div class="fx"><label class="chk"><input type="checkbox" id="sShadow"> Ombra</label>
            <span title="Colore"><input type="color" id="sShadowColor"></span>
            <span title="Distanza (% altezza)">dist <input type="number" id="sShadowDist" step="0.1" min="0" max="5"></span>
            <span title="Opacità (%)">op <input type="number" id="sShadowOpacity" step="5" min="0" max="100"></span></div>
          <div class="fx"><label class="chk"><input type="checkbox" id="sGlow"> Bagliore</label>
            <span title="Colore"><input type="color" id="sGlowColor"></span>
            <span title="Raggio (% altezza)">raggio <input type="number" id="sGlowSize" step="0.1" min="0" max="10"></span>
            <span title="Opacità (%)">op <input type="number" id="sGlowOpacity" step="5" min="0" max="100"></span></div>
          <div class="fx"><label class="chk"><input type="checkbox" id="sBox"> Sfondo</label>
            <span title="Colore"><input type="color" id="sBoxColor"></span>
            <span title="Margine interno (% altezza)">margine <input type="number" id="sBoxPad" step="0.1" min="0" max="10"></span>
            <span title="Opacità (%)">op <input type="number" id="sBoxOpacity" step="5" min="0" max="100"></span></div>
        </div>
      </div>
      <div id="tExport" class="tab" hidden>
        <div class="form">
          <label>Qualità (CRF, più basso = migliore) <input type="number" id="sCrf" min="14" max="32"></label>
          <h4>Dimensioni di uscita (ritaglio)</h4>
          <label>Formato <select id="cPreset"><option value="orig">Originale (nessun ritaglio)</option><option value="free">Libero</option><option value="16:9">16:9</option><option value="9:16">9:16 (Reels/Stories)</option><option value="1:1">1:1 (quadrato)</option><option value="4:5">4:5 (feed Instagram)</option><option value="4:3">4:3</option><option value="3:4">3:4</option></select></label>
          <label>Larghezza × Altezza (px) <span class="pair"><input type="number" id="cW" step="2" min="16"> × <input type="number" id="cH" step="2" min="16"></span></label>
          <label>Posizione X, Y (px) <span class="pair"><input type="number" id="cX" step="2" min="0"> , <input type="number" id="cY" step="2" min="0"></span></label>
          <div class="row"><button id="cCenter">Centra</button><button id="cReset">Ripristina originale</button></div>
          <p class="hint" id="cInfo"></p>
        </div>
        <div class="row"><button id="bExport" class="primary">Cuoci video con sottotitoli</button></div>
        <progress id="exProg" max="100" value="0" hidden></progress>
        <p id="exMsg" class="hint"></p>
        <div class="row" id="dl">
          <a id="dlVideo" class="btn" hidden>⬇ Video</a>
          <a id="dlSrt" class="btn">⬇ .srt</a>
          <a id="dlAss" class="btn">⬇ .ass</a>
        </div>
      </div>
    </section>
    <div id="vsplit" class="vsplit" title="Trascina per cambiare la larghezza dei riquadri · doppio click: ripristina"></div>
    <section class="right">
      <div class="listhead"><b id="count">0</b> sottotitoli <span id="tapBar" class="tapbar" hidden></span></div>
      <div id="list"></div>
    </section>
  </div>
  <section class="timeline">
    <div class="tlbar">
      <button id="zOut">−</button><button id="zIn">+</button><button id="zFit">Adatta</button>
      <input id="scroll" type="range" min="0" max="1000" value="0" step="any">
      <span id="peakState" class="dim"></span>
    </div>
    <canvas id="tl"></canvas>
  </section>
</main>
<input type="file" id="replaceFile" accept="video/*,.mkv" hidden>
<dialog id="nameDlg"><form method="dialog" id="nameForm"><h3>Salva con nome</h3><input type="text" id="nameInput" maxlength="120" required autocomplete="off"><div class="row"><button class="primary" value="ok">Salva copia</button><button type="button" id="nameCancel">Annulla</button></div></form></dialog>
<dialog id="loadDlg"><h3>Carica progetto</h3><div id="loadList"></div><div class="row"><button id="loadClose">Chiudi</button></div></dialog>
<dialog id="clipDlg"><video id="clipVideo" controls playsinline></video><div class="row"><span class="hint">Render ffmpeg identico all'export (480p, 12 s dal cursore)</span><button id="clipClose">Chiudi</button></div></dialog>
<script src="app.js?v=10"></script>
</body>
</html>
