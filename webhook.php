<?php
// ====================================================================
// Meta WhatsApp Cloud API Webhook Handler & Bot Engine (Hostinger)
// ====================================================================

$envFile = __DIR__ . '/.env';
$dbPath = __DIR__ . '/whatsapp_messages.db';

// 1. Read .env file
function loadEnv($path) {
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

$env = loadEnv($envFile);
$verifyToken = $env['WHATSAPP_VERIFY_TOKEN'] ?? ($env['VERIFY_TOKEN'] ?? 'whatsapp_groq_bot_secret_123');

// 2. Initialize Database
function getDbConnection($dbPath) {
    try {
        $db = new PDO("sqlite:" . $dbPath);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

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

        return $db;
    } catch (Exception $e) {
        return null;
    }
}

// 3. Smart Printingtask Customer Support AI / Fallback Logic
function getAiResponse($userPrompt, $apiKey, $model = 'llama-3.3-70b-versatile') {
    // If Groq API key is configured, call Groq
    if (!empty($apiKey) && strpos($apiKey, 'gsk_your') === false) {
        $ch = curl_init("https://api.groq.com/openai/v1/chat/completions");
        $systemPrompt = "You are a professional, helpful, polite, and efficient Customer Support Representative chatting with a client on WhatsApp for printingtask (a professional printing, document, and custom printing services company).\nGreet customers warmly, answer questions about color/BW printing, posters, banners, binding, lamination, and appointments. Keep replies concise and formatted with friendly WhatsApp markdown (*bold*, bullet points).";

        $payload = json_encode([
            "model" => $model,
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
            if (!empty($reply)) return $reply;
        }
    }

    // Smart Fallback
    $p = strtolower(trim($userPrompt));

    if (preg_match('/(human|agent|person|representative|specialist|talk to someone|call me)/i', $p)) {
        return "👤 *Connecting to printingtask Support Team*\n\nI've flagged this conversation for our team. A human specialist is reviewing your message and will respond here shortly.\n\nFeel free to share any files or order details in the meantime!";
    }

    if (preg_match('/(book|appointment|schedule|reserve|slot|meeting)/i', $p)) {
        return "📅 *printingtask Booking Request*\n\nThank you for contacting printingtask! I've logged your request.\n\n• Please reply with your preferred date and time\n• Specify if you need printing, consultation, or custom tasks\n\nOur team will confirm your slot right away!";
    }

    if (preg_match('/(price|cost|rate|quote|how much|charges|estimate)/i', $p)) {
        return "💰 *printingtask Pricing Guide*\n\nHere is our standard rate breakdown:\n• *B/W Printing:* ₹2 / page\n• *Color Printing:* ₹10 / page\n• *Spiral Binding:* Starting at ₹35\n• *Posters & Banners:* Custom sizing available\n\n👉 Send us your file or specs for an exact quote!";
    }

    if (preg_match('/(hi|hello|hey|namaste|good morning|good evening)/i', $p)) {
        return "👋 *Hello! Welcome to printingtask Support*\n\nHow can we assist you today?\n• 🖨️ Document & Color Printing\n• 📦 Order Status & Delivery\n• 📅 Book an Appointment / Consultation\n\nSend us a message or upload your file anytime!";
    }

    return "Thank you for contacting *printingtask*! 📄\n\nWe have received your message. A customer support representative will assist you with your printing order or inquiry right away. If you have a document or photo to print, feel free to send it here!";
}

// 4. Send Message via Meta WhatsApp Cloud API
function sendMetaWhatsAppMessage($recipient, $text, $token, $phoneId) {
    if (empty($token) || empty($phoneId)) return [false, "Missing Token or Phone ID"];

    $url = "https://graph.facebook.com/v21.0/{$phoneId}/messages";
    $payload = json_encode([
        "messaging_product" => "whatsapp",
        "recipient_type" => "individual",
        "to" => preg_replace('/[^0-9]/', '', $recipient),
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
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return [$httpCode === 200, $response];
}

// ====================================================================
// 5. ROUTING & REQUEST HANDLING
// ====================================================================

// A. Handle Meta Webhook Verification (GET Request)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
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
        echo "Verification failed: token mismatch.";
        exit;
    }
}

// B. Handle Inbound WhatsApp Messages (POST Request)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);

    // Save debug log
    $logDir = __DIR__ . '/uploads';
    if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
    @file_put_contents($logDir . '/last_webhook.json', $rawInput);

    $db = getDbConnection($dbPath);
    $metaToken = $env['WHATSAPP_TOKEN'] ?? '';
    $phoneId = $env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';
    $groqKey = $env['GROQ_API_KEY'] ?? '';
    $groqModel = $env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';

    if (isset($data['entry'])) {
        foreach ($data['entry'] as $entry) {
            foreach ($entry['changes'] ?? [] as $change) {
                $val = $change['value'] ?? [];
                $contacts = $val['contacts'] ?? [];
                $senderName = $contacts[0]['profile']['name'] ?? 'Customer';
                $phoneMetadata = $val['metadata'] ?? [];

                // Update phoneId dynamically if not configured
                if (empty($phoneId) && !empty($phoneMetadata['phone_number_id'])) {
                    $phoneId = $phoneMetadata['phone_number_id'];
                }

                // Process Incoming Messages
                foreach ($val['messages'] ?? [] as $msg) {
                    $senderId = $msg['from'] ?? '';
                    $msgType = $msg['type'] ?? 'text';
                    $userText = '';

                    if ($msgType === 'text') {
                        $userText = trim($msg['text']['body'] ?? '');
                    } elseif ($msgType === 'image') {
                        $userText = trim($msg['image']['caption'] ?? '📷 [Photo Received]');
                    } elseif ($msgType === 'document') {
                        $docName = $msg['document']['filename'] ?? 'File';
                        $userText = trim($msg['document']['caption'] ?? "📄 [Document: {$docName}]");
                    }

                    if (empty($senderId) || empty($userText)) continue;

                    // 1. Save Inbound Message to SQLite
                    if ($db) {
                        $stmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, raw_payload) VALUES (?, ?, ?, 'inbound', 'meta_whatsapp', 'received', ?)");
                        $stmt->execute([$senderId, $senderName, $userText, json_encode($msg)]);

                        // Open / extend 24-hour Meta service window
                        $expTs = time() + 86400; // 24 hours from now
                        $wStmt = $db->prepare("INSERT INTO meta_conversations (phone_number, expiration_timestamp, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(phone_number) DO UPDATE SET expiration_timestamp = excluded.expiration_timestamp, updated_at = CURRENT_TIMESTAMP");
                        $wStmt->execute([$senderId, $expTs]);
                    }

                    // 2. Check if Bot is enabled for this customer
                    $botActive = true;
                    if ($db) {
                        $cStmt = $db->prepare("SELECT bot_enabled FROM contact_settings WHERE phone_number = ?");
                        $cStmt->execute([$senderId]);
                        $cRow = $cStmt->fetch();
                        if ($cRow && isset($cRow['bot_enabled'])) {
                            $botActive = (bool)$cRow['bot_enabled'];
                        }
                    }

                    // 3. Generate AI Reply and Send Back to WhatsApp!
                    if ($botActive) {
                        $replyText = getAiResponse($userText, $groqKey, $groqModel);

                        // Send back via Meta WhatsApp Cloud API
                        list($sentSuccess, $sendResult) = sendMetaWhatsAppMessage($senderId, $replyText, $metaToken, $phoneId);

                        // Save Outbound Reply to SQLite
                        if ($db) {
                            $oStmt = $db->prepare("INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, raw_payload, ai_model) VALUES (?, 'Support Agent (AI)', ?, 'outbound', 'meta_whatsapp', ?, ?, 'printingtask AI')");
                            $oStmt->execute([$senderId, $replyText, $sentSuccess ? 'sent' : 'failed', $sendResult]);
                        }
                    }
                }
            }
        }
    }

    // Acknowledge receipt to Meta
    http_response_code(200);
    header('Content-Type: text/plain; charset=utf-8');
    echo "EVENT_RECEIVED";
    exit;
}

http_response_code(200);
echo "Webhook endpoint active.";
