import pytest
from fastapi import HTTPException

from app.schemas.annotation import AISuggestRequest
from app.services.ai_suggestion_service import AISuggestionService


def _ner_request(text: str) -> AISuggestRequest:
    return AISuggestRequest(task_type="ner", text=text, labels=["PER", "ORG", "LOC"])


def test_repairs_ner_offsets_when_entity_text_occurs_in_source() -> None:
    source_text = '"Nguyễn Văn A đang làm việc tại Viettel ở Hà Nội."'
    entity_text = "Nguyễn Văn A"
    payload = {
        "suggestions": [
            {
                "text": entity_text,
                "label": "PER",
                "start": 0,
                "end": len(entity_text),
                "confidence": 0.99,
            }
        ]
    }

    suggestions = AISuggestionService()._validate_suggestions(
        _ner_request(source_text), [], payload
    )

    assert suggestions[0]["start"] == 1
    assert suggestions[0]["end"] == 1 + len(entity_text)
    assert source_text[suggestions[0]["start"]:suggestions[0]["end"]] == entity_text


def test_keeps_valid_ner_offsets() -> None:
    source_text = "Nguyễn Văn A làm việc tại Viettel."
    entity_text = "Viettel"
    start = source_text.index(entity_text)
    payload = {
        "suggestions": [
            {
                "text": entity_text,
                "label": "ORG",
                "start": start,
                "end": start + len(entity_text),
                "confidence": 0.95,
            }
        ]
    }

    suggestions = AISuggestionService()._validate_suggestions(
        _ner_request(source_text), [], payload
    )

    assert suggestions[0]["start"] == start
    assert suggestions[0]["end"] == start + len(entity_text)


def test_rejects_ner_text_that_does_not_occur_in_source() -> None:
    payload = {
        "suggestions": [
            {
                "text": "Không tồn tại",
                "label": "PER",
                "start": 0,
                "end": 13,
                "confidence": 0.8,
            }
        ]
    }

    with pytest.raises(HTTPException, match="does not occur"):
        AISuggestionService()._validate_suggestions(
            _ner_request("Nguyễn Văn A làm việc tại Viettel."), [], payload
        )
