import os
import secrets
import urllib.parse
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

import db

router = APIRouter(tags=["auth"])

SESSION_COOKIE_NAME = "liberstudy_session"
OAUTH_STATE_COOKIE_NAME = "liberstudy_oauth_state"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _frontend_origin() -> str:
    return (os.getenv("FRONTEND_ORIGIN", "").strip() or "http://localhost:5173").rstrip("/")


def _cookie_secure() -> bool:
    return _frontend_origin().startswith("https://")


def _cookie_samesite() -> str:
    value = os.getenv("SESSION_COOKIE_SAMESITE", "lax").strip().lower()
    return value if value in {"lax", "strict", "none"} else "lax"


def _allowed_google_emails() -> set[str]:
    raw = os.getenv("ALLOWED_GOOGLE_EMAILS", "")
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def _public_guest_access_enabled() -> bool:
    return os.getenv("PUBLIC_GUEST_ACCESS", "").strip().lower() in {"1", "true", "yes", "on"}


def _session_expire_days() -> int:
    try:
        return max(1, int(os.getenv("SESSION_EXPIRE_DAYS", "7")))
    except ValueError:
        return 7


def get_user_from_session_token(session_token: Optional[str]) -> Optional[dict]:
    if not session_token:
        return None
    return db.get_user_by_auth_session(session_token)


def _set_session_cookie(response: Response, session_token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_token,
        httponly=True,
        secure=_cookie_secure(),
        samesite=_cookie_samesite(),
        max_age=_session_expire_days() * 86400,
        path="/",
    )


def _clear_session_cookie(response: RedirectResponse) -> None:
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=_cookie_secure(),
        samesite=_cookie_samesite(),
        path="/",
    )


def _create_guest_user() -> dict:
    guest_id = secrets.token_hex(8)
    return db.upsert_google_user(
        google_id=f"guest:{guest_id}",
        email=f"guest-{guest_id}@liberstudy.local",
        name="访客用户",
        avatar_url=None,
    )


async def require_user(request: Request, response: Response) -> dict:
    user = get_user_from_session_token(request.cookies.get(SESSION_COOKIE_NAME))
    if user is None:
        if not _public_guest_access_enabled():
            raise HTTPException(status_code=401, detail="Authentication required")
        user = _create_guest_user()
        session_token = db.create_auth_session(user["id"], expire_days=_session_expire_days())
        _set_session_cookie(response, session_token)
    request.state.current_user = user
    return user


@router.get("/auth/google/login")
def google_login():
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "").strip()
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=500, detail="Google OAuth env vars are not configured")

    state = secrets.token_urlsafe(24)
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            "prompt": "select_account",
        }
    )
    response = RedirectResponse(f"{GOOGLE_AUTH_URL}?{query}")
    response.set_cookie(
        OAUTH_STATE_COOKIE_NAME,
        state,
        httponly=True,
        secure=_cookie_secure(),
        samesite=_cookie_samesite(),
        max_age=600,
        path="/",
    )
    return response


@router.get("/auth/google/callback")
async def google_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None):
    frontend_origin = _frontend_origin()
    error_redirect = RedirectResponse(f"{frontend_origin}/login?error=google_oauth_failed")
    error_redirect.delete_cookie(OAUTH_STATE_COOKIE_NAME, path="/")

    state_cookie = request.cookies.get(OAUTH_STATE_COOKIE_NAME)
    if not code or not state or not state_cookie or state != state_cookie:
        return error_redirect

    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "").strip()
    if not client_id or not client_secret or not redirect_uri:
        raise HTTPException(status_code=500, detail="Google OAuth env vars are not configured")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            token_res = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            token_res.raise_for_status()
            token_data = token_res.json()

            userinfo_res = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            )
            userinfo_res.raise_for_status()
            profile = userinfo_res.json()
    except Exception:
        return error_redirect

    email = (profile.get("email") or "").strip().lower()
    google_id = (profile.get("sub") or "").strip()
    name = (profile.get("name") or email or "Google User").strip()
    avatar_url = profile.get("picture")

    if not google_id or not email:
        return error_redirect

    allowlist = _allowed_google_emails()
    if allowlist and email not in allowlist:
        denied = RedirectResponse(f"{frontend_origin}/login?error=not_allowed")
        denied.delete_cookie(OAUTH_STATE_COOKIE_NAME, path="/")
        return denied

    user = db.upsert_google_user(
        google_id=google_id,
        email=email,
        name=name,
        avatar_url=avatar_url,
    )
    session_token = db.create_auth_session(user["id"], expire_days=_session_expire_days())

    response = RedirectResponse(f"{frontend_origin}/")
    response.delete_cookie(OAUTH_STATE_COOKIE_NAME, path="/")
    _set_session_cookie(response, session_token)
    return response


@router.get("/auth/me")
async def auth_me(request: Request, response: Response):
    user = await require_user(request, response)
    return user


@router.post("/auth/logout")
def auth_logout(request: Request):
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if session_token:
        db.delete_auth_session(session_token)
    response = JSONResponse({"ok": True})
    _clear_session_cookie(response)
    response.delete_cookie(OAUTH_STATE_COOKIE_NAME, path="/")
    return response
