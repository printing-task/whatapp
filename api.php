<?php
// ====================================================================
// printingtask • WhatsApp Business CRM API Backend (PHP Engine)
// Handles Dashboard APIs, Real-time Chat, Bulk Broadcasts, AI Bot, Settings
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

// 2. Helper to read JSON request input safely
function getJsonInput() {
    $raw = file_get_contents('php://input');
    if ($raw !== false) {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', trim($raw));
    }
    $data = !empty($raw) ? json_decode($raw, true) : null;
    if (!is_array($data) || empty($data)) {
        $data = !empty($_POST) ? $_POST : $_REQUEST;
    }
    return is_array($data) ? $data : [];
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

        $db->exec("CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT NOT NULL,
            customer_name TEXT DEFAULT 'Customer',
            service TEXT NOT NULL,
            date_time TEXT NOT NULL,
            status TEXT DEFAULT 'confirmed',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS webhook_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT DEFAULT 'meta',
            payload TEXT,
            status TEXT DEFAULT 'received',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT NOT NULL,
            customer_name TEXT DEFAULT 'Lead',
            business_name TEXT DEFAULT '',
            category TEXT DEFAULT '',
            area TEXT DEFAULT '',
            website TEXT DEFAULT '',
            source TEXT DEFAULT 'Broadcast / Manual',
            status TEXT DEFAULT 'New',
            last_messaged_at TIMESTAMP,
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS security_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT,
            event_type TEXT DEFAULT 'scan',
            description TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");

        // Default templates if empty
        $cnt = $db->query("SELECT COUNT(*) FROM templates")->fetchColumn();
        if ($cnt == 0) {
            $stmt = $db->prepare("INSERT INTO templates (title, category, content) VALUES (?, ?, ?)");
            $stmt->execute(["Order Ready for Pickup", "Orders", "Hi {{name}}! Your printing order is ready for pickup. Feel free to collect it during our store hours!"]);
            $stmt->execute(["Design Proof Approval", "Proofs", "Hello {{name}}, your requested design sample is ready for review. Please reply to approve or request revisions."]);
            $stmt->execute(["Special 20% Discount", "Promotions", "Exciting news {{name}}! Enjoy 20% off all color printing and spiral binding this week. Place your order now!"]);
        }

        return $db;
    } catch (Exception $e) {
        return null;
    }
}

// 3. AI Reply Generation (Groq Cloud API + Fallback)
function generateAiReply($userPrompt, $apiKey, $model = 'llama-3.3-70b-versatile') {
    $t0 = microtime(true);
    if (!empty($apiKey)) {
        $ch = curl_init("https://api.groq.com/openai/v1/chat/completions");
        $systemPrompt = "You are the friendly, helpful AI customer support representative for 'printingtask' (a professional printing, document, and custom stationery studio). Always be polite, concise, and helpful. Mention relevant pricing (₹2/page B/W, ₹10/page Color, ₹35 binding) and invite them to share their files or visit for pickup when applicable.";
        
        $payload = json_encode([
            "model" => $model ?: 'llama-3.3-70b-versatile',
            "messages" => [
                ["role" => "system", "content" => $systemPrompt],
                ["role" => "user", "content" => $userPrompt]
            ],
            "max_tokens" => 350,
            "temperature" => 0.6
        ]);

        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer {$apiKey}",
            "Content-Type: application/json"
        ]);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code === 200) {
            $data = json_decode($res, true);
            $reply = $data['choices'][0]['message']['content'] ?? '';
            if (!empty($reply)) {
                $latency = round((microtime(true) - $t0) * 1000, 1);
                return [$reply, "Groq (" . ($model ?: 'llama-3.3-70b') . ")", $latency];
            }
        }
    }

    // Smart Keyword Fallback
    $p = strtolower(trim($userPrompt));
    $reply = "";

    if (preg_match('/(human|agent|person|representative|specialist|talk to someone|call me)/i', $p)) {
        $reply = "👤 *Connecting to printingtask Support Team*\n\nI've flagged this conversation for our team. A human specialist is reviewing your message and will respond here shortly.\n\nFeel free to share any files or order details in the meantime!";
    } elseif (preg_match('/(book|appointment|schedule|reserve|slot|meeting)/i', $p)) {
        $reply = "📅 *printingtask Booking Request*\n\nThank you for contacting printingtask! I've logged your request.\n\n• Please reply with your preferred date and time\n• Specify if you need printing, consultation, or custom tasks\n\nOur team will confirm your slot right away!";
    } elseif (preg_match('/(price|cost|rate|quote|how much|charges|estimate)/i', $p)) {
        $reply = "💰 *printingtask Pricing Guide*\n\nHere is our standard rate breakdown:\n• *B/W Printing:* ₹2 / page\n• *Color Printing:* ₹10 / page\n• *Spiral Binding:* Starting at ₹35\n• *Posters & Banners:* Custom sizing available\n\n👉 Send us your file or specs for an exact quote!";
    } elseif (preg_match('/(hi|hello|hey|namaste|good morning|good evening)/i', $p)) {
        $reply = "👋 *Hello! Welcome to printingtask Support*\n\nHow can we assist you today?\n• 🖨️ Document & Color Printing\n• 📦 Order Status & Delivery\n• 📅 Book an Appointment / Consultation\n\nSend us a message or upload your file anytime!";
    } else {
        $reply = "Thank you for contacting *printingtask*! 📄\n\nWe have received your message. A customer support representative will assist you with your printing order or inquiry right away. If you have a document or photo to print, feel free to send it here!";
    }

    $latency = round((microtime(true) - $t0) * 1000, 1);
    return [$reply, "Smart Rule Engine", $latency];
}

