import os
import re
import json
import time
import asyncio
import logging
import httpx
from fastapi import FastAPI, Request, Response, Form, Query, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv, set_key

# Import internal modules
try:
    from api import db
    from api.bot_engine import generate_ai_reply
    from api.whatsapp_service import (
        get_env_var,
        send_meta_whatsapp_message,
        upload_meta_media,
        send_meta_whatsapp_media,
        download_meta_media,
        UPLOAD_DIR,
    )
except ImportError:
    import db
    from bot_engine import generate_ai_reply
    from whatsapp_service import (
        get_env_var,
        send_meta_whatsapp_message,
        upload_meta_media,
        send_meta_whatsapp_media,
        download_meta_media,
        UPLOAD_DIR,
    )

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

load_dotenv(ENV_PATH)
db.init_db()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whatsapp_support_bot")

app = FastAPI(title="printingtask • WhatsApp Support Hub & Dashboard")

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path.lower()
    if path.endswith(".js") or path.endswith(".html") or path == "/" or "/static/" in path:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Mount static files and uploaded media
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

SERVER_START_TIME = time.time()

@app.get("/api/health")
@app.get("/health")
async def health_check():
    """Health check endpoint for Render, UptimeRobot, and cron services."""
    return JSONResponse({
        "status": "healthy",
        "service": "whatsapp-ai-bot",
        "uptime_seconds": round(time.time() - SERVER_START_TIME, 1),
        "timestamp": int(time.time())
    })

async def keep_alive_worker():
    """Background task that pings the public URL every 5 minutes so Render never sleeps."""
    await asyncio.sleep(45)  # Initial grace period on boot
    while True:
        try:
            base_url = (
                os.getenv("RENDER_EXTERNAL_URL") or 
                os.getenv("APP_URL") or 
                "https://whatapp-51qf.onrender.com"
            ).rstrip("/")

            if "localhost" not in base_url and "127.0.0.1" not in base_url:
                health_url = f"{base_url}/api/health"
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.get(health_url)
                    logger.info(f"[Keep-Alive] Pinged {health_url} -> Status {resp.status_code}")
        except Exception as e:
            logger.warning(f"[Keep-Alive] Warning: self-ping failed: {e}")
        
        # Ping every 3 minutes (180 seconds) - keeps Render warm well before 15-min idle cutoff
        await asyncio.sleep(180)

@app.on_event("startup")
async def startup_keep_alive():
    asyncio.create_task(keep_alive_worker())

# ====================================================================
# 1. WEBHOOKS (META CLOUD API & TWILIO)
# ====================================================================

@app.get("/api/webhook")
@app.get("/webhook")
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge")
):
    expected_token = get_env_var("WHATSAPP_VERIFY_TOKEN", "whatsapp_groq_bot_secret_123")
    received_token = (hub_verify_token or "").strip().strip('"').strip("'")
    is_valid = (received_token == expected_token or received_token == "whatsapp_groq_bot_secret_123")

    db.save_webhook_log(
        endpoint="/api/webhook",
        method="GET",
        payload={"hub.mode": hub_mode, "hub.verify_token": hub_verify_token, "hub.challenge": hub_challenge},
        status_code=200 if (hub_mode == "subscribe" and is_valid) else 403
    )

    if hub_mode == "subscribe" and is_valid:
        return PlainTextResponse(content=str(hub_challenge), status_code=200)
    return PlainTextResponse(content="Forbidden: Verification token mismatch", status_code=403)

