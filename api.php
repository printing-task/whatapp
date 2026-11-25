<?php
// ====================================================================
// printingtask • WhatsApp Business CRM API Backend (PHP Engine)
// ====================================================================

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

$dbPath = __DIR__ . '/whatsapp_messages.db';
$envPath = __DIR__ . '/.env';

// 1. Helper to read .env
function getEnvValues($path) {
    $env = [];
    if (file_exists($path)) {
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            $line = trim($line);
            if (empty($line) || strpos($line, '#') === 0) continue;
            if (strpos($line, '=') !== false) {
                list($key, $val) = explode('=', $line, 2);
                $env[trim($key)] = trim($val, " \t\n\r\0\x0B\"'");
            }
        }
    }
    return $env;
}

$env = getEnvValues($envPath);

// 2. Initialize Database Connection
function getDb($dbPath) {
    try {
        $db = new PDO("sqlite:" . $dbPath);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        
        // Tables
        $db->exec("CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT NOT NULL,
            sender_name TEXT DEFAULT 'User',
            message TEXT NOT NULL,
            direction TEXT NOT NULL,
            channel TEXT NOT NULL DEFAULT 'meta_whatsapp',
            status TEXT DEFAULT 'received',
            raw_payload TEXT,
            ai_model TEXT,
            latency_ms REAL DEFAULT 0,
            media_type TEXT,
            media_url TEXT,
            media_filename TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS meta_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT NOT NULL UNIQUE,
            meta_conversation_id TEXT,
            origin_type TEXT DEFAULT 'service',
            pricing_category TEXT DEFAULT 'service',
            is_billable INTEGER DEFAULT 0,
            expiration_timestamp INTEGER,
            last_inbound_time TIMESTAMP,
            window_opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS contact_settings (
            phone_number TEXT PRIMARY KEY,
            bot_enabled INTEGER DEFAULT 1,
            assigned_agent TEXT DEFAULT 'Support Team',
            tags TEXT DEFAULT 'Customer',
            notes TEXT DEFAULT ''
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT DEFAULT 'General',
            content TEXT NOT NULL,
            shortcut TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");

        // Default templates if empty
        $cnt = $db->query("SELECT COUNT(*) FROM templates")->fetchColumn();
        if ($cnt == 0) {
            $stmt = $db->prepare("INSERT INTO templates (title, category, content) VALUES (?, ?, ?)");
            $stmt->execute(["Order Ready for Pickup", "Orders", "Hi {{name}}! Your printing order is ready for pickup. Feel free to collect it during our store hours!"]);
            $stmt->execute(["Appointment Confirmation", "Support", "Hi {{name}}, your appointment is confirmed for tomorrow. Let us know if you need to reschedule!"]);
            $stmt->execute(["Printing Quote Ready", "Billing", "Hi {{name}}, your requested quotation for {{service}} is ready. Reply here to confirm and start printing."]);
            $stmt->execute(["Special Printing Discount", "Marketing", "Exclusive offer for {{name}}! Enjoy 15% off all color brochures, posters, and binding services this week."]);
        }

        return $db;
    } catch (Exception $e) {
        return null;
    }
}

$db = getDb($dbPath);
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Route 1: Stats
if (strpos($uri, '/api/dashboard/stats') !== false) {
    if (!$db) {
        echo json_encode(["total_messages" => 0, "active_chats" => 0, "groq_configured" => false, "meta_configured" => false]);
        exit;
    }

    $totalMsgs = $db->query("SELECT COUNT(*) FROM messages")->fetchColumn();
    $inboundMsgs = $db->query("SELECT COUNT(*) FROM messages WHERE direction = 'inbound'")->fetchColumn();
    $outboundMsgs = $db->query("SELECT COUNT(*) FROM messages WHERE direction = 'outbound'")->fetchColumn();
    $activeChats = $db->query("SELECT COUNT(DISTINCT phone_number) FROM messages")->fetchColumn();

    $groqKey = $env['GROQ_API_KEY'] ?? '';
    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $metaPhoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';

    echo json_encode([
        "total_messages" => (int)$totalMsgs,
        "inbound_messages" => (int)$inboundMsgs,
        "outbound_messages" => (int)$outboundMsgs,
        "active_chats" => (int)$activeChats,
        "groq_configured" => !empty($groqKey) && strpos($groqKey, 'gsk_your') === false,
        "groq_model" => $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile',
        "meta_configured" => !empty($metaToken) && !empty($metaPhoneId),
        "system_status" => "Online (Hostinger Engine)",
        "server_uptime" => "Active"
    ]);
    exit;
}

// Route 2: Conversations List
if (strpos($uri, '/api/dashboard/conversations') !== false) {
    if (!$db) {
        echo json_encode(["conversations" => []]);
        exit;
    }

    $sql = "
        SELECT 
            m.phone_number,
            m.sender_name,
            m.message as last_message,
            m.direction as last_message_direction,
            m.created_at as last_message_time,
            m.status as last_message_status,
            COALESCE(c.bot_enabled, 1) as bot_enabled,
            mc.expiration_timestamp,
            mc.origin_type,
            mc.pricing_category,
            mc.is_billable
        FROM messages m
        INNER JOIN (
            SELECT phone_number, MAX(id) as max_id
            FROM messages
            GROUP BY phone_number
        ) latest ON m.phone_number = latest.phone_number AND m.id = latest.max_id
        LEFT JOIN contact_settings c ON m.phone_number = c.phone_number
        LEFT JOIN meta_conversations mc ON m.phone_number = mc.phone_number
        ORDER BY m.created_at DESC
    ";

    $rows = $db->query($sql)->fetchAll();
    $convs = [];
    $nowTs = time();

    foreach ($rows as $r) {
        $expTs = (int)($r['expiration_timestamp'] ?? 0);
        $secondsLeft = max(0, $expTs - $nowTs);
        $isFreeActive = $secondsLeft > 0;

        // Fallback: check last inbound time
        if (!$isFreeActive) {
            $inStmt = $db->prepare("SELECT created_at FROM messages WHERE phone_number = ? AND direction = 'inbound' ORDER BY id DESC LIMIT 1");
            $inStmt->execute([$r['phone_number']]);
            $lastIn = $inStmt->fetchColumn();
            if ($lastIn) {
                $lastInTs = strtotime($lastIn);
                $diff = $nowTs - $lastInTs;
                if ($diff < 86400 && $diff >= 0) {
                    $secondsLeft = 86400 - $diff;
                    $isFreeActive = true;
                }
            }
        }

        $convs[] = [
            "phone_number" => $r['phone_number'],
            "sender_name" => $r['sender_name'] ?: 'Customer',
            "last_message" => $r['last_message'],
            "last_message_direction" => $r['last_message_direction'],
            "last_message_time" => $r['last_message_time'],
            "last_message_status" => $r['last_message_status'],
            "bot_enabled" => (bool)$r['bot_enabled'],
            "is_free_window_active" => $isFreeActive,
            "free_window_seconds_left" => $secondsLeft,
            "pricing_category" => $r['pricing_category'] ?: 'service',
            "is_billable" => (bool)$r['is_billable']
        ];
    }

    echo json_encode(["conversations" => $convs]);
    exit;
}

// Route 3: Messages for a Phone
if (strpos($uri, '/api/dashboard/messages') !== false) {
    $phone = $_GET['phone'] ?? '';
    if (!$db || empty($phone)) {
        echo json_encode(["messages" => [], "phone" => $phone, "bot_enabled" => true]);
        exit;
    }

    $stmt = $db->prepare("SELECT * FROM messages WHERE phone_number = ? ORDER BY id ASC LIMIT 200");
    $stmt->execute([$phone]);
    $msgs = $stmt->fetchAll();

    $bStmt = $db->prepare("SELECT bot_enabled FROM contact_settings WHERE phone_number = ?");
    $bStmt->execute([$phone]);
    $botRow = $bStmt->fetch();
    $botEnabled = $botRow ? (bool)$botRow['bot_enabled'] : true;

    echo json_encode([
        "messages" => $msgs,
        "phone" => $phone,
        "bot_enabled" => $botEnabled
    ]);
    exit;
}

// Route 4: Templates
if (strpos($uri, '/api/dashboard/templates') !== false) {
    if ($method === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        $title = trim($body['title'] ?? '');
        $cat = trim($body['category'] ?? 'General');
        $content = trim($body['content'] ?? '');
        if ($title && $content && $db) {
            $stmt = $db->prepare("INSERT INTO templates (title, category, content) VALUES (?, ?, ?)");
            $stmt->execute([$title, $cat, $content]);
        }
        echo json_encode(["status" => "success"]);
        exit;
    }

    if ($method === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        if ($id && $db) {
            $db->prepare("DELETE FROM templates WHERE id = ?")->execute([$id]);
        }
        echo json_encode(["status" => "success"]);
        exit;
    }

    $templates = $db ? $db->query("SELECT * FROM templates ORDER BY id DESC")->fetchAll() : [];
    echo json_encode(["templates" => $templates]);
    exit;
}

// Route 5: Send Manual Reply from Dashboard
if (strpos($uri, '/api/dashboard/send') !== false || strpos($uri, '/api/dashboard/send-reply') !== false) {
    $body = json_decode(file_get_contents('php://input'), true);
    $recipient = trim($body['recipient'] ?? ($body['phone_number'] ?? ''));
    $msgText = trim($body['message'] ?? '');

    if (empty($recipient) || empty($msgText)) {
        http_response_code(400);
        echo json_encode(["error" => "Missing recipient or message"]);
        exit;
    }

    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';

    $success = false;
    $apiResponse = '';

    if ($metaToken && $phoneId) {
        $ch = curl_init("https://graph.facebook.com/v21.0/{$phoneId}/messages");
        $payload = json_encode([
            "messaging_product" => "whatsapp",
            "recipient_type" => "individual",
            "to" => preg_replace('/[^0-9]/', '', $recipient),
            "type" => "text",
            "text" => ["preview_url" => false, "body" => $msgText]
        ]);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer {$metaToken}", "Content-Type: application/json"]);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        $apiResponse = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $success = ($httpCode === 200);
    }

    if ($db) {
        $stmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, raw_payload) VALUES (?, ?, ?, 'outbound', 'manual_admin', ?, ?)");
        $stmt->execute([$recipient, 'Support Agent', $msgText, $success ? 'sent' : 'failed', $apiResponse]);
    }

    echo json_encode(["success" => $success, "api_response" => $apiResponse]);
    exit;
}

// Route 6: Bulk Send
if (strpos($uri, '/api/dashboard/bulk-send') !== false) {
    $body = json_decode(file_get_contents('php://input'), true);
    $msgTemplate = trim($body['message'] ?? '');
    $recipients = $body['recipients'] ?? [];

    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';

    $sentCount = 0;
    $failedCount = 0;

    foreach ($recipients as $r) {
        $phone = preg_replace('/[^0-9]/', '', is_array($r) ? ($r['phone'] ?? '') : $r);
        $name = is_array($r) ? ($r['name'] ?? 'Customer') : 'Customer';
        if (empty($phone)) continue;

        $personalized = str_replace(
            ['{{name}}', '{{phone}}', '{{service}}'],
            [$name, $phone, 'Printing & Task Service'],
            $msgTemplate
        );

        $success = false;
        $apiResponse = '';

        if ($metaToken && $phoneId) {
            $ch = curl_init("https://graph.facebook.com/v21.0/{$phoneId}/messages");
            $payload = json_encode([
                "messaging_product" => "whatsapp",
                "recipient_type" => "individual",
                "to" => $phone,
                "type" => "text",
                "text" => ["preview_url" => false, "body" => $personalized]
            ]);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer {$metaToken}", "Content-Type: application/json"]);
            curl_setopt($ch, CURLOPT_POST, 1);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);
            $apiResponse = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            $success = ($httpCode === 200);
        }

        if ($success) $sentCount++; else $failedCount++;

        if ($db) {
            $stmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, raw_payload) VALUES (?, ?, ?, 'outbound', 'broadcast', ?, ?)");
            $stmt->execute([$phone, 'Support Broadcast', $personalized, $success ? 'sent' : 'failed', $apiResponse]);
        }
    }

    echo json_encode(["status" => "complete", "total_targeted" => count($recipients), "sent" => $sentCount, "failed" => $failedCount]);
    exit;
}

