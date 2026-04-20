from services.llm_service import _agriculture_refusal, _looks_agriculture_prompt


def test_agriculture_prompt_detection_matches_planting_query():
    assert _looks_agriculture_prompt('ny suggestion for planting apple tree') is True


def test_agriculture_prompt_detection_rejects_unrelated_query():
    assert _looks_agriculture_prompt('what is the capital of france') is False


def test_agriculture_refusal_uses_same_language_family():
    english_refusal = _agriculture_refusal('en')
    malay_refusal = _agriculture_refusal('ms')

    assert 'agriculture-related' in english_refusal
    assert 'pertanian' in malay_refusal
