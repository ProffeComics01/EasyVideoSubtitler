<?php
declare(strict_types=1);
/** Funzioni condivise tra api.php (web) e worker.php (CLI). */


/* Fallback se l'estensione mbstring non è installata. */
if (!function_exists('mb_substr')) {
    function mb_substr(string $s, int $start, ?int $len = null): string {
        if (preg_match_all('/./us', $s, $m) === false) return substr($s, $start, $len);
        return implode('', array_slice($m[0], $start, $len));
    }
}

define('STORAGE', getenv('SUBTITLER_STORAGE') ?: __DIR__ . '/storage');
define('FFMPEG',  getenv('FFMPEG')  ?: 'ffmpeg');
define('FFPROBE', getenv('FFPROBE') ?: 'ffprobe');
define('PHP_CLI', getenv('PHP_CLI') ?: (in_array(PHP_SAPI, ['cli', 'cli-server'], true) ? PHP_BINARY : 'php'));

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];
const FONT_EXT  = ['ttf', 'otf'];


const ANIM_KINDS = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'zoom-out', 'swirl', 'blur',
                    'pop', 'bounce', 'typewriter', 'flip', 'spread', 'wipe'];
const POS_KINDS  = ['bottom', 'middle', 'top'];
/** Keyframe di scala (progresso 0..1 -> scala) per le animazioni a rimbalzo. Speculari a KF in app.js. */
const KEYFRAMES = [
    'pop'    => [[0, 0], [0.6, 1.15], [1, 1]],
    'bounce' => [[0, 0], [0.45, 1.25], [0.7, 0.9], [0.85, 1.05], [1, 1]],
];

/** Durate effettive (s) di entrata/uscita: troncate in proporzione se superano la durata del sottotitolo. */
function animTimes(array $s): array {
    $dur = max(0.0, (float)$s['end'] - (float)$s['start']);
    $in  = ($s['inA']  ?? 'none') !== 'none' ? max(0.0, (float)($s['inMs']  ?? 0) / 1000) : 0.0;
    $out = ($s['outA'] ?? 'none') !== 'none' ? max(0.0, (float)($s['outMs'] ?? 0) / 1000) : 0.0;
    $tot = $in + $out;
    if ($tot > $dur && $tot > 0) { $f = $dur / $tot; $in *= $f; $out *= $f; }
    return [$in < 0.02 ? 0.0 : $in, $out < 0.02 ? 0.0 : $out];
}

/** Numero di passi della macchina da scrivere (>= 40 ms ciascuno). Speculare a typeSteps() in app.js. */
function typeSteps(int $len, float $d): int { return max(1, min($len, (int)floor($d / 0.04))); }

