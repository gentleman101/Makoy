<?php
$f = $_GET['f'] ?? '';
$path = __DIR__ . '/' . basename($f);
if (!$f || !file_exists($path) || pathinfo($path, PATHINFO_EXTENSION) !== 'html') {
    http_response_code(404); exit;
}
$html = file_get_contents($path);
$html = str_replace('<head>', '<head><script src="/resources/gate.js"></script>', $html, $count);
if (!$count) {
    $html = str_ireplace('<head>', '<head><script src="/resources/gate.js"></script>', $html);
}
header('Content-Type: text/html; charset=UTF-8');
echo $html;
