"""Tests for reply validation utility behaviors."""

from services.llm_service import _reply_looks_truncated


def test_reply_looks_truncated_when_missing_terminal_punctuation() -> None:
    assert _reply_looks_truncated("Hello! I am AcreZen and I can help you") is True


def test_reply_looks_truncated_false_for_complete_sentence() -> None:
    assert _reply_looks_truncated("Hello! I am AcreZen and I can help you today.") is False


def test_reply_looks_truncated_true_for_trailing_comma() -> None:
    assert _reply_looks_truncated("I am ready to help,") is True
