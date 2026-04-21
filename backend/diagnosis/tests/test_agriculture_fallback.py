from services.llm_service import (
    _agriculture_fallback,
    _agriculture_refusal,
    _is_casual_prompt,
    _looks_agriculture_prompt,
)


def test_agriculture_prompt_detection_matches_planting_query():
    assert _looks_agriculture_prompt('ny suggestion for planting apple tree') is True


def test_agriculture_prompt_detection_rejects_unrelated_query():
    assert _looks_agriculture_prompt('what is the capital of france') is False


def test_agriculture_refusal_uses_same_language_family():
    english_refusal = _agriculture_refusal('en')
    malay_refusal = _agriculture_refusal('ms')

    assert 'AcreZen' in english_refusal
    assert 'farming assistant' in english_refusal.lower()
    assert 'AcreZen' in malay_refusal
    assert 'pembantu' in malay_refusal.lower() or 'ladang' in malay_refusal.lower()


def test_agriculture_refusal_is_conversational_without_headings():
    refusal = _agriculture_refusal('en')
    assert 'Finding' not in refusal
    assert 'Actions' not in refusal
    assert 'Treatment' not in refusal
    assert 'Recheck' not in refusal


def test_agriculture_fallback_is_conversational_without_headings():
    fallback = _agriculture_fallback('en')
    assert 'Finding' not in fallback
    assert 'Actions' not in fallback
    assert 'Treatment' not in fallback
    assert 'Recheck' not in fallback


def test_is_casual_prompt_detects_greeting_and_intro_queries():
    assert _is_casual_prompt('hi there') is True
    assert _is_casual_prompt('what can you do?') is True
    assert _is_casual_prompt('who are you') is True
    assert _is_casual_prompt('boleh bantu saya') is True
    assert _is_casual_prompt('how do I manage tomato blight') is False