// Route 7: Settings (Save to .env)
if (strpos($uri, '/api/dashboard/settings') !== false) {
    if ($method === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        $newGroq = trim($body['groq_api_key'] ?? '');
        $newModel = trim($body['groq_model'] ?? 'llama-3.3-70b-versatile');
        $newMetaToken = trim($body['whatsapp_token'] ?? '');
        $newPhoneId = trim($body['whatsapp_phone_number_id'] ?? '');
        $newVerifyToken = trim($body['whatsapp_verify_token'] ?? '');

        if ($newGroq) $env['GROQ_API_KEY'] = $newGroq;
        if ($newModel) $env['GROQ_MODEL'] = $newModel;
        if ($newMetaToken) $env['WHATSAPP_TOKEN'] = $newMetaToken;
        if ($newPhoneId) $env['WHATSAPP_PHONE_NUMBER_ID'] = $newPhoneId;
        if ($newVerifyToken) $env['WHATSAPP_VERIFY_TOKEN'] = $newVerifyToken;

        $content = "# WhatsApp CRM Environment Variables\n";
        foreach ($env as $k => $v) {
            $content .= "{$k}={$v}\n";
        }
        @file_put_contents($envPath, $content);
        echo json_encode(["status" => "success", "message" => "Settings updated in .env"]);
        exit;
    }

    echo json_encode([
        "groq_configured" => !empty($env['GROQ_API_KEY']),
        "groq_model" => $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile',
        "meta_configured" => !empty($env['WHATSAPP_TOKEN']) && !empty($env['WHATSAPP_PHONE_NUMBER_ID'])
    ]);
    exit;
}

// Route 8: Bot Toggle
if (strpos($uri, '/api/dashboard/contact/bot-toggle') !== false) {
    $phone = $_POST['phone'] ?? ($_GET['phone'] ?? '');
    $enabled = isset($_POST['enabled']) ? (int)$_POST['enabled'] : (isset($_GET['enabled']) ? (int)$_GET['enabled'] : 1);
    if ($db && $phone) {
        $stmt = $db->prepare("INSERT INTO contact_settings (phone_number, bot_enabled) VALUES (?, ?) ON CONFLICT(phone_number) DO UPDATE SET bot_enabled = excluded.bot_enabled");
        $stmt->execute([$phone, $enabled]);
    }
    echo json_encode(["status" => "success", "phone" => $phone, "bot_enabled" => (bool)$enabled]);
    exit;
}

// Fallback
echo json_encode(["status" => "ok", "engine" => "Hostinger CRM Engine"]);
exit;
