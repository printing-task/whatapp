"""
Centralised Agent Guardrails, Structured Intent Classifier,
Explicit Action Confirmation State Machine, Allowlisted Tool Execution,
and Immutable Audit Trail.
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from api import db


_CONFIRM_RE = re.compile(r"^\s*(?:yes|y|confirm|ok\s*confirm|proceed|haan|ha|ji|approved?)\s*[!.]*\s*$", re.IGNORECASE)
_CANCEL_RE = re.compile(r"^\s*(?:no|n|cancel|stop|abort|nahi|mat\s*karo|never\s*mind)\s*[!.]*\s*$", re.IGNORECASE)

_BOOKING_CREATE_RE = re.compile(
    r"(?i)\b(?:book|schedule|fix|reserve|set\s+up)\s+(?:a\s+|an\s+|my\s+)?(?:appointment|meeting|consultation|demo|call|slot)\b"
)
_BOOKING_CANCEL_RE = re.compile(
    r"(?i)\b(?:cancel|delete|remove|call\s+off)\s+(?:my\s+|the\s+)?(?:appointment|booking|meeting|consultation|slot)\b"
)
_BILLING_RE = re.compile(
    r"(?i)\b(?:refund|payout|withdraw|upgrade\s+plan|subscribe|recharge|transfer\s+coins|billing\s+dispute)\b"
)
_HANDOVER_RE = re.compile(
    r"(?i)\b(?:talk\s+to\s+(?:a\s+)?(?:human|agent|person|representative|specialist|founder)|connect\s+me\s+to\s+(?:support|agent|human)|human\s+handover)\b"
)
_DATE_HINT_RE = re.compile(
    r"(?i)\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b"
)


def _extract_datetime_hint(text: str) -> str:
    matches = _DATE_HINT_RE.findall(str(text or ""))
    if not matches:
        return "Pending Schedule"
    return " ".join(matches[:2]).strip()


def _extract_service_hint(text: str) -> str:
    low = str(text or "").lower()
    if "security" in low or "audit" in low or "alpha" in low:
        return "Website Security Audit Consultation"
    if "app" in low or "android" in low or "ios" in low or "website" in low:
        return "Website & App Development Demo"
    if "blockchain" in low or "verify" in low:
        return "Blockchain Verification Consultation"
    return "WhatsApp AI Automation Consultation"


def classify_intent_and_risk(text: str, pending_state: Optional[dict] = None) -> Dict[str, Any]:
    clean = str(text or "").strip()
    pending_action = (pending_state or {}).get("pending_action")
    has_pending = (pending_state or {}).get("stage") == "awaiting_confirmation" and bool(pending_action)

    if has_pending and _CONFIRM_RE.match(clean):
        return {
            "intent": "confirm_pending",
            "risk_level": pending_action.get("risk_level", "medium"),
            "entities": {},
            "requires_confirmation": False,
            "is_confirm_reply": True,
            "is_cancel_reply": False,
        }

    if has_pending and _CANCEL_RE.match(clean):
        return {
            "intent": "cancel_pending",
            "risk_level": "low",
            "entities": {},
            "requires_confirmation": False,
            "is_confirm_reply": False,
            "is_cancel_reply": True,
        }

    if _BILLING_RE.search(clean):
        return {
            "intent": "billing_or_refund",
            "risk_level": "high",
            "action_name": "billing_support_escalation",
            "entities": {"summary": clean[:160]},
            "requires_confirmation": True,
            "is_confirm_reply": False,
            "is_cancel_reply": False,
        }

    if _BOOKING_CANCEL_RE.search(clean):
        return {
            "intent": "cancel_booking",
            "risk_level": "medium",
            "action_name": "cancel_booking",
            "entities": {},
            "requires_confirmation": True,
            "is_confirm_reply": False,
            "is_cancel_reply": False,
        }

    if _BOOKING_CREATE_RE.search(clean):
        return {
            "intent": "create_booking",
            "risk_level": "medium",
            "action_name": "create_booking",
            "entities": {
                "service": _extract_service_hint(clean),
                "date_time": _extract_datetime_hint(clean),
            },
            "requires_confirmation": True,
            "is_confirm_reply": False,
            "is_cancel_reply": False,
        }

    if _HANDOVER_RE.search(clean):
        return {
            "intent": "human_handover",
            "risk_level": "medium",
            "action_name": "escalate_to_human",
            "entities": {},
            "requires_confirmation": True,
            "is_confirm_reply": False,
            "is_cancel_reply": False,
        }

    return {
        "intent": "general_inquiry",
        "risk_level": "low",
        "action_name": "",
        "entities": {},
        "requires_confirmation": False,
        "is_confirm_reply": False,
        "is_cancel_reply": False,
    }


def _tool_create_booking(tenant_id: str, phone_number: str, params: dict) -> Dict[str, Any]:
    prof = db.get_customer_profile(phone_number, tenant_id=tenant_id)
    cname = (params.get("customer_name") or prof.get("contact_name") or prof.get("business_name") or "Customer").strip()
    svc = (params.get("service") or "WhatsApp AI Automation Consultation").strip()
    dt = (params.get("date_time") or "Pending Schedule").strip()
    bid = db.add_manual_booking(
        phone_number=phone_number,
        customer_name=cname,
        service=svc,
        date_time=dt,
        status="confirmed",
        notes="Confirmed via AI Agent Guardrail",
        tenant_id=tenant_id,
    )
    if not bid:
        return {"ok": False, "reply": "Sorry, I could not create the booking right now. Please try again."}
    return {
        "ok": True,
        "booking_id": bid,
        "reply": (
            f"✅ *Booking Confirmed (ID #{bid})*\n"
            f"• Service: {svc}\n"
            f"• Time: {dt}\n"
            "Our team has logged this in your workspace."
        ),
    }


def _tool_cancel_booking(tenant_id: str, phone_number: str, params: dict) -> Dict[str, Any]:
    clean_phone = db.normalize_phone_key(phone_number) or str(phone_number or "").replace("+", "").strip()
    all_bookings = db.get_bookings(tenant_id=tenant_id)
    target = None
    for b in all_bookings:
        bphone = db.normalize_phone_key(b.get("phone_number", "")) or str(b.get("phone_number", "")).replace("+", "").strip()
        if bphone == clean_phone and str(b.get("status", "")).lower() != "cancelled":
            target = b
            break
    if not target:
        return {"ok": False, "reply": "I couldn't find an active booking under your number to cancel."}
    ok = db.update_booking_status(int(target["id"]), "cancelled", tenant_id=tenant_id)
    if not ok:
        return {"ok": False, "reply": "Unable to cancel that booking right now. Please contact support."}
    return {
        "ok": True,
        "booking_id": int(target["id"]),
        "reply": f"❌ Your booking *#{target['id']}* ({target.get('service_requested', 'Consultation')}) has been cancelled cleanly.",
    }


def _tool_escalate_to_human(tenant_id: str, phone_number: str, params: dict) -> Dict[str, Any]:
    db.set_bot_enabled_for_contact(phone_number, False, tenant_id=tenant_id)
    return {
        "ok": True,
        "reply": (
            "👤 I have paused automated replies for this thread and alerted a human Growhaz specialist. "
            "Someone from our team will reply directly here shortly."
        ),
    }


def _tool_billing_support_escalation(tenant_id: str, phone_number: str, params: dict) -> Dict[str, Any]:
    db.set_bot_enabled_for_contact(phone_number, False, tenant_id=tenant_id)
    return {
        "ok": True,
        "reply": (
            "🔐 Your billing / refund request has been logged safely for human verification and audit review. "
            "For your protection, automated AI bots never execute wallet refunds or transfers directly."
        ),
    }


AUTHORIZED_TOOLS = {
    "create_booking": _tool_create_booking,
    "cancel_booking": _tool_cancel_booking,
    "escalate_to_human": _tool_escalate_to_human,
    "billing_support_escalation": _tool_billing_support_escalation,
}


def execute_authorized_tool(
    tenant_id: str,
    phone_number: str,
    action_name: str,
    params: Optional[dict] = None,
    actor: str = "customer",
    risk_level: str = "medium",
) -> Dict[str, Any]:
    """Execute ONLY allowlisted backend actions with tenant isolation and audit logging."""
    fn = AUTHORIZED_TOOLS.get(action_name)
    if not fn:
        db.log_action_audit(
            tenant_id=tenant_id,
            actor=actor,
            phone_number=phone_number,
            action_name=action_name or "unknown",
            status="denied",
            risk_level="high",
            details={"reason": "Tool not in allowlist"},
        )
        return {"ok": False, "reply": "That action is not permitted for automated execution."}

    try:
        res = fn(tenant_id, phone_number, params or {})
        db.log_action_audit(
            tenant_id=tenant_id,
            actor=actor,
            phone_number=phone_number,
            action_name=action_name,
            status="executed" if res.get("ok") else "failed",
            risk_level=risk_level,
            details={"params": params or {}, "booking_id": res.get("booking_id")},
        )
        return res
    except Exception as e:
        db.log_action_audit(
            tenant_id=tenant_id,
            actor=actor,
            phone_number=phone_number,
            action_name=action_name,
            status="error",
            risk_level=risk_level,
            details={"error": str(e)},
        )
        return {"ok": False, "reply": "An internal error prevented executing that action safely."}


def handle_guarded_turn(
    tenant_id: str,
    phone_number: str,
    user_text: str,
    sender_name: str = "",
    channel: str = "whatsapp",
    is_voice: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    Evaluate multi-turn conversation state & structured intent before calling LLM.
    Returns None for low-risk conversational queries; returns a deterministic dict
    `{reply, engine, intent, state}` when confirmation or tool execution applies.
    """
    if not phone_number or not str(user_text or "").strip():
        return None

    tid = str(tenant_id or "default").strip() or "default"
    state = db.get_conversation_state(tid, phone_number)

    # Expire stale pending confirmations automatically
    if state.get("stage") == "awaiting_confirmation" and state.get("pending_expires_at"):
        try:
            exp = datetime.fromisoformat(str(state["pending_expires_at"]).replace("Z", "+00:00"))
            if exp <= datetime.now(timezone.utc):
                db.clear_conversation_state(tid, phone_number)
                state = {"tenant_id": tid, "phone_number": phone_number, "stage": "idle", "pending_action": None}
        except Exception:
            pass

    parsed = classify_intent_and_risk(user_text, pending_state=state)
    intent = parsed["intent"]

    if intent == "confirm_pending":
        pending = state.get("pending_action") or {}
        action_name = pending.get("action_name", "")
        risk = pending.get("risk_level", "medium")

        # Require typed text confirmation for high-risk / financial voice requests
        if is_voice and risk == "high":
            db.log_action_audit(
                tenant_id=tid,
                actor=f"{channel}:{phone_number}",
                phone_number=phone_number,
                action_name=action_name,
                status="voice_confirmation_blocked",
                risk_level="high",
                details={"reason": "High-risk action cannot be authorized via voice alone"},
            )
            return {
                "reply": (
                    "🔐 For financial & billing security, voice confirmation is not accepted for this action.\n"
                    "Please type *CONFIRM* (as a text message) to proceed, or reply *CANCEL* to abort."
                ),
                "engine": "Agent Guardrail (Voice Safety)",
                "intent": intent,
            }

        db.log_action_audit(
            tenant_id=tid,
            actor=f"{channel}:{phone_number}",
            phone_number=phone_number,
            action_name=action_name,
            status="approved",
            risk_level=risk,
            details={"params": pending.get("params", {})},
        )
        tool_res = execute_authorized_tool(
            tenant_id=tid,
            phone_number=phone_number,
            action_name=action_name,
            params=pending.get("params", {}),
            actor=f"{channel}:{phone_number}",
            risk_level=risk,
        )
        db.clear_conversation_state(tid, phone_number)
        return {
            "reply": tool_res["reply"],
            "engine": f"Authorized Tool ({action_name})",
            "intent": intent,
        }

    if intent == "cancel_pending":
        pending = state.get("pending_action") or {}
        db.log_action_audit(
            tenant_id=tid,
            actor=f"{channel}:{phone_number}",
            phone_number=phone_number,
            action_name=pending.get("action_name", "unknown"),
            status="rejected_by_user",
            risk_level="low",
            details={},
        )
        db.clear_conversation_state(tid, phone_number)
        return {
            "reply": "Got it — I have cancelled that pending action. How else can I help you today?",
            "engine": "Agent Guardrail (Cancelled)",
            "intent": intent,
        }

    if parsed.get("requires_confirmation"):
        action_name = parsed["action_name"]
        entities = dict(parsed.get("entities") or {})
        if sender_name and "customer_name" not in entities:
            entities["customer_name"] = sender_name

        if action_name == "create_booking":
            summary = f"book *{entities.get('service')}* ({entities.get('date_time')})"
        elif action_name == "cancel_booking":
            summary = "cancel your active consultation booking"
        elif action_name == "escalate_to_human":
            summary = "pause AI auto-replies and connect a human specialist"
        else:
            summary = "submit a billing/refund request for human review"

        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        pending_payload = {
            "action_name": action_name,
            "params": entities,
            "risk_level": parsed["risk_level"],
            "summary": summary,
        }
        db.set_conversation_state(
            tid,
            phone_number,
            stage="awaiting_confirmation",
            pending_action=pending_payload,
            pending_expires_at=expires_at,
            last_intent=intent,
        )
        db.log_action_audit(
            tenant_id=tid,
            actor=f"{channel}:{phone_number}",
            phone_number=phone_number,
            action_name=action_name,
            status="requested_awaiting_confirmation",
            risk_level=parsed["risk_level"],
            details={"entities": entities, "is_voice": is_voice},
        )
        return {
            "reply": (
                f"Before I proceed to {summary}, please reply *YES* (or *CONFIRM*) to authorize, "
                "or reply *CANCEL* to abort."
            ),
            "engine": "Agent Guardrail (Confirmation Required)",
            "intent": intent,
        }

    return None