/** Tag ASS di un'animazione. $in = entrata/uscita, $d durata in s, $a = [x,y] ancora, $c = [x,y] centro stimato. */
function animTags(string $kind, bool $in, float $d, array $a, array $c, int $W, int $H, float $sizePx, float $sp0): string {
    $ms = (int)round($d * 1000);
    [$ax, $ay] = $a;
    $fad = $in ? "\\fad($ms,0)" : "\\fad(0,$ms)";
    switch ($kind) {
    case 'fade': return $fad;
    case 'slide-up': case 'slide-down': case 'slide-left': case 'slide-right':
        $m = ['slide-up' => [0, -1], 'slide-down' => [0, 1], 'slide-left' => [-1, 0], 'slide-right' => [1, 0]][$kind];
        $dx = (int)round($m[0] * 0.12 * $W); $dy = (int)round($m[1] * 0.10 * $H);
        return ($in ? sprintf('\\move(%d,%d,%d,%d,0,%d)', $ax - $dx, $ay - $dy, $ax, $ay, $ms)
                    : sprintf('\\move(%d,%d,%d,%d,0,%d)', $ax, $ay, $ax + $dx, $ay + $dy, $ms)) . $fad;
    case 'zoom':
        return $in ? "\\fscx1\\fscy1\\t(0,$ms,\\fscx100\\fscy100)" : "\\t(0,$ms,\\fscx1\\fscy1)";
    case 'zoom-out':   // da grande a normale, con dissolvenza
        return ($in ? "\\fscx250\\fscy250\\t(0,$ms,\\fscx100\\fscy100)" : "\\t(0,$ms,\\fscx250\\fscy250)") . $fad;
    case 'swirl':
        $org = sprintf('\\org(%d,%d)', $c[0], $c[1]);
        return $org . ($in ? "\\frz360\\t(0,$ms,\\frz0)" : "\\t(0,$ms,\\frz-360)") . $fad;
    case 'blur':
        $b = max(1, (int)round($H * 0.012));
        return ($in ? "\\blur$b\\t(0,$ms,\\blur0)" : "\\t(0,$ms,\\blur$b)") . $fad;
    case 'pop': case 'bounce':
        $kf = KEYFRAMES[$kind];
        if (!$in) $kf = array_reverse(array_map(fn($k) => [1 - $k[0], $k[1]], $kf));   // uscita = entrata invertita nel tempo
        $sc = fn($v) => max(1, (int)round($v * 100));
        $o = sprintf('\\fscx%d\\fscy%d', $sc($kf[0][1]), $sc($kf[0][1]));
        for ($i = 0; $i < count($kf) - 1; $i++)
            $o .= sprintf('\\t(%d,%d,\\fscx%d\\fscy%d)', (int)round($kf[$i][0] * $ms), (int)round($kf[$i + 1][0] * $ms), $sc($kf[$i + 1][1]), $sc($kf[$i + 1][1]));
        return $o;
    case 'flip':       // ribaltamento verticale (scala Y) ancorato al bordo del testo
        return $in ? "\\fscy1\\t(0,$ms,\\fscy100)" : "\\t(0,$ms,\\fscy1)";
    case 'spread': {   // spaziatura tra le lettere da larga a normale
        $wide = $sp0 + round(0.6 * $sizePx, 1);
        return ($in ? sprintf('\\fsp%s\\t(0,%d,\\fsp%s)', $wide, $ms, $sp0) : sprintf('\\fsp%s\\t(0,%d,\\fsp%s)', $sp0, $ms, $wide)) . $fad;
    }
    case 'wipe':       // rivelazione da sinistra a destra tramite clip animato
        return $in ? sprintf('\\clip(0,0,1,%d)\\t(0,%d,\\clip(0,0,%d,%d))', $H, $ms, $W, $H)
                   : sprintf('\\clip(0,0,%d,%d)\\t(0,%d,\\clip(%d,0,%d,%d))', $W, $H, $ms, $W - 1, $W, $H);
    }
    return '';         // none, typewriter (gestita a eventi separati)
}

function defaultStyle(): array {
    return [
        'size' => 6.0,            // % dell'altezza video (di uscita)
        'color' => '#ffffff',
        'outlineColor' => '#000000',
        'outline' => 0.45,        // % dell'altezza video
        'bold' => true,
        'pos' => 'bottom',        // bottom | middle | top
        'margin' => 5.0,          // % dell'altezza video
        'crf' => 20,
        // effetti sul testo (globali; ogni sottotitolo può sovrascrivere opacità/ombra/bagliore/sfondo)
        'opacity' => 100,         // %
        'spacing' => 0.0,         // spaziatura lettere, % della dimensione del font
        'shadow' => false, 'shadowColor' => '#000000', 'shadowDist' => 0.5, 'shadowOpacity' => 70,
        'glow' => false,   'glowColor' => '#ffe066',   'glowSize' => 1.2,   'glowOpacity' => 85,
        'box' => false,    'boxColor' => '#000000',    'boxPad' => 0.8,     'boxOpacity' => 65,
        'out' => null,            // ritaglio: {w,h,x,y} in pixel del video originale; null = nessun ritaglio
    ];
}