// 4. Send Message via Meta WhatsApp Cloud API
function sendMetaWhatsAppMessage($recipient, $text, $token, $phoneId) {
    if (empty($token) || empty($phoneId)) return [false, "Missing Token or Phone ID"];

    $cleanTo = preg_replace('/[^0-9]/', '', $recipient);
    $url = "https://graph.facebook.com/v21.0/{$phoneId}/messages";
    $payload = json_encode([
        "messaging_product" => "whatsapp",
        "recipient_type" => "individual",
        "to" => $cleanTo,
        "type" => "text",
        "text" => ["preview_url" => false, "body" => $text]
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ]);
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return [($httpCode === 200), $response];
}

$db = getDb($dbPath);
$uri = $_SERVER['REQUEST_URI'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Route 1: Stats Overview
if (strpos($uri, '/api/dashboard/stats') !== false) {
    if (!$db) {
        echo json_encode(["total_messages" => 0, "inbound_messages" => 0, "outbound_messages" => 0, "active_chats" => 0, "active_24h_windows" => 0]);
        exit;
    }

    $total = (int)$db->query("SELECT COUNT(*) FROM messages")->fetchColumn();
    $inbound = (int)$db->query("SELECT COUNT(*) FROM messages WHERE direction = 'inbound'")->fetchColumn();
    $outbound = (int)$db->query("SELECT COUNT(*) FROM messages WHERE direction = 'outbound'")->fetchColumn();
    $activeChats = (int)$db->query("SELECT COUNT(DISTINCT phone_number) FROM messages")->fetchColumn();

    $nowTs = time();
    $activeWindows = (int)$db->query("SELECT COUNT(*) FROM meta_conversations WHERE expiration_timestamp > {$nowTs}")->fetchColumn();

    echo json_encode([
        "total_messages" => $total,
        "inbound_messages" => $inbound,
        "outbound_messages" => $outbound,
        "active_chats" => $activeChats,
        "active_24h_windows" => $activeWindows,
        "groq_active" => !empty($env['GROQ_API_KEY']),
        "meta_active" => !empty($env['WHATSAPP_TOKEN']) && !empty($env['WHATSAPP_PHONE_NUMBER_ID'])
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

// Route 3: Messages for a Phone (GET) or Delete Messages (DELETE)
if (strpos($uri, '/api/dashboard/messages') !== false) {
    if ($method === 'DELETE') {
        $body = getJsonInput();
        $ids = $body['ids'] ?? [];
        if ($db && is_array($ids) && count($ids) > 0) {
            $inClause = implode(',', array_map('intval', $ids));
            $db->exec("DELETE FROM messages WHERE id IN ({$inClause})");
        }
        echo json_encode(["status" => "success", "deleted_ids" => $ids]);
        exit;
    }

    $phone = trim($_GET['phone'] ?? '');
    if (!$db || empty($phone)) {
        echo json_encode(["messages" => [], "phone" => $phone, "bot_enabled" => true]);
        exit;
    }

    $clean = preg_replace('/[^0-9]/', '', $phone);
    $stmt = $db->prepare("SELECT * FROM messages WHERE phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ? ORDER BY id ASC LIMIT 250");
    $stmt->execute([$phone, '+' . $clean, $clean]);
    $msgs = $stmt->fetchAll();

    $bStmt = $db->prepare("SELECT bot_enabled FROM contact_settings WHERE phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ? LIMIT 1");
    $bStmt->execute([$phone, '+' . $clean, $clean]);
    $botRow = $bStmt->fetch();
    $botEnabled = $botRow ? (bool)$botRow['bot_enabled'] : true;

    echo json_encode([
        "messages" => $msgs,
        "phone" => $phone,
        "bot_enabled" => $botEnabled
    ]);
    exit;
}

// Route 4: Clear All Data (DELETE)
if (strpos($uri, '/api/dashboard/clear') !== false) {
    if ($method === 'DELETE' && $db) {
        $db->exec("DELETE FROM messages");
        $db->exec("DELETE FROM meta_conversations");
        $db->exec("DELETE FROM webhook_logs");
    }
    echo json_encode(["status" => "success", "message" => "All messages and conversations cleared"]);
    exit;
}

// Route 5: Send Manual Reply or Simulate Customer Message (/api/dashboard/send)
if (strpos($uri, '/api/dashboard/send') !== false || strpos($uri, '/api/dashboard/send-reply') !== false) {
    $body = getJsonInput();

    // Accept phone, recipient, phone_number, or to
    $recipient = trim($body['phone'] ?? ($body['recipient'] ?? ($body['phone_number'] ?? ($body['to'] ?? ''))));
    $msgText = trim($body['message'] ?? ($body['msg'] ?? ($body['text'] ?? ($body['caption'] ?? ''))));
    $senderName = trim($body['name'] ?? ($body['sender_name'] ?? 'Support Agent'));
    $role = trim($body['role'] ?? 'agent');
    $sendViaMeta = isset($body['send_via_meta']) ? (bool)$body['send_via_meta'] : true;

    if (empty($recipient) || empty($msgText)) {
        http_response_code(400);
        echo json_encode([
            "error" => "Phone number and message text are required.",
            "received_phone" => $recipient,
            "received_message" => $msgText
        ]);
        exit;
    }

    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';
    $groqKey = $env['GROQ_API_KEY'] ?? '';
    $groqModel = $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';

    // Case 1: Role is 'customer' -> Simulate inbound customer message + trigger AI auto-reply!
    if ($role === 'customer') {
        $inboundId = null;
        if ($db) {
            $inStmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status) VALUES (?, ?, ?, 'inbound', 'simulator', 'received')");
            $inStmt->execute([$recipient, $senderName ?: 'Customer', $msgText]);
            $inboundId = $db->lastInsertId();
        }

        // Check if bot enabled for this contact
        $botActive = true;
        if ($db) {
            $bStmt = $db->prepare("SELECT bot_enabled FROM contact_settings WHERE phone_number = ?");
            $bStmt->execute([$recipient]);
            $bRow = $bStmt->fetch();
            if ($bRow && (int)$bRow['bot_enabled'] === 0) {
                $botActive = false;
            }
        }

        $aiReply = "";
        $engineUsed = "";
        $latencyMs = 0;
        $outboundId = null;

        if ($botActive) {
            list($aiReply, $engineUsed, $latencyMs) = generateAiReply($msgText, $groqKey, $groqModel);
            if ($db) {
                $outStmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, ai_model, latency_ms) VALUES (?, 'Support Agent (AI)', ?, 'outbound', 'simulator', 'sent', ?, ?)");
                $outStmt->execute([$recipient, $aiReply, $engineUsed, $latencyMs]);
                $outboundId = $db->lastInsertId();
            }
        }

        echo json_encode([
            "success" => true,
            "inbound_id" => $inboundId,
            "outbound_id" => $outboundId,
            "customer_message" => $msgText,
            "ai_reply" => $aiReply,
            "engine" => $engineUsed,
            "latency_ms" => $latencyMs
        ]);
        exit;
    }

    // Case 2: Role is 'ai' -> AI generates agent response
    $replyBody = $msgText;
    $engineUsed = null;
    $latencyMs = 0;
    if ($role === 'ai') {
        list($replyBody, $engineUsed, $latencyMs) = generateAiReply($msgText, $groqKey, $groqModel);
        $senderName = "Support Agent (AI)";
    } else {
        $senderName = "printingtask Support";
        // When human agent replies directly, pause AI bot for this contact so AI does not interrupt!
        if ($db) {
            $db->prepare("INSERT INTO contact_settings (phone_number, bot_enabled) VALUES (?, 0) ON CONFLICT(phone_number) DO UPDATE SET bot_enabled = 0")->execute([$recipient]);
        }
    }

    // Send via Meta WhatsApp Cloud API if enabled and credentials configured
    $metaSuccess = false;
    $apiResponse = '';
    if ($sendViaMeta && $metaToken && $phoneId) {
        list($metaSuccess, $apiResponse) = sendMetaWhatsAppMessage($recipient, $replyBody, $metaToken, $phoneId);
    } elseif (!$sendViaMeta) {
        $metaSuccess = true;
        $apiResponse = 'Sent in dashboard (Meta forwarding disabled)';
    } else {
        $apiResponse = 'Notice: WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set in .env. Message recorded locally.';
    }

    $msgStatus = $metaSuccess ? 'sent' : ($sendViaMeta ? 'failed' : 'sent');
    $msgId = null;

    if ($db) {
        $stmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, raw_payload, ai_model, latency_ms) VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?)");
        $channel = ($role === 'ai') ? 'meta_whatsapp' : 'manual_admin';
        $stmt->execute([
            $recipient,
            $senderName,
            $replyBody,
            $channel,
            $msgStatus,
            is_string($apiResponse) ? $apiResponse : json_encode($apiResponse),
            $engineUsed,
            $latencyMs
        ]);
        $msgId = $db->lastInsertId();
    }

    echo json_encode([
        "success" => true,
        "message_id" => $msgId,
        "phone" => $recipient,
        "message" => $replyBody,
        "status" => $msgStatus,
        "meta_sent" => $metaSuccess,
        "api_response" => $apiResponse
    ]);
    exit;
}

