<?php
declare(strict_types=1);
/**
 * Job di sistema. Uso:  php worker.php <id> export|peaks|proxy
 * Può essere lanciato dal web (api.php), da cron o a mano.
 */
require __DIR__ . '/lib.php';
if (PHP_SAPI !== 'cli') exit('CLI only');

$id = $argv[1] ?? ''; $mode = $argv[2] ?? 'export';
$dir = pdir($id);
$meta = jread("$dir/meta.json");
$video = $dir . '/' . $meta['video'];
$jobFile = "$dir/job_$mode.json";
$job = ['status' => 'running', 'progress' => 0, 'pid' => getmypid(), 'started' => time()];
$save = function (array $patch = []) use (&$job, $jobFile) { $job = array_merge($job, $patch); jwrite($jobFile, $job); };
$save();

function runFfmpeg(array $args, string $dir, float $duration, callable $onProgress, string $log = 'ffmpeg.log'): int {
    $cmd = array_merge([FFMPEG, '-y', '-hide_banner', '-nostdin', '-nostats', '-progress', 'pipe:1'], $args);
    $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['file', "$dir/$log", 'w']], $pipes, $dir);
    if (!is_resource($p)) throw new RuntimeException('ffmpeg non eseguibile');
    while (($line = fgets($pipes[1])) !== false) {
        if (preg_match('/^out_time_(?:us|ms)=(\d+)/', $line, $m) && $duration > 0) {
            $onProgress(min(0.99, ((int)$m[1] / 1e6) / $duration));
        }
    }
    fclose($pipes[1]);
    return proc_close($p);
}

try {
    if ($mode === 'export') {
        file_put_contents("$dir/subs.ass", subsToAss(jread("$dir/subs.json", []), $meta));
        [$ow, $oh, $ox, $oy] = outRect($meta);
        $crop = ($ow < (int)$meta['width'] || $oh < (int)$meta['height']) ? "crop=$ow:$oh:$ox:$oy," : '';   // ritaglio, poi sottotitoli sul frame di uscita
        $vf = $crop . 'ass=subs.ass' . (!empty($meta['font']) ? ':fontsdir=fonts' : '');
        $crf = (int)($meta['style']['crf'] ?? 20);
        $last = 0;
        $rc = runFfmpeg([
            '-i', $video, '-map', '0:v:0', '-map', '0:a?', '-vf', $vf,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', (string)$crf, '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', 'output.tmp',
        ], $dir, (float)$meta['duration'], function (float $p) use (&$last, $save) {
            if ($p - $last >= 0.01) { $last = $p; $save(['progress' => round($p, 3)]); }
        });
        if ($rc !== 0) throw new RuntimeException("ffmpeg ha restituito $rc:\n" . implode("\n", array_slice(file("$dir/ffmpeg.log") ?: [], -8)));
        rename("$dir/output.tmp", "$dir/output.mp4");
        $save(['status' => 'done', 'progress' => 1, 'finished' => time()]);

    } elseif ($mode === 'peaks') {
        // Inviluppo audio: 1 byte ogni 40 ms (25 valori/s) a partire da PCM mono 2 kHz.
        if (empty($meta['audio'])) { jwrite("$dir/peaks.json", ['rate' => 25, 'data' => '']); $save(['status' => 'done']); exit; }
        $p = proc_open([FFMPEG, '-v', 'error', '-nostdin', '-i', $video, '-vn', '-ac', '1', '-ar', '2000', '-f', 's16le', 'pipe:1'],
                       [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
        $bins = ''; $buf = ''; $BIN = 80;
        while (!feof($pipes[1])) {
            $chunk = fread($pipes[1], 65536);
            if ($chunk === false || $chunk === '') continue;
            $buf .= $chunk;
            $n = intdiv(strlen($buf), 2 * $BIN) * $BIN;
            if ($n === 0) continue;
            $samples = unpack('s*', substr($buf, 0, $n * 2));
            $buf = substr($buf, $n * 2);
            for ($i = 1; $i <= $n; $i += $BIN) {
                $m = 0;
                for ($j = $i, $e = $i + $BIN; $j < $e; $j++) { $a = $samples[$j] < 0 ? -$samples[$j] : $samples[$j]; if ($a > $m) $m = $a; }
                $bins .= chr(min(255, (int)($m / 128)));
            }
        }
        fclose($pipes[1]); proc_close($p);
        jwrite("$dir/peaks.json", ['rate' => 25, 'data' => base64_encode($bins)]);
        $save(['status' => 'done']);

    } elseif ($mode === 'proxy') {
        // Anteprima leggera h264/480p per i video che il browser non riproduce.
        $rc = runFfmpeg(['-i', $video, '-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
                         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', 'preview.tmp'],
                        $dir, (float)$meta['duration'], function (float $p) use ($save) { $save(['progress' => round($p, 2)]); });
        if ($rc !== 0) throw new RuntimeException('Creazione anteprima fallita');
        rename("$dir/preview.tmp", "$dir/preview.mp4");
        $save(['status' => 'done', 'progress' => 1]);
    } elseif ($mode === 'clip') {
        // Anteprima fedele: 12 s dal punto richiesto, 480p, stesso file ASS e stesso font dell'export.
        $start = max(0.0, (float)($argv[3] ?? 0)); $len = 12.0;
        file_put_contents("$dir/subs_clip.ass", subsToAss(jread("$dir/subs.json", []), $meta));
        [$ow, $oh, $ox, $oy] = outRect($meta);
        $crop = ($ow < (int)$meta['width'] || $oh < (int)$meta['height']) ? "crop=$ow:$oh:$ox:$oy," : '';
        $vf = sprintf("setpts=PTS+%.3f/TB,{$crop}scale=-2:'min(480,ih)',ass=subs_clip.ass%s,setpts=PTS-STARTPTS", $start, !empty($meta['font']) ? ':fontsdir=fonts' : '');
        $rc = runFfmpeg(['-ss', sprintf('%.3f', $start), '-t', (string)$len, '-i', $video, '-map', '0:v:0', '-map', '0:a?', '-vf', $vf,
                         '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', 'clip.tmp'],
                        $dir, min($len, max(0.1, (float)$meta['duration'] - $start)), function (float $p) use ($save) { $save(['progress' => round($p, 2)]); }, 'ffmpeg_clip.log');
        if ($rc !== 0) throw new RuntimeException("ffmpeg ha restituito $rc:\n" . implode("\n", array_slice(file("$dir/ffmpeg_clip.log") ?: [], -8)));
        rename("$dir/clip.tmp", "$dir/clip.mp4");
        $save(['status' => 'done', 'progress' => 1]);
    } else {
        throw new InvalidArgumentException("Modo sconosciuto: $mode");
    }
} catch (Throwable $e) {
    $save(['status' => 'error', 'error' => $e->getMessage()]);
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
