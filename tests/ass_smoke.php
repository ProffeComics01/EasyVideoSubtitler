<?php
declare(strict_types=1);
/** Smoke test del generatore ASS (nessuna dipendenza):  php tests/ass_smoke.php */
require __DIR__ . '/../lib.php';

$fail = 0;
$check = function (string $name, bool $ok) use (&$fail) { echo ($ok ? "  ok   " : "  FAIL ") . $name . "\n"; if (!$ok) $fail++; };
$sub = fn(array $x = []) => array_merge(['start' => 1.0, 'end' => 5.0, 'text' => 'Ciao mondo', 'pos' => '', 'inA' => 'none', 'inMs' => 300,
                                         'outA' => 'none', 'outMs' => 300, 'opa' => '', 'shadow' => '', 'glow' => '', 'box' => ''], $x);
$meta = fn(array $style = []) => ['width' => 1280, 'height' => 720, 'fontFamily' => null, 'font' => null, 'style' => $style];
$events = fn(string $ass) => array_values(array_filter(explode("\n", $ass), fn($l) => str_starts_with($l, 'Dialogue:')));

echo "Generatore ASS\n";
$a = subsToAss([$sub()], $meta());
$check('PlayRes = risoluzione originale senza ritaglio', str_contains($a, "PlayResX: 1280\nPlayResY: 720"));
$check('un solo evento, nessun tag, senza effetti', count($events($a)) === 1 && !str_contains($events($a)[0], '{'));

$a = subsToAss([$sub()], $meta(['out' => ['w' => 721, 'h' => 720, 'x' => 281, 'y' => 0]]));
$check('ritaglio: PlayRes = dimensioni di uscita (pari)', str_contains($a, "PlayResX: 720\nPlayResY: 720"));
$check('cleanOut: pari e dentro il frame', cleanOut(['w' => 9999, 'h' => 100, 'x' => 5000, 'y' => 3], 1280, 720) === ['w' => 1280, 'h' => 100, 'x' => 0, 'y' => 2]);
$check('cleanOut: frame intero = nessun ritaglio', cleanOut(['w' => 1280, 'h' => 720, 'x' => 0, 'y' => 0], 1280, 720) === null);

$ev = $events(subsToAss([$sub(['inA' => 'fade', 'inMs' => 500, 'outA' => 'fade', 'outMs' => 200])], $meta()));
$check('fade in/out: tre fasi', count($ev) === 3 && str_contains($ev[0], '\fad(500,0)') && str_contains($ev[2], '\fad(0,200)'));

$ev = $events(subsToAss([$sub(['end' => 1.3, 'inA' => 'fade', 'inMs' => 500, 'outA' => 'fade', 'outMs' => 500])], $meta()));
$check('durate troppo lunghe ridotte in proporzione (nessuna fase centrale)', count($ev) === 2);

foreach (['slide-up', 'zoom', 'zoom-out', 'swirl', 'blur', 'pop', 'bounce', 'flip', 'spread', 'wipe'] as $k) {
    $ev = $events(subsToAss([$sub(['inA' => $k, 'inMs' => 400])], $meta()));
    $check("animazione '$k' genera tag nella fase di entrata", count($ev) === 2 && str_contains($ev[0], '{'));
}

$ev = $events(subsToAss([$sub(['text' => 'abcd', 'inA' => 'typewriter', 'inMs' => 400])], $meta()));
$check('macchina da scrivere: un evento per passo + fase centrale', count($ev) === 4 + 1 && str_contains($ev[0], 'a{\alpha&HFF&}bcd'));

$ev = $events(subsToAss([$sub(['glow' => 'on', 'box' => 'on', 'shadow' => 'on'])], $meta()));
$check('effetti: livelli sfondo(0) / bagliore(1) / testo(2)', count($ev) === 3 && str_starts_with($ev[0], 'Dialogue: 0') && str_contains($ev[0], ',Box,') && str_starts_with($ev[1], 'Dialogue: 1') && str_starts_with($ev[2], 'Dialogue: 2'));
$check('effetti: ombra nel livello testo', str_contains($ev[2], '\shad'));

$ev = $events(subsToAss([$sub(['shadow' => 'off'])], $meta(['shadow' => true])));
$check('override per sottotitolo: ombra globale disattivata', !str_contains($ev[0], '\shad'));
$ev = $events(subsToAss([$sub(['opa' => 50])], $meta()));
$check('opacità 50% -> alpha 0x80', str_contains($ev[0], '\1a&H80&'));

echo $fail ? "\n$fail test falliti\n" : "\nTutti i test superati\n";
exit($fail ? 1 : 0);