// Route 6: Send Media Attachment (/api/dashboard/send-media)
if (strpos($uri, '/api/dashboard/send-media') !== false) {
    $phone = trim($_POST['phone'] ?? '');
    $caption = trim($_POST['caption'] ?? '');
    $mediaType = trim($_POST['media_type'] ?? 'image');
    $sendViaMeta = isset($_POST['send_via_meta']) ? filter_var($_POST['send_via_meta'], FILTER_VALIDATE_BOOLEAN) : true;

    if (empty($phone)) {
        http_response_code(400);
        echo json_encode(["error" => "Phone number is required."]);
        exit;
    }

    $savedFilename = '';
    $savedUrl = '';

    if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
        $uploadDir = __DIR__ . '/uploads';
        if (!is_dir($uploadDir)) @mkdir($uploadDir, 0755, true);

        $origName = basename($_FILES['file']['name']);
        $safeName = time() . '_' . preg_replace('/[^a-zA-Z0-9._-]/', '', $origName);
        $target = $uploadDir . '/' . $safeName;

        if (move_uploaded_file($_FILES['file']['tmp_name'], $target)) {
            $savedFilename = $origName;
            $savedUrl = '/uploads/' . $safeName;
        }
    }

    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';
    $metaSuccess = false;
    $apiResponse = '';

    if ($sendViaMeta && $metaToken && $phoneId) {
        // Send caption via Meta as WhatsApp message
        $sendText = $caption ?: ("Sent attachment: " . ($savedFilename ?: "file"));
        list($metaSuccess, $apiResponse) = sendMetaWhatsAppMessage($phone, $sendText, $metaToken, $phoneId);
    }

    if ($db) {
        // Pause bot for contact
        $db->prepare("INSERT INTO contact_settings (phone_number, bot_enabled) VALUES (?, 0) ON CONFLICT(phone_number) DO UPDATE SET bot_enabled = 0")->execute([$phone]);

        $stmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, media_type, media_url, media_filename, raw_payload) VALUES (?, 'Support Agent', ?, 'outbound', 'manual_admin', ?, ?, ?, ?, ?)");
        $status = $metaSuccess ? 'sent' : ($sendViaMeta ? 'failed' : 'sent');
        $stmt->execute([$phone, $caption ?: "Attachment: {$savedFilename}", $status, $mediaType, $savedUrl, $savedFilename, $apiResponse]);
    }

    echo json_encode(["success" => true, "media_url" => $savedUrl, "filename" => $savedFilename]);
    exit;
}