/** Normalizza il ritaglio: dimensioni pari, dentro il video originale. null se coincide con l'intero frame. */
function cleanOut($o, int $W, int $H): ?array {
    if (!is_array($o) || !isset($o['w'], $o['h'])) return null;
    $w = min($W, max(16, ((int)$o['w']) & ~1)); $h = min($H, max(16, ((int)$o['h']) & ~1));
    if ($w >= $W - 1 && $h >= $H - 1) return null;
    $w = min($w, $W & ~1); $h = min($h, $H & ~1);
    $x = max(0, min($W - $w, ((int)($o['x'] ?? 0)) & ~1)); $y = max(0, min($H - $h, ((int)($o['y'] ?? 0)) & ~1));
    return ['w' => $w, 'h' => $h, 'x' => $x, 'y' => $y];
}
/** [w, h, x, y] del frame di uscita. */
function outRect(array $meta): array {
    $W = (int)$meta['width']; $H = (int)$meta['height'];
    $o = cleanOut($meta['style']['out'] ?? null, $W, $H);
    return $o ? [$o['w'], $o['h'], $o['x'], $o['y']] : [$W, $H, 0, 0];
}

function pdir(string $id): string {
    if (!preg_match('/^[a-f0-9]{16}$/', $id)) throw new InvalidArgumentException('ID progetto non valido');
    $d = STORAGE . '/' . $id;
    if (!is_dir($d)) throw new RuntimeException('Progetto non trovato');
    return $d;
}

function jread(string $file, $default = null) {
    if (!is_file($file)) return $default;
    $j = json_decode((string)file_get_contents($file), true);
    return $j === null ? $default : $j;
}

function jwrite(string $file, $data): void {
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    rename($tmp, $file);
}

/** Esegue ffprobe e ritorna [width,height,duration,fps] (tiene conto della rotazione). */
function probe(string $file): array {
    $cmd = [FFPROBE, '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', $file];
    $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($p)) throw new RuntimeException('ffprobe non eseguibile');
    $out = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($p);
    $j = json_decode($out ?: '', true);
    $v = null; $hasAudio = false;
    foreach (($j['streams'] ?? []) as $s) {
        if (($s['codec_type'] ?? '') === 'video' && !$v && ($s['disposition']['attached_pic'] ?? 0) == 0) $v = $s;
        if (($s['codec_type'] ?? '') === 'audio') $hasAudio = true;
    }
    if (!$v) throw new RuntimeException('Il file non contiene una traccia video');
    $w = (int)$v['width']; $h = (int)$v['height'];
    $rot = 0;
    foreach (($v['side_data_list'] ?? []) as $sd) if (isset($sd['rotation'])) $rot = (int)$sd['rotation'];
    if (isset($v['tags']['rotate'])) $rot = (int)$v['tags']['rotate'];
    if (abs($rot) % 180 === 90) [$w, $h] = [$h, $w];
    $fps = 25.0;
    if (preg_match('#^(\d+)/(\d+)$#', $v['avg_frame_rate'] ?? '', $m) && (int)$m[2] > 0) $fps = (int)$m[1] / (int)$m[2];
    $dur = (float)($j['format']['duration'] ?? $v['duration'] ?? 0);
    return ['width' => $w, 'height' => $h, 'duration' => $dur, 'fps' => round($fps, 3), 'codec' => $v['codec_name'] ?? '', 'audio' => $hasAudio];
}

/** Legge dal file del font: famiglia, peso/corsivo (fc-scan) e fattore di scala libass (metriche OS/2 "win"). */
function fontInfo(string $path): ?array {
    $p = proc_open(['fc-scan', '--format', '%{family}|%{weight}|%{slant}\n', $path], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($p)) return null;
    $out = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($p);
    $parts = explode('|', trim(explode("\n", trim($out))[0] ?? ''));
    $family = trim(explode(',', $parts[0] ?? '')[0]);
    if ($family === '') return null;
    return ['family' => $family, 'bold' => (int)($parts[1] ?? 80) >= 180, 'italic' => (int)($parts[2] ?? 0) > 0, 'k' => fontScale($path)];
}

