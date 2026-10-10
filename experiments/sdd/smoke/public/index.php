<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = rtrim($path, '/') ?: '/';

$pages = [
    '/' => ['Home - GIT 2025 Responsible Gem & Jewelry Supply Chain', 'GIT 2025', 'home'],
    '/program' => ['Program - GIT 2025', 'Program', 'stub'],
    '/registration-fee' => ['Registration Fee - GIT 2025', 'Registration Fee', 'stub'],
    '/contact' => ['Contact - GIT 2025', 'Contact', 'stub'],
];

if (isset($pages[$path])) {
    [$title, $h1, $kind] = $pages[$path];
} else {
    http_response_code(404);
    $title = 'Page not found';
    $h1 = 'Page not found';
    $kind = 'missing';
}

function nav(): void
{
    echo '<header><a href="/">GIT 2025</a><nav>';
    foreach (['/' => 'Home', '/program' => 'Program', '/registration-fee' => 'Registration Fee', '/contact' => 'Contact'] as $href => $text) {
        echo '<a href="' . $href . '">' . $text . '</a>';
    }
    echo '</nav></header>';
}

header('Content-Type: text/html; charset=UTF-8');
echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' . htmlspecialchars($title) . '</title></head><body>';
nav();
echo '<main><h1>' . htmlspecialchars($h1) . '</h1>';
if ($kind === 'home') {
    echo '<p>Responsible Gem &amp; Jewelry Supply Chain. 8 - 9 September 2025. Bangkok, Thailand.</p>';
    echo '<p>GIT has proudly hosted the Gem and Jewelry Conferences since 2006, alongside the 72nd Bangkok Gem and Jewelry Fair.</p>';
    echo '<p><a href="/program">Program</a> <a href="/registration-fee">Registration Fee</a></p>';
} elseif ($kind === 'missing') {
    echo '<p><a href="/">Back to Home</a></p>';
} else {
    echo '<p>This smoke page intentionally omits the tables and the form.</p>';
}
echo '</main><footer>';
echo '<p>The Gem and Jewelry Institute of Thailand (Public Organization)</p>';
echo '<p><a href="mailto:gitconference@git.or.th">gitconference@git.or.th</a></p>';
echo '<p>(+66) 2634 4999</p>';
echo '<p>Copyright © 2025. All rights reserved.</p>';
echo '</footer></body></html>';
