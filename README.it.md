# Easy Video Subtitler

Piccola web app **PHP + JavaScript**, senza dipendenze, per aggiungere sottotitoli stilizzati e animati a un video.
Carichi il video, incolli il testo (o un `.srt`), sincronizzi premendo un tasto mentre il video scorre, correggi ogni
frase su una timeline con la forma d'onda, scegli font ed effetti — poi un job **ffmpeg** "cuoce" tutto in un nuovo video.

🇬🇧 English: [README.md](README.md)

## Funzioni

- **Timeline** con forma d'onda: trascina blocchi e bordi, snap, zoom, annulla/ripeti, pulsanti ±0,1 s / ±0,5 s.
- **Sincronizzazione a battuta**: incolla una frase per riga e premi **Invio** all'inizio di ogni frase.
- **Importa/esporta** `.srt`; esporta `.ass`; esporta il video finale (`.mp4` H.264/AAC).
- **Font personalizzato** (`.ttf`/`.otf`), dimensione, colori, contorno, posizione (globale e per sottotitolo).
- **Animazioni del testo** (entrata e uscita, durata in ms, per sottotitolo): dissolvenza, macchina da scrivere, pop, rimbalzo,
  zoom, zoom da grande, scorrimento (4 direzioni), rivela, ribalta, spaziatura, vortice, sfocatura.
- **Effetti sul testo**: opacità, ombra, bagliore, sfondo, spaziatura — valori globali con override per sottotitolo.
- **Ritaglio / dimensioni di uscita**: formati predefiniti (16:9, 9:16, 1:1, 4:5…), riquadro di ritaglio spostabile sull'anteprima.
  I sottotitoli sono composti sul frame ritagliato. Nessun ridimensionamento: il video viene solo ritagliato.
- **Anteprima fedele**: 12 secondi renderizzati da ffmpeg dal cursore, identici all'export.
- **Progetti** salvati nella cartella di lavoro: *File ▸ Nuovo / Salva / Salva con nome / Sostituisci video / Carica / Recenti*, con riapertura dell'ultimo progetto all'avvio (opzionale).
- **Sostituisci video**: cambia il video di un progetto mantenendo sottotitoli e stile (utile per una versione rimontata). Se durata, risoluzione o audio differiscono chiede conferma; con una risoluzione diversa il ritaglio viene azzerato. Il file precedente viene eliminato, e anche le anteprime ed esportazioni derivate; le copie create con *Salva con nome* non sono toccate.

## Requisiti

PHP ≥ 8.1, `ffmpeg` con **libass** e `ffprobe`, `fc-scan` (fontconfig), un browser moderno.

## Avvio rapido

```bash
git clone https://github.com/ProffeComics01/easy-video-subtitler.git
cd easy-video-subtitler
./run.sh 8080          # poi apri http://localhost:8080
```

## Aggiornare senza perdere i progetti

I progetti stanno in `storage/`, **dentro la cartella dell'app**. Prima di sostituire la cartella con una versione più
recente, copia `storage/` in un posto sicuro (oppure imposta `SUBTITLER_STORAGE` su una cartella esterna all'app).

## Sicurezza

Non c'è autenticazione: chiunque raggiunga l'indirizzo vede ed elimina tutti i progetti. Usalo in locale o dietro
Basic Auth / VPN / reverse proxy con login. La document root deve essere `public/`.

## Come funziona, configurazione, test

Vedi la sezione corrispondente in [README.md](README.md). Test: `php tests/ass_smoke.php`.

## Contribuire

Segnalazioni e pull request sono benvenute: [CONTRIBUTING.md](CONTRIBUTING.md). Licenza: [MIT](LICENSE).