/** libass interpreta Fontsize come altezza di cella (winAscent+winDescent): k = em / cella. */
function fontScale(string $path): float {
    $d = (string)file_get_contents($path, false, null, 0, 1 << 20);
    if (strlen($d) < 12) return 0.85;
    $n = unpack('n', substr($d, 4, 2))[1]; $t = [];
    for ($i = 0; $i < $n && 12 + $i * 16 + 16 <= strlen($d); $i++) {
        $tag = substr($d, 12 + $i * 16, 4); $off = unpack('N', substr($d, 12 + $i * 16 + 8, 4))[1]; $t[$tag] = $off;
    }
    if (!isset($t['head'])) return 0.85;
    $upem = unpack('n', substr($d, $t['head'] + 18, 2))[1] ?: 1000;
    $cell = 0;
    if (isset($t['OS/2']) && strlen($d) >= $t['OS/2'] + 78) $cell = unpack('n', substr($d, $t['OS/2'] + 74, 2))[1] + unpack('n', substr($d, $t['OS/2'] + 76, 2))[1];
    if ($cell <= 0 && isset($t['hhea'])) { $a = unpack('s', substr($d, $t['hhea'] + 4, 2))[1]; $b = unpack('s', substr($d, $t['hhea'] + 6, 2))[1]; $cell = $a - $b; }
    return $cell > 0 ? round(min(1.0, $upem / $cell), 3) : 0.85;
}

function srtTime(float $t): string {
    $ms = (int)round(max(0, $t) * 1000);
    return sprintf('%02d:%02d:%02d,%03d', intdiv($ms, 3600000), intdiv($ms, 60000) % 60, intdiv($ms, 1000) % 60, $ms % 1000);
}
function assTime(float $t): string {
    $cs = (int)round(max(0, $t) * 100);
    return sprintf('%d:%02d:%02d.%02d', intdiv($cs, 360000), intdiv($cs, 6000) % 60, intdiv($cs, 100) % 60, $cs % 100);
}

function sortedSubs(array $subs): array {
    $subs = array_values(array_filter($subs, fn($s) => trim((string)($s['text'] ?? '')) !== ''));
    usort($subs, fn($a, $b) => $a['start'] <=> $b['start']);
    return $subs;
}

function subsToSrt(array $subs): string {
    $o = ''; $i = 1;
    foreach (sortedSubs($subs) as $s) {
        $o .= $i++ . "\n" . srtTime($s['start']) . ' --> ' . srtTime($s['end']) . "\n" . trim($s['text']) . "\n\n";
    }
    return $o;
}

function assColor(string $hex, int $alpha = 0): string {
    $hex = ltrim($hex, '#');
    if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) $hex = 'ffffff';
    return sprintf('&H%02X%s%s%s', $alpha, strtoupper(substr($hex, 4, 2)), strtoupper(substr($hex, 2, 2)), strtoupper(substr($hex, 0, 2)));
}

function assAlpha(float $visible): string { return sprintf('&H%02X&', (int)round((1 - max(0.0, min(1.0, $visible))) * 255)); }
function assTagColor(string $hex): string {
    $hex = ltrim($hex, '#'); if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) $hex = 'ffffff';
    return sprintf('&H%s%s%s&', strtoupper(substr($hex, 4, 2)), strtoupper(substr($hex, 2, 2)), strtoupper(substr($hex, 0, 2)));
}

/** Effetti effettivi di un sottotitolo: valori globali con eventuali override ('on'/'off', opacità numerica). */
function subEffects(array $s, array $st): array {
    $tri = fn($k, $g) => ($s[$k] ?? '') === 'on' ? true : (($s[$k] ?? '') === 'off' ? false : (bool)$g);
    $opa = (isset($s['opa']) && $s['opa'] !== '' && is_numeric($s['opa'])) ? (float)$s['opa'] : (float)$st['opacity'];
    return ['opacity' => max(0.0, min(100.0, $opa)), 'shadow' => $tri('shadow', $st['shadow']), 'glow' => $tri('glow', $st['glow']), 'box' => $tri('box', $st['box'])];
}

