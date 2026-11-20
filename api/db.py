import os
import sqlite3
import json
import time
from datetime import datetime, timezone

# Database path
DB_DIR = os.path.dirname(os.path.abspath(__file__))
if os.environ.get("VERCEL"):
    DB_PATH = "/tmp/whatsapp_messages.db"
else:
    DB_PATH = os.path.join(os.path.dirname(DB_DIR), "whatsapp_messages.db")

_DB_INITIALIZED = False

def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=15.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    except Exception:
        pass
    return conn

def init_db(force: bool = False):
    """Initialize database tables for messages, bookings, templates, and contact settings."""
    global _DB_INITIALIZED
    if _DB_INITIALIZED and not force:
        return
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # Messages Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT NOT NULL,
                sender_name TEXT DEFAULT 'User',
                message TEXT NOT NULL,
                direction TEXT NOT NULL, -- 'inbound' or 'outbound'
                channel TEXT NOT NULL DEFAULT 'meta_whatsapp', -- 'meta_whatsapp', 'twilio', 'simulator', 'manual_admin'
                status TEXT DEFAULT 'received', -- 'received', 'sent', 'failed'
                raw_payload TEXT,
                ai_model TEXT,
                latency_ms REAL DEFAULT 0,
                media_type TEXT, -- 'image', 'document', 'audio', 'video'
                media_url TEXT,
                media_filename TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Safe schema migrations for media and Meta ID support
        for col_def in ["media_type TEXT", "media_url TEXT", "media_filename TEXT", "meta_message_id TEXT"]:
            try:
                cursor.execute(f"ALTER TABLE messages ADD COLUMN {col_def}")
            except Exception:
                pass
        
        # Bookings & Support Requests Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT NOT NULL,
                customer_name TEXT DEFAULT 'Customer',
                service_requested TEXT DEFAULT 'Customer Support / Appointment',
                booking_date_time TEXT DEFAULT 'Pending Schedule',
                status TEXT DEFAULT 'pending', -- 'confirmed', 'pending', 'cancelled', 'completed'
                notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Message Templates Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT DEFAULT 'General',
                content TEXT NOT NULL,
                shortcut TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Contact Settings (Bot enabled / disabled per user)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS contact_settings (
                phone_number TEXT PRIMARY KEY,
                bot_enabled INTEGER DEFAULT 1,
                assigned_agent TEXT DEFAULT 'Support Team',
                tags TEXT DEFAULT 'Customer',
                notes TEXT DEFAULT ''
            )
        """)

        # Meta Conversations Table (Official 24-hour conversation windows & pricing per contact)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS meta_conversations (
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
            )
        """)
        
        # Webhook Logs Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS webhook_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL,
                payload TEXT,
                status_code INTEGER DEFAULT 200,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Seed default support templates if empty
        cursor.execute("SELECT COUNT(*) as count FROM templates")
        if cursor.fetchone()["count"] == 0:
            default_templates = [
                ("👋 Welcome Greeting", "Greeting", "Hello {{name}}! 👋 Thank you for reaching out to printingtask Support. How can we assist you with your printing or orders today?", "/welcome"),
                ("📅 Booking Confirmation", "Bookings", "Hi {{name}}, your appointment/booking for {{service}} on {{date_time}} with printingtask is confirmed! Please let us know if you need to make changes.", "/confirm"),
                ("🖨️ Printing Quote Details", "Quotes", "Hi {{name}}, here is our estimate for your printingtask request:\n• Documents / Flyers / Banners / Visiting Cards\n• Custom finishing available\nWould you like us to proceed with printing?", "/quote"),
                ("📦 Order Ready for Pickup", "Orders", "Great news {{name}}! 🎉 Your printingtask order is ready for pickup or dispatched for delivery. Please share your Order ID at the counter.", "/ready"),
                ("💳 Payment Request", "Billing", "Hi {{name}}, you can complete your printingtask payment securely using this link: https://pay.example.com/invoice/{{phone}} . Let us know once completed!", "/pay"),
                ("⏳ Under Review by Specialist", "Support", "Hi {{name}}, your request has been escalated to our senior printingtask specialist. We are reviewing your files and will update you shortly.", "/review"),
                ("⭐ Feedback & CSAT Survey", "Feedback", "Hi {{name}}, how was your printingtask experience today? Please rate us from 1 (Poor) to 5 (Excellent) ⭐. Thank you!", "/feedback"),
                ("👤 Human Handover", "Handover", "A human customer support specialist from printingtask has joined this chat. One moment please while I connect you.", "/agent")
            ]
            cursor.executemany("INSERT INTO templates (title, category, content, shortcut) VALUES (?, ?, ?, ?)", default_templates)
        
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_phone ON messages(phone_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_created_at ON messages(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_phone_created ON messages(phone_number, created_at DESC)")
        
        conn.commit()
        conn.close()
        _DB_INITIALIZED = True
    except Exception as e:
        print(f"[DB] Error initializing database: {e}")

def save_message(phone_number: str, message: str, direction: str = "inbound", 
                 sender_name: str = "User", channel: str = "meta_whatsapp", 
                 status: str = "received", raw_payload: dict = None, 
                 ai_model: str = None, latency_ms: float = 0.0,
                 media_type: str = None, media_url: str = None, media_filename: str = None,
                 meta_message_id: str = None):
    """Save an incoming or outgoing message to the database, track booking intent, and renew 24h free window."""
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        
        payload_str = json.dumps(raw_payload) if isinstance(raw_payload, (dict, list)) else (raw_payload or "")
        
        # Try to infer Meta message ID if not provided
        if not meta_message_id and isinstance(raw_payload, dict):
            meta_message_id = raw_payload.get("id")
            if not meta_message_id and isinstance(raw_payload.get("messages"), list) and raw_payload["messages"]:
                meta_message_id = raw_payload["messages"][0].get("id")
            elif not meta_message_id and "meta_api_response" in raw_payload:
                try:
                    resp_data = json.loads(raw_payload["meta_api_response"])
                    if isinstance(resp_data.get("messages"), list) and resp_data["messages"]:
                        meta_message_id = resp_data["messages"][0].get("id")
                except Exception:
                    pass

        cursor.execute("""
            INSERT INTO messages (phone_number, sender_name, message, direction, channel, status, raw_payload, ai_model, latency_ms, media_type, media_url, media_filename, meta_message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (phone_number, sender_name, message, direction, channel, status, payload_str, ai_model, latency_ms, media_type, media_url, media_filename, meta_message_id))
        
        msg_id = cursor.lastrowid

        # Automatic 24-Hour Free Context Window Refresh on Inbound Messages
        if direction == "inbound":
            record_inbound_window_cursor(cursor, phone_number)
            if message:
                detect_and_record_booking(cursor, phone_number, sender_name, message)

        conn.commit()
        conn.close()
        return msg_id
    except Exception as e:
        print(f"[DB] Error saving message: {e}")
        return None

def record_inbound_window_cursor(cursor, phone_number: str):
    """Start or refresh the 24-hour customer service window for this contact in active transaction."""
    if not phone_number:
        return
    try:
        clean = str(phone_number).replace("+", "").strip()
        now_ts = int(time.time())
        exp_ts = now_ts + 86400  # 24 hours rolling window
        
        cursor.execute("SELECT id FROM meta_conversations WHERE REPLACE(phone_number, '+', '') = ?", (clean,))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute("""
                UPDATE meta_conversations
                SET last_inbound_time = CURRENT_TIMESTAMP,
                    expiration_timestamp = ?,
                    origin_type = 'service',
                    pricing_category = 'service',
                    is_billable = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (exp_ts, existing["id"]))
        else:
            cursor.execute("""
                INSERT INTO meta_conversations (phone_number, origin_type, pricing_category, is_billable, expiration_timestamp, last_inbound_time, window_opened_at, updated_at)
                VALUES (?, 'service', 'service', 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """, (phone_number, exp_ts))
    except Exception as e:
        print(f"[DB] Error recording inbound window (cursor): {e}")

def record_inbound_window(phone_number: str):
    """Start or refresh the 24-hour customer service window for this contact upon incoming message."""
    if not phone_number:
        return
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        record_inbound_window_cursor(cursor, phone_number)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB] Error recording inbound window: {e}")

def save_meta_conversation_status(phone_number: str, meta_conv_id: str, expiration_timestamp: int = None,
                                 origin_type: str = "service", pricing_category: str = "service",
                                 is_billable: int = 0):
    """Save authoritative 24-hour conversation status and pricing metadata from Meta webhook statuses."""
    if not phone_number:
        return False
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        clean = str(phone_number).replace("+", "").strip()
        
        cursor.execute("SELECT id FROM meta_conversations WHERE REPLACE(phone_number, '+', '') = ?", (clean,))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute("""
                UPDATE meta_conversations
                SET meta_conversation_id = COALESCE(?, meta_conversation_id),
                    expiration_timestamp = COALESCE(?, expiration_timestamp),
                    origin_type = COALESCE(?, origin_type),
                    pricing_category = COALESCE(?, pricing_category),
                    is_billable = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (meta_conv_id, expiration_timestamp, origin_type, pricing_category, is_billable, existing["id"]))
        else:
            cursor.execute("""
                INSERT INTO meta_conversations (phone_number, meta_conversation_id, origin_type, pricing_category, is_billable, expiration_timestamp, last_inbound_time, window_opened_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """, (phone_number, meta_conv_id, origin_type, pricing_category, is_billable, expiration_timestamp))
            
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[DB] Error saving meta conversation status: {e}")
        return False

def get_meta_conversation(phone_number: str):
    """Get active 24-hour conversation window state, remaining time, and Meta pricing category."""
    if not phone_number:
        return None
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        clean = str(phone_number).replace("+", "").strip()
        
        cursor.execute("""
            SELECT * FROM meta_conversations
            WHERE REPLACE(phone_number, '+', '') = ?
            ORDER BY id DESC LIMIT 1
        """, (clean,))
        row = cursor.fetchone()
        
        # Inbound message ground truth
        cursor.execute("""
            SELECT created_at FROM messages
            WHERE REPLACE(phone_number, '+', '') = ? AND direction = 'inbound'
            ORDER BY id DESC LIMIT 1
        """, (clean,))
        in_row = cursor.fetchone()
        conn.close()
        
        now_ts = int(time.time())
        now_utc = datetime.now(timezone.utc)
        
        exp_ts = None
        origin_type = "service"
        pricing_category = "service"
        is_billable = 0
        meta_conv_id = None
        last_in = in_row["created_at"] if in_row else None
        
        if row:
            exp_ts = row["expiration_timestamp"]
            origin_type = row["origin_type"] or "service"
            pricing_category = row["pricing_category"] or "service"
            is_billable = row["is_billable"] or 0
            meta_conv_id = row["meta_conversation_id"]
            if not last_in and row["last_inbound_time"]:
                last_in = row["last_inbound_time"]
                
        seconds_left = 0
        is_active = False
        
        if exp_ts and exp_ts > now_ts:
            seconds_left = int(exp_ts - now_ts)
            is_active = True
        elif last_in:
            try:
                dt_str = str(last_in).replace(" ", "T")
                if not dt_str.endswith("Z") and "+" not in dt_str:
                    dt_str += "Z"
                in_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                elapsed = (now_utc - in_dt).total_seconds()
                rem = 86400 - elapsed
                if rem > 0:
                    seconds_left = int(rem)
                    is_active = True
                    if not exp_ts:
                        exp_ts = int(in_dt.timestamp()) + 86400
            except Exception:
                pass
                
        return {
            "phone_number": phone_number,
            "meta_conversation_id": meta_conv_id,
            "origin_type": origin_type,
            "pricing_category": pricing_category,
            "is_billable": bool(is_billable),
            "is_free_window_active": is_active,
            "free_window_seconds_left": seconds_left,
            "expiration_timestamp": exp_ts,
            "last_inbound_time": last_in
        }
    except Exception as e:
        print(f"[DB] Error getting meta conversation: {e}")
        return None

def update_message_status_by_wamid(wamid: str, new_status: str):
    """Update message status (sent, delivered, read, failed) from Meta webhook status receipts."""
    if not wamid or not new_status:
        return False
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE messages
            SET status = ?
            WHERE meta_message_id = ? OR raw_payload LIKE ?
        """, (new_status, wamid, f"%{wamid}%"))
        updated = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return updated
    except Exception as e:
        print(f"[DB] Error updating message status by wamid: {e}")
        return False

def detect_and_record_booking(cursor, phone_number: str, customer_name: str, message: str):
    """Detect if incoming message has booking or order intent."""
    msg_lower = message.lower()
    booking_keywords = ["book", "booking", "appointment", "schedule", "reserve", "slot", "meeting", "consultation", "order", "print"]
    
    if any(k in msg_lower for k in booking_keywords):
        service = "Customer Support & Task Order"
        if "print" in msg_lower: service = "Printing Service Order"
        elif "consult" in msg_lower: service = "Customer Consultation"
        elif "order" in msg_lower: service = "Custom Order Request"
        elif "appointment" in msg_lower or "book" in msg_lower: service = "Scheduled Appointment"

        cursor.execute("""
            SELECT id FROM bookings 
            WHERE phone_number = ? AND created_at >= datetime('now', '-2 hours')
            LIMIT 1
        """, (phone_number,))
        existing = cursor.fetchone()
        
        if not existing:
            cursor.execute("""
                INSERT INTO bookings (phone_number, customer_name, service_requested, booking_date_time, status, notes)
                VALUES (?, ?, ?, ?, 'pending', ?)
            """, (phone_number, customer_name or "WhatsApp Customer", service, "Requested via WhatsApp", message))

def is_bot_enabled_for_contact(phone_number: str) -> bool:
    """Check if automated bot is enabled for this customer phone number."""
    if not phone_number:
        return True
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        clean = str(phone_number).replace("+", "").strip()
        cursor.execute("""
            SELECT bot_enabled FROM contact_settings 
            WHERE phone_number = ? 
               OR phone_number = ? 
               OR REPLACE(phone_number, '+', '') = ?
            LIMIT 1
        """, (phone_number, f"+{clean}", clean))
        row = cursor.fetchone()
        conn.close()
        if row is not None:
            return bool(row["bot_enabled"])
        return True # Default enabled
    except Exception as e:
        print(f"[DB] Error checking bot enabled: {e}")
        return True

def set_bot_enabled_for_contact(phone_number: str, enabled: bool):
    """Toggle automated bot for this customer."""
    if not phone_number:
        return False
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        clean = str(phone_number).replace("+", "").strip()
        val = 1 if enabled else 0
        
        # Save under raw, clean, and plus versions so lookup always hits
        keys = set([str(phone_number).strip(), clean, f"+{clean}"])
        for p in keys:
            if p:
                cursor.execute("""
                    INSERT INTO contact_settings (phone_number, bot_enabled)
                    VALUES (?, ?)
                    ON CONFLICT(phone_number) DO UPDATE SET bot_enabled = excluded.bot_enabled
                """, (p, val))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[DB] Error setting bot enabled: {e}")
        return False

def get_conversations():
    """Get list of distinct contact conversations with their latest message, Meta 24h window, and pricing category."""
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        
        query = """
            SELECT 
                m1.phone_number,
                COALESCE(
                    (SELECT m_in.sender_name FROM messages m_in WHERE REPLACE(m_in.phone_number, '+', '') = REPLACE(m1.phone_number, '+', '') AND m_in.direction = 'inbound' ORDER BY m_in.id DESC LIMIT 1),
                    m1.sender_name,
                    'Customer'
                ) as sender_name,
                COALESCE(
                    NULLIF(m1.message, ''),
                    CASE 
                        WHEN m1.media_type = 'image' THEN '📷 Photo'
                        WHEN m1.media_type = 'document' THEN '📄 ' || COALESCE(m1.media_filename, 'Document')
                        ELSE 'Attachment'
                    END
                ) as last_message,
                m1.media_type as last_media_type,
                m1.direction as last_direction,
                m1.channel as last_channel,
                m1.created_at as last_time,
                (SELECT m_in2.created_at FROM messages m_in2 WHERE REPLACE(m_in2.phone_number, '+', '') = REPLACE(m1.phone_number, '+', '') AND m_in2.direction = 'inbound' ORDER BY m_in2.id DESC LIMIT 1) as last_inbound_time,
                (SELECT COUNT(*) FROM messages m2 WHERE REPLACE(m2.phone_number, '+', '') = REPLACE(m1.phone_number, '+', '')) as total_messages,
                (SELECT COUNT(*) FROM messages m3 WHERE REPLACE(m3.phone_number, '+', '') = REPLACE(m1.phone_number, '+', '') AND m3.direction = 'inbound') as inbound_count,
                COALESCE((SELECT cs.bot_enabled FROM contact_settings cs WHERE REPLACE(cs.phone_number, '+', '') = REPLACE(m1.phone_number, '+', '') LIMIT 1), 1) as bot_enabled,
                mc.meta_conversation_id,
                mc.expiration_timestamp as meta_expiration_timestamp,
                mc.origin_type,
                mc.pricing_category,
                mc.is_billable
            FROM messages m1
            LEFT JOIN meta_conversations mc ON REPLACE(mc.phone_number, '+', '') = REPLACE(m1.phone_number, '+', '')
            WHERE m1.id IN (
                SELECT MAX(id) FROM messages GROUP BY REPLACE(phone_number, '+', '')
            )
            ORDER BY m1.created_at DESC
        """
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()

        now_ts = int(time.time())
        now_utc = datetime.now(timezone.utc)
        results = []
        for r in rows:
            c = dict(r)
            meta_exp = c.get("meta_expiration_timestamp")
            last_in = c.get("last_inbound_time")

            is_active = False
            seconds_left = 0

            # 1. Authoritative Meta webhook expiration timestamp if present and future
            if meta_exp and meta_exp > now_ts:
                is_active = True
                seconds_left = int(meta_exp - now_ts)
            elif last_in:
                # 2. Ground-truth fallback: 24h from latest inbound customer message
                try:
                    dt_str = str(last_in).replace(" ", "T")
                    if not dt_str.endswith("Z") and "+" not in dt_str:
                        dt_str += "Z"
                    in_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                    elapsed = (now_utc - in_dt).total_seconds()
                    remaining = 86400 - elapsed
                    if remaining > 0:
                        is_active = True
                        seconds_left = int(remaining)
                except Exception:
                    pass

            c["is_free_window_active"] = is_active
            c["free_window_seconds_left"] = seconds_left
            c["pricing_category"] = c.get("pricing_category") or "service"
            c["origin_type"] = c.get("origin_type") or "service"
            c["is_billable"] = bool(c.get("is_billable", 0))
            results.append(c)
        return results
    except Exception as e:
        print(f"[DB] Error getting conversations: {e}")
        return []

def get_messages(phone_number: str = None, limit: int = 500):
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        
        if phone_number:
            clean = str(phone_number).replace("+", "").strip()
            cursor.execute("""
                SELECT * FROM messages 
                WHERE phone_number = ? 
                   OR phone_number = ? 
                   OR REPLACE(phone_number, '+', '') = ?
                ORDER BY created_at ASC, id ASC 
                LIMIT ?
            """, (phone_number, f"+{clean}", clean, limit))
        else:
            cursor.execute("""
                SELECT * FROM messages 
                ORDER BY created_at DESC, id DESC 
                LIMIT ?
            """, (limit,))
            
        rows = cursor.fetchall()
        conn.close()
        msg_list = [dict(row) for row in rows]

        # Highlight the latest inbound customer message that refreshed the 24h free context window
        if phone_number and msg_list:
            latest_inbound_id = None
            for m in reversed(msg_list):
                if m.get("direction") == "inbound":
                    latest_inbound_id = m.get("id")
                    break
            for m in msg_list:
                m["is_latest_inbound"] = (m.get("id") == latest_inbound_id)

        return msg_list
    except Exception as e:
        print(f"[DB] Error getting messages: {e}")
        return []
    except Exception as e:
        print(f"[DB] Error getting messages: {e}")
        return []

def get_templates():
    """Get all response templates."""
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM templates ORDER BY id ASC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        print(f"[DB] Error getting templates: {e}")
        return []

def save_template(title: str, category: str, content: str, shortcut: str = ""):
    """Save a new custom message template."""
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO templates (title, category, content, shortcut) VALUES (?, ?, ?, ?)", (title, category, content, shortcut))
        t_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return t_id
    except Exception as e:
        print(f"[DB] Error saving template: {e}")
        return None

def delete_template(template_id: int):
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM templates WHERE id = ?", (template_id,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        return False

def get_bookings():
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bookings ORDER BY created_at DESC LIMIT 100")
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        return []

def update_booking_status(booking_id: int, status: str):
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE bookings SET status = ? WHERE id = ?", (status, booking_id))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

def add_manual_booking(phone_number: str, customer_name: str, service: str, date_time: str, status: str = "confirmed", notes: str = ""):
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO bookings (phone_number, customer_name, service_requested, booking_date_time, status, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (phone_number, customer_name, service, date_time, status, notes))
        conn.commit()
        booking_id = cursor.lastrowid
        conn.close()
        return booking_id
    except Exception:
        return None

def get_stats():
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) as total FROM messages")
        total_messages = cursor.fetchone()["total"]
        
        cursor.execute("SELECT COUNT(DISTINCT phone_number) as contacts FROM messages")
        total_contacts = cursor.fetchone()["contacts"]
        
        cursor.execute("SELECT COUNT(*) as inbound FROM messages WHERE direction = 'inbound'")
        inbound_messages = cursor.fetchone()["inbound"]
        
        cursor.execute("SELECT COUNT(*) as outbound FROM messages WHERE direction = 'outbound'")
        outbound_messages = cursor.fetchone()["outbound"]
        
        cursor.execute("SELECT AVG(latency_ms) as avg_latency FROM messages WHERE latency_ms > 0")
        avg_row = cursor.fetchone()
        avg_latency = round(avg_row["avg_latency"] or 0, 2) if avg_row else 0
        
        cursor.execute("SELECT COUNT(*) as count FROM webhook_logs")
        total_webhooks = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM bookings")
        total_bookings = cursor.fetchone()["count"]
        
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        cursor.execute("SELECT COUNT(*) as today_total FROM messages WHERE created_at LIKE ?", (f"{today_str}%",))
        today_messages = cursor.fetchone()["today_total"]

        # Active 24-hour Free Customer Service Windows (Eligible for ₹0 promotional messaging)
        cursor.execute("""
            SELECT COUNT(DISTINCT REPLACE(phone_number, '+', '')) as active_windows
            FROM messages
            WHERE direction = 'inbound'
              AND created_at >= datetime('now', '-24 hours')
        """)
        active_free_windows = cursor.fetchone()["active_windows"]
        
        conn.close()
        return {
            "total_messages": total_messages,
            "total_contacts": total_contacts,
            "inbound_messages": inbound_messages,
            "outbound_messages": outbound_messages,
            "avg_latency_ms": avg_latency,
            "total_webhooks": total_webhooks,
            "total_bookings": total_bookings,
            "today_messages": today_messages,
            "active_free_windows": active_free_windows
        }
    except Exception as e:
        return {
            "total_messages": 0, "total_contacts": 0, "inbound_messages": 0, "outbound_messages": 0,
            "avg_latency_ms": 0, "total_webhooks": 0, "total_bookings": 0, "today_messages": 0,
            "active_free_windows": 0
        }

def save_webhook_log(endpoint: str, method: str, payload: any = None, status_code: int = 200, ip_address: str = ""):
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        payload_str = json.dumps(payload) if isinstance(payload, (dict, list)) else str(payload or "")
        cursor.execute("INSERT INTO webhook_logs (endpoint, method, payload, status_code, ip_address) VALUES (?, ?, ?, ?, ?)", 
                       (endpoint, method, payload_str, status_code, ip_address))
        conn.commit()
        conn.close()
    except Exception:
        pass

def get_webhook_logs(limit: int = 50):
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM webhook_logs ORDER BY created_at DESC, id DESC LIMIT ?", (limit,))
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception:
        return []

def clear_data():
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages")
        cursor.execute("DELETE FROM bookings")
        cursor.execute("DELETE FROM webhook_logs")
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

def delete_messages(message_ids: list):
    """Delete one or multiple messages by their IDs."""
    if not message_ids:
        return False
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        ids = [int(i) for i in message_ids if str(i).isdigit()]
        if not ids:
            return False
        placeholders = ",".join("?" for _ in ids)
        cursor.execute(f"DELETE FROM messages WHERE id IN ({placeholders})", ids)
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[DB] Error deleting messages: {e}")
        return False

def delete_contact(phone_number: str):
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        clean = str(phone_number).replace("+", "").strip()
        cursor.execute("""
            DELETE FROM messages 
            WHERE phone_number = ? 
               OR phone_number = ? 
               OR REPLACE(phone_number, '+', '') = ?
        """, (phone_number, f"+{clean}", clean))
        cursor.execute("""
            DELETE FROM bookings 
            WHERE phone_number = ? 
               OR phone_number = ? 
               OR REPLACE(phone_number, '+', '') = ?
        """, (phone_number, f"+{clean}", clean))
        cursor.execute("""
            DELETE FROM contact_settings 
            WHERE phone_number = ? 
               OR phone_number = ? 
               OR REPLACE(phone_number, '+', '') = ?
        """, (phone_number, f"+{clean}", clean))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[DB] Error deleting contact: {e}")
        return False

def get_contact_profile(phone_number: str):
    """Retrieve full customer profile, 24h window status, statistics, exchanged media, and bookings."""
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        clean = str(phone_number).replace("+", "").strip()

        # 1. Contact Settings
        cursor.execute("""
            SELECT * FROM contact_settings 
            WHERE phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?
            LIMIT 1
        """, (phone_number, f"+{clean}", clean))
        cs_row = cursor.fetchone()
        cs = dict(cs_row) if cs_row else {"bot_enabled": 1, "tags": "Customer", "notes": "", "assigned_agent": "Support Team"}

        # 2. Latest Name and Channel from messages
        cursor.execute("""
            SELECT sender_name, channel, created_at, direction 
            FROM messages 
            WHERE phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?
            ORDER BY id DESC LIMIT 1
        """, (phone_number, f"+{clean}", clean))
        latest_msg = cursor.fetchone()

        # Inbound name preferred
        cursor.execute("""
            SELECT sender_name FROM messages 
            WHERE (phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?) 
              AND direction = 'inbound' 
            ORDER BY id DESC LIMIT 1
        """, (phone_number, f"+{clean}", clean))
        in_name = cursor.fetchone()

        # 3. Message Stats
        cursor.execute("""
            SELECT 
                COUNT(*) as total_messages,
                SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) as inbound_messages,
                SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) as outbound_messages,
                MIN(created_at) as first_seen,
                MAX(created_at) as last_seen
            FROM messages 
            WHERE phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?
        """, (phone_number, f"+{clean}", clean))
        stats_row = cursor.fetchone()
        stats = dict(stats_row) if stats_row else {}

        # 4. Last Inbound & Meta 24h Free Context Window
        cursor.execute("""
            SELECT created_at FROM messages 
            WHERE (phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?) 
              AND direction = 'inbound' 
            ORDER BY id DESC LIMIT 1
        """, (phone_number, f"+{clean}", clean))
        last_in_row = cursor.fetchone()
        last_in = last_in_row["created_at"] if last_in_row else None

        cursor.execute("""
            SELECT * FROM meta_conversations 
            WHERE REPLACE(phone_number, '+', '') = ?
            ORDER BY id DESC LIMIT 1
        """, (clean,))
        meta_row = cursor.fetchone()
        meta_dict = dict(meta_row) if meta_row else None

        now_ts = int(time.time())
        now_utc = datetime.now(timezone.utc)
        is_free_active = False
        seconds_left = 0

        if meta_dict and meta_dict.get("expiration_timestamp") and meta_dict["expiration_timestamp"] > now_ts:
            is_free_active = True
            seconds_left = int(meta_dict["expiration_timestamp"] - now_ts)
        elif last_in:
            try:
                dt_str = str(last_in).replace(" ", "T")
                if not dt_str.endswith("Z") and "+" not in dt_str:
                    dt_str += "Z"
                in_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                elapsed = (now_utc - in_dt).total_seconds()
                rem = 86400 - elapsed
                if rem > 0:
                    is_free_active = True
                    seconds_left = int(rem)
            except Exception:
                pass

        # 5. Media attachments
        cursor.execute("""
            SELECT id, media_type, media_url, media_filename, direction, created_at 
            FROM messages 
            WHERE (phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?) 
              AND media_url IS NOT NULL AND media_url != ''
            ORDER BY id DESC LIMIT 30
        """, (phone_number, f"+{clean}", clean))
        media_rows = cursor.fetchall()
        media_list = [dict(m) for m in media_rows]

        # 6. Bookings
        cursor.execute("""
            SELECT * FROM bookings 
            WHERE phone_number = ? OR phone_number = ? OR REPLACE(phone_number, '+', '') = ?
            ORDER BY id DESC
        """, (phone_number, f"+{clean}", clean))
        booking_rows = cursor.fetchall()
        bookings_list = [dict(b) for b in booking_rows]

        conn.close()

        sender_name = (in_name["sender_name"] if in_name and in_name["sender_name"] else (latest_msg["sender_name"] if latest_msg else "Customer")) or "Customer"
        channel = (latest_msg["channel"] if latest_msg else "meta_whatsapp") or "meta_whatsapp"

        return {
            "phone_number": phone_number,
            "sender_name": sender_name,
            "channel": channel,
            "bot_enabled": cs.get("bot_enabled", 1) != 0,
            "tags": cs.get("tags") or "Customer",
            "notes": cs.get("notes") or "",
            "assigned_agent": cs.get("assigned_agent") or "Support Team",
            "is_free_window_active": is_free_active,
            "free_window_seconds_left": seconds_left,
            "last_inbound_time": last_in,
            "meta_conversation": {
                "id": meta_dict.get("meta_conversation_id") if meta_dict else None,
                "origin_type": (meta_dict.get("origin_type") if meta_dict else "service") or "service",
                "pricing_category": (meta_dict.get("pricing_category") if meta_dict else "service") or "service",
                "is_billable": bool(meta_dict.get("is_billable", 0)) if meta_dict else False,
                "expiration_timestamp": meta_dict.get("expiration_timestamp") if meta_dict else None,
                "is_free_window_active": is_free_active,
                "free_window_seconds_left": seconds_left
            },
            "stats": stats,
            "media": media_list,
            "bookings": bookings_list
        }
    except Exception as e:
        print(f"[DB] Error getting contact profile: {e}")
        return None

def update_contact_profile(phone_number: str, notes: str = None, tags: str = None, assigned_agent: str = None):
    """Update contact tags, notes, and assigned support agent."""
    try:
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        clean = str(phone_number).replace("+", "").strip()

        cursor.execute("SELECT * FROM contact_settings WHERE REPLACE(phone_number, '+', '') = ?", (clean,))
        row = cursor.fetchone()
        if row:
            updates = []
            vals = []
            if notes is not None:
                updates.append("notes = ?")
                vals.append(notes)
            if tags is not None:
                updates.append("tags = ?")
                vals.append(tags)
            if assigned_agent is not None:
                updates.append("assigned_agent = ?")
                vals.append(assigned_agent)
            if updates:
                vals.append(row["phone_number"])
                cursor.execute(f"UPDATE contact_settings SET {', '.join(updates)} WHERE phone_number = ?", vals)
        else:
            cursor.execute("""
                INSERT INTO contact_settings (phone_number, bot_enabled, assigned_agent, tags, notes)
                VALUES (?, 1, ?, ?, ?)
            """, (phone_number, assigned_agent or "Support Team", tags or "Customer", notes or ""))

        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[DB] Error updating contact profile: {e}")
        return False
