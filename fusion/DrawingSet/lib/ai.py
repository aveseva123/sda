"""AI assistant: edits a sheet specification from a natural-language request via the Claude API.

Fusion's embedded Python has no package manager, so the official SDK cannot be installed there;
the request is sent as raw HTTPS (urllib) following the Messages API shape:
POST https://api.anthropic.com/v1/messages with structured output (output_config.format).
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence

from .spec import AI_RESPONSE_SCHEMA, SPEC_DOC, normalize_sheet

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-opus-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM_PROMPT = """Ты — помощник конструктора мебельного производства. Ты редактируешь описание листа чертежа
(JSON-спецификацию) по просьбе пользователя. Верни обновлённый лист целиком и короткое объяснение по-русски
(что изменил, что невозможно и почему). Не меняй id листа, kind и subject. Сохраняй всё, о чём пользователь
не просил. Идентификаторы деталей и позиции бери из описания модели. Размеры на листе — в миллиметрах.

""" + SPEC_DOC


@dataclass
class AIResult:
    sheet: Dict[str, Any]
    explanation: str
    model: str = ""
    usage: Dict[str, Any] = field(default_factory=dict)
    refused: bool = False


class AIError(RuntimeError):
    pass


Transport = Callable[[Dict[str, Any], Dict[str, str]], Dict[str, Any]]


def _http_transport(body: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API_URL, data=data, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=600, context=ctx) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            message = payload.get("error", {}).get("message", str(exc))
        except Exception:
            message = str(exc)
        if exc.code == 401:
            raise AIError("Ключ API не принят (401). Проверьте ключ на вкладке «AI».") from exc
        if exc.code == 429:
            raise AIError("Лимит запросов API (429). Повторите через минуту.") from exc
        if exc.code == 400:
            raise AIError(f"Запрос отклонён API (400): {message}") from exc
        raise AIError(f"Ошибка API {exc.code}: {message}") from exc
    except urllib.error.URLError as exc:
        raise AIError(f"Нет связи с api.anthropic.com: {exc.reason}") from exc


class SheetAssistant:
    def __init__(self, api_key: str, model: str = DEFAULT_MODEL, effort: str = "high",
                 transport: Optional[Transport] = None):
        self.api_key = (api_key or os.environ.get("ANTHROPIC_API_KEY", "")).strip()
        self.model = model or DEFAULT_MODEL
        self.effort = effort if effort in ("low", "medium", "high", "xhigh", "max") else "high"
        self.transport = transport or _http_transport

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", "x-api-key": self.api_key, "anthropic-version": API_VERSION}
        if self.model.startswith(("claude-opus-5", "claude-fable")):
            headers["anthropic-beta"] = FALLBACK_BETA
        return headers

    def edit_sheet(self, sheet: Dict[str, Any], model_summary: str, request: str,
                   history: Optional[Sequence[Dict[str, str]]] = None) -> AIResult:
        if not self.api_key:
            raise AIError("Не задан ключ API. Введите его на вкладке «AI» (или переменная окружения ANTHROPIC_API_KEY).")
        messages: List[Dict[str, Any]] = []
        for turn in history or []:
            if turn.get("role") in ("user", "assistant") and turn.get("content"):
                messages.append({"role": turn["role"], "content": turn["content"]})
        user_text = (
            "Описание модели:\n" + model_summary + "\n\nТекущий лист (JSON):\n" + json.dumps(sheet, ensure_ascii=False)
            + "\n\nПросьба пользователя: " + request.strip()
        )
        messages.append({"role": "user", "content": user_text})
        body: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": 16000,
            "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            "messages": messages,
            "output_config": {"effort": self.effort, "format": {"type": "json_schema", "schema": AI_RESPONSE_SCHEMA}},
        }
        if self.model.startswith(("claude-opus-5", "claude-fable")):
            body["fallbacks"] = "default"
        response = self.transport(body, self._headers())
        stop = response.get("stop_reason")
        if stop == "refusal":
            details = response.get("stop_details") or {}
            return AIResult(sheet=sheet, explanation=f"Модель отказалась выполнять запрос ({details.get('category') or 'без категории'}).",
                            model=response.get("model", ""), usage=response.get("usage", {}), refused=True)
        if stop == "max_tokens":
            raise AIError("Ответ модели обрезан по лимиту токенов; упростите просьбу.")
        text = next((b.get("text", "") for b in response.get("content", []) if b.get("type") == "text"), "")
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise AIError(f"Модель вернула не JSON: {text[:200]}") from exc
        new_sheet = normalize_sheet(data.get("sheet") or {}, sheet)
        new_sheet["id"], new_sheet["kind"], new_sheet["subject"] = sheet["id"], sheet["kind"], sheet["subject"]
        return AIResult(sheet=new_sheet, explanation=str(data.get("explanation") or ""),
                        model=response.get("model", ""), usage=response.get("usage", {}))


def model_summary(data: Any, rows: Sequence[Any], scene: Any = None, max_parts: int = 120) -> str:
    """Compact description of the model for the prompt: parts, positions, sizes, holes, sub-assemblies."""
    lines = [f"Изделие: {data.product}; проект {data.project}; вид {data.view}."]
    lines.append("Детали (occ_id | поз. | название | материал | толщина | Д×Ш | категория | отверстий):")
    count = 0
    for p in data.parts:
        if p.category == "assembly":
            lines.append(f"  подсборка {p.occ_id} | {p.position} | {p.title}")
            continue
        holes = ""
        if scene is not None and p.occ_id in scene.parts:
            n = sum(len(b.holes) for b in scene.parts[p.occ_id].bodies)
            holes = str(n)
        lines.append(f"  {p.occ_id} | {p.position} | {p.title} | {p.material} | {p.thickness_mm:g} | "
                     f"{p.length_mm:g}×{p.width_mm:g} | {p.category}{' крепёж' if p.is_hardware else ''} | {holes}")
        count += 1
        if count >= max_parts:
            lines.append(f"  … ещё {len(data.parts) - count} деталей")
            break
    if rows:
        lines.append("Уникальные позиции (ключ листа деталировки part:<key>):")
        from .spec import row_key
        for r in rows:
            if not r.is_hardware:
                lines.append(f"  part:{row_key(r)} — поз. {r.position} {r.title}, {r.quantity} шт.")
    return "\n".join(lines)