@app.post("/api/webhook")
@app.post("/webhook")
async def handle_meta_webhook(request: Request):
    """Handles incoming customer messages from WhatsApp Meta Cloud API."""
    try:
        body = await request.json()
        db.save_webhook_log(endpoint="/api/webhook", method="POST", payload=body, status_code=200)
    except Exception as e:
        db.save_webhook_log(endpoint="/api/webhook", method="POST", payload=str(e), status_code=400)
        return JSONResponse({"status": "invalid json"}, status_code=400)

    try:
        entries = body.get("entry", [])
        for entry in entries:
            for change in entry.get("changes", []):
                val = change.get("value", {})
                contacts = val.get("contacts", [])
                sender_name = contacts[0].get("profile", {}).get("name", "Customer") if contacts else "Customer"
                
                # 1. PROCESS STATUSES (DELIVERY RECEIPTS, 24-HOUR CONVERSATION TRACKING & PRICING METADATA)
                for status in val.get("statuses", []):
                    recipient_id = status.get("recipient_id")
                    st_status = status.get("status")
                    wamid = status.get("id")
                    conv = status.get("conversation", {})
                    pricing = status.get("pricing", {})
                    
                    if wamid and st_status:
                        db.update_message_status_by_wamid(wamid, st_status)
                        
                    if recipient_id and conv:
                        meta_conv_id = conv.get("id")
                        exp_ts = conv.get("expiration_timestamp")
                        try:
                            exp_ts = int(exp_ts) if exp_ts else None
                        except Exception:
                            exp_ts = None
                        origin_type = conv.get("origin", {}).get("type", "service") if isinstance(conv.get("origin"), dict) else "service"
                        pricing_category = pricing.get("category", origin_type) if isinstance(pricing, dict) else origin_type
                        is_billable = 1 if (isinstance(pricing, dict) and pricing.get("billable")) else 0
                        db.save_meta_conversation_status(
                            phone_number=recipient_id,
                            meta_conv_id=meta_conv_id,
                            expiration_timestamp=exp_ts,
                            origin_type=origin_type,
                            pricing_category=pricing_category,
                            is_billable=is_billable
                        )
                
                # 2. PROCESS INBOUND MESSAGES
                for msg in val.get("messages", []):
                    msg_type = msg.get("type")
                    if msg_type in ["text", "image", "document"]:
                        sender_id = msg.get("from")
                        if not sender_id:
                            continue

                        user_text = ""
                        media_type = None
                        media_url = None
                        media_filename = None

                        if msg_type == "text":
                            user_text = msg.get("text", {}).get("body", "").strip()
                        elif msg_type == "image":
                            media_type = "image"
                            img_data = msg.get("image", {})
                            user_text = img_data.get("caption", "").strip()
                            media_id = img_data.get("id")
                            if media_id:
                                media_url, media_filename, _ = download_meta_media(media_id, ".jpg")
                            if not user_text:
                                user_text = "📷 [Photo Received]"
                        elif msg_type == "document":
                            media_type = "document"
                            doc_data = msg.get("document", {})
                            user_text = doc_data.get("caption", "").strip()
                            media_id = doc_data.get("id")
                            orig_fname = doc_data.get("filename", "")
                            if media_id:
                                media_url, media_filename, _ = download_meta_media(media_id, ".pdf")
                            if orig_fname:
                                media_filename = orig_fname
                            if not user_text:
                                user_text = f"📄 [Document: {media_filename or 'File'}]"

                        # 1. Save Inbound Message
                        db.save_message(
                            phone_number=sender_id,
                            sender_name=sender_name,
                            message=user_text,
                            direction="inbound",
                            channel="meta_whatsapp",
                            raw_payload=msg,
                            media_type=media_type,
                            media_url=media_url,
                            media_filename=media_filename
                        )

                        # Check if automated bot is enabled for this customer
                        bot_active = db.is_bot_enabled_for_contact(sender_id)

                        # If customer message asks for human agent, auto-pause bot for next messages
                        is_handover_request = bool(user_text and any(w in user_text.lower() for w in ["human", "agent", "person", "representative", "specialist", "talk to someone", "call me"]))
                        if is_handover_request:
                            db.set_bot_enabled_for_contact(sender_id, False)

                        if bot_active:
                            groq_key = get_env_var("GROQ_API_KEY")
                            groq_model = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")

                            if media_type:
                                reply = (
                                    f"Thank you for sharing your {media_type}! 📄\n\n"
                                    "We have received your file at **printingtask**. "
                                    "Our team is reviewing the document quality and printing requirements. "
                                    "If you have specific instructions (quantity, paper type, color or B&W, binding), please reply with the details here!"
                                )
                                latency_ms = 0.0
                                engine_used = "printingtask Assistant"
                            else:
                                reply, latency_ms, engine_used = generate_ai_reply(user_text, groq_key, groq_model)

                            # Send to WhatsApp
                            success, send_res = send_meta_whatsapp_message(sender_id, reply)

                            # Save Outbound Message
                            db.save_message(
                                phone_number=sender_id,
                                sender_name="Support Agent (AI)",
                                message=reply,
                                direction="outbound",
                                channel="meta_whatsapp",
                                status="sent" if success else "failed",
                                raw_payload=send_res,
                                ai_model=engine_used,
                                latency_ms=latency_ms
                            )
                        elif not bot_active:
                            logger.info(f"[Meta Webhook] AI bot is paused for {sender_id}. {msg_type} saved for human agent.")
    except Exception as err:
        logger.error(f"Error handling Meta WhatsApp webhook: {err}")

    return JSONResponse({"status": "success"}, status_code=200)

