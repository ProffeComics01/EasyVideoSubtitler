<?php
declare(strict_types=1);
require __DIR__ . '/../lib.php';

function out($data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Serve un file con supporto Range (necessario per il seek del <video>). */
function serveFile(string $path, string $mime, ?string $downloadName = null): never {
    if (!is_file($path)) out(['error' => 'File non trovato'], 404);
    $size = filesize($path); $start = 0; $end = $size - 1;
    header('Content-Type: ' . $mime);
    header('Accept-Ranges: bytes');
    if ($downloadName) header('Content-Disposition: attachment; filename="' . str_replace('"', '', $downloadName) . '"');
    if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
        if ($m[1] !== '') { $start = (int)$m[1]; if ($m[2] !== '') $end = min((int)$m[2], $end); }
        elseif ($m[2] !== '') { $start = max(0, $size - (int)$m[2]); }
        if ($start > $end) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    session_write_close();
    $f = fopen($path, 'rb'); fseek($f, $start);
    for ($left = $end - $start + 1; $left > 0 && !feof($f); ) {
        $chunk = fread($f, min(1 << 20, $left)); echo $chunk; $left -= strlen($chunk); flush();
    }
    fclose($f); exit;
}

function body(): array {
    $j = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($j)) out(['error' => 'JSON non valido'], 400);
    return $j;
}

function cleanStyle(array $in, array $meta): array {
    $d = defaultStyle(); $c = fn($v, $lo, $hi, $def) => is_numeric($v) ? max($lo, min($hi, (float)$v)) : $def;
    $hex = fn($v, $def) => is_string($v) && preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? strtolower($v) : $def;
    return [
        'size' => $c($in['size'] ?? null, 1, 30, $d['size']),
        'color' => $hex($in['color'] ?? null, $d['color']),
        'outlineColor' => $hex($in['outlineColor'] ?? null, $d['outlineColor']),
        'outline' => $c($in['outline'] ?? null, 0, 3, $d['outline']),
        'bold' => !empty($in['bold']),
        'pos' => in_array($in['pos'] ?? '', ['bottom', 'middle', 'top'], true) ? $in['pos'] : 'bottom',
        'margin' => $c($in['margin'] ?? null, 0, 40, $d['margin']),
        'crf' => (int)$c($in['crf'] ?? null, 14, 32, 20),
        'opacity' => $c($in['opacity'] ?? null, 0, 100, $d['opacity']),
        'spacing' => $c($in['spacing'] ?? null, -10, 60, $d['spacing']),
        'shadow' => !empty($in['shadow']), 'shadowColor' => $hex($in['shadowColor'] ?? null, $d['shadowColor']),
        'shadowDist' => $c($in['shadowDist'] ?? null, 0, 5, $d['shadowDist']), 'shadowOpacity' => $c($in['shadowOpacity'] ?? null, 0, 100, $d['shadowOpacity']),
        'glow' => !empty($in['glow']), 'glowColor' => $hex($in['glowColor'] ?? null, $d['glowColor']),
        'glowSize' => $c($in['glowSize'] ?? null, 0, 10, $d['glowSize']), 'glowOpacity' => $c($in['glowOpacity'] ?? null, 0, 100, $d['glowOpacity']),
        'box' => !empty($in['box']), 'boxColor' => $hex($in['boxColor'] ?? null, $d['boxColor']),
        'boxPad' => $c($in['boxPad'] ?? null, 0, 10, $d['boxPad']), 'boxOpacity' => $c($in['boxOpacity'] ?? null, 0, 100, $d['boxOpacity']),
        'out' => cleanOut($in['out'] ?? null, (int)$meta['width'], (int)$meta['height']),
    ];
}

$a = $_GET['a'] ?? '';
$id = $_GET['id'] ?? '';