// Route 7: Trigger AI Reply (/api/dashboard/trigger-ai-reply)
if (strpos($uri, '/api/dashboard/trigger-ai-reply') !== false) {
    $body = getJsonInput();
    $phone = trim($body['phone'] ?? '');
    $customPrompt = trim($body['prompt'] ?? '');

    if (empty($phone)) {
        http_response_code(400);
        echo json_encode(["error" => "Phone is required"]);
        exit;
    }

    $groqKey = $env['GROQ_API_KEY'] ?? '';
    $groqModel = $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';
    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';

    // Find last customer message
    $promptToUse = $customPrompt;
    if (empty($promptToUse) && $db) {
        $st = $db->prepare("SELECT message FROM messages WHERE phone_number = ? AND direction = 'inbound' ORDER BY id DESC LIMIT 1");
        $st->execute([$phone]);
        $promptToUse = $st->fetchColumn() ?: "Hello, need help with printing";
    }

    list($aiReply, $engineUsed, $latencyMs) = generateAiReply($promptToUse, $groqKey, $groqModel);

    $metaSuccess = false;
    $apiResponse = '';
    if ($metaToken && $phoneId) {
        list($metaSuccess, $apiResponse) = sendMetaWhatsAppMessage($phone, $aiReply, $metaToken, $phoneId);
    }

    if ($db) {
        $stmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, ai_model, latency_ms, raw_payload) VALUES (?, 'Support Agent (AI)', ?, 'outbound', 'meta_whatsapp', ?, ?, ?, ?)");
        $stmt->execute([$phone, $aiReply, $metaSuccess ? 'sent' : 'failed', $engineUsed, $latencyMs, $apiResponse]);
    }

    echo json_encode(["success" => true, "reply" => $aiReply, "engine" => $engineUsed, "latency_ms" => $latencyMs]);
    exit;
}

