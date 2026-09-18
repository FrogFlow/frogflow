<?php
/**
 * Ретранслятор курса ВТБ Казахстан для ИИ-консультанта BOVI.
 *
 * Зачем он нужен. ВТБ Казахстан отвечает только на запросы с казахстанских
 * адресов: со всех остальных соединение рвётся. Деплой консультанта стоит за
 * границей, поэтому напрямую курс оттуда не получить. Сайт bovi.kz стоит в
 * Алматы, и запрос к ВТБ с него проходит. Этот файл делает ровно одно: берёт
 * ответ ВТБ и отдаёт его как есть.
 *
 * Установка:
 *   1. Положить файл в корень сайта рядом с wp-config.php.
 *   2. Открыть в браузере https://bovi.kz/vtb-relay.php — должен прийти JSON
 *      с курсами валют.
 *   3. В Vercel в переменные окружения проекта консультанта добавить
 *      CONSULTANT_VTB_RELAY_URL = https://bovi.kz/vtb-relay.php
 *      и сделать Redeploy.
 *
 * Дальше курс подтягивается сам каждые 15 минут. Ничего секретного файл не
 * отдаёт: это те же курсы, что ВТБ публикует у себя на сайте.
 */

declare(strict_types=1);

const VTB_URL = 'https://online-api.vtb.kz/api/exchange-rate/by-currencyMob/';
const TIMEOUT_SECONDS = 8;
/** Сколько держать последний удачный ответ, если ВТБ прилёг. */
const CACHE_SECONDS = 900;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');

$cacheFile = sys_get_temp_dir() . '/vtb-relay-cache.json';

function fetchFromVtb(): ?string
{
    $ch = curl_init(VTB_URL);
    if ($ch === false) {
        return null;
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => TIMEOUT_SECONDS,
        CURLOPT_CONNECTTIMEOUT => TIMEOUT_SECONDS,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json,text/html;q=0.9,*/*;q=0.8',
            'Referer: https://online.vtb.kz/unAuth/exchange-rates',
        ],
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            . '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if (!is_string($body) || $body === '' || $status < 200 || $status >= 300) {
        return null;
    }
    return $body;
}

$body = fetchFromVtb();

if ($body !== null) {
    @file_put_contents($cacheFile, $body);
    header('X-Relay-Source: vtb');
    echo $body;
    exit;
}

// ВТБ не ответил: отдаём последний удачный ответ, пока он не слишком старый.
if (is_readable($cacheFile) && (time() - (int) filemtime($cacheFile)) < CACHE_SECONDS) {
    header('X-Relay-Source: cache');
    echo (string) file_get_contents($cacheFile);
    exit;
}

http_response_code(502);
header('X-Relay-Source: none');
echo json_encode(
    ['error' => 'vtb_unreachable', 'checked_at' => gmdate('c')],
    JSON_UNESCAPED_UNICODE
);