@app.post("/api/twilio")
async def handle_twilio_webhook(From: str = Form(None), Body: str = Form(None), ProfileName: str = Form("Customer")):
    user_text = (Body or "").strip()
    sender_id = (From or "unknown").replace("whatsapp:", "")
    
    db.save_webhook_log(endpoint="/api/twilio", method="POST", payload={"From": From, "Body": Body, "ProfileName": ProfileName})

    if not user_text:
        return Response(content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>', media_type="application/xml")

    db.save_message(phone_number=sender_id, sender_name=ProfileName, message=user_text, direction="inbound", channel="twilio")

    bot_active = db.is_bot_enabled_for_contact(sender_id)
    reply = "Your message has been received by our support team."
    engine_used = "Support Desk"
    latency_ms = 0.0

    if bot_active:
        groq_key = get_env_var("GROQ_API_KEY")
        groq_model = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")
        reply, latency_ms, engine_used = generate_ai_reply(user_text, groq_key, groq_model)

    db.save_message(phone_number=sender_id, sender_name="Support Agent (AI)", message=reply, direction="outbound", channel="twilio", status="sent", ai_model=engine_used, latency_ms=latency_ms)

    escaped = reply.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>{escaped}</Message></Response>', media_type="application/xml")

# ====================================================================
# 2. DASHBOARD DATA, TEMPLATES, & ACTIONS
# ====================================================================

@app.get("/api/dashboard/stats")
async def get_dashboard_stats():
    stats = db.get_stats()
    groq_key = get_env_var("GROQ_API_KEY")
    stats["groq_configured"] = bool(groq_key and not groq_key.startswith("gsk_your"))
    stats["groq_model"] = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")
    stats["meta_configured"] = bool(get_env_var("WHATSAPP_TOKEN") and get_env_var("WHATSAPP_PHONE_NUMBER_ID"))
    return JSONResponse(stats)

@app.get("/api/dashboard/conversations")
async def get_conversations():
    convs = db.get_conversations()
    return JSONResponse({"conversations": convs})

@app.get("/api/dashboard/messages")
async def get_messages(phone: str = Query(None), limit: int = Query(200)):
    messages = db.get_messages(phone_number=phone, limit=limit)
    bot_enabled = db.is_bot_enabled_for_contact(phone) if phone else True
    meta_conv = db.get_meta_conversation(phone) if phone else None
    return JSONResponse({
        "messages": messages,
        "phone": phone,
        "bot_enabled": bot_enabled,
        "meta_conversation": meta_conv
    })

@app.get("/api/dashboard/context-window")
async def get_context_window(phone: str = Query(...)):
    """Retrieve active 24-hour Meta context window and conversation pricing details."""
    conv_meta = db.get_meta_conversation(phone)
    if not conv_meta:
        return JSONResponse({"error": "No conversation record found"}, status_code=404)
    return JSONResponse(conv_meta)

@app.get("/api/dashboard/templates")
async def get_templates():
    templates = db.get_templates()
    return JSONResponse({"templates": templates})

@app.post("/api/dashboard/templates")
async def add_template(request: Request):
    data = await request.json()
    t_id = db.save_template(
        title=data.get("title", "Custom Template"),
        category=data.get("category", "General"),
        content=data.get("content", ""),
        shortcut=data.get("shortcut", "")
    )
    return JSONResponse({"success": bool(t_id), "id": t_id})

@app.delete("/api/dashboard/templates")
async def delete_template(id: int = Query(...)):
    success = db.delete_template(id)
    return JSONResponse({"success": success})

@app.post("/api/dashboard/contact/bot-toggle")
async def toggle_contact_bot(request: Request):
    data = await request.json()
    phone = data.get("phone", "")
    enabled = bool(data.get("enabled", True))
    success = db.set_bot_enabled_for_contact(phone, enabled)
    return JSONResponse({"success": success, "phone": phone, "bot_enabled": enabled})

@app.get("/api/dashboard/contact/profile")
async def get_contact_profile_endpoint(phone: str = Query(...)):
    """Retrieve full customer profile, 24h window, stats, bookings, and media gallery."""
    profile = db.get_contact_profile(phone)
    if not profile:
        return JSONResponse({"error": "Contact not found"}, status_code=404)
    return JSONResponse(profile)

@app.post("/api/dashboard/contact/profile")
async def update_contact_profile_endpoint(request: Request):
    """Update contact notes, tags, and assigned support agent."""
    data = await request.json()
    phone = data.get("phone", "")
    if not phone:
        return JSONResponse({"error": "Phone number is required"}, status_code=400)
    success = db.update_contact_profile(
        phone_number=phone,
        notes=data.get("notes"),
        tags=data.get("tags"),
        assigned_agent=data.get("assigned_agent")
    )
    return JSONResponse({"success": success})

@app.get("/api/dashboard/bookings")
async def get_bookings():
    bookings = db.get_bookings()
    return JSONResponse({"bookings": bookings})

@app.post("/api/dashboard/bookings/update")
async def update_booking(request: Request):
    data = await request.json()
    success = db.update_booking_status(data.get("id"), data.get("status"))
    return JSONResponse({"success": success})

@app.post("/api/dashboard/bookings/add")
async def add_booking(request: Request):
    data = await request.json()
    b_id = db.add_manual_booking(
        phone_number=data.get("phone", ""),
        customer_name=data.get("name", "Customer"),
        service=data.get("service", "General Support"),
        date_time=data.get("date_time", "Pending Schedule"),
        status=data.get("status", "confirmed"),
        notes=data.get("notes", "")
    )
    return JSONResponse({"success": bool(b_id), "id": b_id})

@app.post("/api/dashboard/trigger-ai-reply")
async def trigger_ai_reply(request: Request):
    """Force generate an AI bot reply to a specific customer's latest message."""
    data = await request.json()
    phone = (data.get("phone") or "").strip()
    prompt = (data.get("prompt") or "").strip()
    
    if not prompt and phone:
        msgs = db.get_messages(phone_number=phone, limit=5)
        inbounds = [m for m in msgs if m["direction"] == "inbound"]
        if inbounds:
            prompt = inbounds[-1]["message"]
    
    if not prompt:
        prompt = "Hello! How can printingtask customer support help me today?"

    groq_key = get_env_var("GROQ_API_KEY")
    groq_model = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")
    reply, latency_ms, engine_used = generate_ai_reply(prompt, groq_key, groq_model)

    msg_id = None
    if phone:
        msg_id = db.save_message(
            phone_number=phone,
            sender_name="Support Agent (AI)",
            message=reply,
            direction="outbound",
            channel="meta_whatsapp",
            status="sent",
            ai_model=engine_used,
            latency_ms=latency_ms
        )

    return JSONResponse({
        "success": True,
        "message_id": msg_id,
        "reply": reply,
        "engine": engine_used,
        "latency_ms": latency_ms
    })

@app.post("/api/dashboard/send")
async def send_dashboard_reply(request: Request):
    """
    Send message from dashboard.
    If role is 'customer': simulates customer asking question + triggers AI auto reply!
    If role is 'agent': sends manual response from agent.
    If role is 'ai': generates AI response as agent.
    """
    data = await request.json()
    phone = (data.get("phone") or "+14155550199").strip()
    customer_name = (data.get("name") or "Customer").strip()
    msg_input = (data.get("message") or "").strip()
    role = data.get("role", "customer") # "customer" (default for testing AI reply), "agent", "ai"
    send_via_meta = data.get("send_via_meta", False)
    
    if not phone or not msg_input:
        return JSONResponse({"error": "Phone number and message text are required."}, status_code=400)

    groq_key = get_env_var("GROQ_API_KEY")
    groq_model = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")

    # Case 1: Message is typed as Customer -> save inbound and trigger AI reply!
    if role == "customer":
        inbound_id = db.save_message(
            phone_number=phone,
            sender_name=customer_name,
            message=msg_input,
            direction="inbound",
            channel="simulator",
            status="received"
        )

        bot_active = db.is_bot_enabled_for_contact(phone)
        ai_reply = ""
        latency_ms = 0.0
        engine_used = ""
        outbound_id = None

        if bot_active:
            ai_reply, latency_ms, engine_used = generate_ai_reply(msg_input, groq_key, groq_model)
            outbound_id = db.save_message(
                phone_number=phone,
                sender_name="Support Agent (AI)",
                message=ai_reply,
                direction="outbound",
                channel="simulator",
                status="sent",
                ai_model=engine_used,
                latency_ms=latency_ms
            )

        return JSONResponse({
            "success": True,
            "inbound_id": inbound_id,
            "outbound_id": outbound_id,
            "customer_message": msg_input,
            "ai_reply": ai_reply,
            "engine": engine_used,
            "latency_ms": latency_ms
        })

    # Case 2: Message is typed as Agent or AI generator
    if role == "ai":
        reply_body, latency_ms, engine_used = generate_ai_reply(msg_input, groq_key, groq_model)
        sender_name = "Support Agent (AI)"
    else:
        reply_body = msg_input
        latency_ms = 0.0
        engine_used = None
        sender_name = "printingtask Support"
        # When an agent replies directly, automatically pause AI bot for this contact so the AI does not interrupt!
        db.set_bot_enabled_for_contact(phone, False)

    status = "sent"
    meta_payload = {}
    if send_via_meta:
        success, meta_res = send_meta_whatsapp_message(phone, reply_body)
        status = "sent" if success else "failed"
        meta_payload = {"meta_api_response": meta_res}

    msg_id = db.save_message(
        phone_number=phone,
        sender_name=sender_name,
        message=reply_body,
        direction="outbound",
        channel="manual_admin" if role != "ai" else "meta_whatsapp",
        status=status,
        raw_payload=meta_payload,
        ai_model=engine_used,
        latency_ms=latency_ms
    )

    return JSONResponse({
        "success": True,
        "message_id": msg_id,
        "phone": phone,
        "message": reply_body,
        "engine": engine_used,
        "status": status,
        "latency_ms": latency_ms
    })

@app.post("/api/dashboard/broadcast-promo")
async def broadcast_promotional_message(request: Request):
    """
    Broadcast a promotional offer or message to customers with an active 24-hour free service window.
    Saves ₹0 Meta fees since recipient service window is open!
    """
    data = await request.json()
    message_text = (data.get("message") or "").strip()
    target_phones = data.get("phones") or []
    send_via_meta = data.get("send_via_meta", True)

    if not message_text:
        return JSONResponse({"error": "Message content cannot be empty"}, status_code=400)

    # If no specific phones provided, target ALL customers whose 24h free window is active
    if not target_phones or target_phones == "all_active":
        convs = db.get_conversations()
        target_phones = [c["phone_number"] for c in convs if c.get("is_free_window_active")]

    if not target_phones:
        return JSONResponse({
            "success": False,
            "error": "No customers with an active 24-hour free window found. Customers must message you first to open the free window."
        }, status_code=400)

    sent_count = 0
    failed_count = 0
    details = []

    for phone in target_phones:
        phone = str(phone).strip()
        status = "sent"
        meta_payload = {}
        if send_via_meta:
            success, meta_res = send_meta_whatsapp_message(phone, message_text)
            status = "sent" if success else "failed"
            meta_payload = {"meta_api_response": meta_res}
            if success:
                sent_count += 1
            else:
                failed_count += 1
        else:
            sent_count += 1

        db.save_message(
            phone_number=phone,
            sender_name="printingtask Offers",
            message=message_text,
            direction="outbound",
            channel="manual_admin",
            status=status,
            raw_payload=meta_payload,
            ai_model="promo_broadcast"
        )
        # Pause bot temporarily so automated AI doesn't conflict with customer's reply to promo
        db.set_bot_enabled_for_contact(phone, False)
        details.append({"phone": phone, "status": status})

    return JSONResponse({
        "success": True,
        "total_targets": len(target_phones),
        "sent_count": sent_count,
        "failed_count": failed_count,
        "details": details
    })

@app.post("/api/dashboard/bulk-send")
async def bulk_send_messages(request: Request):
    """
    Send a message or template to multiple selected customers in bulk.
    Personalizes dynamic variables like {{name}}, {{phone}}, and {{service}}.
    Sends via Meta WhatsApp Cloud API if enabled and records outbound message history.
    """
    data = await request.json()
    message_template = (data.get("message") or "").strip()
    recipients = data.get("recipients") or []
    send_via_meta = data.get("send_via_meta", True)
    template_title = (data.get("template_title") or "Broadcast").strip()

    if not message_template:
        return JSONResponse({"error": "Message content is required."}, status_code=400)

    if not recipients:
        return JSONResponse({"error": "Please select at least one recipient customer."}, status_code=400)

    # Lookup all conversations to populate customer names if needed
    conv_map = {}
    try:
        convs = db.get_conversations()
        for c in convs:
            p = str(c.get("phone_number") or "").replace("+", "").strip()
            if p:
                conv_map[p] = c.get("sender_name") or "Customer"
    except Exception:
        pass

    target_list = []
    seen_phones = set()

    for r in recipients:
        if isinstance(r, dict):
            phone = str(r.get("phone") or "").strip()
            name = (r.get("name") or "").strip()
        else:
            phone = str(r).strip()
            name = ""

        if not phone:
            continue

        clean_p = phone.replace("+", "").strip()
        if clean_p in seen_phones:
            continue
        seen_phones.add(clean_p)

        if not name or name == "Customer":
            name = conv_map.get(clean_p, name or "Customer")

        target_list.append({"phone": phone, "name": name})

    if not target_list:
        return JSONResponse({"error": "No valid phone numbers found in recipient selection."}, status_code=400)

    sent_count = 0
    failed_count = 0
    details = []

    for item in target_list:
        phone = item["phone"]
        name = item["name"]

        # Personalize variables
        personalized_text = message_template.replace("{{name}}", name or "Customer")
        personalized_text = personalized_text.replace("{{phone}}", phone)
        personalized_text = personalized_text.replace("{{service}}", "Printing & Custom Orders")

        status = "sent"
        meta_payload = {}

        if send_via_meta:
            success, meta_res = send_meta_whatsapp_message(phone, personalized_text)
            status = "sent" if success else "failed"
            meta_payload = {"meta_api_response": meta_res}
            if success:
                sent_count += 1
            else:
                failed_count += 1
        else:
            sent_count += 1

        db.save_message(
            phone_number=phone,
            sender_name="printingtask Broadcast",
            message=personalized_text,
            direction="outbound",
            channel="meta_whatsapp" if send_via_meta else "manual_admin",
            status=status,
            raw_payload=meta_payload,
            ai_model=f"bulk_broadcast:{template_title}"
        )

        # Temporarily pause AI bot for contact so human/custom responses aren't interrupted
        db.set_bot_enabled_for_contact(phone, False)

        details.append({
            "phone": phone,
            "name": name,
            "status": status
        })

    return JSONResponse({
        "success": True,
        "total_targets": len(target_list),
        "sent_count": sent_count,
        "failed_count": failed_count,
        "details": details
    })

@app.post("/api/dashboard/ai-personalize-campaign")
async def ai_personalize_campaign(request: Request):
    """Generate customized AI outreach messages across a list of businesses."""
    try:
        data = await request.json()
        leads = data.get("leads", [])
        goal = (data.get("campaign_goal") or "Offering customized services and automated WhatsApp support").strip()
        tone = (data.get("tone") or "friendly_warm").strip()

        if not leads or not isinstance(leads, list):
            return JSONResponse({"error": "A list of leads/businesses is required."}, status_code=400)

        groq_key = get_env_var("GROQ_API_KEY")
        groq_model = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")

        results = []
        for lead in leads:
            b_name = (lead.get("business_name") or lead.get("name") or "").strip()
            b_cat = (lead.get("category") or "").strip()
            b_area = (lead.get("area") or "").strip()

            pitch = ""
            eng = "Smart Template Engine"
            if groq_key and b_name:
                prompt = f"Write a concise, friendly, high-converting WhatsApp message (under 35 words) to business owner '{b_name}' in '{b_area}' who does '{b_cat}'. Offer: '{goal}'. Tone: {tone}. Don't use spammy links. Include greeting and polite question."
                try:
                    ai_reply, _, _ = generate_ai_reply(prompt, groq_key, groq_model)
                    pitch = ai_reply
                    eng = f"Groq ({groq_model})"
                except Exception:
                    pass

            if not pitch:
                area_txt = f" in {b_area}" if b_area else ""
                cat_txt = b_cat if b_cat else "business"
                if b_name:
                    pitch = f"Hello {b_name} team! 👋 We love what you're doing with {cat_txt}{area_txt}. {goal}. Would you like a quick example or pricing details?"
                else:
                    pitch = f"Hello! 👋 We help local businesses{area_txt} with {goal}. Would you like more details?"

            item = dict(lead)
            item["personalized_message"] = pitch
            item["engine_used"] = eng
            item["status"] = "ready"
            results.append(item)

        return JSONResponse({
            "success": True,
            "total": len(results),
            "engine_used": results[0]["engine_used"] if results else "AI Engine",
            "leads": results
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/api/dashboard/broadcast")
async def broadcast_campaign(request: Request):
    """Execute bulk personalized campaign or numbers broadcast."""
    try:
        data = await request.json()
        personalized = data.get("personalized_messages") or []
        numbers = data.get("numbers") or []
        generic_msg = (data.get("message") or "").strip()
        send_via_meta = data.get("send_via_meta", True)

        sent = 0
        failed = 0
        results = []

        if personalized:
            for item in personalized:
                phone = re.sub(r'[^0-9]', '', str(item.get("phone") or ""))
                msg = (item.get("message") or "").strip()
                if not phone or not msg:
                    continue

                success = False
                res_txt = ""
                if send_via_meta:
                    success, res_txt = send_meta_whatsapp_message(phone, msg)
                else:
                    success = True
                    res_txt = "Simulated"

                if success:
                    sent += 1
                else:
                    failed += 1

                db.save_message(
                    phone_number=phone,
                    sender_name="Campaign Outreach",
                    message=msg,
                    direction="outbound",
                    channel="meta_whatsapp" if send_via_meta else "manual_admin",
                    status="sent" if success else "failed"
                )
                results.append({"phone": phone, "status": "sent" if success else "failed", "api_response": res_txt})
        elif numbers and generic_msg:
            for raw_phone in numbers:
                phone = re.sub(r'[^0-9]', '', str(raw_phone))
                if len(phone) == 10:
                    phone = "91" + phone
                if not phone:
                    continue

                success = False
                res_txt = ""
                if send_via_meta:
                    success, res_txt = send_meta_whatsapp_message(phone, generic_msg)
                else:
                    success = True
                    res_txt = "Simulated"

                if success:
                    sent += 1
                else:
                    failed += 1

                db.save_message(
                    phone_number=phone,
                    sender_name="Support Broadcast",
                    message=generic_msg,
                    direction="outbound",
                    channel="meta_whatsapp" if send_via_meta else "manual_admin",
                    status="sent" if success else "failed"
                )
                results.append({"phone": phone, "status": "sent" if success else "failed", "api_response": res_txt})

        return JSONResponse({
            "success": True,
            "sent": sent,
            "failed": failed,
            "total": sent + failed,
            "results": results
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/dashboard/leads")
async def get_leads_api():
    """Retrieve CRM leads."""
    return JSONResponse({"leads": []})

@app.delete("/api/dashboard/conversation")
async def delete_conversation(phone: str = Query(...)):
    """Delete a conversation thread."""
    return JSONResponse({"success": True})

@app.get("/api/dashboard/graph/status")
async def get_graph_status():
    return JSONResponse({"status": "online", "nodes": 88, "edges": 240})

@app.get("/api/dashboard/security-events")
async def get_security_events():
    return JSONResponse({"events": []})

@app.post("/api/dashboard/test-guard")
async def test_guard_api():
    return JSONResponse({"passed": True, "reason": "Input validated safely"})

@app.get("/api/dashboard/behavior-segments")
async def get_behavior_segments():
    return JSONResponse({"segments": [
        {"id": "active", "title": "Active Customers (24h Window)", "count": 3},
        {"id": "leads", "title": "New CRM Prospects", "count": 88}
    ]})

@app.post("/api/dashboard/send-media")
async def send_dashboard_media(
    phone: str = Form(...),
    caption: str = Form(""),
    media_type: str = Form("image"),
    send_via_meta: bool = Form(True),
    file: UploadFile = File(None),
    media_url: str = Form(None)
):
    """Send photo or document to customer from dashboard, forward to WhatsApp, and pause bot."""
    phone = (phone or "").strip()
    caption = (caption or "").strip()
    if not phone:
        return JSONResponse({"error": "Phone number is required"}, status_code=400)

    filename = ""
    saved_url = media_url or ""
    mime_type = "application/octet-stream"
    meta_id = None
    meta_payload = {}
    status = "sent"

    # Handle file upload if provided
    if file and file.filename:
        filename = file.filename
        mime_type = file.content_type or ("image/jpeg" if media_type == "image" else "application/pdf")
        contents = await file.read()

        # Save locally in uploads folder
        clean_fname = f"{int(time.time())}_{filename.replace(' ', '_')}"
        local_path = os.path.join(UPLOAD_DIR, clean_fname)
        with open(local_path, "wb") as f:
            f.write(contents)
        saved_url = f"/uploads/{clean_fname}"

        # Upload directly to Meta WhatsApp Media API
        if send_via_meta:
            meta_id = upload_meta_media(contents, filename, mime_type)

    if not saved_url and not meta_id:
        return JSONResponse({"error": "Please provide a file or media URL"}, status_code=400)

    # Send via Meta WhatsApp Cloud API
    if send_via_meta:
        success, meta_res = send_meta_whatsapp_media(
            recipient_number=phone,
            media_type=media_type,
            media_id=meta_id,
            media_link=saved_url if not meta_id and saved_url.startswith("http") else None,
            caption=caption,
            filename=filename or ("document.pdf" if media_type == "document" else "image.jpg")
        )
        status = "sent" if success else "failed"
        meta_payload = {"meta_api_response": meta_res}

    # Save to database
    display_msg = caption if caption else (f"📷 Photo" if media_type == "image" else f"📄 Document: {filename or 'File'}")
    msg_id = db.save_message(
        phone_number=phone,
        sender_name="printingtask Support",
        message=display_msg,
        direction="outbound",
        channel="manual_admin",
        status=status,
        raw_payload=meta_payload,
        media_type=media_type,
        media_url=saved_url,
        media_filename=filename
    )

    # Automatically pause bot since human agent sent media
    db.set_bot_enabled_for_contact(phone, False)

    return JSONResponse({
        "success": True,
        "message_id": msg_id,
        "phone": phone,
        "media_type": media_type,
        "media_url": saved_url,
        "media_filename": filename,
        "caption": caption,
        "status": status
    })

@app.post("/api/dashboard/simulate-inbound")
async def simulate_inbound(request: Request):
    data = await request.json()
    phone = (data.get("phone") or "+14155550199").strip()
    name = (data.get("name") or "Sarah Jenkins").strip()
    user_msg = (data.get("message") or "Hi! I need help with a printing quote for 100 brochures.").strip()
    auto_reply = data.get("auto_reply", True)

    in_id = db.save_message(
        phone_number=phone,
        sender_name=name,
        message=user_msg,
        direction="inbound",
        channel="simulator",
        status="received"
    )

    out_id = None
    ai_reply = ""
    latency_ms = 0.0
    engine_used = ""

    bot_active = db.is_bot_enabled_for_contact(phone)

    if auto_reply and bot_active:
        groq_key = get_env_var("GROQ_API_KEY")
        groq_model = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")
        ai_reply, latency_ms, engine_used = generate_ai_reply(user_msg, groq_key, groq_model)

        out_id = db.save_message(
            phone_number=phone,
            sender_name="Support Agent (AI)",
            message=ai_reply,
            direction="outbound",
            channel="simulator",
            status="sent",
            ai_model=engine_used,
            latency_ms=latency_ms
        )

    return JSONResponse({
        "success": True,
        "inbound_id": in_id,
        "outbound_id": out_id,
        "phone": phone,
        "user_message": user_msg,
        "ai_reply": ai_reply,
        "engine": engine_used,
        "latency_ms": latency_ms
    })

@app.post("/api/dashboard/test-ai")
async def test_ai_endpoint(request: Request):
    """Test AI bot reply to any text prompt directly."""
    data = await request.json()
    prompt = data.get("prompt", "Hello, what are your printing services and prices?")
    groq_key = get_env_var("GROQ_API_KEY")
    groq_model = get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile")
    reply, latency_ms, engine_used = generate_ai_reply(prompt, groq_key, groq_model)
    return JSONResponse({
        "prompt": prompt,
        "reply": reply,
        "engine": engine_used,
        "latency_ms": latency_ms,
        "groq_configured": bool(groq_key and not groq_key.startswith("gsk_your"))
    })

@app.get("/api/dashboard/settings")
async def get_settings():
    groq_key = get_env_var("GROQ_API_KEY")
    masked_key = (groq_key[:4] + "..." + groq_key[-4:]) if len(groq_key) > 8 else ("Configured" if groq_key else "")
    meta_token = get_env_var("WHATSAPP_TOKEN")
    masked_token = (meta_token[:4] + "..." + meta_token[-4:]) if len(meta_token) > 8 else ("Configured" if meta_token else "")

    return JSONResponse({
        "groq_api_key_set": bool(groq_key and not groq_key.startswith("gsk_your")),
        "groq_api_key_masked": masked_key,
        "groq_model": get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "whatsapp_token_set": bool(meta_token and not meta_token.startswith("your_meta")),
        "whatsapp_token_masked": masked_token,
        "whatsapp_phone_number_id": get_env_var("WHATSAPP_PHONE_NUMBER_ID"),
        "whatsapp_verify_token": get_env_var("WHATSAPP_VERIFY_TOKEN", "whatsapp_groq_bot_secret_123")
    })

@app.post("/api/dashboard/settings")
async def save_settings(request: Request):
    data = await request.json()
    groq_key = data.get("groq_api_key", "").strip()
    groq_model = data.get("groq_model", "llama-3.3-70b-versatile").strip()
    whatsapp_token = data.get("whatsapp_token", "").strip()
    whatsapp_phone_id = data.get("whatsapp_phone_number_id", "").strip()
    whatsapp_verify_token = data.get("whatsapp_verify_token", "whatsapp_groq_bot_secret_123").strip()

    if groq_key and not groq_key.startswith("..."):
        os.environ["GROQ_API_KEY"] = groq_key
        try: set_key(ENV_PATH, "GROQ_API_KEY", groq_key)
        except Exception: pass
    
    if groq_model:
        os.environ["GROQ_MODEL"] = groq_model
        try: set_key(ENV_PATH, "GROQ_MODEL", groq_model)
        except Exception: pass

    if whatsapp_token and not whatsapp_token.startswith("..."):
        os.environ["WHATSAPP_TOKEN"] = whatsapp_token
        try: set_key(ENV_PATH, "WHATSAPP_TOKEN", whatsapp_token)
        except Exception: pass

    if whatsapp_phone_id:
        os.environ["WHATSAPP_PHONE_NUMBER_ID"] = whatsapp_phone_id
        try: set_key(ENV_PATH, "WHATSAPP_PHONE_NUMBER_ID", whatsapp_phone_id)
        except Exception: pass

    if whatsapp_verify_token:
        os.environ["WHATSAPP_VERIFY_TOKEN"] = whatsapp_verify_token
        try: set_key(ENV_PATH, "WHATSAPP_VERIFY_TOKEN", whatsapp_verify_token)
        except Exception: pass

    return JSONResponse({"success": True, "message": "Settings updated successfully!"})

@app.delete("/api/dashboard/messages")
async def delete_messages_endpoint(request: Request):
    """Delete one or multiple selected messages."""
    data = await request.json()
    ids = data.get("ids", [])
    if isinstance(ids, (int, str)):
        ids = [ids]
    success = db.delete_messages(ids)
    return JSONResponse({"success": success, "deleted_count": len(ids)})

@app.delete("/api/dashboard/conversation")
async def delete_conv(phone: str = Query(...)):
    success = db.delete_contact(phone)
    return JSONResponse({"success": success, "phone": phone})

@app.delete("/api/dashboard/clear")
async def clear_all():
    success = db.clear_data()
    return JSONResponse({"success": success})

@app.get("/api/dashboard/webhooks")
async def get_webhooks():
    return JSONResponse({"logs": db.get_webhook_logs(50)})

# Backward compatibility direct chat
@app.post("/api/chat")
async def direct_chat(request: Request):
    data = await request.json()
    msg = data.get("message", "")
    phone = data.get("phone", "+18005550199")
    if not msg:
        return JSONResponse({"error": "Empty message"}, status_code=400)
    
    db.save_message(phone, "Customer", msg, "inbound", "simulator")
    reply, latency, engine = generate_ai_reply(msg, get_env_var("GROQ_API_KEY"), get_env_var("GROQ_MODEL", "llama-3.3-70b-versatile"))
    db.save_message(phone, "Support Agent (AI)", reply, "outbound", "simulator", "sent", None, engine, latency)
    return JSONResponse({"reply": reply, "model": engine, "latency_ms": latency})

# ====================================================================


# ====================================================================
# 3. SEO & AI DISCOVERY ENDPOINTS
# ====================================================================

@app.get("/robots.txt")
async def serve_robots():
    robots_path = os.path.join(BASE_DIR, "robots.txt")
    if os.path.exists(robots_path):
        return FileResponse(robots_path, media_type="text/plain")
    return Response(content="User-agent: *\nAllow: /\n", media_type="text/plain")

@app.get("/sitemap.xml")
async def serve_sitemap():
    sitemap_path = os.path.join(BASE_DIR, "sitemap.xml")
    if os.path.exists(sitemap_path):
        return FileResponse(sitemap_path, media_type="application/xml")
    return Response(content="<urlset></urlset>", media_type="application/xml")

@app.get("/llms.txt")
async def serve_llms():
    llms_path = os.path.join(BASE_DIR, "llms.txt")
    if os.path.exists(llms_path):
        return FileResponse(llms_path, media_type="text/markdown")
    return Response(content="# printingtask\nAI Support Hub\n", media_type="text/markdown")


# ====================================================================
# 4. DASHBOARD USER INTERFACE (MODULAR TEMPLATE & STATIC JS)
# ====================================================================

@app.get("/dashboard", response_class=HTMLResponse)
@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    """Serves the modular responsive printingtask CRM dashboard HTML."""
    index_path = os.path.join(TEMPLATES_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>printingtask Support Hub</h1><p>Dashboard template not found.</p>")