// Route 8: Test AI (/api/dashboard/test-ai)
if (strpos($uri, '/api/dashboard/test-ai') !== false) {
    $body = getJsonInput();
    $prompt = trim($body['prompt'] ?? 'Hi, what are your printing rates?');

    $groqKey = $env['GROQ_API_KEY'] ?? '';
    $groqModel = $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';

    list($reply, $engine, $latency) = generateAiReply($prompt, $groqKey, $groqModel);
    echo json_encode(["reply" => $reply, "engine" => $engine, "latency_ms" => $latency]);
    exit;
}

// Route 9: Simulate Inbound Customer Message (/api/dashboard/simulate-inbound)
if (strpos($uri, '/api/dashboard/simulate-inbound') !== false) {
    $body = getJsonInput();
    $phone = trim($body['phone'] ?? '+918815081605');
    $name = trim($body['name'] ?? 'Customer');
    $msg = trim($body['message'] ?? 'Hi, I need quotation for bulk color printouts');
    $autoReply = isset($body['auto_reply']) ? (bool)$body['auto_reply'] : true;

    if ($db) {
        $inStmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status) VALUES (?, ?, ?, 'inbound', 'simulator', 'received')");
        $inStmt->execute([$phone, $name, $msg]);

        if ($autoReply) {
            $groqKey = $env['GROQ_API_KEY'] ?? '';
            $groqModel = $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';
            list($aiReply, $engine, $lat) = generateAiReply($msg, $groqKey, $groqModel);

            $outStmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, ai_model, latency_ms) VALUES (?, 'Support Agent (AI)', ?, 'outbound', 'simulator', 'sent', ?, ?)");
            $outStmt->execute([$phone, $aiReply, $engine, $lat]);
        }
    }

    echo json_encode(["success" => true, "status" => "simulated"]);
    exit;
}