function subsToAss(array $subs, array $meta): string {
    $st = array_merge(defaultStyle(), $meta['style'] ?? []);
    [$W, $H] = outRect($meta);                       // il testo è composto sul frame di uscita (dopo il ritaglio)
    $font = str_replace(',', ' ', $meta['fontFamily'] ?? 'DejaVu Sans');
    $sizePx = $H * $st['size'] / 100;
    $size = round($sizePx, 1);
    $outl = round($H * $st['outline'] / 100, 2);
    $mv   = (int)round($H * $st['margin'] / 100);
    $mlr  = (int)round($W * 0.04);
    $align = ['bottom' => 2, 'middle' => 5, 'top' => 8][$st['pos']] ?? 2;
    $bold = !empty($meta['font']) ? !empty($meta['fontBold']) : !empty($st['bold']);
    $italic = !empty($meta['font']) && !empty($meta['fontItalic']);
    $sp0 = round($sizePx * (float)$st['spacing'] / 100, 1);
    $o  = "[Script Info]\nScriptType: v4.00+\nPlayResX: $W\nPlayResY: $H\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n";
    $o .= "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n";
    foreach (['Default' => 1, 'Box' => 3] as $name => $bs) {      // "Box" = riquadro opaco dietro il testo (BorderStyle 3)
        $o .= sprintf("Style: %s,%s,%s,%s,%s,%s,%s,%d,%d,0,0,100,100,0,0,%d,%s,0,%d,%d,%d,%d,1\n",
            $name, $font, $size, assColor($st['color']), assColor($st['color']), assColor($st['outlineColor']), assColor('#000000', 0x80),
            $bold ? -1 : 0, $italic ? -1 : 0, $bs, $outl, $align, $mlr, $mlr, $mv);
    }
    $o .= "\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
    foreach (sortedSubs($subs) as $s) {
        $t = str_replace(['{', '}'], ['(', ')'], str_replace("\r", '', trim($s['text'])));
        $chars = preg_split('//u', $t, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $len = count($chars);
        $lines = substr_count($t, "\n") + 1;
        $nl = fn(string $x) => str_replace("\n", '\N', $x);
        $full = $nl($t);
        $pos = in_array($s['pos'] ?? '', POS_KINDS, true) ? $s['pos'] : $st['pos'];
        $an  = ['bottom' => 2, 'middle' => 5, 'top' => 8][$pos];
        [$tin, $tout] = animTimes($s);
        $inK = ($s['inA'] ?? 'none'); $outK = ($s['outA'] ?? 'none');
        $custom = ($pos !== $st['pos']) || $tin > 0 || $tout > 0;
        $ay = $pos === 'bottom' ? $H - $mv : ($pos === 'top' ? $mv : intdiv($H, 2));          // ancora (come \an)
        $cy = (int)round($pos === 'bottom' ? $H - $mv - $lines * $sizePx / 2 : ($pos === 'top' ? $mv + $lines * $sizePx / 2 : $H / 2)); // centro stimato
        $anchor = [intdiv($W, 2), $ay]; $centre = [intdiv($W, 2), $cy];
        $base = $custom ? "\\an$an" : '';

        // livelli: 0 = sfondo, 1 = bagliore, 2 = testo (ognuno con le stesse animazioni)
        $fx = subEffects($s, $st); $vis = $fx['opacity'] / 100;
        $spTag = $sp0 != 0.0 ? "\\fsp$sp0" : '';
        $layers = [];
        if ($fx['box'])
            $layers[] = [0, 'Box', $spTag . '\1a&HFF&\3c' . assTagColor($st['boxColor']) . '\3a' . assAlpha($st['boxOpacity'] / 100 * $vis)
                                   . sprintf('\bord%s\shad0', round($H * $st['boxPad'] / 100, 1))];
        if ($fx['glow']) {
            $R = round($H * $st['glowSize'] / 100, 1); $B = max(1.0, round($R * 0.9, 1)); $gc = assTagColor($st['glowColor']); $ga = assAlpha($st['glowOpacity'] / 100 * $vis);
            $layers[] = [1, 'Default', $spTag . "\\1c$gc\\3c$gc\\1a$ga\\3a$ga" . sprintf('\bord%s\shad0\blur%s', $R, $B)];
        }
        $textFx = $spTag;
        if ($vis < 1) $textFx .= '\1a' . assAlpha($vis) . '\3a' . assAlpha($vis);
        if ($fx['shadow']) $textFx .= sprintf('\shad%s\4c%s\4a%s', round($H * $st['shadowDist'] / 100, 1), assTagColor($st['shadowColor']), assAlpha($st['shadowOpacity'] / 100 * $vis));
        $layers[] = [2, 'Default', $textFx];

        $emit = function (float $from, float $to, string $anim, string $text) use (&$o, $layers, $base) {
            foreach ($layers as [$ly, $sty, $lfx]) {
                $tags = $base . $lfx . $anim;
                $o .= sprintf("Dialogue: %d,%s,%s,%s,,0,0,0,,%s%s\n", $ly, assTime($from), assTime($to), $sty, $tags !== '' ? '{' . $tags . '}' : '', $text);
            }
        };
        $phase = function (string $kind, bool $isIn, float $from, float $to, float $d) use ($emit, $anchor, $centre, $W, $H, $sizePx, $sp0, $len, $chars, $nl, $full) {
            if ($kind === 'typewriter') {                 // un evento per passo: il testo non ancora scritto resta trasparente (il layout non si sposta)
                $n = typeSteps($len, $d);
                for ($k = 0; $k < $n; $k++) {
                    $v = (int)ceil($len * ($isIn ? ($k + 1) : ($n - $k)) / $n);
                    $vis = $nl(implode('', array_slice($chars, 0, $v))); $hid = $nl(implode('', array_slice($chars, $v)));
                    $emit($from + $k * $d / $n, $from + ($k + 1) * $d / $n, '', $vis . ($hid !== '' ? '{\alpha&HFF&}' . $hid : ''));
                }
                return;
            }
            $emit($from, $to, animTags($kind, $isIn, $d, $anchor, $centre, $W, $H, $sizePx, $sp0), $full);
        };
        $ms = $s['start'] + $tin; $me = $s['end'] - $tout;
        if ($tin > 0)  $phase($inK, true, $s['start'], $ms, $tin);
        if ($me - $ms > 0.005 || ($tin == 0 && $tout == 0)) $emit($ms, $me, '', $full);
        if ($tout > 0) $phase($outK, false, $me, $s['end'], $tout);
    }
    return $o;
}

/** Il job è "vivo" se il pid registrato esiste ancora. */
function jobAlive(array $job): bool {
    if (!in_array($job['status'] ?? '', ['queued', 'running'], true)) return false;
    if (isset($job['pid']) && is_dir('/proc') && !is_dir('/proc/' . (int)$job['pid'])) return false;
    // job "queued" da troppo tempo senza pid: considerato morto
    if (!isset($job['pid']) && time() - ($job['started'] ?? 0) > 30) return false;
    return true;
}

function spawnWorker(string $id, string $mode, string $arg = ''): void {
    $dir = pdir($id);
    $cmd = sprintf('nohup %s %s %s %s %s > %s 2>&1 &',
        escapeshellarg(PHP_CLI), escapeshellarg(__DIR__ . '/worker.php'), escapeshellarg($id), escapeshellarg($mode), escapeshellarg($arg),
        escapeshellarg($dir . '/worker_' . $mode . '.log'));
    exec($cmd);
}