try {
    switch ($a) {
    case 'list':
        $res = [];
        foreach (glob(STORAGE . '/*', GLOB_ONLYDIR) ?: [] as $d) {
            $m = jread("$d/meta.json"); if (!$m) continue;
            $res[] = ['id' => basename($d), 'name' => $m['name'], 'duration' => $m['duration'], 'created' => $m['created'],
                      'touched' => $m['touched'] ?? $m['created'],
                      'subs' => count(jread("$d/subs.json", [])), 'exported' => is_file("$d/output.mp4")];
        }
        usort($res, fn($x, $y) => $y['touched'] <=> $x['touched']);
        if (isset($_GET['limit'])) $res = array_slice($res, 0, max(1, (int)$_GET['limit']));
        out($res);

    case 'settings':
        $f = STORAGE . '/settings.json';
        $cur = array_merge(['openLast' => true], jread($f, []));
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $in = body();
            if (array_key_exists('openLast', $in)) $cur['openLast'] = (bool)$in['openLast'];
            jwrite($f, $cur);
        }
        out($cur);

    case 'saveas':
        $src = pdir($id); $in = body(); $m = jread("$src/meta.json");
        $nid = bin2hex(random_bytes(8)); $dst = STORAGE . '/' . $nid;
        mkdir("$dst/fonts", 0775, true);
        $linkOrCopy = function (string $from, string $to) { if (is_file($from) && !@link($from, $to)) copy($from, $to); };
        $linkOrCopy("$src/{$m['video']}", "$dst/{$m['video']}");        // video: hard link (nessuno spazio extra) o copia
        $linkOrCopy("$src/preview.mp4", "$dst/preview.mp4");
        foreach (['subs.json', 'peaks.json'] as $f) if (is_file("$src/$f")) copy("$src/$f", "$dst/$f");
        foreach (glob("$src/fonts/*") ?: [] as $f) copy($f, "$dst/fonts/" . basename($f));
        $m['name'] = mb_substr(trim((string)($in['name'] ?? '')), 0, 120) ?: ($m['name'] . ' (copia)');
        $m['created'] = $m['touched'] = time();
        jwrite("$dst/meta.json", $m);
        if (!is_file("$dst/peaks.json")) spawnWorker($nid, 'peaks');
        out(['id' => $nid]);

    case 'replace_stage':
    case 'replace_commit':
    case 'replace_cancel':
        $dir = pdir($id); $m = jread("$dir/meta.json");
        foreach (['export', 'clip', 'proxy', 'peaks'] as $mode) {
            if ($a !== 'replace_cancel' && jobAlive(jread("$dir/job_$mode.json", []))) out(['error' => 'C\'è un job in corso su questo progetto (esportazione, anteprima o analisi audio): riprova tra poco.'], 409);
        }
        $dropStage = function () use ($dir) { foreach (glob("$dir/video.new.*") ?: [] as $f) @unlink($f); @unlink("$dir/replace.json"); };
        $summary = fn(array $i) => ['width' => $i['width'], 'height' => $i['height'], 'duration' => round((float)$i['duration'], 3), 'fps' => $i['fps'], 'audio' => !empty($i['audio'])];

        if ($a === 'replace_cancel') { $dropStage(); out(['ok' => true]); }

        if ($a === 'replace_stage') {
            if (empty($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
                $err = $_FILES['video']['error'] ?? -1;
                out(['error' => $err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE
                    ? 'File troppo grande: alza upload_max_filesize e post_max_size in php.ini' : "Upload fallito (codice $err)"], 400);
            }
            $ext = strtolower(pathinfo($_FILES['video']['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, VIDEO_EXT, true)) out(['error' => 'Formato non supportato (' . implode(', ', VIDEO_EXT) . ')'], 400);
            $dropStage();
            $stage = "$dir/video.new.$ext";
            if (!move_uploaded_file($_FILES['video']['tmp_name'], $stage)) rename($_FILES['video']['tmp_name'], $stage);
            try { $new = probe($stage); } catch (Throwable $e) { $dropStage(); out(['error' => $e->getMessage()], 400); }
            $diffs = [];
            if (abs($new['duration'] - (float)$m['duration']) > 0.2) $diffs[] = 'duration';
            if ($new['width'] != $m['width'] || $new['height'] != $m['height']) $diffs[] = 'size';
            if (!empty($new['audio']) !== !empty($m['audio'])) $diffs[] = 'audio';
            jwrite("$dir/replace.json", ['ext' => $ext, 'info' => $new]);
            out(['staged' => true, 'old' => $summary($m), 'new' => $summary($new), 'diffs' => $diffs]);
        }

        // replace_commit
        $rj = jread("$dir/replace.json");
        if (!$rj || !is_file("$dir/video.new.{$rj['ext']}")) out(['error' => 'Nessun nuovo video in attesa: ricarica il file.'], 400);
        $new = $rj['info']; $ext = $rj['ext']; $oldName = $m['video']; $newName = "video.$ext";
        // rename() crea un nuovo inode: se il vecchio file è condiviso (hard link di "Salva con nome") l'altro progetto resta intatto.
        if (!rename("$dir/video.new.$ext", "$dir/$newName")) out(['error' => 'Impossibile sostituire il file video'], 500);
        if ($oldName !== $newName) @unlink("$dir/$oldName");
        $sizeChanged = $new['width'] != $m['width'] || $new['height'] != $m['height'];
        $m['video'] = $newName;
        foreach (['width', 'height', 'duration', 'fps', 'codec', 'audio'] as $k) $m[$k] = $new[$k];
        if ($sizeChanged) $m['style']['out'] = null;                      // un ritaglio in pixel non ha senso su un'altra risoluzione
        $m['rev'] = time(); $m['touched'] = time();
        jwrite("$dir/meta.json", $m);
        // file derivati dal vecchio video: non più validi
        foreach (['peaks.json', 'preview.mp4', 'output.mp4', 'clip.mp4', 'subs.ass', 'subs_clip.ass', 'job_export.json', 'job_clip.json', 'job_proxy.json', 'job_peaks.json'] as $f) @unlink("$dir/$f");
        @unlink("$dir/replace.json");
        spawnWorker($id, 'peaks');
        out(['ok' => true, 'sizeChanged' => $sizeChanged]);

    case 'create':
        if (empty($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
            $err = $_FILES['video']['error'] ?? -1;
            out(['error' => $err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE
                ? 'File troppo grande: alza upload_max_filesize e post_max_size in php.ini' : "Upload fallito (codice $err)"], 400);
        }
        $orig = $_FILES['video']['name'];
        $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
        if (!in_array($ext, VIDEO_EXT, true)) out(['error' => 'Formato non supportato (' . implode(', ', VIDEO_EXT) . ')'], 400);
        $id = bin2hex(random_bytes(8)); $dir = STORAGE . '/' . $id;
        mkdir($dir . '/fonts', 0775, true);
        $dst = "$dir/video.$ext";
        if (!move_uploaded_file($_FILES['video']['tmp_name'], $dst)) { rename($_FILES['video']['tmp_name'], $dst); }
        try { $info = probe($dst); }
        catch (Throwable $e) { array_map('unlink', glob("$dir/*.*") ?: []); @rmdir("$dir/fonts"); @rmdir($dir); out(['error' => $e->getMessage()], 400); }
        $name = trim((string)($_POST['name'] ?? '')) ?: pathinfo($orig, PATHINFO_FILENAME);
        jwrite("$dir/meta.json", $info + ['name' => mb_substr($name, 0, 120), 'video' => "video.$ext", 'font' => null, 'fontFamily' => null,
                                           'style' => defaultStyle(), 'created' => time(), 'touched' => time()]);
        jwrite("$dir/subs.json", []);
        spawnWorker($id, 'peaks');
        out(['id' => $id]);

    case 'project':
        $dir = pdir($id);
        $m = jread("$dir/meta.json");
        $m['touched'] = time(); jwrite("$dir/meta.json", $m);
        $m['hasPreview'] = is_file("$dir/preview.mp4");
        $m['hasOutput'] = is_file("$dir/output.mp4");
        out(['meta' => $m, 'subs' => jread("$dir/subs.json", [])]);

    case 'save':
        $dir = pdir($id); $in = body();
        $subs = [];
        foreach (array_slice($in['subs'] ?? [], 0, 5000) as $s) {
            $st = max(0.0, (float)($s['start'] ?? 0)); $en = max($st + 0.05, (float)($s['end'] ?? 0));
            $kind = fn($v) => in_array($v, ANIM_KINDS, true) ? $v : 'none';
            $ms = fn($v) => (int)max(0, min(5000, is_numeric($v) ? $v : 300));
            $subs[] = ['start' => round($st, 3), 'end' => round($en, 3), 'text' => mb_substr((string)($s['text'] ?? ''), 0, 2000),
                       'pos' => in_array($s['pos'] ?? '', POS_KINDS, true) ? $s['pos'] : '',
                       'inA' => $kind($s['inA'] ?? 'none'), 'inMs' => $ms($s['inMs'] ?? 300),
                       'outA' => $kind($s['outA'] ?? 'none'), 'outMs' => $ms($s['outMs'] ?? 300),
                       'opa' => (isset($s['opa']) && $s['opa'] !== '' && is_numeric($s['opa'])) ? (int)max(0, min(100, $s['opa'])) : '',
                       'shadow' => in_array($s['shadow'] ?? '', ['on', 'off'], true) ? $s['shadow'] : '',
                       'glow'   => in_array($s['glow']   ?? '', ['on', 'off'], true) ? $s['glow']   : '',
                       'box'    => in_array($s['box']    ?? '', ['on', 'off'], true) ? $s['box']    : ''];
        }
        usort($subs, fn($x, $y) => $x['start'] <=> $y['start']);
        jwrite("$dir/subs.json", $subs);
        $m = jread("$dir/meta.json");
        $m['style'] = cleanStyle($in['style'] ?? [], $m);
        $m['touched'] = time();
        if (isset($in['name'])) $m['name'] = mb_substr(trim((string)$in['name']), 0, 120) ?: $m['name'];
        jwrite("$dir/meta.json", $m);
        out(['ok' => true, 'saved' => time()]);

    case 'font':
        $dir = pdir($id);
        if (empty($_FILES['font']) || $_FILES['font']['error'] !== UPLOAD_ERR_OK) out(['error' => 'Upload font fallito'], 400);
        $ext = strtolower(pathinfo($_FILES['font']['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, FONT_EXT, true)) out(['error' => 'Solo font .ttf o .otf'], 400);
        foreach (glob("$dir/fonts/*") ?: [] as $f) unlink($f);
        $fn = "font.$ext";
        move_uploaded_file($_FILES['font']['tmp_name'], "$dir/fonts/$fn");
        $fi = fontInfo("$dir/fonts/$fn");
        if (!$fi) { unlink("$dir/fonts/$fn"); out(['error' => 'File font non valido'], 400); }
        $m = jread("$dir/meta.json"); $m['font'] = $fn; $m['fontFamily'] = $fi['family']; $m['fontBold'] = $fi['bold']; $m['fontItalic'] = $fi['italic']; $m['fontK'] = $fi['k']; jwrite("$dir/meta.json", $m);
        out(['font' => $fn, 'fontFamily' => $fi['family'], 'fontBold' => $fi['bold'], 'fontItalic' => $fi['italic'], 'fontK' => $fi['k']]);

    case 'font_remove':
        $dir = pdir($id);
        foreach (glob("$dir/fonts/*") ?: [] as $f) unlink($f);
        $m = jread("$dir/meta.json"); $m['font'] = null; $m['fontFamily'] = null; $m['fontBold'] = $m['fontItalic'] = false; $m['fontK'] = null; jwrite("$dir/meta.json", $m);
        out(['ok' => true]);

    case 'get_font':
        $dir = pdir($id); $m = jread("$dir/meta.json");
        if (empty($m['font'])) out(['error' => 'Nessun font'], 404);
        header('Cache-Control: no-cache');
        serveFile("$dir/fonts/{$m['font']}", 'font/' . pathinfo($m['font'], PATHINFO_EXTENSION));

    case 'video':
        $dir = pdir($id); $m = jread("$dir/meta.json");
        $path = (!empty($_GET['proxy']) && is_file("$dir/preview.mp4")) ? "$dir/preview.mp4" : "$dir/{$m['video']}";
        $mt = ['mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'mov' => 'video/mp4', 'webm' => 'video/webm', 'mkv' => 'video/x-matroska', 'avi' => 'video/x-msvideo'];
        serveFile($path, $mt[strtolower(pathinfo($path, PATHINFO_EXTENSION))] ?? 'application/octet-stream');

    case 'peaks':
        $dir = pdir($id);
        $p = jread("$dir/peaks.json");
        $p ? out($p) : out(['pending' => true], 202);

    case 'export':
        $dir = pdir($id);
        $job = jread("$dir/job_export.json", []);
        if (jobAlive($job)) out(['error' => 'Esportazione già in corso'], 409);
        @unlink("$dir/output.mp4");
        jwrite("$dir/job_export.json", ['status' => 'queued', 'progress' => 0, 'started' => time()]);
        spawnWorker($id, 'export');
        out(['ok' => true]);

    case 'proxy':
        $dir = pdir($id);
        $job = jread("$dir/job_proxy.json", []);
        if (!jobAlive($job) && !is_file("$dir/preview.mp4")) {
            jwrite("$dir/job_proxy.json", ['status' => 'queued', 'progress' => 0, 'started' => time()]);
            spawnWorker($id, 'proxy');
        }
        out(['ok' => true]);

    case 'clip':
        $dir = pdir($id);
        $job = jread("$dir/job_clip.json", []);
        if (jobAlive($job)) out(['error' => 'Anteprima già in corso'], 409);
        @unlink("$dir/clip.mp4");
        jwrite("$dir/job_clip.json", ['status' => 'queued', 'progress' => 0, 'started' => time()]);
        spawnWorker($id, 'clip', (string)max(0, (float)($_GET['t'] ?? 0)));
        out(['ok' => true]);

    case 'get_clip':
        $dir = pdir($id); header('Cache-Control: no-store');
        serveFile("$dir/clip.mp4", 'video/mp4');

    case 'status':
        $dir = pdir($id);
        $mode = in_array($_GET['mode'] ?? '', ['proxy', 'clip'], true) ? $_GET['mode'] : 'export';
        $job = jread("$dir/job_$mode.json", ['status' => 'idle']);
        if (in_array($job['status'], ['queued', 'running'], true) && !jobAlive($job)) {
            $job = ['status' => 'error', 'error' => 'Il job è terminato in modo anomalo. Vedi worker_' . $mode . '.log'];
        }
        $job['hasOutput'] = is_file("$dir/output.mp4");
        $job['hasPreview'] = is_file("$dir/preview.mp4");
        out($job);

    case 'download':
        $dir = pdir($id); $m = jread("$dir/meta.json"); $subs = jread("$dir/subs.json", []);
        $base = preg_replace('/[^\w\-]+/u', '_', $m['name']);
        $what = $_GET['what'] ?? 'video';
        if ($what === 'srt') { header('Content-Type: application/x-subrip; charset=utf-8'); header("Content-Disposition: attachment; filename=\"$base.srt\""); echo subsToSrt($subs); exit; }
        if ($what === 'ass') { header('Content-Type: text/x-ssa; charset=utf-8'); header("Content-Disposition: attachment; filename=\"$base.ass\""); echo subsToAss($subs, $m); exit; }
        serveFile("$dir/output.mp4", 'video/mp4', "$base.sub.mp4");

    case 'delete':
        $dir = pdir($id);
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($it as $f) $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
        rmdir($dir);
        out(['ok' => true]);

    default:
        out(['error' => 'Azione sconosciuta'], 404);
    }
} catch (Throwable $e) {
    out(['error' => $e->getMessage()], 400);
}