// Route 10: Bulk Send (/api/dashboard/bulk-send)
if (strpos($uri, '/api/dashboard/bulk-send') !== false) {
    $body = getJsonInput();
    $msgTemplate = trim($body['message'] ?? '');
    $recipients = $body['recipients'] ?? ($body['targets'] ?? ($body['phones'] ?? []));
    $sendViaMeta = isset($body['send_via_meta']) ? (bool)$body['send_via_meta'] : true;

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

        if ($sendViaMeta && $metaToken && $phoneId) {
            list($success, $apiResponse) = sendMetaWhatsAppMessage($phone, $personalized, $metaToken, $phoneId);
        } else {
            $success = true;
            $apiResponse = 'Local broadcast preview';
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

// Route 11: Broadcast Promo (/api/dashboard/broadcast-promo)
if (strpos($uri, '/api/dashboard/broadcast-promo') !== false) {
    $body = getJsonInput();
    $messageText = trim($body['message'] ?? '');
    $targetPhones = $body['phones'] ?? [];
    $sendViaMeta = isset($body['send_via_meta']) ? (bool)$body['send_via_meta'] : true;

    if (empty($messageText)) {
        http_response_code(400);
        echo json_encode(["error" => "Message content cannot be empty"]);
        exit;
    }

    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';
    $nowTs = time();

    // Default to all active free 24-hr window contacts
    if (empty($targetPhones) || $targetPhones === 'all_active') {
        $targetPhones = [];
        if ($db) {
            $activeRows = $db->query("SELECT phone_number FROM meta_conversations WHERE expiration_timestamp > {$nowTs}")->fetchAll();
            foreach ($activeRows as $ar) $targetPhones[] = $ar['phone_number'];
        }
    }

    $sent = 0;
    $failed = 0;
    foreach ($targetPhones as $tp) {
        $cleanPhone = preg_replace('/[^0-9]/', '', $tp);
        if (empty($cleanPhone)) continue;

        $success = false;
        if ($sendViaMeta && $metaToken && $phoneId) {
            list($success, $res) = sendMetaWhatsAppMessage($cleanPhone, $messageText, $metaToken, $phoneId);
        } else {
            $success = true;
        }

        if ($success) $sent++; else $failed++;
        if ($db) {
            $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status) VALUES (?, 'Promotional Offer', ?, 'outbound', 'broadcast', ?)")
               ->execute([$cleanPhone, $messageText, $success ? 'sent' : 'failed']);
        }
    }

    echo json_encode(["success" => true, "sent_count" => $sent, "failed_count" => $failed]);
    exit;
}

// Route 12: Templates (GET, POST, DELETE)
if (strpos($uri, '/api/dashboard/templates') !== false) {
    if ($method === 'POST') {
        $body = getJsonInput();
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

// Route 13: Bookings (/api/dashboard/bookings, /update, /add)
if (strpos($uri, '/api/dashboard/bookings') !== false) {
    if (strpos($uri, '/add') !== false && $method === 'POST') {
        $body = getJsonInput();
        if ($db) {
            $stmt = $db->prepare("INSERT INTO bookings (phone_number, customer_name, service, date_time, status, notes) VALUES (?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                trim($body['phone'] ?? ''),
                trim($body['name'] ?? 'Customer'),
                trim($body['service'] ?? 'General Printing'),
                trim($body['date_time'] ?? date('Y-m-d H:i')),
                trim($body['status'] ?? 'confirmed'),
                trim($body['notes'] ?? '')
            ]);
        }
        echo json_encode(["success" => true]);
        exit;
    }

    if (strpos($uri, '/update') !== false && $method === 'POST') {
        $body = getJsonInput();
        if ($db && isset($body['id'])) {
            $stmt = $db->prepare("UPDATE bookings SET status = ? WHERE id = ?");
            $stmt->execute([trim($body['status'] ?? 'confirmed'), (int)$body['id']]);
        }
        echo json_encode(["success" => true]);
        exit;
    }

    $bookings = $db ? $db->query("SELECT * FROM bookings ORDER BY id DESC LIMIT 50")->fetchAll() : [];
    echo json_encode(["bookings" => $bookings]);
    exit;
}

// Route 14: Webhooks Log (/api/dashboard/webhooks)
if (strpos($uri, '/api/dashboard/webhooks') !== false) {
    $logs = $db ? $db->query("SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 50")->fetchAll() : [];
    echo json_encode(["logs" => $logs]);
    exit;
}

// Route 15: Contact Profile (/api/dashboard/contact/profile)
if (strpos($uri, '/api/dashboard/contact/profile') !== false) {
    if ($method === 'POST') {
        $body = getJsonInput();
        $phone = trim($body['phone'] ?? '');
        $tags = trim($body['tags'] ?? 'Customer');
        $notes = trim($body['notes'] ?? '');
        $agent = trim($body['assigned_agent'] ?? 'Support Team');

        if ($db && $phone) {
            $stmt = $db->prepare("INSERT INTO contact_settings (phone_number, tags, notes, assigned_agent) VALUES (?, ?, ?, ?) ON CONFLICT(phone_number) DO UPDATE SET tags = excluded.tags, notes = excluded.notes, assigned_agent = excluded.assigned_agent");
            $stmt->execute([$phone, $tags, $notes, $agent]);
        }
        echo json_encode(["success" => true]);
        exit;
    }

    $phone = $_GET['phone'] ?? '';
    $settings = null;
    if ($db && $phone) {
        $st = $db->prepare("SELECT * FROM contact_settings WHERE phone_number = ?");
        $st->execute([$phone]);
        $settings = $st->fetch();
    }
    echo json_encode(["profile" => $settings ?: ["phone_number" => $phone, "bot_enabled" => 1, "tags" => "Customer", "notes" => ""]]);
    exit;
}

// Route 16: Settings (Save to .env)
if (strpos($uri, '/api/dashboard/settings') !== false) {
    if ($method === 'POST') {
        $body = getJsonInput();
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

// Route 17: Bot Toggle
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

// Route 18: AI Personalize Campaign (/api/dashboard/ai-personalize-campaign)
if (strpos($uri, '/api/dashboard/ai-personalize-campaign') !== false) {
    $body = getJsonInput();
    $leads = $body['leads'] ?? [];
    $goal = trim($body['campaign_goal'] ?? 'Offering professional services and automated WhatsApp support');
    $tone = trim($body['tone'] ?? 'friendly_warm');
    $groqKey = $env['GROQ_API_KEY'] ?? '';
    $groqModel = $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';

    $results = [];
    $engineUsed = !empty($groqKey) ? "Groq (" . ($groqModel ?: 'llama-3.3-70b') . ")" : "Smart Template Engine";

    foreach ($leads as $l) {
        $bName = trim($l['business_name'] ?? ($l['name'] ?? ''));
        $bCat = trim($l['category'] ?? '');
        $bArea = trim($l['area'] ?? '');
        $bPhone = trim($l['phone'] ?? '');

        $pitch = "";
        if (!empty($groqKey) && !empty($bName)) {
            $prompt = "Write a concise, friendly, high-converting WhatsApp message (under 35 words) to business owner '{$bName}' in '{$bArea}' who does '{$bCat}'. Offer: '{$goal}'. Tone: {$tone}. Don't use spammy links or hashtags. Include greeting and polite question.";
            list($aiReply, $eng, $lat) = generateAiReply($prompt, $groqKey, $groqModel);
            $pitch = $aiReply;
        }

        if (empty($pitch)) {
            $areaText = $bArea ? " in {$bArea}" : "";
            $catText = $bCat ? "{$bCat}" : "business";
            if ($bName) {
                $pitch = "Hello {$bName} team! 👋 We love what you're doing with {$catText}{$areaText}. {$goal}. Would you like a quick example or pricing details?";
            } else {
                $pitch = "Hello! 👋 We help local businesses{$areaText} with {$goal}. Would you like more details?";
            }
        }

        $l['personalized_message'] = $pitch;
        $l['status'] = 'ready';
        $results[] = $l;
    }

    echo json_encode([
        "success" => true,
        "total" => count($results),
        "engine_used" => $engineUsed,
        "leads" => $results
    ]);
    exit;
}

// Route 19: Broadcast & Campaign Execution (/api/dashboard/broadcast)
if (strpos($uri, '/api/dashboard/broadcast') !== false) {
    $body = getJsonInput();
    $personalized = $body['personalized_messages'] ?? [];
    $numbers = $body['numbers'] ?? [];
    $genericMsg = trim($body['message'] ?? '');
    $sendViaMeta = isset($body['send_via_meta']) ? (bool)$body['send_via_meta'] : true;
    $addAsLeads = isset($body['add_as_leads']) || isset($body['save_leads']);
    $leadSource = trim($body['lead_source'] ?? 'Bulk Broadcast');

    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';

    $sent = 0;
    $failed = 0;
    $results = [];

    if (!empty($personalized)) {
        foreach ($personalized as $item) {
            $phone = preg_replace('/[^0-9]/', '', $item['phone'] ?? '');
            $msg = trim($item['message'] ?? '');
            $name = trim($item['name'] ?? 'Customer');
            if (empty($phone) || empty($msg)) continue;

            $success = false;
            $res = '';
            if ($sendViaMeta && $metaToken && $phoneId) {
                list($success, $res) = sendMetaWhatsAppMessage($phone, $msg, $metaToken, $phoneId);
            } else {
                $success = true;
                $res = 'Simulated / local send';
            }

            if ($success) $sent++; else $failed++;

            if ($db) {
                $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status) VALUES (?, 'Campaign Outreach', ?, 'outbound', 'broadcast', ?)")
                   ->execute([$phone, $msg, $success ? 'sent' : 'failed']);

                if ($addAsLeads) {
                    $bCat = trim($item['category'] ?? '');
                    $bArea = trim($item['area'] ?? '');
                    $db->prepare("INSERT INTO leads (phone_number, customer_name, business_name, category, area, source, status, last_messaged_at) VALUES (?, ?, ?, ?, ?, ?, 'Contacted', CURRENT_TIMESTAMP)")
                       ->execute([$phone, $name, $name, $bCat, $bArea, $leadSource]);
                }
            }

            $results[] = [
                "phone" => $phone,
                "status" => $success ? "sent" : "failed",
                "api_response" => $res
            ];
        }
    } elseif (!empty($numbers) && !empty($genericMsg)) {
        foreach ($numbers as $rawPhone) {
            $phone = preg_replace('/[^0-9]/', '', $rawPhone);
            if (strlen($phone) === 10) $phone = '91' . $phone;
            if (empty($phone)) continue;

            $success = false;
            $res = '';
            if ($sendViaMeta && $metaToken && $phoneId) {
                list($success, $res) = sendMetaWhatsAppMessage($phone, $genericMsg, $metaToken, $phoneId);
            } else {
                $success = true;
                $res = 'Simulated / local send';
            }

            if ($success) $sent++; else $failed++;

            if ($db) {
                $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status) VALUES (?, 'Support Broadcast', ?, 'outbound', 'broadcast', ?)")
                   ->execute([$phone, $genericMsg, $success ? 'sent' : 'failed']);

                if ($addAsLeads) {
                    $db->prepare("INSERT INTO leads (phone_number, customer_name, source, status, last_messaged_at) VALUES (?, 'Lead', ?, 'Contacted', CURRENT_TIMESTAMP)")
                       ->execute([$phone, $leadSource]);
                }
            }

            $results[] = [
                "phone" => $phone,
                "status" => $success ? "sent" : "failed",
                "api_response" => $res
            ];
        }
    }

    echo json_encode([
        "success" => true,
        "sent" => $sent,
        "failed" => $failed,
        "total" => $sent + $failed,
        "results" => $results
    ]);
    exit;
}

// Route 20: CRM Leads (/api/dashboard/leads)
if (strpos($uri, '/api/dashboard/leads') !== false) {
    if ($method === 'POST') {
        $body = getJsonInput();
        $phone = preg_replace('/[^0-9]/', '', $body['phone'] ?? '');
        $name = trim($body['name'] ?? 'Lead');
        $bName = trim($body['business_name'] ?? '');
        $cat = trim($body['category'] ?? '');
        $area = trim($body['area'] ?? '');
        $status = trim($body['status'] ?? 'New');
        $source = trim($body['source'] ?? 'Manual Import');

        if ($db && $phone) {
            $stmt = $db->prepare("INSERT INTO leads (phone_number, customer_name, business_name, category, area, status, source) VALUES (?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$phone, $name, $bName, $cat, $area, $status, $source]);
        }
        echo json_encode(["success" => true]);
        exit;
    }

    if ($method === 'DELETE') {
        $parts = explode('/', trim($uri, '/'));
        $id = end($parts);
        if (!is_numeric($id)) $id = $_GET['id'] ?? 0;
        if ($db && $id) {
            $db->prepare("DELETE FROM leads WHERE id = ?")->execute([(int)$id]);
        }
        echo json_encode(["success" => true]);
        exit;
    }

    if ($method === 'PUT') {
        $body = getJsonInput();
        $id = $body['id'] ?? 0;
        $status = trim($body['status'] ?? 'Contacted');
        if ($db && $id) {
            $db->prepare("UPDATE leads SET status = ? WHERE id = ?")->execute([$status, (int)$id]);
        }
        echo json_encode(["success" => true]);
        exit;
    }

    $leads = $db ? $db->query("SELECT * FROM leads ORDER BY id DESC LIMIT 200")->fetchAll() : [];
    echo json_encode(["leads" => $leads]);
    exit;
}

// Route 21: Delete Single Conversation (/api/dashboard/conversation)
if (strpos($uri, '/api/dashboard/conversation') !== false && $method === 'DELETE') {
    $phone = trim($_GET['phone'] ?? '');
    if ($db && $phone) {
        $clean = preg_replace('/[^0-9]/', '', $phone);
        $db->prepare("DELETE FROM messages WHERE phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?")->execute([$phone, '+' . $clean, $clean]);
        $db->prepare("DELETE FROM meta_conversations WHERE phone_number = ? OR REPLACE(phone_number, '+', '') = ?")->execute([$phone, $clean]);
    }
    echo json_encode(["success" => true]);
    exit;
}

// Route 22: Graph & Security Mock Endpoints for UI
if (strpos($uri, '/api/dashboard/graph/status') !== false) {
    echo json_encode(["status" => "online", "nodes" => 88, "edges" => 240]);
    exit;
}

if (strpos($uri, '/api/dashboard/security-events') !== false) {
    echo json_encode(["events" => []]);
    exit;
}

if (strpos($uri, '/api/dashboard/test-guard') !== false) {
    echo json_encode(["passed" => true, "reason" => "Input validated safely"]);
    exit;
}

if (strpos($uri, '/api/dashboard/behavior-segments') !== false) {
    echo json_encode(["segments" => [
        ["id" => "active", "title" => "Active Customers (24h Window)", "count" => 3],
        ["id" => "leads", "title" => "New CRM Prospects", "count" => 88]
    ]]);
    exit;
}

// Fallback
echo json_encode(["status" => "ok", "engine" => "Hostinger CRM Engine"]);
exit;
