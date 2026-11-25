<?php
// ====================================================================
// Meta WhatsApp Cloud API Webhook Handler for Hostinger
// ====================================================================

// 1. Read .env file if available
$envFile = __DIR__ . '/.env';
$verifyToken = 'whatsapp_groq_bot_secret_123';

if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || strpos($line, '#') === 0) continue;
        if (strpos($line, '=') !== false) {
            list($key, $val) = explode('=', $line, 2);
            $key = trim($key);
            $val = trim($val, " \t\n\r\0\x0B\"'");
            if (($key === 'WHATSAPP_VERIFY_TOKEN' || $key === 'VERIFY_TOKEN') && !empty($val)) {
                $verifyToken = $val;
            }
        }
    }
}

// 2. Handle Meta Webhook Verification (GET Request)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Note: PHP converts dots in query params to underscores (hub.mode -> hub_mode)
    $mode = $_GET['hub_mode'] ?? ($_GET['hub.mode'] ?? '');
    $token = $_GET['hub_verify_token'] ?? ($_GET['hub.verify_token'] ?? '');
    $challenge = $_GET['hub_challenge'] ?? ($_GET['hub.challenge'] ?? '');

    if ($mode === 'subscribe' && $token === $verifyToken) {
        http_response_code(200);
        header('Content-Type: text/plain; charset=utf-8');
        echo $challenge;
        exit;
    } else {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Verification failed: token mismatch or invalid mode.";
        exit;
    }
}

// 3. Handle Inbound WhatsApp Webhook Events (POST Request)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawPayload = file_get_contents('php://input');
    
    // Optional: Log webhook payload for inspection
    $logDir = __DIR__ . '/uploads';
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0755, true);
    }
    @file_put_contents($logDir . '/last_webhook.json', $rawPayload);

    // Respond immediately to Meta to acknowledge receipt
    http_response_code(200);
    header('Content-Type: text/plain; charset=utf-8');
    echo "EVENT_RECEIVED";
    exit;
}

http_response_code(200);
echo "Webhook endpoint active.";
